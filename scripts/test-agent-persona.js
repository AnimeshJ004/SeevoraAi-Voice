const fs = require('fs');

async function testServerChat() {
  const db = JSON.parse(fs.readFileSync('dashboard/data/db.json', 'utf8'));
  const agent = db.agents[0];

  const loginRes = await fetch('http://localhost:8787/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'demo@rapidx.ai', password: 'RapidXDemo1234!' })
  });
  const cookie = loginRes.headers.get('set-cookie');

  async function ask(query) {
    const res = await fetch('http://localhost:8787/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Cookie': cookie },
      body: JSON.stringify({
        messages: [
          { role: 'assistant', text: agent.greeting },
          { role: 'user', text: query }
        ],
        system: agent.persona
      })
    });
    const d = await res.json();
    console.log(`\nUser: "${query}"`);
    console.log(`AI:   "${d.text}"`);
    return d.text;
  }

  console.log('Testing Server Chat Language Switching:');
  await ask('Seevora ke baare me batao');
  await ask('Tell me about Seevora');
  await ask('Aapke founder kaun hain?');
  await ask('Who founded Seevora?');
}

testServerChat().catch(console.error);
