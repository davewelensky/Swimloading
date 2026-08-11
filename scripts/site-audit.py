#!/usr/bin/env python3
"""Audit the live site: broken links, SEO fields, structured data.

    python3 scripts/site-audit.py                 # the standard page set
    python3 scripts/site-audit.py /explore /pro   # just these

Read-only. Fetches only swimloading.com, five at a time.

WHY THIS EXISTS
---------------
Written 2026-08-09 after /explore turned out to be indexable, absent from
the sitemap and linked from nowhere — three separate reasons a page could
not be found, none of which showed up by looking at the page. Broken links
and missing meta are invisible until something enumerates them.

A NOTE ON PARSING HTML WITH REGEX
---------------------------------
This does, and the first version was wrong in the way everyone is wrong.
It reported /explore's title as 241 characters because an HTML COMMENT on
that page contained the literal text "<title>" while discussing titles.
The regex matched the mention inside the comment as an opening tag and ran
to the real closing tag.

The lesson is not "use a parser" — this stays dependency-free on purpose —
it is that comments, scripts and inline SVG are not content and must be
removed BEFORE anything is matched, and that head-only fields must be
looked for in the head only. All three are handled below. A tool that
reports a fault which is not there costs more than one that reports
nothing, because the next hour goes on the phantom.
"""
import re
import sys
import urllib.request
import urllib.error
from concurrent.futures import ThreadPoolExecutor
from collections import defaultdict

SITE = 'https://www.swimloading.com'
UA = 'Mozilla/5.0 (compatible; SwimLoadingSiteAudit/1.0; +https://www.swimloading.com)'

DEFAULT_PAGES = [
    '/', '/explore', '/list-your-swim', '/pricing', '/pro', '/intel', '/campaign',
    '/robben', '/ri', '/capepoint', '/dassen', '/preekstool', '/westangle',
    '/clubs', '/swimmers', '/crossings', '/crossing-prep',
    '/crossings/english-channel', '/spots', '/spots/atlantic', '/spots/false-bay',
    '/swims/south-africa', '/partners/maurten', '/partners/sis', '/partners/blu-smooth',
    '/partners/magic5', '/partners/blueseventy', '/partners/trihard', '/partners/eolab',
]


def fetch(url, method='GET'):
    req = urllib.request.Request(url, method=method, headers={'User-Agent': UA})
    try:
        with urllib.request.urlopen(req, timeout=25) as r:
            return r.status, (r.read().decode('utf-8', 'replace') if method == 'GET' else '')
    except urllib.error.HTTPError as e:
        return e.code, ''
    except Exception as e:
        return 0, '%s: %s' % (type(e).__name__, e)


def strip_noise(html):
    """Remove everything that is not content before matching anything.

    Comments first — a comment may legally contain any tag-looking text,
    which is exactly what broke the original version of this script.
    """
    html = re.sub(r'<!--.*?-->', ' ', html, flags=re.S)
    html = re.sub(r'<(script|style|noscript)\b[^>]*>.*?</\1>', ' ', html, flags=re.S | re.I)
    html = re.sub(r'<svg\b[^>]*>.*?</svg>', ' ', html, flags=re.S | re.I)  # SVGs carry their own <title>
    return html


def head_of(html):
    m = re.search(r'<head\b[^>]*>(.*?)</head>', html, re.S | re.I)
    return m.group(1) if m else html[:20000]


def meta_content(head, *, name=None, prop=None):
    attr, val = ('name', name) if name else ('property', prop)
    pat_a = r'<meta[^>]+%s=["\']%s["\'][^>]*content=["\']([^"\']*)' % (attr, re.escape(val))
    pat_b = r'<meta[^>]+content=["\']([^"\']*)["\'][^>]*%s=["\']%s["\']' % (attr, re.escape(val))
    m = re.search(pat_a, head, re.I) or re.search(pat_b, head, re.I)
    return m.group(1).strip() if m else None


def audit_page(url):
    status, html = fetch(url)
    if status != 200 or not html:
        return {'url': url, 'status': status, 'error': html[:120] or None}

    clean = strip_noise(html)
    head = head_of(clean)

    # Title from the HEAD only, and non-greedy within it.
    tm = re.search(r'<title[^>]*>(.*?)</title>', head, re.S | re.I)
    canon = re.search(r'<link[^>]+rel=["\']canonical["\'][^>]*href=["\']([^"\']*)', head, re.I)

    body = clean[clean.find('<body'):] if '<body' in clean else clean
    links = set()
    for m in re.finditer(r'href=["\'](/[^"\'#?][^"\']*)["\']', body):
        links.add(m.group(1).split('#')[0].split('?')[0].rstrip('/') or '/')

    return {
        'url': url, 'status': status,
        'title': re.sub(r'\s+', ' ', tm.group(1)).strip() if tm else None,
        'desc': meta_content(head, name='description'),
        'robots': meta_content(head, name='robots'),
        'canonical': canon.group(1) if canon else None,
        'og_title': meta_content(head, prop='og:title'),
        'h1_count': len(re.findall(r'<h1\b', body, re.I)),
        'jsonld': len(re.findall(r'application/ld\+json', html, re.I)),
        'links': sorted(links),
    }


def main():
    pages = sys.argv[1:] or DEFAULT_PAGES
    print('Auditing %d pages…\n' % len(pages), file=sys.stderr)
    with ThreadPoolExecutor(max_workers=5) as ex:
        results = list(ex.map(lambda p: audit_page(SITE + p), pages))

    print('=== PAGE STATUS ===')
    bad = [r for r in results if r['status'] != 200]
    for r in bad:
        print('  %-34s %s %s' % (r['url'].replace(SITE, ''), r['status'], r.get('error') or ''))
    print('  %d of %d returned 200' % (len(results) - len(bad), len(results)))

    print('\n=== SEO FIELDS ===')
    print('  %-30s %-6s %-5s %-6s %-4s %s' % ('page', 'title', 'desc', 'canon', 'h1', 'notes'))
    for r in results:
        if r['status'] != 200:
            continue
        p = r['url'].replace(SITE, '') or '/'
        noindex = 'noindex' in (r['robots'] or '')
        flags = []
        if noindex:
            flags.append('noindex (intentional? then the gaps below do not matter)')
        else:
            if not r['title']: flags.append('NO TITLE')
            elif len(r['title']) > 65: flags.append('title %d chars' % len(r['title']))
            if not r['desc']: flags.append('NO DESC')
            elif len(r['desc']) > 160: flags.append('desc %d chars' % len(r['desc']))
            if not r['canonical']: flags.append('no canonical')
            if r['h1_count'] == 0: flags.append('NO H1')
            elif r['h1_count'] > 1: flags.append('%d H1s' % r['h1_count'])
            if not r['og_title']: flags.append('no og:title')
            if r['jsonld'] == 0: flags.append('no JSON-LD')
        print('  %-30s %-6s %-5s %-6s %-4s %s' % (
            p, len(r['title'] or ''), len(r['desc'] or ''),
            'y' if r['canonical'] else 'NO', r['h1_count'],
            '; '.join(flags) if flags else 'ok'))

    all_links = defaultdict(set)
    for r in results:
        for l in r.get('links', []):
            all_links[l].add(r['url'].replace(SITE, '') or '/')

    print('\n=== %d DISTINCT INTERNAL LINKS ===' % len(all_links))
    with ThreadPoolExecutor(max_workers=5) as ex:
        statuses = list(ex.map(lambda t: (t, fetch(SITE + t, 'HEAD')[0]), sorted(all_links)))
    broken = [(t, s) for t, s in statuses if s not in (200, 301, 302, 308)]
    for t, s in broken:
        print('  BROKEN %-40s %s  from: %s' % (t, s, ', '.join(sorted(all_links[t]))[:80]))
    print('  %d ok / %d checked' % (len(statuses) - len(broken), len(statuses)))


if __name__ == '__main__':
    main()
