// Adds all Brevo contacts to a specific list by id
// Usage: node scripts/fill-list.js YOUR_BREVO_API_KEY LIST_ID
// Example: node scripts/fill-list.js xkeysib-xxx 13

const key    = process.argv[2];
const listId = process.argv[3];
if (!key || !listId) {
    console.error('Usage: node scripts/fill-list.js YOUR_BREVO_API_KEY LIST_ID');
    process.exit(1);
}

const headers = { 'api-key': key, 'Accept': 'application/json', 'Content-Type': 'application/json' };

// 1. Download all contact emails from Brevo
console.log('Fetching all contacts from Brevo…');
let emails = [], offset = 0;
while (true) {
    const res  = await fetch(`https://api.brevo.com/v3/contacts?limit=500&offset=${offset}`, { headers });
    const data = await res.json();
    const batch = (data.contacts || []).map(c => c.email).filter(Boolean);
    emails = emails.concat(batch);
    if (batch.length < 500) break;
    offset += 500;
}
console.log(`Found ${emails.length} contacts.`);

// 2. Add them to the list in chunks of 150
console.log(`Adding to list id=${listId}…`);
for (let i = 0; i < emails.length; i += 150) {
    const chunk = emails.slice(i, i + 150);
    const res = await fetch(`https://api.brevo.com/v3/contacts/lists/${listId}/contacts/add`, {
        method: 'POST', headers,
        body: JSON.stringify({ emails: chunk }),
    });
    const text = await res.text();
    console.log(`  Chunk ${i}–${i + chunk.length}: status ${res.status} ${res.status === 204 ? 'OK' : text}`);
}
console.log('Done.');
