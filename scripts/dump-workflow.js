const fs = require('fs');
const lines = fs.readFileSync('.env', 'utf8').split('\n');
let key = '';
for (const l of lines) {
  if (l.trim().startsWith('DOGRAH_API_KEY=')) {
    key = l.trim().split('=')[1].replace(/['"]/g, '');
  }
}

async function run() {
  const r = await fetch('https://app.dograh.com/api/v1/workflow/fetch/13027', {
    headers: { 'X-API-Key': key }
  });
  const d = await r.json();
  console.log('Workflow Name:', d.name);
  console.log('Voice Config:', JSON.stringify(d.voice_config || d.workflow_configurations?.voice_config || {}, null, 2));
  for (const n of (d.workflow_definition?.nodes || [])) {
    console.log(`\n=================== NODE ${n.id}: ${n.data?.name || n.name} ===================`);
    console.log(n.data?.prompt);
  }
}
run().catch(console.error);
