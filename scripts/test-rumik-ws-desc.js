const fs = require('fs');

const lines = fs.readFileSync('.env', 'utf8').split('\n');
let key = '';
for (const l of lines) {
  if (l.trim().startsWith('RUMIK_API_KEY=')) {
    key = l.trim().split('=')[1].replace(/['"]/g, '');
  }
}

async function testWs(desc) {
  const text = "Namaste, main Seevora ki AI receptionist hoon. Hum चौबीस घंटे aur saaton din service dete hain.";
  console.log('Requesting ws-connect with text:', text);
  const mintRes = await fetch('https://silk-api.rumik.ai/v1/tts/ws-connect', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${key}`,
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0'
    },
    body: JSON.stringify({ model: 'muga', text: text })
  });
  console.log('Mint status:', mintRes.status);
  const mint = await mintRes.json();
  console.log('Mint data:', mint);

  let url = mint.ws_url;
  if (mint.token && !url.includes('token=')) {
    url += (url.includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(mint.token);
  }

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    let chunks = 0;
    let totalBytes = 0;
    ws.onopen = () => {
      console.log('WS opened, sending frame...');
      const frame = {
        model: 'muga',
        text: text
      };
      if (desc) frame.description = desc;
      console.log('Sending frame:', frame);
      ws.send(JSON.stringify(frame));
    };

    ws.onmessage = (e) => {
      if (typeof e.data === 'string') {
        console.log('WS string message:', e.data);
      } else {
        chunks++;
        totalBytes += (e.data.byteLength || e.data.length || 0);
      }
    };

    ws.onclose = (e) => {
      console.log('WS closed:', e.code, e.reason);
      console.log(`Received ${chunks} chunks, ${totalBytes} bytes total.`);
      resolve({ chunks, totalBytes });
    };

    ws.onerror = (err) => {
      console.error('WS error:', err);
      reject(err);
    };
  });
}

async function run() {
  console.log('--- Test WS with description ---');
  await testWs('a warm Indian female voice, fluent in Hindi and English, natural Hinglish tone');
}

run().catch(console.error);
