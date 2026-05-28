// sync-brevo.js — Upsert all SwimLoading members into Brevo + add to a fresh list
// Usage: node scripts/sync-brevo.js SUPABASE_SERVICE_KEY BREVO_API_KEY

const SUPABASE_URL    = 'https://szgkzuswelntnevobnoh.supabase.co';
const SUPABASE_KEY    = process.argv[2] || process.env.SUPABASE_SERVICE_KEY;
const BREVO_KEY       = process.argv[3] || process.env.BREVO_API_KEY;
const BREVO_BATCH_URL = 'https://api.brevo.com/v3/contacts/batch';
const BATCH_SIZE      = 100;
const LIST_NAME       = 'SwimLoading Members';  // kept constant — same list updated each run

if (!SUPABASE_KEY) { console.error('Missing SUPABASE_SERVICE_KEY'); process.exit(1); }
if (!BREVO_KEY)    { console.error('Missing BREVO_API_KEY');         process.exit(1); }

// ── 1. Fetch all profiles with an email ──────────────────────────────────────

async function fetchProfiles() {
    const url = `${SUPABASE_URL}/rest/v1/profiles?select=email,display_name,full_name,home_domain&email=not.is.null&limit=10000`;
    const res = await fetch(url, {
        headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` },
    });
    if (!res.ok) throw new Error(`Supabase fetch failed ${res.status}: ${await res.text()}`);
    return res.json();
}

// ── 2. Create a fresh dated list, return its ID ──────────────────────────────

async function createFreshList() {
    const headers = { 'api-key': BREVO_KEY, 'Accept': 'application/json', 'Content-Type': 'application/json' };
    const date    = new Date().toISOString().slice(0, 10); // e.g. 2026-05-14
    const name    = `${LIST_NAME} ${date}`;

    const res = await fetch('https://api.brevo.com/v3/contacts/lists', {
        method: 'POST', headers,
        body: JSON.stringify({ name, folderId: 1 }),
    });
    if (!res.ok) throw new Error(`Could not create list: ${await res.text()}`);
    const { id } = await res.json();
    console.log(`Created fresh list "${name}" (id ${id})`);
    return id;
}

// ── 3. Map profile to Brevo contact ──────────────────────────────────────────

function toBrevoContact(profile, listId) {
    const [firstName = '', ...rest] = (profile.full_name || '').trim().split(/\s+/);
    return {
        email:      profile.email,
        attributes: {
            SWIMLOADING_NAME: profile.display_name || '',
            HOME_DOMAIN:      profile.home_domain  || '',
            FIRSTNAME:        firstName,
            LASTNAME:         rest.join(' '),
        },
        listIds:       [listId],
        updateEnabled: true,
    };
}

// ── 4. Send one contact individually (fallback) ───────────────────────────────

async function upsertOne(contact) {
    const res = await fetch('https://api.brevo.com/v3/contacts', {
        method: 'POST',
        headers: { 'api-key': BREVO_KEY, 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify(contact),
    });
    if (res.status === 204 || res.status === 201 || res.status === 200) return 'ok';
    const body = await res.json().catch(() => ({}));
    if (body.code === 'duplicate_parameter') return 'ok';
    return `${res.status}: ${body.message || JSON.stringify(body)}`;
}

// ── 5. Send one batch — fall back to one-by-one on 404 ───────────────────────

async function upsertBatch(contacts, batchNum, totalBatches) {
    const res = await fetch(BREVO_BATCH_URL, {
        method: 'POST',
        headers: { 'api-key': BREVO_KEY, 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ contacts }),
    });

    if (res.status === 204 || res.status === 201 || res.status === 200) {
        console.log(`  Batch ${batchNum}/${totalBatches}: ${contacts.length} contacts — OK`);
        return { synced: contacts.length, skipped: 0 };
    }

    // 404 = one or more contacts invalid/blacklisted — retry one-by-one
    if (res.status === 404) {
        console.log(`  Batch ${batchNum}/${totalBatches}: problem contacts found, retrying one-by-one…`);
        let synced = 0, skipped = 0;
        for (const contact of contacts) {
            const result = await upsertOne(contact);
            if (result === 'ok') { synced++; }
            else { console.log(`    Skipped ${contact.email}: ${result}`); skipped++; }
        }
        console.log(`  Batch ${batchNum}/${totalBatches}: ${synced} synced, ${skipped} skipped`);
        return { synced, skipped };
    }

    throw new Error(`Brevo batch ${batchNum} failed ${res.status}: ${await res.text()}`);
}

// ── 6. Add emails to a list (separate call — batch upsert ignores listIds) ───

async function addEmailsToList(listId, emails) {
    const headers = { 'api-key': BREVO_KEY, 'Content-Type': 'application/json', 'Accept': 'application/json' };
    // Brevo accepts up to 150 emails per call here
    for (let i = 0; i < emails.length; i += 150) {
        const chunk = emails.slice(i, i + 150);
        const res = await fetch(`https://api.brevo.com/v3/contacts/lists/${listId}/contacts/add`, {
            method: 'POST', headers,
            body: JSON.stringify({ emails: chunk }),
        });
        // 204 = success, 400 with contactsNotFound is fine (blacklisted contacts)
        if (res.status !== 204 && res.status !== 200) {
            const body = await res.json().catch(() => ({}));
            if (body.contacts?.notFound) {
                // Some emails weren't in Brevo (blacklisted/skipped) — that's fine
            } else {
                console.warn(`  Add-to-list warning ${res.status}: ${JSON.stringify(body)}`);
            }
        }
        process.stdout.write(`  Added ${Math.min(i + 150, emails.length)}/${emails.length} to list…\r`);
    }
    console.log(`  Added all emails to list (id ${listId}).          `);
}

// ── Main ─────────────────────────────────────────────────────────────────────

(async () => {
    console.log('Fetching profiles from Supabase…');
    const profiles = await fetchProfiles();
    console.log(`Found ${profiles.length} profiles with email.`);
    if (profiles.length === 0) { console.log('Nothing to sync.'); return; }

    const listId   = await createFreshList();
    const contacts = profiles.map(p => toBrevoContact(p, listId));
    const batches  = [];
    for (let i = 0; i < contacts.length; i += BATCH_SIZE) {
        batches.push(contacts.slice(i, i + BATCH_SIZE));
    }

    // Step 1: upsert all contacts into Brevo
    console.log(`Syncing ${profiles.length} contacts in ${batches.length} batch(es)…`);
    let synced = 0, skipped = 0;
    const errors = [];
    for (let i = 0; i < batches.length; i++) {
        try {
            const r = await upsertBatch(batches[i], i + 1, batches.length);
            synced += r.synced; skipped += r.skipped;
        } catch (err) {
            errors.push(`Batch ${i + 1}: ${err.message}`);
        }
    }

    // Step 2: explicitly add all emails to the new list
    console.log(`\nAdding contacts to list…`);
    const emails = profiles.map(p => p.email);
    await addEmailsToList(listId, emails);

    console.log(`\nDone. ${synced} contacts synced, added to list id=${listId}.${skipped > 0 ? ` (${skipped} skipped — invalid/blacklisted)` : ''}`);
    if (errors.length > 0) {
        console.error(`\n${errors.length} error(s):`);
        errors.forEach(e => console.error(' ', e));
        process.exit(1);
    }
})();
