// sync-brevo.js — Upsert all SwimLoading members into Brevo contacts
// Usage: node scripts/sync-brevo.js
// Env:   SUPABASE_SERVICE_KEY, BREVO_API_KEY

const SUPABASE_URL     = 'https://szgkzuswelntnevobnoh.supabase.co';
const SUPABASE_KEY     = process.env.SUPABASE_SERVICE_KEY;
const BREVO_KEY        = process.env.BREVO_API_KEY;
const BREVO_BATCH_URL  = 'https://api.brevo.com/v3/contacts/batch';
const BATCH_SIZE       = 150;

if (!SUPABASE_KEY) { console.error('Missing SUPABASE_SERVICE_KEY'); process.exit(1); }
if (!BREVO_KEY)    { console.error('Missing BREVO_API_KEY');         process.exit(1); }

// ── 1. Fetch all profiles with an email ──────────────────────────────────────

async function fetchProfiles() {
    const url = `${SUPABASE_URL}/rest/v1/profiles?select=email,display_name,full_name,home_domain&email=not.is.null&limit=10000`;
    const res = await fetch(url, {
        headers: {
            'apikey':        SUPABASE_KEY,
            'Authorization': `Bearer ${SUPABASE_KEY}`,
        },
    });
    if (!res.ok) {
        const text = await res.text();
        throw new Error(`Supabase fetch failed ${res.status}: ${text}`);
    }
    return res.json();
}

// ── 2. Map a profile row to a Brevo contact object ───────────────────────────

function toBrevoContact(profile) {
    const [firstName = '', ...rest] = (profile.full_name || '').trim().split(/\s+/);
    const lastName = rest.join(' ');

    return {
        email:      profile.email,
        attributes: {
            SWIMLOADING_NAME: profile.display_name || '',
            HOME_DOMAIN:      profile.home_domain  || '',
            FIRSTNAME:        firstName,
            LASTNAME:         lastName,
        },
        updateEnabled: true,   // upsert — update if contact already exists
    };
}

// ── 3. Send one batch to Brevo ───────────────────────────────────────────────

async function upsertBatch(contacts, batchNum, totalBatches) {
    const res = await fetch(BREVO_BATCH_URL, {
        method:  'POST',
        headers: {
            'api-key':      BREVO_KEY,
            'Content-Type': 'application/json',
            'Accept':       'application/json',
        },
        body: JSON.stringify({ contacts }),
    });

    if (res.status === 204 || res.status === 201 || res.status === 200) {
        console.log(`  Batch ${batchNum}/${totalBatches}: ${contacts.length} contacts — OK`);
        return;
    }

    const body = await res.text();
    throw new Error(`Brevo batch ${batchNum} failed ${res.status}: ${body}`);
}

// ── Main ─────────────────────────────────────────────────────────────────────

(async () => {
    console.log('Fetching profiles from Supabase…');
    const profiles = await fetchProfiles();
    console.log(`Found ${profiles.length} profiles with email.`);

    if (profiles.length === 0) {
        console.log('Nothing to sync.');
        return;
    }

    const contacts = profiles.map(toBrevoContact);
    const batches  = [];
    for (let i = 0; i < contacts.length; i += BATCH_SIZE) {
        batches.push(contacts.slice(i, i + BATCH_SIZE));
    }

    console.log(`Syncing in ${batches.length} batch(es) of up to ${BATCH_SIZE}…`);

    let synced = 0;
    const errors = [];

    for (let i = 0; i < batches.length; i++) {
        try {
            await upsertBatch(batches[i], i + 1, batches.length);
            synced += batches[i].length;
        } catch (err) {
            errors.push(`Batch ${i + 1}: ${err.message}`);
        }
    }

    console.log(`\nSynced ${synced} contacts to Brevo.`);
    if (errors.length > 0) {
        console.error(`\n${errors.length} batch error(s):`);
        errors.forEach(e => console.error(' ', e));
        process.exit(1);
    }
})();
