/**
 * SwimLoading — eo SwimBETTER Performance Challenge Winner Draw
 *
 * Run once, after 31 October 2026 (SAST), once the Aug-Oct window has fully
 * closed. The script refuses to draw while the window is still open.
 *
 * Mechanic (confirmed by Dave, 2026-07-29):
 *   - Qualify: 30+ active days (config.qualify_min_active_days) across the
 *     full Aug 1 - Oct 31 window. An "active day" = 1+ real (non-sensor,
 *     non-backdated) temp log that day — see eo_log_active_date() in
 *     sql/applied/2026-08-20_eo-challenge-record-every-swim.sql.
 *   - Draw pool: everyone who qualifies, capped at config.draw_pool_cap (20)
 *     — if more than 20 qualify, only the top 20 by active-day count (then
 *     longest streak) enter; if fewer than 20 qualify, everyone who
 *     qualifies enters.
 *   - Equal odds within the pool — once you've cleared the consistency bar,
 *     every finalist has exactly the same chance. This is the actual
 *     "fair" part Dave asked for — not weighted by how consistent you were
 *     beyond the bar.
 *
 * Who can never win (same standing rule as draw-monthly-winner.mjs):
 *   - the organiser (DaveW, shown in the app as "KGB")
 *   - the organiser's partner ("Ysie"), conflict of interest since 1 Aug 2026
 *   Both are removed BEFORE the qualifying threshold and the pool cap are
 *   applied, so an excluded account inside the top 20 lets the next
 *   qualifier in rather than shrinking the pool. The pool is therefore built
 *   here, from get_eo_challenge_leaders(), not taken from
 *   get_eo_challenge_draw_pool() (which caps before any exclusion).
 *
 * Uses crypto.randomInt (not Math.random) for the same reason as
 * draw-monthly-winner.mjs — not seedable/predictable. Prints a full audit
 * log of the entire draw pool before picking, then stores a DRAFT result in
 * challenge_draw_results (same table the July draw uses) for admin approval
 * in /admin — never announce a winner from this script's console output
 * directly.
 *
 * Usage:
 *   SUPABASE_SERVICE_KEY=xxx node scripts/draw-eo-swimbetter-winner.mjs             # the real draw
 *   SUPABASE_SERVICE_KEY=xxx node scripts/draw-eo-swimbetter-winner.mjs --dry-run   # preview only
 *
 * Flags:
 *   --dry-run                          build and print the pool exactly as the real draw would,
 *                                      but pick nobody and store nothing. Also runs while the
 *                                      window is still open, so the draw can be rehearsed.
 *   --exclude=<user_id>[,<user_id>]    extra accounts removed from the pool (replacement draws only)
 *   --replaces=<challenge_draw_results.id>   links the new row to the one it replaces (replacement_for)
 *   --reason="..."                     recorded in the new row's description (the real, disclosed reason)
 */

import { createClient } from '@supabase/supabase-js';
import { randomInt } from 'crypto';

const SUPABASE_URL         = 'https://szgkzuswelntnevobnoh.supabase.co';
const CHALLENGE_ID         = '2026-08_eo-swimbetter'; // Aug-Oct 2026, distinct key space from the monthly '2026-07' style ids
const CHALLENGE_NAME       = 'eo SwimBETTER Performance Challenge (Aug 1 - Oct 31 2026)';
const ORGANISER_ID         = 'df137255-3add-4153-b368-32e06e2be188'; // DaveW / "KGB" — never eligible

// Standing conflict-of-interest exclusions (see the winner-verification rule). Removed BEFORE the pool
// is built, so they structurally cannot win — not swapped out after the fact.
const EXCLUDED_IDS = new Map([
    [ORGANISER_ID, 'organiser (DaveW / KGB)'],
    ['cff2fc33-4a55-451b-8c7f-20f12c1898ce', 'organiser\'s partner ("Ysie"): conflict of interest, standing exclusion since 1 Aug 2026'],
]);

const flagArgs = process.argv.slice(2).filter(a => a.startsWith('--'));
const hasFlag = name => flagArgs.includes(`--${name}`);
const flag = name => { const f = flagArgs.find(a => a.startsWith(`--${name}=`)); return f ? f.slice(name.length + 3).replace(/^"|"$/g, '') : null; };
const dryRun        = hasFlag('dry-run');
const extraExcluded = (flag('exclude') || '').split(',').map(x => x.trim()).filter(Boolean);
const replacesId    = flag('replaces');
const replaceReason = flag('reason');

// The service_role key is never pasted into chat or committed anywhere. Vercel holds it as a
// Sensitive variable, so `vercel env pull` cannot retrieve it either (it writes "[SENSITIVE]").
// Run this in the macOS Terminal app: if the env var is not set, the key is asked for here and
// typed/pasted hidden. Get it from Supabase → Project Settings → API keys → service_role.
function askHidden(promptText) {
    if (!process.stdin.isTTY) return Promise.resolve('');
    process.stdout.write(promptText);
    return new Promise(resolve => {
        const stdin = process.stdin;
        let buf = '';
        stdin.setRawMode(true); stdin.resume(); stdin.setEncoding('utf8');
        const onData = ch => {
            if (ch.includes('\r') || ch.includes('\n')) {
                buf += ch.split(/\r|\n/)[0];
                stdin.setRawMode(false); stdin.pause(); stdin.off('data', onData);
                process.stdout.write('\n');
                resolve(buf.trim());
            } else if (ch === '\u0003') {           // Ctrl-C
                process.stdout.write('\n'); process.exit(1);
            } else if (ch === '\u007f' || ch === '\b') {
                buf = buf.slice(0, -1);
            } else {
                buf += ch;
            }
        };
        stdin.on('data', onData);
    });
}

const SUPABASE_SERVICE_KEY = (process.env.SUPABASE_SERVICE_KEY || '').trim()
    || await askHidden('Supabase service_role key (typing is hidden, then Enter): ');

if (!SUPABASE_SERVICE_KEY || SUPABASE_SERVICE_KEY === '[SENSITIVE]') {
    console.error('No usable Supabase service_role key.');
    console.error('Run this in the macOS Terminal app and paste the key when asked, or set SUPABASE_SERVICE_KEY first.');
    console.error('The key comes from Supabase → Project Settings → API keys → service_role (not the anon key).');
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });

// The challenge window is defined in SAST (Africa/Johannesburg). Never compare
// against a UTC date here: at 00:30 SAST on 1 Nov it is still 31 Oct in UTC.
const sastToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Johannesburg' });

const byRank = (a, b) =>
    (b.total_active_days - a.total_active_days) ||
    (b.longest_streak - a.longest_streak) ||
    String(a.display_name || '').localeCompare(String(b.display_name || ''));

const fmt = p => `${(p.display_name || 'Unknown').trim()} — ${p.total_active_days} active days, longest streak ${p.longest_streak} (${p.first_active_date} → ${p.last_active_date}) — ${p.user_id}`;

async function main() {
    console.log('═'.repeat(70));
    console.log(`eo SwimBETTER Draw — ${CHALLENGE_NAME}${dryRun ? '   [DRY RUN]' : ''}`);
    console.log(`Run at: ${new Date().toISOString()} (SAST date ${sastToday()})`);
    console.log('═'.repeat(70));

    const { data: config, error: configError } = await supabase
        .from('eo_challenge_config').select('*').eq('id', 1).single();
    if (configError || !config) {
        console.error('Could not load eo_challenge_config:', configError?.message);
        if (/invalid api key|jwt/i.test(configError?.message || '')) {
            console.error('Supabase rejected the key. Use the service_role key from Supabase → Project Settings → API keys, not the anon key or a Vercel placeholder.');
        }
        process.exit(1);
    }
    console.log(`Window: ${config.launch_date} → ${config.end_date}`);
    console.log(`Qualify: ${config.qualify_min_active_days}+ active days · Pool cap: ${config.draw_pool_cap}\n`);

    const today = sastToday();
    if (today <= config.end_date) {
        if (!dryRun) {
            console.error(`Window hasn't closed yet (ends ${config.end_date}, today is ${today} SAST). Refusing to draw early.`);
            console.error('Swimmers can still earn days until midnight SAST on the end date. Run this on or after the next day.');
            process.exit(1);
        }
        console.log(`[dry run] Window still open (ends ${config.end_date}, today ${today} SAST). A real draw would refuse here; standings below are provisional.\n`);
    }

    // The leaderboard, not the SQL draw pool: exclusions must come off before the cap (see header).
    const { data: leaders, error: leadersError } = await supabase.rpc('get_eo_challenge_leaders');
    if (leadersError) {
        console.error('RPC error (get_eo_challenge_leaders):', leadersError.message);
        process.exit(1);
    }
    if (!leaders || !leaders.length) {
        console.error('No active days recorded at all — nothing to draw.');
        process.exit(1);
    }

    extraExcluded.forEach(id => EXCLUDED_IDS.set(id, 'excluded for this draw via --exclude' + (replaceReason ? `: ${replaceReason}` : '')));

    const excludedHere = leaders.filter(l => EXCLUDED_IDS.has(l.user_id));
    const eligible     = leaders.filter(l => !EXCLUDED_IDS.has(l.user_id));
    const qualified    = eligible.filter(l => l.total_active_days >= config.qualify_min_active_days).sort(byRank);
    const pool         = qualified.slice(0, config.draw_pool_cap);
    const nearMisses   = eligible.filter(l => l.total_active_days < config.qualify_min_active_days).sort(byRank).slice(0, 5);

    console.log(`Swimmers with at least one active day: ${leaders.length}`);
    excludedHere.forEach(l => console.log(`Excluded from the pool: ${(l.display_name || 'Unknown').trim()} (${l.total_active_days} active days), ${EXCLUDED_IDS.get(l.user_id)}`));
    console.log(`Qualified (${config.qualify_min_active_days}+ days, after exclusions): ${qualified.length}` +
        (qualified.length > config.draw_pool_cap ? ` — capped to the top ${config.draw_pool_cap}` : ''));
    if (nearMisses.length) {
        console.log(`Closest below the bar (for the record, not in the draw):`);
        nearMisses.forEach(l => console.log(`     ${(l.display_name || 'Unknown').trim()} — ${l.total_active_days} days`));
    }

    // Cross-check against the database's own pool function. Any difference must be
    // explained entirely by the exclusions above; anything else means the rule drifted.
    const { data: sqlPool } = await supabase.rpc('get_eo_challenge_draw_pool');
    if (sqlPool) {
        const sqlIds = new Set(sqlPool.map(p => p.user_id));
        const onlyInSql    = sqlPool.filter(p => !pool.some(x => x.user_id === p.user_id) && !EXCLUDED_IDS.has(p.user_id));
        const onlyInScript = pool.filter(p => !sqlIds.has(p.user_id));
        const capLetSomeoneIn = qualified.length + excludedHere.filter(e => e.total_active_days >= config.qualify_min_active_days).length > config.draw_pool_cap;
        if (onlyInSql.length || (onlyInScript.length && !capLetSomeoneIn)) {
            console.error('\nPOOL MISMATCH between this script and get_eo_challenge_draw_pool() that exclusions do not explain. Stop and investigate before drawing.');
            onlyInSql.forEach(p => console.error(`  only in SQL pool:    ${fmt(p)}`));
            onlyInScript.forEach(p => console.error(`  only in script pool: ${fmt(p)}`));
            process.exit(1);
        }
        console.log(`Cross-check: get_eo_challenge_draw_pool() returns ${sqlPool.length}; after exclusions the pools agree.`);
    }

    if (!pool.length) {
        console.error(`\nNo one qualified with ${config.qualify_min_active_days}+ active days after exclusions — nothing to draw.`);
        process.exit(1);
    }

    console.log(`\nDraw pool: ${pool.length} finalist(s), equal odds each:`);
    pool.forEach((p, i) => console.log(`  ${String(i).padEnd(3)} ${fmt(p)}`));

    if (dryRun) {
        console.log('\n' + '─'.repeat(70));
        console.log(`DRY RUN complete: ${pool.length} finalist(s) would enter with equal odds. No winner drawn, nothing stored.`);
        console.log('─'.repeat(70));
        return;
    }

    const winningIndex = randomInt(0, pool.length);
    const winner = pool[winningIndex];
    const runnerUpPool = pool.filter((_, i) => i !== winningIndex);
    const runnerUp = runnerUpPool.length ? runnerUpPool[randomInt(0, runnerUpPool.length)] : null;

    console.log('\n' + '─'.repeat(70));
    console.log(`WINNING INDEX: #${winningIndex} of ${pool.length} (0-indexed, equal odds)`);
    console.log(`WINNER: ${(winner.display_name || 'Unknown').trim()}  (${winner.total_active_days} active days, streak ${winner.longest_streak})`);
    console.log(`  user_id: ${winner.user_id}`);
    if (runnerUp) {
        console.log(`\nRUNNER-UP (if winner declines): ${(runnerUp.display_name || 'Unknown').trim()}  (${runnerUp.total_active_days} active days)`);
        console.log(`  user_id: ${runnerUp.user_id}`);
    }
    console.log('─'.repeat(70));
    console.log('\nScreenshot this entire output before announcing anything.');

    const { error: insertError } = await supabase.from('challenge_draw_results').insert({
        challenge_id: CHALLENGE_ID,
        challenge_name: CHALLENGE_NAME,
        winner_user_id: winner.user_id,
        winner_display_name: (winner.display_name || '').trim() || null,
        winning_ticket_id: String(winningIndex),
        winning_entry_type: 'consistency_draw',
        winning_entry_description: `Qualified with ${winner.total_active_days} active days (longest streak ${winner.longest_streak}), 1 of ${pool.length} equal-odds finalists` +
            (runnerUp ? `. Runner-up if declined: ${(runnerUp.display_name || '').trim()} (${runnerUp.user_id})` : '') +
            (replacesId ? `. REPLACEMENT DRAW for ${replacesId}${extraExcluded.length ? `, excluding ${extraExcluded.join(', ')}` : ''}${replaceReason ? `. Reason: ${replaceReason}` : ''}` : ''),
        participant_count: pool.length,
        ticket_count: pool.length, // equal-odds draw — one "ticket" per finalist, not weighted
        raw_ticket_breakdown: { pool, excluded: excludedHere.map(e => ({ user_id: e.user_id, display_name: e.display_name, total_active_days: e.total_active_days, reason: EXCLUDED_IDS.get(e.user_id) })) },
        ...(replacesId ? { replacement_for: replacesId } : {}),
    });

    if (insertError) {
        console.error(`\n[non-fatal] Could not persist draw result: ${insertError.message}`);
        console.error('The draw itself is still valid — screenshot this output and store the result manually if needed.');
    } else {
        console.log(`\nStored as a PENDING draw result (challenge_id=${CHALLENGE_ID}) — approve it in /admin before it appears in any newsletter.`);
    }
}

main();
