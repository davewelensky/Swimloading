#!/usr/bin/env node
// Is graphify-out/ still a fair description of this repository?
//
// WHY THIS EXISTS. The graph is worth having as a navigation layer, and
// worth nothing if it silently describes last week's code. But rebuilding
// it after every edit is the opposite failure: minutes of work and a pile
// of tokens to re-learn something that did not change. So this answers one
// question — CURRENT or STALE — cheaply enough to run before any broad
// exploration, and says WHY when the answer is STALE.
//
// HOW FRESHNESS IS DECIDED. `npm run graph:refresh` leaves a stamp
// (commit + time). Freshness is that commit diffed against HEAD, plus any
// uncommitted file touched since the stamp. Deterministic, and it survives
// graphify choosing not to rewrite graph.json when a rebuild finds nothing
// new — which it does, and which broke the two more obvious baselines
// (graph.json's mtime and its built_at_commit) before this stamp existed.
//
// THE FILE FILTER IS DERIVED, NOT INVENTED. RELEVANT_EXT below is exactly
// the set of extensions the existing graph has nodes for (551 indexed
// files on 2026-08-19: .sql .js .ts .html .md .mjs .json .py .txt .sh).
// If graphify's own coverage changes, re-run the one-liner in the test
// block at the bottom rather than guessing.
//
//   node scripts/graph-freshness.mjs           # human summary, exit 0/1
//   node scripts/graph-freshness.mjs --json    # machine readable
//   node scripts/graph-freshness.mjs --quiet   # exit code only
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const REPO = path.resolve(new URL('..', import.meta.url).pathname);
const GRAPH = path.join(REPO, 'graphify-out', 'graph.json');

// Extensions graphify actually extracts nodes from.
const RELEVANT_EXT = new Set(['.sql', '.js', '.ts', '.html', '.md', '.mjs', '.json', '.py', '.txt', '.sh']);

// Never relevant, whatever their extension: not source, or generated FROM
// source. graphify already excludes these from extraction, so a change in
// one can never change the graph.
const IGNORED_PREFIX = [
  '.git/', 'node_modules/', 'graphify-out/', 'out/', 'dist/', 'build/',
  'coverage/', '.claude-worktrees/', '.vercel/', 'archive/', '14files/',
];
const IGNORED_FILE = new Set(['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', '.DS_Store']);
// Editor/agent debris and backups that sit beside real source.
const IGNORED_SUFFIX = ['.bak', '.bak2', '.save', '.min.js', '.map', '.log'];

// Changes that alter the SHAPE of the codebase — a new API handler, a
// deleted module, a renamed script — invalidate the graph immediately,
// because the graph is a map of what exists. Edits inside a file that
// already exists are a matter of degree, so they accumulate to a threshold.
const STRUCTURAL_STATUS = new Set(['A', 'D', 'R', 'C']);
const MODIFIED_THRESHOLD = Number(process.env.GRAPH_STALE_THRESHOLD || 10);

const git = (args) => {
  try {
    return execFileSync('git', args, { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return '';
  }
};

// A .json is either configuration that shapes the architecture (routes,
// scripts, workspace packages) or a data dump that happens to live in the
// repo (brevo-contacts.json, all_historical_swimmers.json). Only the first
// kind can change the graph.
//
// The list is not invented: it is the set of json basenames graphify
// actually has nodes for (.mcp.json, package.json, vercel.json,
// manifest.json, railway.json, tsconfig.json), which is the honest
// definition of "json this graph cares about". Size was tried first and
// was wrong — a 201 KB export sailed under a 256 KB bar.
const JSON_CONFIG_NAMES = new Set([
  'package.json', 'vercel.json', 'manifest.json', '.mcp.json',
  'tsconfig.json', 'railway.json', 'launch.json', 'settings.json',
]);

export function isRelevant(file) {
  if (!file) return false;
  // git quotes paths containing spaces or non-ASCII — strip before matching,
  // or "blog/may update.html" fails every prefix test and passes as new.
  const f = file.trim().replace(/^"|"$/g, '');
  if (IGNORED_PREFIX.some((p) => f.startsWith(p))) return false;
  if (IGNORED_FILE.has(path.basename(f))) return false;
  if (IGNORED_SUFFIX.some((s) => f.endsWith(s))) return false;
  const ext = path.extname(f).toLowerCase();
  if (!RELEVANT_EXT.has(ext)) return false;
  if (ext === '.json' && !JSON_CONFIG_NAMES.has(path.basename(f))) return false;
  return true;
}

// The refresh marker.
//
// graph.json's own mtime and built_at_commit CANNOT serve as "when did we
// last refresh": graphify prints "No code-graph topology changes detected;
// outputs left untouched" and leaves the file alone whenever a rebuild
// finds nothing new. So a file it has already examined and judged
// uninteresting would be reported as changed forever. This stamp records
// that we ran it, whatever it decided — written by `npm run graph:refresh`.
const STAMP = path.join(REPO, 'graphify-out', '.freshness-stamp.json');

function writeStamp() {
  const stamp = {
    at: new Date().toISOString(),
    commit: git(['rev-parse', 'HEAD']).trim() || null,
  };
  writeFileSync(STAMP, JSON.stringify(stamp, null, 2));
  return stamp;
}

function readStamp() {
  try {
    return JSON.parse(readFileSync(STAMP, 'utf8'));
  } catch {
    return null;
  }
}

/** The commit graph.json was built from, without parsing 12 MB of JSON. */
function builtAtCommit() {
  if (!existsSync(GRAPH)) return null;
  const head = readFileSync(GRAPH, 'utf8').slice(-4000);
  const m = head.match(/"built_at_commit"\s*:\s*"([0-9a-f]{7,40})"/);
  return m ? m[1] : null;
}

export function checkFreshness() {
  if (!existsSync(GRAPH)) {
    return { state: 'STALE', reason: 'no graph yet — graphify-out/graph.json does not exist', structural: [], modified: [] };
  }
  const stamp = readStamp();
  // The stamp is authoritative when present; built_at_commit is the
  // fallback for a graph built before this tooling existed.
  const commit = stamp?.commit || builtAtCommit();
  if (!commit) {
    return { state: 'STALE', reason: 'graph.json records no built_at_commit', structural: [], modified: [] };
  }
  // A commit we cannot resolve (rebased away, shallow clone) means we
  // cannot prove freshness — and unprovable is not the same as fresh.
  if (!git(['cat-file', '-t', commit]).startsWith('commit')) {
    return { state: 'STALE', reason: `built_at_commit ${commit.slice(0, 7)} is not in this history`, structural: [], modified: [] };
  }

  const structural = [];
  const modified = [];
  const note = (status, file) => {
    if (!isRelevant(file)) return;
    const clean = String(file).trim().replace(/^"|"$/g, '');
    (STRUCTURAL_STATUS.has(status[0]) ? structural : modified).push(clean);
  };

  const baselineMs = stamp?.at ? Date.parse(stamp.at) : statSync(GRAPH).mtimeMs;
  const touchedSinceBaseline = (file) => {
    try {
      return statSync(path.join(REPO, file)).mtimeMs > baselineMs;
    } catch {
      return true; // gone from disk — that is a real change
    }
  };

  // Committed changes since the graph was built...
  //
  // ...but a file can appear here as "added" merely because it was
  // COMMITTED, having sat untracked on disk for days. graphify reads the
  // working tree, so it indexed that file long ago and nothing about the
  // graph changed when git finally started tracking it. This tool flagged
  // its own commit that way. If the file predates the stamp, it is already
  // in the graph whatever git thinks.
  for (const line of git(['diff', '--name-status', `${commit}..HEAD`]).split('\n')) {
    if (!line.trim()) continue;
    const [status, ...paths] = line.split('\t');
    const file = paths[paths.length - 1];
    if (!touchedSinceBaseline(file)) continue;
    note(status, file);
  }
  // ...plus uncommitted work, because the graph describes the code on disk,
  // not the code that happens to be committed.
  //
  // BUT only the part of it that postdates the graph. `graphify update`
  // reads the WORKING TREE, so every uncommitted file that existed when it
  // ran is already represented. Counting all of them made the checker
  // report STALE the instant after a successful refresh — this repo
  // permanently carries ~13 untracked files, so the tool would have cried
  // wolf forever and been ignored, which is worse than not having it.
  // graph.json's own mtime is the refresh timestamp; nothing to maintain.
  for (const line of git(['status', '--porcelain']).split('\n')) {
    if (!line.trim()) continue;
    const status = line.slice(0, 2).trim();
    const file = String(line.slice(3).split(' -> ').pop()).trim().replace(/^"|"$/g, '');
    if (!touchedSinceBaseline(file)) continue;
    note(status === '??' ? 'A' : status, file);
  }

  const uniq = (a) => [...new Set(a)];
  const s = uniq(structural);
  const m = uniq(modified).filter((f) => !s.includes(f));

  if (s.length) {
    return { state: 'STALE', reason: `${s.length} file(s) added, deleted or renamed`, structural: s, modified: m, commit };
  }
  if (m.length >= MODIFIED_THRESHOLD) {
    return { state: 'STALE', reason: `${m.length} relevant files changed (threshold ${MODIFIED_THRESHOLD})`, structural: s, modified: m, commit };
  }
  return { state: 'CURRENT', reason: m.length ? `${m.length} file(s) changed, below threshold ${MODIFIED_THRESHOLD}` : 'no relevant changes', structural: s, modified: m, commit };
}

// ── CLI ────────────────────────────────────────────────────────────────
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  if (args.includes('--stamp')) {
    const s = writeStamp();
    console.log(`Graphify: refreshed at ${s.at} (${(s.commit || 'no commit').slice(0, 7)})`);
    process.exit(0);
  }
  const result = checkFreshness();
  if (args.includes('--json')) {
    console.log(JSON.stringify(result, null, 2));
  } else if (!args.includes('--quiet')) {
    const count = result.structural.length + result.modified.length;
    console.log(result.state === 'CURRENT'
      ? `Graphify: CURRENT — ${result.reason}`
      : `Graphify: STALE — ${result.reason}`);
    if (result.state === 'STALE' && count) {
      const sample = [...result.structural, ...result.modified].slice(0, 8);
      for (const f of sample) console.log(`  ${result.structural.includes(f) ? '+/-' : ' ~ '} ${f}`);
      if (count > sample.length) console.log(`  … and ${count - sample.length} more`);
      console.log('\nRefresh with: npm run graph:refresh');
    }
  }
  process.exit(result.state === 'CURRENT' ? 0 : 1);
}
