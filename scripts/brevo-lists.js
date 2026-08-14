// Usage: node scripts/brevo-lists.js YOUR_BREVO_API_KEY
const key = process.argv[2];
if (!key) { console.error('Usage: node scripts/brevo-lists.js YOUR_BREVO_API_KEY'); process.exit(1); }

const res = await fetch('https://api.brevo.com/v3/contacts/lists?limit=50', {
    headers: { 'api-key': key, 'Accept': 'application/json' }
});
const { lists } = await res.json();
lists.forEach(l => console.log(`id=${l.id}  name="${l.name}"  contacts=${l.totalSubscribers}  folderId=${l.folderId}`));
