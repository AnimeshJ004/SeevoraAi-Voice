const fs = require('fs');
const lines = fs.readFileSync('.env', 'utf8').split('\n');
let key = '';
for (const l of lines) {
  if (l.trim().startsWith('DOGRAH_API_KEY=')) {
    key = l.trim().split('=')[1].replace(/['"]/g, '');
  }
}

async function fixDograhWorkflow() {
  console.log('Fetching workflow 13027 from Dograh...');
  const getRes = await fetch('https://app.dograh.com/api/v1/workflow/fetch/13027', {
    headers: { 'X-API-Key': key, 'Accept': 'application/json' }
  });
  const data = await getRes.json();
  const def = data.workflow_definition;

  const node0 = def.nodes.find(n => n.id === '0');
  if (node0) {
    console.log('Current Node 0 Prompt length:', node0.data.prompt.length);
    let p = node0.data.prompt;

    // Remove any instruction forcing English
    p = p.replace(/- Plain spoken English\..*?\n/g, '');

    // Add strict language mirroring at the top of HOW YOU SPEAK
    const howYouSpeakOld = '# HOW YOU SPEAK, THIS MATTERS MORE THAN ANYTHING';
    const howYouSpeakNew = `# HOW YOU SPEAK, THIS MATTERS MORE THAN ANYTHING

- STRICT LANGUAGE MIRRORING (CRITICAL): You MUST ALWAYS reply in the exact language the caller speaks!
  * If the caller speaks Hindi or Hinglish (e.g. "Seevora ke baare me batao", "Aap kya karte ho?", "Founder kaun hai?"): YOU MUST REPLY IN NATURAL CONVERSATIONAL HINDI / HINGLISH. NEVER reply in English to a Hindi question!
  * If the caller speaks English (e.g. "Tell me about Seevora", "Who is the CEO?"): Reply in natural English.
  * Always mirror the caller's language dynamically from turn to turn.
- ONE or TWO short spoken sentences per turn. Never more. This is a phone call, not an essay.
- Natural spoken phrasing. No bullet points, no lists, no markdown, no emoji.
- Warm, quick, confident. Like a sharp receptionist who genuinely wants to help.`;

    if (p.includes(howYouSpeakOld)) {
      p = p.replace(howYouSpeakOld, howYouSpeakNew);
    } else {
      p = howYouSpeakNew + '\n\n' + p;
    }

    // Make sure 24/7 is spelled out
    p = p.replace(/24\/7/g, 'twenty-four seven');
    p = p.replace(/24\*7/g, 'twenty-four seven');

    node0.data.prompt = p;
    console.log('Updated Node 0 Prompt.');
  }

  // Also check Node 1 (Start/Greeting)
  const node1 = def.nodes.find(n => n.id === '1');
  if (node1) {
    node1.data.prompt = `# THIS STAGE

Open the call in a clear, polite, and professional tone.
In ONE natural sentence, say: "Hi! Thank you for calling Seevora! I'm your AI assistant. How can I help you today?"

CRITICAL: As soon as the caller replies in Hindi or Hinglish, switch immediately to Hindi/Hinglish!`;
    console.log('Updated Node 1 Prompt.');
  }

  // Also check Node 2 (Discover Intent)
  const node2 = def.nodes.find(n => n.id === '2');
  if (node2) {
    node2.data.prompt = `Understand what the caller or their business needs. Ask one short question at a time to find out if they need AI voice agents, WhatsApp automation, or CRM integration.
MANDATORY: Always match the caller's language (Hindi/Hinglish if they spoke Hindi, English if they spoke English).`;
    console.log('Updated Node 2 Prompt.');
  }

  // Also check Node 3 (Answer or Qualify)
  const node3 = def.nodes.find(n => n.id === '3');
  if (node3) {
    node3.data.prompt = `Answer from known Seevora capabilities in 1 or 2 concise, clear sentences. Offer to set up a free discovery audit or a demo with our team.
MANDATORY: Always match the caller's language (Hindi/Hinglish if they spoke Hindi, English if they spoke English).`;
    console.log('Updated Node 3 Prompt.');
  }

  console.log('Saving workflow 13027 to Dograh...');
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

fixDograhWorkflow().catch(console.error);
