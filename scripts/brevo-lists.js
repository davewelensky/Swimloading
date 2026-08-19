// List every Brevo contact list, so you can find the numeric BREVO_LIST_ID
// that scripts/sync-brevo-swimmers.mjs needs.
//
// Usage:
//   node scripts/brevo-lists.js YOUR_BREVO_API_KEY
//   BREVO_API_KEY=xxx node scripts/brevo-lists.js
//
// Prefer the env var — an API key passed as an argument is visible to every
// other process on the machine and lands in your shell history.

const key = process.argv[2] || process.env.BREVO_API_KEY;
if (!key) {
    console.error('Usage: node scripts/brevo-lists.js YOUR_BREVO_API_KEY  (or set BREVO_API_KEY)');
    process.exit(1);
}

// Brevo v3 keys look like "xkeysib-<64 hex>-<16 alnum>". A truncated paste is
// the most common cause of a 401 here, and it is worth catching before the
// round trip so the error names the real problem.
if (!/^xkeysib-/.test(key)) {
    console.warn('Warning: that does not look like a Brevo v3 key (they start "xkeysib-").');
}

const res  = await fetch('https://api.brevo.com/v3/contacts/lists?limit=50', {
    headers: { 'api-key': key, 'Accept': 'application/json' }
});
const body = await res.text();

if (!res.ok) {
    // Brevo replies with {code, message} on failure. Surfacing it beats the
    // "Cannot read properties of undefined" this script used to throw, which
    // said nothing about the key being rejected.
    console.error(`Brevo API error ${res.status} ${res.statusText}`);
    console.error(body);
    if (res.status === 401) {
        console.error('\n401 usually means: key revoked, key truncated, or an SMTP/v2 key');
        console.error('rather than an API v3 key. Generate one at');
        console.error('Brevo -> Settings -> SMTP & API -> API keys.');
    }
    process.exit(1);
}

let parsed;
try {
    parsed = JSON.parse(body);
} catch {
    console.error('Brevo returned a non-JSON body:');
    console.error(body.slice(0, 500));
    process.exit(1);
}

const lists = parsed.lists ?? [];
if (!lists.length) {
    console.log('No lists returned. Full response:');
    console.log(JSON.stringify(parsed, null, 2));
    process.exit(0);
}

console.log(`${parsed.count ?? lists.length} list(s):\n`);
for (const l of lists) {
    console.log(`id=${l.id}  name="${l.name}"  contacts=${l.totalSubscribers}  folderId=${l.folderId}`);
}
