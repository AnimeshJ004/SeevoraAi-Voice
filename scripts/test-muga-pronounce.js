const fs = require('fs');
const lines = fs.readFileSync('.env', 'utf8').split('\n');
let key = '';
for (const l of lines) {
  if (l.trim().startsWith('RUMIK_API_KEY=')) {
    key = l.trim().split('=')[1].replace(/['"]/g, '');
  }
}

async function test(filename, text, desc, tone) {
  let fullText = text;
  if (tone && tone !== 'neutral') {
    fullText = `[${tone}] ` + text;
  }
  const payload = {
    model: 'muga',
    text: fullText
  };
  if (desc) payload.description = desc;
  console.log(`\nTesting [${filename}]:`, payload);

  const res = await fetch('https://silk-api.rumik.ai/v1/tts', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${key}`,
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0'
    },
    body: JSON.stringify(payload)
  });
  console.log('Status:', res.status);
  const buf = await res.arrayBuffer();
  console.log('Size:', buf.byteLength);
  fs.writeFileSync(filename, Buffer.from(buf));
}

async function run() {
  // Test 1: "24/7" vs "round the clock" vs "twenty four seven"
  await test('test1_raw.wav', 'Seevora provides 24/7 AI Voice receptionists.', null, 'neutral');
  await test('test2_spoken.wav', 'Seevora provides twenty-four seven AI Voice receptionists.', 'natural Indian accent, speaking Hindi and English fluently', 'neutral');
  await test('test3_hindi.wav', 'नमस्ते! मैं सीवोरा की एआई रिसेप्शनिस्ट हूँ। मैं आपकी क्या मदद कर सकती हूँ?', 'clear Indian female voice speaking natural Hindi', 'neutral');
  await test('test4_hinglish.wav', 'Namaste! Main Seevora ki AI receptionist hoon. Main aapki kya madad kar sakti hoon?', 'clear Indian female voice speaking natural Hindi and Hinglish', 'neutral');
}

run().catch(console.error);
