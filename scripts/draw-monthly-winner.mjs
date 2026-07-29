/**
 * SwimLoading — Monthly Challenge Winner Draw
 *
 * Weighted random draw over draw_entries ("tickets") for the monthly
 * challenge. Uses crypto.randomInt (not Math.random) so the pick is not
 * seedable/predictable, and prints a full audit log — ticket list, the
 * winning ticket index, winner, and runner-up (in case the winner declines,
 * as happened in April 2026) — so the result can be screenshotted before
 * announcing anything.
 *
 * The organiser (DaveW / df137255-3add-4153-b368-32e06e2be188) is filtered
 * out BEFORE the ticket pool is built — structurally cannot win.
 *
 * Usage:
 *   SUPABASE_SERVICE_KEY=xxx node scripts/draw-monthly-winner.mjs \
 *     2026-07-01 2026-07-31 "July 2026 — Blu Smooth MK2 Comp wetsuit"
 *
 * Dates are the challenge's SAST launch_date/end_date (from
 * june_challenge_config). The script converts them to the UTC bounds
 * get_challenge_leaders() expects (SAST = UTC+2, so month start 00:00 SAST
 * = previous-day 22:00 UTC).
 */

import { createClient } from '@supabase/supabase-js';
import { randomInt } from 'crypto';

const SUPABASE_URL         = 'https://szgkzuswelntnevobnoh.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || '';
const ORGANISER_ID         = 'df137255-3add-4153-b368-32e06e2be188'; // DaveW — never eligible

const [, , startDateArg, endDateArg, labelArg] = process.argv;

if (!SUPABASE_SERVICE_KEY) {
    console.error('Set SUPABASE_SERVICE_KEY env var first:');
    console.error('  export SUPABASE_SERVICE_KEY="your-service-role-key"');
    process.exit(1);
}
if (!startDateArg || !endDateArg) {
    console.error('Usage: node scripts/draw-monthly-winner.mjs YYYY-MM-DD YYYY-MM-DD "Challenge label"');
    console.error('Example: node scripts/draw-monthly-winner.mjs 2026-07-01 2026-07-31 "July 2026 — Blu Smooth MK2"');
    process.exit(1);
}

const label = labelArg || `${startDateArg} to ${endDateArg}`;

// SAST (UTC+2) month bounds -> UTC bounds for get_challenge_leaders()
function sastDateToUtcBoundStart(dateStr) {
    return new Date(`${dateStr}T00:00:00+02:00`).toISOString();
}
function sastDateToUtcBoundEnd(dateStr) {
    // end_date is inclusive in SAST -> next day 00:00 SAST is the exclusive UTC upper bound
    const d = new Date(`${dateStr}T00:00:00+02:00`);
    d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString();
}

const rangeStartUtc = sastDateToUtcBoundStart(startDateArg);
const rangeEndUtc   = sastDateToUtcBoundEnd(endDateArg);

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function main() {
    console.log('═'.repeat(70));
    console.log(`SwimLoading Monthly Draw — ${label}`);
    console.log(`Window (SAST): ${startDateArg} → ${endDateArg}`);
    console.log(`Window (UTC bounds passed to RPC): ${rangeStartUtc} → ${rangeEndUtc}`);
    console.log(`Run at: ${new Date().toISOString()}`);
    console.log('═'.repeat(70));

    const { data, error } = await supabase.rpc('get_challenge_leaders', {
        p_month_start: rangeStartUtc,
        p_month_end: rangeEndUtc,
    });

    if (error) {
        console.error('RPC error:', error.message);
        console.error('Check sql/applied/june_challenge_v2_functions.sql for the current get_challenge_leaders() signature if this RPC has changed.');
        process.exit(1);
    }
    if (!data || !data.length) {
        console.error('No rows returned — check the date window against june_challenge_config for that month.');
        process.exit(1);
    }

    const entrants = data.filter(r =>
        r.user_id !== ORGANISER_ID &&
        r.qualified_for_draw === true &&
        !r.disqualified &&
        r.draw_entries > 0
    );

    if (!entrants.length) {
        console.error('No eligible entrants (after excluding organiser/disqualified/zero-entry rows). Nothing to draw.');
        process.exit(1);
    }

    // Build the ticket pool: each entrant occupies a contiguous range of ticket indices
    const tickets = [];
    let cursor = 0;
    const ranges = entrants.map(e => {
        const start = cursor;
        cursor += e.draw_entries;
        const end = cursor - 1;
        tickets.push({ display_name: e.display_name, user_id: e.user_id, entries: e.draw_entries, ticketRange: `${start}-${end}` });
        return { ...e, start, end };
    });
    const totalTickets = cursor;

    console.log(`\nEligible entrants: ${entrants.length}`);
    console.log(`Total tickets in the hat: ${totalTickets}\n`);
    console.log('Ticket breakdown:');
    tickets.forEach(t => console.log(`  ${t.ticketRange.padEnd(10)} ${t.display_name} (${t.entries} tickets) — ${t.user_id}`));

    // Draw the winning ticket, then a runner-up ticket from the remaining pool (winner's tickets excluded)
    const winningTicket = randomInt(0, totalTickets);
    const winner = ranges.find(r => winningTicket >= r.start && winningTicket <= r.end);

    const runnerUpPool = ranges.filter(r => r.user_id !== winner.user_id);
    const runnerUpTotalTickets = runnerUpPool.reduce((sum, r) => sum + r.entries, 0);
    let runnerUp = null;
    if (runnerUpTotalTickets > 0) {
        const runnerUpTicket = randomInt(0, runnerUpTotalTickets);
        let acc = 0;
        for (const r of runnerUpPool) {
            acc += r.entries;
            if (runnerUpTicket < acc) { runnerUp = r; break; }
        }
    }

    console.log('\n' + '─'.repeat(70));
    console.log(`WINNING TICKET: #${winningTicket} (of ${totalTickets}, 0-indexed)`);
    console.log(`WINNER: ${winner.display_name}  (${winner.entries} tickets, ${winner.total_points} pts, ${winner.temp_logs_rewarded} logs)`);
    console.log(`  user_id: ${winner.user_id}`);
    if (runnerUp) {
        console.log(`\nRUNNER-UP (if winner declines): ${runnerUp.display_name}  (${runnerUp.entries} tickets, ${runnerUp.total_points} pts)`);
        console.log(`  user_id: ${runnerUp.user_id}`);
    }
    console.log('─'.repeat(70));
    console.log('\nScreenshot this entire output before announcing anything (winner verification rule).');

    // ── Integration contract for the newsletter/admin UI (2026-07-29 addition) ──
    // Purely a persistence step — the selection above (randomInt weighted draw,
    // organiser exclusion) is untouched. Stores a DRAFT result; nothing here
    // marks it approved. The newsletter/admin must never read a winner except
    // through an approved row in this table (see admin.html "Challenge Draw
    // Approval" panel), never from this console output directly.
    const challengeId = startDateArg.slice(0, 7); // e.g. '2026-07'
    const { error: insertError } = await supabase.from('challenge_draw_results').insert({
        challenge_id: challengeId,
        challenge_name: label,
        winner_user_id: winner.user_id,
        winner_display_name: winner.display_name,
        winning_ticket_id: String(winningTicket),
        winning_entry_type: 'draw_entry',
        winning_entry_description: `Ticket #${winningTicket} of ${totalTickets} (${winner.entries} tickets held, ${winner.temp_logs_rewarded} temp logs)`,
        participant_count: entrants.length,
        ticket_count: totalTickets,
        raw_ticket_breakdown: tickets,
    });

    if (insertError) {
        console.error(`\n[non-fatal] Could not persist draw result to challenge_draw_results: ${insertError.message}`);
        console.error('The draw itself is still valid — screenshot this output and store the result manually if needed.');
    } else {
        console.log(`\nStored as a PENDING draw result (challenge_id=${challengeId}) — approve it in /admin before it can appear in any newsletter.`);
    }
}

main();
