const fs = require('fs');
const WebSocket = require('ws');

const lines = fs.readFileSync('.env', 'utf8').split('\n');
let key = '';
for (const l of lines) {
  if (l.trim().startsWith('DEEPGRAM_API_KEY=')) {
    key = l.trim().split('=')[1].replace(/['"]/g, '');
  }
}

console.log('Testing Deepgram WS with key:', key.slice(0, 8) + '...');

const query = new URLSearchParams({
  model: 'nova-3',
  language: 'multi',
  smart_format: 'true',
  punctuate: 'true',
  interim_results: 'true',
  endpointing: '300',
  utterance_end_ms: '1000',
  vad_events: 'true',
});

const ws = new WebSocket(`wss://api.deepgram.com/v1/listen?${query}`, {
  headers: { Authorization: `Token ${key}` }
});

ws.on('open', () => {
  console.log('Deepgram WS OPEN successfully!');
  ws.close();
});

ws.on('error', (err) => {
  console.error('Deepgram WS ERROR:', err);
});

ws.on('close', (code, reason) => {
  console.log('Deepgram WS CLOSE:', code, reason.toString());
});
