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
  console.log('Definition keys:', Object.keys(d.workflow_definition || {}));
  for (const n of (d.workflow_definition?.nodes || [])) {
    console.log('Node:', n.id, n.type, n.name || n.data?.name);
    if (n.data?.voice || n.data?.tts || n.data?.model) {
      console.log('   data:', { voice: n.data.voice, tts: n.data.tts, model: n.data.model });
    }
  }
}
run().catch(console.error);
