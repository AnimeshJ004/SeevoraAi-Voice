const fs = require('fs');
const lines = fs.readFileSync('.env', 'utf8').split('\n');
const env = {};
for (const l of lines) {
  const eq = l.indexOf('=');
  if (eq > 0) env[l.slice(0, eq).trim()] = l.slice(eq + 1).trim().replace(/['"]/g, '');
}

async function updateModelConfig() {
  console.log('Current Dograh API Key:', env.DOGRAH_API_KEY ? 'Present' : 'Missing');

  const payload = {
    version: 2,
    mode: 'byok',
    byok: {
      mode: 'pipeline',
      pipeline: {
        stt: {
          provider: 'deepgram',
          api_key: env.DEEPGRAM_API_KEY,
          model: 'nova-3-general',
          language: 'multi'
        },
        llm: {
          provider: 'groq',
          api_key: env.GROQ_API_KEY,
          model: 'qwen/qwen3.8-27b'
        },
        tts: {
          provider: 'rumik',
          api_key: env.RUMIK_API_KEY,
          model: 'muga',
          voice: env.RUMIK_VOICE || 'ira'
        }
      }
    }
  };

  const res = await fetch('https://app.dograh.com/api/v1/organizations/model-configurations/v2', {
    method: 'PUT',
    headers: {
      'X-API-Key': env.DOGRAH_API_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });
  console.log('Update pipeline status:', res.status);
  const json = await res.json();
  console.log('Response:', JSON.stringify(json, null, 2));
}

updateModelConfig().catch(console.error);
