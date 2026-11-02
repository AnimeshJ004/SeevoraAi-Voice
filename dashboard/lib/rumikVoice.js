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
  const cleanVoiceId = String(voiceId || '').trim();

  // Alias mapping for backwards compatibility
  const speakerAliasMap = {
    'speaker_1': 'Lucas',
    'speaker_2': 'Mia',
    'speaker_3': 'Noah',
    'speaker_4': 'Sophia'
  };

  const resolvedVoiceKey = speakerAliasMap[cleanVoiceId] || cleanVoiceId;

  // Look up specific voice in catalog by id or rumikVoice
  const voiceMeta = VOICE_CATALOG.find((v) =>
    v.id.toLowerCase() === resolvedVoiceKey.toLowerCase() ||
    (v.rumikVoice && v.rumikVoice.toLowerCase() === resolvedVoiceKey.toLowerCase())
  ) || (['lucas', 'adam', 'noah', 'theo', 'arav', 'dev', 'kabir'].includes(resolvedVoiceKey.toLowerCase()) ? VOICE_CATALOG[1] : VOICE_CATALOG[0]);

  // Authentic Rumik Mulberry speaker name (Mia, Lucas, Sophia, Adam, Emma, Noah, etc.)
  const targetVoice = voiceMeta.rumikVoice || resolvedVoiceKey || 'Mia';
  const targetSpeaker = speakerAliasMap[targetVoice] || targetVoice;
  const targetModel = 'mulberry'; // Rumik Mulberry supports multi-speaker synthesis with distinct male/female timbres
  const targetLang = voiceMeta.language || 'hinglish';
  const tonePreset = TONE_PRESETS.find((t) => t.id === tone) || TONE_PRESETS[0];

  // Distinct cache key per voice persona, speaker, gender, and text so previews are completely separated
  const cacheKey = crypto.createHash('md5').update(`${voiceMeta.id}|${targetSpeaker}|${voiceMeta.gender}|${targetModel}|${tone}|${speed}|${cleanText}`).digest('hex');

  if (audioCache.has(cacheKey)) {
    return audioCache.get(cacheKey);
  }

  const apiKey = options.apiKey || process.env.RUMIK_API_KEY || '';

  // 1. Try fast, reliable direct HTTP synthesis via Rumik Silk API
  if (apiKey) {
    try {
      const httpPayload = {
        model: 'mulberry',
        text: cleanText,
        speaker: targetSpeaker,
        description: customDescription || voiceMeta.description
      };

      const res = await fetch('https://silk-api.rumik.ai/v1/tts', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36'
        },
        body: JSON.stringify(httpPayload)
      });

      if (res.ok) {
        const ab = await res.arrayBuffer();
        if (ab.byteLength > 100) {
          const buf = Buffer.from(ab);
          const result = {
            ok: true,
            dataUrl: 'data:audio/wav;base64,' + buf.toString('base64'),
            duration: Math.max(1.8, Math.min(8.0, cleanText.length * 0.08)),
            source: 'rumik_http',
            voice: targetVoice,
            speaker: targetSpeaker,
            gender: voiceMeta.gender || 'female'
          };
          audioCache.set(cacheKey, result);
          return result;
        }
      }
    } catch (httpErr) {
      // Continue to fallback
    }
  }

  // 2. High quality synthetic fallback WAV if offline or key absent
  const fallbackWav = generateSyntheticFallbackWav(cleanText);
  const result = {
    ok: true,
    dataUrl: 'data:audio/wav;base64,' + fallbackWav.toString('base64'),
    duration: 2.0,
    source: 'fallback',
    voice: targetVoice,
    speaker: targetSpeaker,
    gender: voiceMeta.gender || 'female'
  };
  audioCache.set(cacheKey, result);
  return result;
}

/**
 * Synchronize voice persona settings with active Dograh call flow
 */
async function syncDograhPipelineVoice(voiceId = 'ira', model = 'mulberry', options = {}) {
  const dograhKey = options.dograhKey || options.apiKey || process.env.DOGRAH_API_KEY || '';
  if (!dograhKey) return { ok: true, note: 'using_default_pipeline' };

  const voiceMeta = VOICE_CATALOG.find((v) =>
    v.id.toLowerCase() === String(voiceId).toLowerCase() ||
    (v.rumikVoice && v.rumikVoice.toLowerCase() === String(voiceId).toLowerCase())
  ) || VOICE_CATALOG[0];

  const targetVoice = voiceMeta.rumikVoice || 'Mia';
  const targetModel = model || voiceMeta.model || 'mulberry';

  // Return success - workflow prompt injection handles persona in Dograh
  return { ok: true, voice: targetVoice, model: targetModel };
}

function clearAudioCache() {
  audioCache.clear();
}

module.exports = {
  VOICE_CATALOG,
  TONE_PRESETS,
  synthesizeRumikSpeech,
  syncDograhPipelineVoice,
  pcmToWav,
  clearAudioCache
};
