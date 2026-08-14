/**
 * SwimLoading — Brevo Swimmers List Sync
 *
 * Fetches all profiles with emails from Supabase and upserts them
 * into a Brevo contact list, preserving existing contacts.
 *
 * Usage:
 *   SUPABASE_SERVICE_KEY=xxx BREVO_API_KEY=xxx BREVO_LIST_ID=xxx \
 *     node scripts/sync-brevo-swimmers.mjs
 *
 * BREVO_LIST_ID: find it in Brevo → Contacts → Lists → click the list → ID in URL
 */

import { createClient } from '@supabase/supabase-js';

// ─── CONFIG ────────────────────────────────────────────────────────────────
const SUPABASE_URL        = 'https://szgkzuswelntnevobnoh.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || '';
const BREVO_API_KEY        = process.env.BREVO_API_KEY        || '';
const BREVO_LIST_ID        = parseInt(process.env.BREVO_LIST_ID || '0', 10);

if (!SUPABASE_SERVICE_KEY) {
    console.error('Set SUPABASE_SERVICE_KEY env var');
    process.exit(1);
}
if (!BREVO_API_KEY) {
    console.error('Set BREVO_API_KEY env var (Brevo → Settings → API Keys)');
    process.exit(1);
}
if (!BREVO_LIST_ID) {
    console.error('Set BREVO_LIST_ID env var (numeric ID from Brevo → Contacts → Lists)');
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// ─── FETCH PROFILES ────────────────────────────────────────────────────────
async function fetchProfiles() {
    console.log('Fetching profiles from Supabase...');

    const { data, error } = await supabase
        .from('profiles')
        .select('id, email, display_name, full_name, home_domain, city, experience_level, onboarding_completed_at')
        .not('email', 'is', null)
        .neq('email', '');

    if (error) throw new Error(`Supabase error: ${error.message}`);
    console.log(`  Found ${data.length} profiles with email addresses`);
    return data;
}

// ─── BUILD BREVO CONTACTS ──────────────────────────────────────────────────
// Today's date as YYYY-MM-DD (SAST) — stamped on every synced contact
const SYNC_DATE = new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Johannesburg' });

function buildContacts(profiles) {
    return profiles.map(p => {
        // Split full_name into first/last; fall back to display_name
        const name      = p.full_name || p.display_name || '';
        const parts     = name.trim().split(/\s+/);
        const firstName = parts[0] || '';
        const lastName  = parts.slice(1).join(' ') || '';

        const attrs = {};
        if (firstName)              attrs.FIRSTNAME        = firstName;
        if (lastName)               attrs.LASTNAME         = lastName;
        if (p.home_domain)          attrs.HOME_REGION      = p.home_domain;
        if (p.city)                 attrs.CITY             = p.city;
        if (p.experience_level)     attrs.EXPERIENCE_LEVEL = p.experience_level;
        if (p.onboarding_completed_at) attrs.ONBOARDED     = 'yes';
        // Tag app-synced contacts so they're distinguishable from CSV imports
        attrs.SOURCE       = 'SwimLoading App';
        attrs.APP_SYNCED   = SYNC_DATE;

        return { email: p.email.toLowerCase().trim(), attributes: attrs };
    });
}

// ─── ENSURE CONTACT ATTRIBUTES EXIST ───────────────────────────────────────
// Brevo rejects an import that references an attribute that doesn't exist yet,
// so create SOURCE (text) and APP_SYNCED (date) up front. "already exists" is fine.
async function ensureAttributes() {
    const defs = [
        { name: 'SOURCE',     type: 'text' },
        { name: 'APP_SYNCED', type: 'date' },
    ];
    for (const def of defs) {
        const res = await fetch(`https://api.brevo.com/v3/contacts/attributes/normal/${def.name}`, {
            method: 'POST',
            headers: {
                'api-key':      BREVO_API_KEY,
                'Content-Type': 'application/json',
                'Accept':       'application/json',
            },
            body: JSON.stringify({ type: def.type }),
        });
        if (res.ok) {
            console.log(`  Created attribute ${def.name} (${def.type})`);
        } else {
            const body = await res.text();
            if (/already exist/i.test(body)) {
                console.log(`  Attribute ${def.name} already exists — ok`);
            } else {
                console.warn(`  Warning: could not create ${def.name}: ${res.status} ${body}`);
            }
        }
    }
}

// ─── SYNC TO BREVO ─────────────────────────────────────────────────────────
// Brevo's import endpoint handles up to 1 000 contacts per call.
const BREVO_BATCH_SIZE = 1000;

async function syncToBrevo(contacts) {
    console.log(`\nSyncing ${contacts.length} contacts to Brevo list ${BREVO_LIST_ID}...`);

    for (let i = 0; i < contacts.length; i += BREVO_BATCH_SIZE) {
        const batch     = contacts.slice(i, i + BREVO_BATCH_SIZE);
        const batchNum  = Math.floor(i / BREVO_BATCH_SIZE) + 1;
        const batchTotal = Math.ceil(contacts.length / BREVO_BATCH_SIZE);

        console.log(`  Batch ${batchNum}/${batchTotal} — ${batch.length} contacts`);

        const res = await fetch('https://api.brevo.com/v3/contacts/import', {
            method: 'POST',
            headers: {
                'api-key':      BREVO_API_KEY,
                'Content-Type': 'application/json',
                'Accept':       'application/json',
            },
            body: JSON.stringify({
                listIds:       [BREVO_LIST_ID],
                updateEnabled: true,   // update existing contacts
                jsonBody:      batch,
            }),
        });

        if (!res.ok) {
            const body = await res.text();
            throw new Error(`Brevo API error ${res.status}: ${body}`);
        }

        const result = await res.json();
        // Import is async on Brevo's side; processId confirms it was queued
        console.log(`  Queued — processId: ${result.processId ?? '(none returned)'}`);
    }
}

// ─── MAIN ──────────────────────────────────────────────────────────────────
try {
    const profiles = await fetchProfiles();
    const contacts = buildContacts(profiles);

    // Quick sanity check
    const withName  = contacts.filter(c => c.attributes.FIRSTNAME).length;
    const withRegion = contacts.filter(c => c.attributes.HOME_REGION).length;
    console.log(`  ${withName} have a name · ${withRegion} have a home region`);

    console.log('\nEnsuring Brevo attributes exist...');
    await ensureAttributes();

    await syncToBrevo(contacts);

    console.log('\nDone. Brevo processes imports asynchronously — check');
    console.log('Contacts → Import History in Brevo to confirm completion.');
} catch (err) {
    console.error('\nSync failed:', err.message);
    process.exit(1);
}
