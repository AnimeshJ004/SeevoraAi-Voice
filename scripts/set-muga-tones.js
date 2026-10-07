const fs = require('fs');
const path = require('path');
const envPath = path.resolve(__dirname, '..', '.env');
const lines = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8').split('\n') : [];
let apiKey = process.env.DOGRAH_API_KEY || '';
for (const l of lines) {
  if (l.trim().startsWith('DOGRAH_API_KEY=')) apiKey = l.trim().split('=')[1].replace(/['"]/g, '');
}

async function updateWorkflow() {
  const getRes = await fetch('https://app.dograh.com/api/v1/workflow/fetch/13027', {
    headers: { 'X-API-Key': apiKey, 'Accept': 'application/json' }
  });
  const data = await getRes.json();
  const def = data.workflow_definition;

  // 1. Update Node 0 (Global Node)
  const node0 = def.nodes.find(n => n.id === '0');
  if (node0) {
    let p = node0.data.prompt;
    if (!p.includes('EMOTION & TONE TAGS')) {
      p += '\n\n# EMOTION & TONE TAGS (RUMIK MUGA)\n- To produce an enthusiastic, joyful, and warm voice, ALWAYS prefix every spoken sentence with an emotional tone tag: [happy] or [excited].\n- Use [excited] for greetings, introducing Seevora, discussing automation benefits, and celebratory remarks.\n- Use [happy] for acknowledging caller replies, answering questions, and confirming booking details.\n- Example: "[excited] Hi! Thank you for calling Seevora! How can I help you today?"\n- Example: "[happy] That sounds great, we can definitely build that custom voice system for your business!"\n';
      node0.data.prompt = p;
    }
  }

  // 2. Update Node 1 (Start / Greeting)
  const node1 = def.nodes.find(n => n.id === '1');
  if (node1) {
    node1.data.prompt = '# THIS STAGE\n\nOpen the call with warm, joyful energy.\nIn ONE natural sentence, say: "[excited] Hi! Thank you for calling Seevora! I\'m your AI assistant. How can I help you today?"\n\nMirror the caller\'s language naturally. Always keep an [excited] or [happy] tone.';
  }

  // 3. Update Node 2 (Discover Intent)
  const node2 = def.nodes.find(n => n.id === '2');
  if (node2) {
    node2.data.prompt = 'Understand what the caller or their business needs. Ask one short question at a time to find out if they need AI voice agents, WhatsApp automation, or CRM integration. Prefix responses with [happy] or [excited].';
  }

  // 4. Update Node 3 (Answer or Qualify)
  const node3 = def.nodes.find(n => n.id === '3');
  if (node3) {
    node3.data.prompt = 'Answer from known Seevora capabilities in 1 or 2 concise, enthusiastic sentences. Prefix responses with [happy] or [excited]. Offer to set up a free discovery audit or a demo with our team.';
  }

  // 5. Update Node 4 (Capture Outcome)
  const node4 = def.nodes.find(n => n.id === '4');
  if (node4) {
    node4.data.prompt = 'Confirm the caller\'s requirement and contact details in one short sentence. Prefix with [happy]. Ask for preferred callback time or offer demo details on WhatsApp.';
  }

  // 6. Update Node 6 (End)
  const node6 = def.nodes.find(n => n.id === '6');
  if (node6) {
    node6.data.prompt = 'Thank the caller for reaching out to Seevora. Prefix with [happy] or [excited]. Wish them a great day and close politely in one sentence.';
  }

  console.log('Sending PUT to update workflow 13027...');
  const putRes = await fetch('https://app.dograh.com/api/v1/workflow/13027', {
    method: 'PUT',
    headers: { 'X-API-Key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: data.name, workflow_definition: def })
  });
  console.log('Update status:', putRes.status);

  console.log('Publishing workflow...');
  const pubRes = await fetch('https://app.dograh.com/api/v1/workflow/13027/publish', {
    method: 'POST',
    headers: { 'X-API-Key': apiKey, 'Content-Type': 'application/json' }
  });
  console.log('Publish status:', pubRes.status);
}

updateWorkflow().catch(console.error);
