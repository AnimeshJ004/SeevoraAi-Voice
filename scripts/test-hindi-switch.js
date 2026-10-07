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

async function test(model, query) {
  const messages = [
    { role: 'system', content: agent.persona },
    { role: 'assistant', content: agent.greeting },
    { role: 'user', content: query }
  ];
  const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages, temperature: 0.7 })
  });
  const d = await r.json();
  console.log('Query:', query);
  console.log('Reply:\n', d.choices?.[0]?.message?.content || d.error);
}

async function run() {
  const models = ['openai/gpt-oss-20b', 'qwen/qwen3.8-27b', 'openai/gpt-oss-120b'];
  const queries = [
    'seevora ke baare me batao',
    'mujhe seevora ke baare me janna hai',
    'aapke founder kaun hain?'
  ];

  for (const m of models) {
    console.log(`\n=================== MODEL: ${m} ===================`);
    for (const q of queries) {
      await test(m, q);
    }
  }
}
run().catch(console.error);
