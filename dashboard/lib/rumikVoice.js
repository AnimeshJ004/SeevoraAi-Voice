'use strict';

const crypto = require('crypto');

/**
 * Rumik Voice Registry & Synthesis Engine for Seevora AI Voice
 * Powered by Rumik Mulberry & Muga Streaming Speech Engine
 */

const VOICE_CATALOG = [
  {
    id: 'ira',
    name: 'Ira',
    rumikVoice: 'Mia',
    gender: 'female',
    accent: 'Indian English / Hinglish',
    model: 'mulberry',
    language: 'hinglish',
    defaultTone: 'happy',
    tags: ['Warm', 'Friendly', 'Empathetic', 'Natural'],
    recommendedFor: 'Clinics, Dental Care, Salons, Hospitality & Customer Service',
    description: 'a female 30s indian voice, normal pitch, warm timbre, conversational pacing, calm and reassuring, professional register, like a customer support agent.',
    sampleGreeting: 'Namaste! Welcome to our clinic. Main aapki appointment schedule karne mein madad kar sakti hoon.'
  },
  {
    id: 'arav',
    name: 'Arav',
    rumikVoice: 'Lucas',
    gender: 'male',
    accent: 'Indian English / Hinglish',
    model: 'mulberry',
    language: 'hinglish',
    defaultTone: 'professional',
    tags: ['Corporate', 'Authoritative', 'Calm', 'Steady'],
    recommendedFor: 'Real Estate, Legal Advisory, Finance, Corporate Reception',
    description: 'a male 30s indian voice, low pitch, smooth timbre, slow pacing, neutral, formal register, like a corporate training narrator.',
    sampleGreeting: 'Hello! Thank you for calling our office. How can I assist you with your project inquiry today?'
  },
  {
    id: 'riya',
    name: 'Riya',
    rumikVoice: 'Sophia',
    gender: 'female',
    accent: 'Indian English / Hinglish',
    model: 'mulberry',
    language: 'hinglish',
    defaultTone: 'excited',
    tags: ['Energetic', 'Enthusiastic', 'High-Converting', 'Dynamic'],
    recommendedFor: 'Sales Outreach, Outbound Calling Campaigns, Event Inquiries',
    description: 'a female 20s indian voice, high pitch, smooth timbre, brisk pacing, energetic, casual register, like a social media creator.',
    sampleGreeting: 'Hi! Thank you for calling Seevora AI! I would love to walk you through our voice automation features.'
  },
  {
    id: 'dev',
    name: 'Dev',
    rumikVoice: 'Adam',
    gender: 'male',
    accent: 'Indian English / Hinglish',
    model: 'mulberry',
    language: 'hinglish',
    defaultTone: 'empathetic',
    tags: ['Supportive', 'Patient', 'Gentle', 'Clear'],
    recommendedFor: 'IT Helpdesk, Hospital Triage, Emergency Support, Billing Inquiries',
    description: 'a male 40s voice, deep and patient timbre, measured conversational pacing, confident, formal register, like a brand spokesperson.',
    sampleGreeting: 'Namaste! Seevora support desk par aapka swagat hai. Kripya batayein main aapki kya sahayata kar sakta hoon?'
  },
  {
    id: 'ananya',
    name: 'Ananya',
    rumikVoice: 'Emma',
    gender: 'female',
    accent: 'Modern Indian English',
    model: 'mulberry',
    language: 'hinglish',
    defaultTone: 'happy',
    tags: ['Sophisticated', 'Polite', 'Premium', 'Articulate'],
    recommendedFor: 'High-Ticket Consulting, Luxury Spas, Architecture & Design Studios',
    description: 'a female 30s articulate voice, normal pitch, smooth timbre, brisk pacing, polite, neutral register, like a virtual receptionist.',
    sampleGreeting: 'Good day! Thank you for reaching out to our boutique advisory. How may we assist your consultation today?'
  },
  {
    id: 'kabir',
    name: 'Kabir',
    rumikVoice: 'Noah',
    gender: 'male',
    accent: 'Conversational Hinglish',
    model: 'mulberry',
    language: 'hinglish',
    defaultTone: 'neutral',
    tags: ['Casual', 'Approachable', 'Modern', 'Youthful'],
    recommendedFor: 'Gyms & Fitness Centers, E-Commerce Stores, Consumer Tech Brands',
    description: 'a male 20s voice, normal pitch, warm timbre, conversational pacing, relaxed and friendly, casual register, like a podcast host.',
    sampleGreeting: 'Hey! Thanks for calling us. How can I help you check memberships or latest offers today?'
  }
];

const TONE_PRESETS = [
  { id: 'happy', label: 'Warm & Friendly', emotionTag: '[happy]', desc: 'Joyful, polite and welcoming energy' },
  { id: 'excited', label: 'Enthusiastic & High Energy', emotionTag: '[excited]', desc: 'Upbeat and lively for marketing & sales' },
  { id: 'neutral', label: 'Calm & Balanced', emotionTag: '[neutral]', desc: 'Steady, objective and clear tone' },
  { id: 'empathetic', label: 'Empathetic & Gentle', emotionTag: '[happy]', desc: 'Soft and patient for healthcare and support' },
  { id: 'professional', label: 'Corporate & Formal', emotionTag: '[neutral]', desc: 'Dignified executive and business tone' }
];

// In-memory cache for synthesized audio snippets (key: hash -> { wavBuffer, dataUrl, ts })
const audioCache = new Map();

/**
 * Prepend a standard 44-byte RIFF/WAV header to 24kHz 16-bit mono raw PCM audio
 */
function pcmToWav(pcmBuffer, sampleRate = 24000) {
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const dataSize = pcmBuffer.length;
  const header = Buffer.alloc(44);

  header.write('RIFF', 0);
  header.writeUInt32LE(dataSize + 36, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16); // Subchunk1Size
  header.writeUInt16LE(1, 20);  // 1 = Linear PCM
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataSize, 40);

  return Buffer.concat([header, pcmBuffer]);
}

/**
 * Generate a synthetic pleasant preview tone waveform (fallback if Rumik network is unreachable)
 */
function generateSyntheticFallbackWav(text = '', sampleRate = 24000) {
  const durationSec = Math.min(3.5, Math.max(1.5, text.length * 0.05));
  const numSamples = Math.floor(sampleRate * durationSec);
  const pcm = Buffer.alloc(numSamples * 2);

  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    const env = Math.exp(-2.2 * (t % 0.8));
    const sample = Math.sin(2 * Math.PI * 440 * t) * 0.4 +
                   Math.sin(2 * Math.PI * 554.37 * t) * 0.25 +
                   Math.sin(2 * Math.PI * 659.25 * t) * 0.2;
    const val = Math.floor(sample * env * 14000);
    pcm.writeInt16LE(Math.max(-32767, Math.min(32767, val)), i * 2);
  }

  return pcmToWav(pcm, sampleRate);
}

/**
 * Synthesize speech preview via Rumik Silk WebSocket API
 */
async function synthesizeRumikSpeech(options = {}) {
  const {
    text = 'Namaste, main Seevora AI Voice receptionist hoon.',
    voiceId = 'ira',
    model = '',
    tone = 'happy',
    speed = 1.0,
    customDescription = ''
  } = options;

  const cleanText = String(text || '').trim().slice(0, 500);

  // Look up specific voice in catalog
  const voiceMeta = VOICE_CATALOG.find((v) =>
    v.id.toLowerCase() === String(voiceId).toLowerCase() ||
    (v.rumikVoice && v.rumikVoice.toLowerCase() === String(voiceId).toLowerCase())
  ) || VOICE_CATALOG[0];

  const targetVoice = voiceMeta.rumikVoice || 'Mia';
  const targetModel = model || voiceMeta.model || 'mulberry';
  const targetLang = voiceMeta.language || 'hinglish';
  const tonePreset = TONE_PRESETS.find((t) => t.id === tone) || TONE_PRESETS[0];

  // Distinct cache key per voice ID and text so previews are completely separated
  const cacheKey = crypto.createHash('md5').update(`${voiceMeta.id}|${targetVoice}|${targetModel}|${tone}|${speed}|${cleanText}`).digest('hex');

  if (audioCache.has(cacheKey)) {
    return audioCache.get(cacheKey);
  }

  const apiKey = options.apiKey || process.env.RUMIK_API_KEY || '';
  if (!apiKey) {
    const fallbackWav = generateSyntheticFallbackWav(cleanText);
    const result = {
      ok: true,
      dataUrl: 'data:audio/wav;base64,' + fallbackWav.toString('base64'),
      duration: 2.0,
      source: 'fallback'
    };
    audioCache.set(cacheKey, result);
    return result;
  }

  try {
    // 1. Request WebSocket connection token from Rumik Silk API with exact voice and language
    const connectPayload = {
      model: targetModel,
      text: cleanText,
      voice: targetVoice,
      language: targetLang
    };
    if (customDescription || voiceMeta.description) {
      connectPayload.description = customDescription || voiceMeta.description;
    }

    const connectRes = await fetch('https://silk-api.rumik.ai/v1/tts/ws-connect', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0'
      },
      body: JSON.stringify(connectPayload)
    });

    if (!connectRes.ok) {
      throw new Error(`Rumik connect HTTP ${connectRes.status}`);
    }

    const mint = await connectRes.json();
    let wsUrl = mint.ws_url;
    if (mint.token && !wsUrl.includes('token=')) {
      wsUrl += (wsUrl.includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(mint.token);
    }

    // 2. Stream audio chunks via WebSocket with voice frame
    const pcmChunks = [];
    let audioDuration = 2.0;

    await new Promise((resolve) => {
      const timeout = setTimeout(() => {
        try { ws.close(); } catch (_) {}
        resolve();
      }, 8000);

      const ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        const frame = {
          model: targetModel,
          text: cleanText,
          voice: targetVoice,
          language: targetLang
        };
        if (customDescription || voiceMeta.description) {
          frame.description = customDescription || voiceMeta.description;
        }
        ws.send(JSON.stringify(frame));
      };

      ws.onmessage = async (e) => {
        if (typeof e.data === 'string') {
          try {
            const parsed = JSON.parse(e.data);
            if (parsed.audio_duration) audioDuration = parsed.audio_duration;
            if (parsed.type === 'done') {
              clearTimeout(timeout);
              try { ws.close(); } catch (_) {}
              resolve();
            }
          } catch (_) {}
        } else if (e.data && typeof e.data.arrayBuffer === 'function') {
          const ab = await e.data.arrayBuffer();
          pcmChunks.push(Buffer.from(ab));
        } else if (e.data) {
          pcmChunks.push(Buffer.from(e.data));
        }
      };

      ws.onclose = () => {
        clearTimeout(timeout);
        resolve();
      };

      ws.onerror = () => {
        clearTimeout(timeout);
        try { ws.close(); } catch (_) {}
        resolve();
      };
    });

    const pcmBuffer = Buffer.concat(pcmChunks);
    let wavBuffer;

    if (pcmBuffer.length > 100) {
      wavBuffer = pcmToWav(pcmBuffer, 24000);
    } else {
      wavBuffer = generateSyntheticFallbackWav(cleanText);
    }

    const result = {
      ok: true,
      dataUrl: 'data:audio/wav;base64,' + wavBuffer.toString('base64'),
      duration: audioDuration || 2.2,
      source: pcmBuffer.length > 100 ? 'rumik' : 'fallback',
      voice: targetVoice
    };

    audioCache.set(cacheKey, result);
    return result;
  } catch (err) {
    const fallbackWav = generateSyntheticFallbackWav(cleanText);
    const result = {
      ok: true,
      dataUrl: 'data:audio/wav;base64,' + fallbackWav.toString('base64'),
      duration: 2.0,
      source: 'fallback',
      voice: targetVoice
    };
    audioCache.set(cacheKey, result);
    return result;
  }
}

const DOGRAH_PROVIDER_UUID = '6b18d881-8a19-49e7-868f-49908487a5e5';

const DOGRAH_VOICE_MAP = {
  ira: 'dg_voice_6e30d8477e1036594a34',      // Arushi - Hinglish Speaker (Bilingual Hindi/English/Hinglish native, seamless steady pitch)
  arushi: 'dg_voice_6e30d8477e1036594a34',
  janvi: 'dg_voice_1a8124dba11d9c9d2c90',    // Janvi - Steady Agent (Formal Indian English)
  mia: 'dg_voice_6e30d8477e1036594a34',
  priya: 'dg_voice_a1753028c332bcfb3f06',    // Priya - Trusted Operator (Patient, authoritative customer support)
  riya: 'dg_voice_97d4516437fe6c87cc1b',     // Riya - College Roommate (Energetic, friendly Hindi female)
  sophia: 'dg_voice_97d4516437fe6c87cc1b',
  arav: 'dg_voice_ee5efd12f17797d0ff39',     // Aarav - Old Time Storyteller (Warm adult male, Indian accent)
  aarav: 'dg_voice_ee5efd12f17797d0ff39',
  lucas: 'dg_voice_ee5efd12f17797d0ff39',
  dev: 'dg_voice_a50f13b2d8c083dd60e5',      // Dev - Friendly Host (Calm, genuine Hindi/Hinglish male helpdesk)
  adam: 'dg_voice_a50f13b2d8c083dd60e5',
  ananya: 'dg_voice_d59fce898d558485677b',   // Ananya - Process Facilitator (Articulate, sophisticated Hindi/English female)
  emma: 'dg_voice_d59fce898d558485677b',
  kabir: 'dg_voice_437a1f970729e529e3d3',    // Kabir - Service Integrator (Modern, approachable Hindi/Hinglish male)
  noah: 'dg_voice_437a1f970729e529e3d3',
  sanya: 'dg_voice_c00befaf7c6c41bed0a2'     // Sanya - Modern Communicator (Crisp, approachable Hindi female)
};

/**
 * Sync selected client voice into Dograh Organization Model Configuration
 * Updates the active Dograh Pipeline configuration with the mapped native Indian voice
 * and configures multilingual STT with Hindi+English hints for flawless speech comprehension.
 */
async function syncDograhPipelineVoice(voiceId = 'ira', model = 'mulberry', options = {}) {
  const dograhKey = options.dograhKey || options.apiKey || options.dograhApiKey || process.env.DOGRAH_API_KEY || '';
  if (!dograhKey) return { ok: false, error: 'missing_dograh_key' };

  const vKey = String(voiceId || 'ira').toLowerCase().trim();
  const targetVoice = DOGRAH_VOICE_MAP[vKey] || (vKey.startsWith('dg_voice_') ? vKey : 'dg_voice_1a8124dba11d9c9d2c90');

  try {
    let configUuid = options.modelConfigUuid;
    let configName = 'Organization default';

    // 1. Resolve active configuration UUID if not provided
    if (!configUuid) {
      try {
        const listRes = await fetch('https://app.dograh.com/api/v1/model-connections/model-configurations', {
          headers: { 'X-API-Key': dograhKey }
        });
        if (listRes.ok) {
          const configs = await listRes.json();
          const active = (Array.isArray(configs) && (configs.find((c) => c.is_active) || configs[0])) || null;
          if (active && active.uuid) {
            configUuid = active.uuid;
            configName = active.name || configName;
          }
        }
      } catch (_) {}
    }

    if (!configUuid) {
      configUuid = '5b1bc597-6ba0-4058-a342-9129ace7ecde';
    }

    // 2. Fetch current configuration to preserve provider connection uuids & STT settings
    const getRes = await fetch('https://app.dograh.com/api/v1/model-connections/model-configurations/' + configUuid, {
      headers: { 'X-API-Key': dograhKey }
    });
    if (!getRes.ok) {
      return { ok: false, status: getRes.status, error: 'Dograh GET config returned ' + getRes.status };
    }
    const current = await getRes.json();
    const cfg = current.configuration || {};

    // Ensure Dograh provider connection is restored & active
    try {
      await fetch(`https://app.dograh.com/api/v1/model-connections/provider-connections/${DOGRAH_PROVIDER_UUID}/restore`, {
        method: 'POST',
        headers: { 'X-API-Key': dograhKey }
      }).catch(() => {});
    } catch (_) {}

    // Configure Native Indian TTS Voice (human-like, authentic Indian cadence, natural Devanagari & English)
    cfg.tts = {
      settings: {
        model: 'default',
        voice: targetVoice,
        speed: 1
      },
      provider_connection_uuid: DOGRAH_PROVIDER_UUID
    };

    // Configure Multilingual High-Accuracy Indian Speech Recognition
    cfg.stt = {
      settings: {
        model: 'default',
        language: 'multi',
        language_hints: ['hi', 'en']
      },
      provider_connection_uuid: DOGRAH_PROVIDER_UUID
    };

    // Configure High-Throughput Conversational LLM with zero 413 token limit issues
    cfg.llm = {
      settings: {
        model: 'default',
        temperature: null
      },
      provider_connection_uuid: DOGRAH_PROVIDER_UUID
    };

    // 3. Patch Dograh configuration with target voice & model
    const patchRes = await fetch('https://app.dograh.com/api/v1/model-connections/model-configurations/' + configUuid, {
      method: 'PATCH',
      headers: {
        'X-API-Key': dograhKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: current.name || configName,
        configuration: cfg
      })
    });

    return {
      ok: patchRes.ok,
      status: patchRes.status,
      targetVoice,
      configUuid
    };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

module.exports = {
  VOICE_CATALOG,
  TONE_PRESETS,
  synthesizeRumikSpeech,
  syncDograhPipelineVoice,
  pcmToWav
};
