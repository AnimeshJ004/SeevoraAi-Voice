async function testPipeline() {
  // Login first
  const loginRes = await fetch('http://localhost:8787/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'demo@rapidx.ai', password: 'RapidXDemo1234!' })
  });
  const cookie = loginRes.headers.get('set-cookie');
  console.log('Login status:', loginRes.status);

  // 1. Test chat in Hindi
  console.log('Testing /api/chat with Hindi query...');
  const chatRes = await fetch('http://localhost:8787/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Cookie': cookie },
    body: JSON.stringify({
      messages: [{ role: 'user', text: 'Aapki company kya karti hai aur kab open rehti hai?' }]
    })
  });
  console.log('Chat status:', chatRes.status);
  const chatData = await chatRes.json();
  console.log('LLM Reply:', chatData.text);

  // 2. Test TTS synthesis with Muga
  console.log('\nTesting /api/tts with Muga...');
  const ttsRes = await fetch('http://localhost:8787/api/tts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Cookie': cookie },
    body: JSON.stringify({
      model: 'muga',
      text: chatData.text || 'Seevora provides twenty-four seven AI Voice receptionists.'
    })
  });
  console.log('TTS status:', ttsRes.status);
  const buf = await ttsRes.arrayBuffer();
  console.log('TTS audio bytes received:', buf.byteLength);
}

testPipeline().catch(console.error);
