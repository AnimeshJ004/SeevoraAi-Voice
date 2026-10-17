const fs = require('fs');
const lines = fs.readFileSync('.env', 'utf8').split('\n');
let key = '';
for (const l of lines) {
  if (l.trim().startsWith('DOGRAH_API_KEY=')) {
    key = l.trim().split('=')[1].replace(/['"]/g, '');
  }
}

async function run() {
  const env = {};
  for (const l of lines) {
    const eq = l.indexOf('=');
    if (eq > 0) env[l.slice(0, eq).trim()] = l.slice(eq + 1).trim().replace(/['"]/g, '');
  }

  // 1. Try login with email/password
  const loginRes = await fetch('https://app.dograh.com/api/v1/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: env.DOGRAH_EMAIL, password: env.DOGRAH_PASSWORD })
  });
  console.log('Login status:', loginRes.status);
  const loginData = await loginRes.json();
  const token = loginData.access_token || loginData.token || key;
  console.log('Token obtained:', !!token);

  // 2. Fetch model config with Bearer token
  const r = await fetch('https://app.dograh.com/api/v1/organizations/model-configurations/v2', {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  console.log('Config status with Bearer:', r.status);
  const d = await r.json();
  console.log('Config:', JSON.stringify(d, null, 2));
}
run().catch(console.error);
