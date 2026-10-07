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
  console.log('Top keys:', Object.keys(d));
  console.log('Workflow keys:', {
    llm_config: d.llm_config,
    voice_config: d.voice_config,
    model: d.model,
    tts: d.tts,
    stt: d.stt
  });
  for (const n of (d.workflow_definition?.nodes || [])) {
    console.log('Node ' + n.id + ' (' + (n.data?.name || n.name) + '):', {
      model: n.data?.model,
      voice: n.data?.voice,
      tts: n.data?.tts,
      llm: n.data?.llm,
      model_config: n.data?.model_config,
      voice_config: n.data?.voice_config
    });
  }
}
run().catch(console.error);
