const fs = require('fs');
const lines = fs.readFileSync('.env', 'utf8').split('\n');
let key = '';
for (const l of lines) {
  if (l.trim().startsWith('DOGRAH_API_KEY=')) {
    key = l.trim().split('=')[1].replace(/['"]/g, '');
  }
}

async function run() {
  const r = await fetch('https://app.dograh.com/api/v1/organizations/model-configurations/v2', {
    headers: { 'X-API-Key': key }
  });
  console.log('GET status:', r.status);
  const d = await r.json();
  console.log('Config:', JSON.stringify(d, null, 2));
}
run().catch(console.error);
