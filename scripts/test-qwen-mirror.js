const fs = require('fs');
const lines = fs.readFileSync('.env', 'utf8').split('\n');
let key = '';
for (const l of lines) {
  if (l.trim().startsWith('GROQ_API_KEY=')) {
    key = l.trim().split('=')[1].replace(/['"]/g, '');
  }
}
const db = JSON.parse(fs.readFileSync('dashboard/data/db.json', 'utf8'));
const agent = db.agents[0];

async function test(query) {
  const messages = [
    { role: 'system', content: agent.persona },
    { role: 'assistant', content: agent.greeting },
    { role: 'user', content: query }
  ];
  const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'qwen/qwen3.8-27b', messages, temperature: 0.7 })
  });
  const d = await r.json();
  console.log('User:', query);
  console.log('Reply:', d.choices?.[0]?.message?.content);
}

async function run() {
  console.log('Testing Qwen with both Hindi and English:');
  await test('Tell me about Seevora');
  await test('Who is your CEO?');
  await test('Seevora ke baare me bataiye');
  await test('Aap kya kya karte ho?');
  await test('What are your services?');
}
run().catch(console.error);
