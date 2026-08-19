// List every Brevo contact list, so you can find the numeric BREVO_LIST_ID
// that scripts/sync-brevo-swimmers.mjs needs.
//
// Usage:
//   node scripts/brevo-lists.js YOUR_BREVO_API_KEY
//   BREVO_API_KEY=xxx node scripts/brevo-lists.js
//
// Prefer the env var — an API key passed as an argument is visible to every
// other process on the machine and lands in your shell history.

// Trim hard. A key copied out of the Brevo UI often carries a trailing space
// or newline, and sending that in the api-key header returns 401 "Key not
// found" — a wrong-credentials error for what is actually a whitespace bug.
const key = (process.argv[2] || process.env.BREVO_API_KEY || '').replace(/\s+/g, '');
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
    // Shape of the key, never the key: enough to see a truncated paste
    // without putting the credential in a terminal or a screenshot.
    console.error(`\nkey received: ${key.length} chars, ` +
                  `starts "${key.slice(0, 8)}", ends "${key.slice(-4)}", ` +
                  `${key.split('-').length - 1} dash(es)`);
    console.error('A complete Brevo v3 key is 89 chars: "xkeysib-" + 64 hex + "-" + 16.');
    if (res.status === 401) {
        // Brevo returns 401 for an unauthorised IP as well as a bad key, and
        // the message above names which. Read it before touching the key: a
        // full-length key that 401s is usually the IP allowlist, not the
        // credential. Add the address at
        // https://app.brevo.com/security/authorised_ips — and add a range if
        // yours is dynamic, or this recurs every time the router reconnects.
        console.error('\n401 means one of: unauthorised IP (see the message above),');
        console.error('key revoked, key truncated, or an SMTP/v2 key rather than an');
        console.error('API v3 key. Keys: Brevo -> Settings -> SMTP & API -> API keys.');
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
