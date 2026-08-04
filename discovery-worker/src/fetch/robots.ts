// robots.txt fetching, parsing and matching, per RFC 9309 semantics:
// group selection by most-specific user-agent token, longest-match rule
// precedence, allow wins a length tie, '*' wildcards and '$' end anchors.
//
// Failure posture is deliberately conservative and honest:
//   * no robots.txt (404 / other 4xx)  -> everything is allowed
//   * robots.txt unreachable (5xx/network) -> NOTHING is fetched from that
//     host this run. Guessing "probably fine" is how a bot ends up on
//     blocklists; a paid product cannot afford that reputation.

export interface RobotsRule {
  allow: boolean;
  pattern: string;
}

export interface RobotsGroup {
  userAgents: string[];
  rules: RobotsRule[];
  crawlDelaySeconds: number | null;
}

export interface RobotsRules {
  groups: RobotsGroup[];
  // Sitemap: directives are site-wide, not per-user-agent. They are the
  // single cheapest route to a site's full page inventory — an organiser
  // that lists 200 races behind JavaScript usually still enumerates every
  // race URL in its sitemap.
  sitemaps: string[];
}

export type RobotsAvailability = 'ok' | 'no_robots' | 'unreachable';

export interface RobotsDecision {
  allowed: boolean;
  availability: RobotsAvailability;
  crawlDelaySeconds: number | null;
  matchedRule: string | null;
}

export function parseRobots(text: string): RobotsRules {
  const groups: RobotsGroup[] = [];
  const sitemaps: string[] = [];
  let current: RobotsGroup | null = null;
  // A group is "open" while consecutive user-agent lines accumulate; the
  // first rule line closes the user-agent run.
  let collectingAgents = false;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (!line) continue;
    const sep = line.indexOf(':');
    if (sep === -1) continue;
    const field = line.slice(0, sep).trim().toLowerCase();
    const value = line.slice(sep + 1).trim();

    if (field === 'user-agent') {
      if (!collectingAgents) {
        current = { userAgents: [], rules: [], crawlDelaySeconds: null };
        groups.push(current);
        collectingAgents = true;
      }
      current!.userAgents.push(value.toLowerCase());
    } else if (field === 'allow' || field === 'disallow') {
      if (!current) continue; // rule before any user-agent line — ignored
      collectingAgents = false;
      // An empty Disallow means "allow everything" and matches nothing as
      // a pattern; recording it with an empty pattern gives it length 0,
      // so any real rule outranks it — which is the correct behaviour.
      current.rules.push({ allow: field === 'allow', pattern: value });
    } else if (field === 'crawl-delay') {
      if (!current) continue;
      collectingAgents = false;
      const n = Number(value);
      if (Number.isFinite(n) && n >= 0) current.crawlDelaySeconds = n;
    } else if (field === 'sitemap') {
      if (value) sitemaps.push(value);
      if (current) collectingAgents = false;
    } else {
      // unknown fields end a user-agent run but keep the group
      if (current) collectingAgents = false;
    }
  }
  return { groups, sitemaps: [...new Set(sitemaps)] };
}

// Most-specific group for our token: exact/substring token match beats
// '*'. Token comparison is on the product token (e.g. "swimloadingdiscoverybot"),
// case-insensitive, per RFC 9309 §2.2.1.
function selectGroup(rules: RobotsRules, userAgentToken: string): RobotsGroup | null {
  const token = userAgentToken.toLowerCase();
  let best: RobotsGroup | null = null;
  let bestSpecificity = -1;
  for (const group of rules.groups) {
    for (const agent of group.userAgents) {
      let specificity = -1;
      if (agent === '*') specificity = 0;
      else if (token.includes(agent) || agent.includes(token)) specificity = agent.length;
      if (specificity > bestSpecificity) {
        bestSpecificity = specificity;
        best = group;
      }
    }
  }
  return best;
}

// Pattern match with '*' (any chars) and '$' (end anchor) support.
function patternMatches(pattern: string, path: string): boolean {
  if (pattern === '') return false;
  const anchored = pattern.endsWith('$');
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const regex = body
    .split('*')
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp(`^${regex}${anchored ? '$' : ''}`).test(path);
}

export function isPathAllowed(rules: RobotsRules, userAgentToken: string, path: string): { allowed: boolean; matchedRule: string | null } {
  const group = selectGroup(rules, userAgentToken);
  if (!group) return { allowed: true, matchedRule: null };

  let bestLength = -1;
  let bestAllow = true;
  let bestRule: string | null = null;
  for (const rule of group.rules) {
    if (!patternMatches(rule.pattern, path)) continue;
    const length = rule.pattern.length;
    // Longest match wins; allow wins an exact length tie.
    if (length > bestLength || (length === bestLength && rule.allow && !bestAllow)) {
      bestLength = length;
      bestAllow = rule.allow;
      bestRule = `${rule.allow ? 'Allow' : 'Disallow'}: ${rule.pattern}`;
    }
  }
  return { allowed: bestLength === -1 ? true : bestAllow, matchedRule: bestRule };
}

export function crawlDelayFor(rules: RobotsRules, userAgentToken: string): number | null {
  return selectGroup(rules, userAgentToken)?.crawlDelaySeconds ?? null;
}

export type RobotsFetcher = (robotsUrl: string) => Promise<{ status: number; text: string } | { networkError: string }>;

interface CachedRobots {
  availability: RobotsAvailability;
  rules: RobotsRules | null;
}

// Per-origin robots cache for the lifetime of one worker process. A crawl
// pass touches each origin many times; robots.txt is fetched once.
export class RobotsCache {
  private readonly cache = new Map<string, Promise<CachedRobots>>();

  constructor(
    private readonly fetcher: RobotsFetcher,
    private readonly userAgentToken: string
  ) {}

  // Sitemap URLs this origin declares in robots.txt. Empty when robots is
  // absent, unreachable, or declares none — callers fall back to probing
  // the conventional /sitemap.xml path.
  async sitemapsFor(pageUrl: string): Promise<string[]> {
    const origin = new URL(pageUrl).origin;
    let entry = this.cache.get(origin);
    if (!entry) {
      entry = this.load(origin);
      this.cache.set(origin, entry);
    }
    const { rules } = await entry;
    return rules?.sitemaps ?? [];
  }

  async check(pageUrl: string): Promise<RobotsDecision> {
    const url = new URL(pageUrl);
    const origin = url.origin;
    let entry = this.cache.get(origin);
    if (!entry) {
      entry = this.load(origin);
      this.cache.set(origin, entry);
    }
    const { availability, rules } = await entry;

    if (availability === 'unreachable') {
      return { allowed: false, availability, crawlDelaySeconds: null, matchedRule: null };
    }
    if (availability === 'no_robots' || !rules) {
      return { allowed: true, availability, crawlDelaySeconds: null, matchedRule: null };
    }
    const { allowed, matchedRule } = isPathAllowed(rules, this.userAgentToken, url.pathname + url.search);
    return { allowed, availability, crawlDelaySeconds: crawlDelayFor(rules, this.userAgentToken), matchedRule };
  }

  private async load(origin: string): Promise<CachedRobots> {
    const result = await this.fetcher(`${origin}/robots.txt`);
    if ('networkError' in result) return { availability: 'unreachable', rules: null };
    if (result.status >= 200 && result.status < 300) {
      return { availability: 'ok', rules: parseRobots(result.text) };
    }
    if (result.status >= 500) return { availability: 'unreachable', rules: null };
    // 404 and other 4xx: the site publishes no robots policy — allowed.
    return { availability: 'no_robots', rules: null };
  }
}
