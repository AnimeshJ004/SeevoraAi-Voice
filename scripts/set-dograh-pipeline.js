const fs = require('fs');
const path = require('path');

function loadEnv() {
  const envPath = path.resolve(__dirname, '..', '.env');
  const lines = fs.readFileSync(envPath, 'utf8').split('\n');
  const env = {};
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const k = trimmed.slice(0, eq).trim();
    const v = trimmed.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '');
    env[k] = v;
  }
  return env;
}

const env = loadEnv();
const apiKey = env.DOGRAH_API_KEY;

async function updatePipeline() {
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
          model: env.GROQ_MODEL || 'openai/gpt-oss-20b'
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
    headers: { 'X-API-Key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  console.log('Update pipeline status:', res.status);
  const json = await res.json();
  console.log('Pipeline effective TTS:', json.effective_configuration ? json.effective_configuration.tts : json);
}

updatePipeline().catch(console.error);
