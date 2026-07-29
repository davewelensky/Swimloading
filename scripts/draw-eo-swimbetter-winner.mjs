/**
 * SwimLoading — eo SwimBETTER Performance Challenge Winner Draw
 *
 * Run once, after 31 October 2026, once the Aug-Oct window has fully closed.
 *
 * Mechanic (confirmed by Dave, 2026-07-29):
 *   - Qualify: 30+ active days (config.qualify_min_active_days) across the
 *     full Aug 1 - Oct 31 window. An "active day" = 1+ real (non-sensor,
 *     non-backdated) temp log that day — see record_eo_active_day() in
 *     sql/applied/2026-07-29_eo-swimbetter-challenge.sql.
 *   - Draw pool: everyone who qualifies, capped at config.draw_pool_cap (20)
 *     — if more than 20 qualify, only the top 20 by active-day count (then
 *     longest streak) enter; if fewer than 20 qualify, everyone who
 *     qualifies enters.
 *   - Equal odds within the pool — once you've cleared the consistency bar,
 *     every finalist has exactly the same chance. This is the actual
 *     "fair" part Dave asked for — not weighted by how consistent you were
 *     beyond the bar.
 *
 * Uses crypto.randomInt (not Math.random) for the same reason as
 * draw-monthly-winner.mjs — not seedable/predictable. Prints a full audit
 * log of the entire draw pool before picking, then stores a DRAFT result in
 * challenge_draw_results (same table the July draw uses) for admin approval
 * in /admin — never announce a winner from this script's console output
 * directly.
 *
 * Usage:
 *   SUPABASE_SERVICE_KEY=xxx node scripts/draw-eo-swimbetter-winner.mjs
 */

import { createClient } from '@supabase/supabase-js';
import { randomInt } from 'crypto';

const SUPABASE_URL         = 'https://szgkzuswelntnevobnoh.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || '';
const CHALLENGE_ID         = '2026-08_eo-swimbetter'; // Aug-Oct 2026, distinct key space from the monthly '2026-07' style ids
const CHALLENGE_NAME       = 'eo SwimBETTER Performance Challenge (Aug 1 - Oct 31 2026)';

if (!SUPABASE_SERVICE_KEY) {
    console.error('Set SUPABASE_SERVICE_KEY env var first:');
    console.error('  export SUPABASE_SERVICE_KEY="your-service-role-key"');
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function main() {
    console.log('═'.repeat(70));
    console.log(`eo SwimBETTER Draw — ${CHALLENGE_NAME}`);
    console.log(`Run at: ${new Date().toISOString()}`);
    console.log('═'.repeat(70));

    const { data: config, error: configError } = await supabase
        .from('eo_challenge_config').select('*').eq('id', 1).single();
    if (configError || !config) {
        console.error('Could not load eo_challenge_config:', configError?.message);
        process.exit(1);
    }
    console.log(`Window: ${config.launch_date} → ${config.end_date}`);
    console.log(`Qualify: ${config.qualify_min_active_days}+ active days · Pool cap: ${config.draw_pool_cap}\n`);

    const today = new Date().toISOString().slice(0, 10);
    if (today <= config.end_date) {
        console.error(`Window hasn't closed yet (ends ${config.end_date}, today is ${today}). Refusing to draw early.`);
        process.exit(1);
    }

    const { data: pool, error: poolError } = await supabase.rpc('get_eo_challenge_draw_pool');
    if (poolError) {
        console.error('RPC error:', poolError.message);
        process.exit(1);
    }
    if (!pool || !pool.length) {
        console.error('No one qualified (0 rows from get_eo_challenge_draw_pool) — nothing to draw.');
        process.exit(1);
    }

    console.log(`Draw pool: ${pool.length} qualified swimmer(s) (cap was ${config.draw_pool_cap})\n`);
    console.log('Full pool, equal odds each:');
    pool.forEach((p, i) => console.log(`  ${String(i).padEnd(3)} ${p.display_name} — ${p.total_active_days} active days, longest streak ${p.longest_streak} (${p.first_active_date} → ${p.last_active_date}) — ${p.user_id}`));

    const winningIndex = randomInt(0, pool.length);
    const winner = pool[winningIndex];
    const runnerUpPool = pool.filter((_, i) => i !== winningIndex);
    const runnerUp = runnerUpPool.length ? runnerUpPool[randomInt(0, runnerUpPool.length)] : null;

    console.log('\n' + '─'.repeat(70));
    console.log(`WINNING INDEX: #${winningIndex} of ${pool.length} (0-indexed, equal odds)`);
    console.log(`WINNER: ${winner.display_name}  (${winner.total_active_days} active days, streak ${winner.longest_streak})`);
    console.log(`  user_id: ${winner.user_id}`);
    if (runnerUp) {
        console.log(`\nRUNNER-UP (if winner declines): ${runnerUp.display_name}  (${runnerUp.total_active_days} active days)`);
        console.log(`  user_id: ${runnerUp.user_id}`);
    }
    console.log('─'.repeat(70));
    console.log('\nScreenshot this entire output before announcing anything.');

    const { error: insertError } = await supabase.from('challenge_draw_results').insert({
        challenge_id: CHALLENGE_ID,
        challenge_name: CHALLENGE_NAME,
        winner_user_id: winner.user_id,
        winner_display_name: winner.display_name,
        winning_ticket_id: String(winningIndex),
        winning_entry_type: 'consistency_draw',
        winning_entry_description: `Qualified with ${winner.total_active_days} active days (longest streak ${winner.longest_streak}), 1 of ${pool.length} equal-odds finalists`,
        participant_count: pool.length,
        ticket_count: pool.length, // equal-odds draw — one "ticket" per finalist, not weighted
        raw_ticket_breakdown: pool,
    });

    if (insertError) {
        console.error(`\n[non-fatal] Could not persist draw result: ${insertError.message}`);
        console.error('The draw itself is still valid — screenshot this output and store the result manually if needed.');
    } else {
        console.log(`\nStored as a PENDING draw result (challenge_id=${CHALLENGE_ID}) — approve it in /admin before it appears in any newsletter.`);
    }
}

main();
