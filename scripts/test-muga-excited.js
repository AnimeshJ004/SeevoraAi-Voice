const fs = require('fs');
const lines = fs.readFileSync('.env', 'utf8').split('\n');
let key = '';
for (const l of lines) {
  if (l.trim().startsWith('RUMIK_API_KEY=')) {
    key = l.trim().split('=')[1].replace(/['"]/g, '');
  }
}

async function testMuga() {
  console.log('Testing Rumik /v1/tts/ws-connect with Muga excited tone...');
  const res = await fetch('https://silk-api.rumik.ai/v1/tts/ws-connect', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${key}`,
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
    },
    body: JSON.stringify({
      model: 'muga',
      text: '[excited] Hi! Thank you for calling Seevora! I am your AI assistant.'
    })
  });
  console.log('ws-connect status:', res.status);
  const data = await res.json();
  console.log('ws-connect data:', data);

  console.log('Testing Rumik /v1/tts batch with Muga excited tone...');
  const ttsRes = await fetch('https://silk-api.rumik.ai/v1/tts', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${key}`,
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
    },
    body: JSON.stringify({
      model: 'muga',
      text: '[excited] Hi! Thank you for calling Seevora! I am your AI assistant.'
    })
  });
  console.log('tts status:', ttsRes.status);
  const buf = await ttsRes.arrayBuffer();
  console.log('tts audio buffer bytes:', buf.byteLength);
}

testMuga().catch(console.error);
