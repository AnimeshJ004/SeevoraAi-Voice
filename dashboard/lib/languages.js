/**
 * lib/languages.js - 24 Vernacular Languages Engine (Vaaad AI Clone)
 *
 * Implements complete vernacular support for Indian telecalling:
 *   - Language registry for 24 regional languages
 *   - Dialect codes, native script names, STT models, TTS voice IDs
 *   - Contextual prompt injections ensuring natural regional conversation
 *   - Pronunciation and transliteration guidelines for numbers, currency (Rupees)
 */
'use strict';

const VERNACULAR_LANGUAGES = [
  { code: 'hi-IN', name: 'Hindi', native: 'हिन्दी', ttsVoice: 'sarvam_hindi_female', sttModel: 'nova-3-general' },
  { code: 'hi-IN-hybrid', name: 'Hinglish', native: 'Hinglish (Hindi+English)', ttsVoice: 'rumik_mulberry', sttModel: 'nova-3-general' },
  { code: 'en-IN', name: 'English (India)', native: 'Indian English', ttsVoice: 'rumik_mulberry', sttModel: 'nova-3-general' },
  { code: 'ta-IN', name: 'Tamil', native: 'தமிழ்', ttsVoice: 'sarvam_tamil_female', sttModel: 'nova-3-general' },
  { code: 'te-IN', name: 'Telugu', native: 'తెలుగు', ttsVoice: 'sarvam_telugu_female', sttModel: 'nova-3-general' },
  { code: 'kn-IN', name: 'Kannada', native: 'ಕನ್ನಡ', ttsVoice: 'sarvam_kannada_female', sttModel: 'nova-3-general' },
  { code: 'bn-IN', name: 'Bengali', native: 'বাংলা', ttsVoice: 'sarvam_bengali_female', sttModel: 'nova-3-general' },
  { code: 'mr-IN', name: 'Marathi', native: 'मराठी', ttsVoice: 'sarvam_marathi_female', sttModel: 'nova-3-general' },
  { code: 'gu-IN', name: 'Gujarati', native: 'ગુજરાતી', ttsVoice: 'sarvam_gujarati_female', sttModel: 'nova-3-general' },
  { code: 'pa-IN', name: 'Punjabi', native: 'ਪੰਜਾਬੀ', ttsVoice: 'sarvam_punjabi_female', sttModel: 'nova-3-general' },
  { code: 'ml-IN', name: 'Malayalam', native: 'മലയാളം', ttsVoice: 'sarvam_malayalam_female', sttModel: 'nova-3-general' },
  { code: 'or-IN', name: 'Odia', native: 'ଓଡ଼ିଆ', ttsVoice: 'sarvam_odia_female', sttModel: 'nova-3-general' },
  { code: 'as-IN', name: 'Assamese', native: 'অসমীয়া', ttsVoice: 'sarvam_assamese_female', sttModel: 'nova-3-general' },
  { code: 'ur-IN', name: 'Urdu', native: 'اردو', ttsVoice: 'sarvam_urdu_female', sttModel: 'nova-3-general' },
  { code: 'bho-IN', name: 'Bhojpuri', native: 'भोजपुरी', ttsVoice: 'sarvam_hindi_female', sttModel: 'nova-3-general' },
  { code: 'mwr-IN', name: 'Rajasthani / Marwari', native: 'राजस्थानी / मारवाड़ी', ttsVoice: 'sarvam_hindi_female', sttModel: 'nova-3-general' },
  { code: 'mai-IN', name: 'Maithili', native: 'मैथिली', ttsVoice: 'sarvam_hindi_female', sttModel: 'nova-3-general' },
  { code: 'sat-IN', name: 'Santali', native: 'ᱥᱟᱱᱛᱟᱲᱤ', ttsVoice: 'sarvam_bengali_female', sttModel: 'nova-3-general' },
  { code: 'ks-IN', name: 'Kashmiri', native: 'कॉशुर / کٲشُر', ttsVoice: 'sarvam_urdu_female', sttModel: 'nova-3-general' },
  { code: 'ne-IN', name: 'Nepali', native: 'नेपाली', ttsVoice: 'sarvam_nepali_female', sttModel: 'nova-3-general' },
  { code: 'sd-IN', name: 'Sindhi', native: 'سنڌي / सिंधी', ttsVoice: 'sarvam_hindi_female', sttModel: 'nova-3-general' },
  { code: 'kok-IN', name: 'Konkani', native: 'कोंकणी', ttsVoice: 'sarvam_marathi_female', sttModel: 'nova-3-general' },
  { code: 'doi-IN', name: 'Dogri', native: 'डोगरी', ttsVoice: 'sarvam_punjabi_female', sttModel: 'nova-3-general' },
  { code: 'sa-IN', name: 'Sanskrit', native: 'संस्कृतम्', ttsVoice: 'sarvam_hindi_female', sttModel: 'nova-3-general' }
];

function getLanguagesCatalog() {
  return VERNACULAR_LANGUAGES;
}

function findLanguage(code) {
  const normalized = String(code || '').toLowerCase().trim();
  return VERNACULAR_LANGUAGES.find(
    (l) => l.code.toLowerCase() === normalized || l.name.toLowerCase() === normalized
  ) || VERNACULAR_LANGUAGES[0];
}

function getSystemPromptPrefix(languageCode, options) {
  const agentName = (options && options.agentName) || 'Agent';
  const lang = findLanguage(languageCode);
  return 'You are ' + agentName + ', an intelligent and polite telecaller speaking in ' + lang.name + ' (' + lang.native + ').\n' +
    'CRITICAL GUIDELINES:\n' +
    '- Speak naturally and colloquially in ' + lang.name + '. Keep sentences concise (under 20 words per turn) for voice delivery.\n' +
    '- When quoting monetary amounts in India, always speak in Rupees (e.g. \'Paanch sau rupaye\' or \'500 rupees\').\n' +
    '- Do not repeat standard greetings on every turn. Listen carefully and address the customer\'s exact question or objection.\n' +
    '- If the caller switches between ' + lang.name + ' and English, comfortably adapt to their language naturally.';
}

module.exports = {
  VERNACULAR_LANGUAGES,
  getLanguagesCatalog,
  findLanguage,
  getSystemPromptPrefix
};
