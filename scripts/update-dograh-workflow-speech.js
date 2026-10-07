const fs = require('fs');
const lines = fs.readFileSync('.env', 'utf8').split('\n');
let key = '';
for (const l of lines) {
  if (l.trim().startsWith('DOGRAH_API_KEY=')) {
    key = l.trim().split('=')[1].replace(/['"]/g, '');
  }
}

async function updateDograhWorkflow() {
  console.log('Fetching workflow 13027 from Dograh...');
  const getRes = await fetch('https://app.dograh.com/api/v1/workflow/fetch/13027', {
    headers: { 'X-API-Key': key, 'Accept': 'application/json' }
  });
  const data = await getRes.json();
  const def = data.workflow_definition;

  const node0 = def.nodes.find(n => n.id === '0');
  if (node0) {
    let p = node0.data.prompt;
    // Replace "24/7" with "Twenty-four seven"
    p = p.replace(/1\.\s*24\/7\s*AI Voice Receptionists/, '1. Twenty-four seven AI Voice Receptionists');
    
    // Ensure speech pronunciation rules exist
    if (!p.includes('SPEECH & PRONUNCIATION RULES')) {
      p += `\n\n# SPEECH & PRONUNCIATION RULES (CRITICAL FOR VOICE TTS)
- NEVER write or say "24/7" or "24*7" or "/". Always say "twenty-four seven" or "chaubees ghante".
- NEVER say raw mathematical symbols, asterisks, or markdown characters.
- When speaking Hindi or Hinglish, speak in natural conversational Hindi/Hinglish phrasing with clear Indian pronunciation.
- Keep responses strictly to 1 or 2 concise, spoken sentences.
`;
    }
    node0.data.prompt = p;
    console.log('Updated Node 0 prompt.');
  }

  console.log('Updating workflow 13027...');
  const putRes = await fetch('https://app.dograh.com/api/v1/workflow/13027', {
    method: 'PUT',
    headers: { 'X-API-Key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: data.name, workflow_definition: def })
  });
  console.log('Update status:', putRes.status);

  console.log('Publishing workflow 13027...');
  const pubRes = await fetch('https://app.dograh.com/api/v1/workflow/13027/publish', {
    method: 'POST',
    headers: { 'X-API-Key': key, 'Content-Type': 'application/json' }
  });
  console.log('Publish status:', pubRes.status);
}

updateDograhWorkflow().catch(console.error);
