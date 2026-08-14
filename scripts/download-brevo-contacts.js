// download-brevo-contacts.js — Download all Brevo contacts to a CSV file
// Usage: node scripts/download-brevo-contacts.js YOUR_BREVO_API_KEY

import { writeFileSync } from 'fs';

const BREVO_KEY = process.argv[2] || process.env.BREVO_API_KEY;

if (!BREVO_KEY) {
    console.error('Usage: node scripts/download-brevo-contacts.js YOUR_BREVO_API_KEY');
    process.exit(1);
}

const LIMIT = 500; // max per page

async function fetchPage(offset) {
    const res = await fetch(
        `https://api.brevo.com/v3/contacts?limit=${LIMIT}&offset=${offset}&sort=desc`,
        { headers: { 'api-key': BREVO_KEY, 'Accept': 'application/json' } }
    );
    if (!res.ok) {
        const text = await res.text();
        throw new Error(`Brevo API error ${res.status}: ${text}`);
    }
    return res.json();
}

(async () => {
    console.log('Fetching contacts from Brevo…');

    // First page also tells us the total count
    const first = await fetchPage(0);
    const total = first.count;
    let all = first.contacts || [];

    console.log(`Total contacts in Brevo: ${total}`);

    // Fetch remaining pages
    for (let offset = LIMIT; offset < total; offset += LIMIT) {
        process.stdout.write(`  Fetching ${offset}–${Math.min(offset + LIMIT, total)} of ${total}…\r`);
        const page = await fetchPage(offset);
        all = all.concat(page.contacts || []);
    }
    console.log(`\nDownloaded ${all.length} contacts.`);

    // Write JSON
    const jsonFile = 'brevo-contacts.json';
    writeFileSync(jsonFile, JSON.stringify(all, null, 2));
    console.log(`Saved full data to ${jsonFile}`);

    // Write CSV
    const attrs = ['SWIMLOADING_NAME', 'HOME_DOMAIN', 'FIRSTNAME', 'LASTNAME'];
    const csvHeader = ['email', ...attrs, 'createdAt', 'emailBlacklisted'].join(',');
    const csvRows = all.map(c => {
        const a = c.attributes || {};
        return [
            c.email,
            a.SWIMLOADING_NAME || '',
            a.HOME_DOMAIN      || '',
            a.FIRSTNAME        || '',
            a.LASTNAME         || '',
            c.createdAt        || '',
            c.emailBlacklisted || false,
        ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(',');
    });

    const csvFile = 'brevo-contacts.csv';
    writeFileSync(csvFile, [csvHeader, ...csvRows].join('\n'));
    console.log(`Saved CSV to ${csvFile}`);
    console.log('\nDone.');
})();
