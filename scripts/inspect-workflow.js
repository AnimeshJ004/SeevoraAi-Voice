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
  console.log('Top-level keys:', Object.keys(d));
  console.log('llm_config:', d.llm_config);
  console.log('voice_config:', d.voice_config);
  console.log('workflow_configurations:', d.workflow_configurations);
  for (const n of (d.workflow_definition?.nodes || [])) {
    console.log(`Node ${n.id} (${n.data?.name}):`, {
      type: n.type,
      model: n.data?.model,
      voice: n.data?.voice,
      tts: n.data?.tts,
      llm: n.data?.llm,
      allow_interrupt: n.data?.allow_interrupt,
      tools: n.data?.tools
    });
  }
}
run().catch(console.error);
