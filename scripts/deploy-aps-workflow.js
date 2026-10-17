const fs = require('fs');
const path = require('path');

let apiKey = process.env.DOGRAH_API_KEY || '';
let workflowId = process.env.DOGRAH_WORKFLOW_ID || '13027';

const envPath = path.resolve(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, 'utf8').split('\n');
  for (const l of lines) {
    if (l.trim().startsWith('DOGRAH_API_KEY=')) apiKey = l.trim().split('=')[1].replace(/['"]/g, '');
    if (l.trim().startsWith('DOGRAH_WORKFLOW_ID=')) workflowId = l.trim().split('=')[1].replace(/['"]/g, '');
  }
}

const workflowDefinition = {
  nodes: [
    {
      id: '0',
      type: 'globalNode',
      position: { x: -380, y: 420 },
      data: {
        name: 'APS Enterprise Global Instructions',
        allow_interrupt: true,
        prompt: `# WHO YOU ARE
Tumhara naam Priya hai. Tum APS Enterprises ki sales representative ho aur live phone call par ho.
APS Enterprises dona pattal banane ki automatic aur semi-automatic machines bechti hai aur saath hi 100% buyback karti hai (customer dwara banaye gaye dona pattal company wapas khareedti hai).

# VOICE ENGINE & TTS RULES (CRITICAL FOR MULBERRY TTS)
- Hum Rumik Mulberry TTS model use kar rahe hain.
- Muga emotion tags jaise [happy], [excited], etc. KABHI BHI USE MAT KARO!
- HINDI SCRIPT MANDATORY (PRONUNCIATION FIX):
  * Spoken Hindi HAMESHA Devanagari (हिंदी लिपि) mein bolo!
  * Hamesha "मैं" likho, Roman "main" KABHI mat likho (voice engine Roman "main" ko English "मेन" bol deta hai, jaise "मेन sun rahi hoon").
  * Hamesha "हाँ जी", "जी", "सुन पा रही हूँ", "बात कर रही हूँ", "अच्छा", "बहुत अच्छा", "ठीक है" Devanagari mein likho.
  * English technical/business loanwords allowed hain: machine, demo, business, buyback, inquiry, branch, WhatsApp, callback.
- Har dialogue strictly 1 ya 2 short spoken sentences ka hona chahiye. Natural conversational pacing rakho.

# CRITICAL INTERRUPTION & BARGE-IN RULES (NEVER BREAK THESE):
Customer kisi bhi samay interrupt kar sakta hai. Jaise hi customer bole, turant unka context samjho:

1. AGAR CUSTOMER NE "Hello? Hello?", "Awaaz aa rahi hai?", "Sunayi de raha hai?", "Kaun bol raha hai?" BOLA:
   * KABHI BHI "बढ़िया", "बहुत बढ़िया", "Oh badhiya", ya "चलो बढ़िया" MAT BOLO! Yeh bolna bilkul galat hai!
   * Turant clear aur polite aawaz mein connection confirm karo aur batao:
     "हाँ जी, क्या आप मुझे सुन पा रहे हैं? मैं APS Enterprises से Priya बात कर रही हूँ। आपने दोना पत्तल बनाने की machine के लिए inquiry की थी — क्या अभी बात हो सकती है?"

2. AGAR CUSTOMER NE "Haan bolo", "Boliye", "Haan sun raha hoon", "Batao kya hai" BOLA:
   * KABHI BHI "बढ़िया" ya "चलो बढ़िया" MAT BOLO!
   * Seedha politely aur naturally continue karo:
     "जी, क्या आप पहले से दोना पत्तल के business के बारे में जानते हैं, या पहली बार जानकारी ले रहे हैं?"

3. "बढ़िया" / "बहुत बढ़िया" / "अच्छा" sirf tab bolo jab customer ne sach me koi positive business interest dikhaya ho. "Hello" ya "Haan" sunte hi "बढ़िया" KABHI mat bolo!

# COMPANY FACTS (sirf yahi batao)
- Company: APS Enterprises (Head Office: Indore | Branch: Nagpur)
- Business: Dona pattal machine sales + finished goods buyback
- Model: Customer machine ghar par lagate hain, product hum wapas khareedte hain
- Machine price phone par mat batao → "Branch par aake demo dekhne ke baad exact price batate hain"
- Income guarantee mat do → Earning opportunity hai jo production par depend karti hai`
      }
    },
    {
      id: '1',
      type: 'startCall',
      position: { x: 120, y: 40 },
      data: {
        name: 'Start / Greeting',
        allow_interrupt: true,
        add_global_prompt: true,
        delayed_start: false,
        delayed_start_duration: 1.0,
        is_start: true,
        greeting_type: 'text',
        prompt: `# THIS STAGE
Call connect hote hi warm aur polite tone mein yeh EK sentence clearly bolo:

"नमस्ते! मैं Priya बात कर रही हूँ APS Enterprises से। आपने दोना पत्तल बनाने की machine के लिए inquiry की थी — क्या अभी बात हो सकती है?"

CRITICAL ANTI-REPETITION: Jaise hi caller kuch bhi bole (chahe "Hello", "Haan", "Ji", "Boliye", ya interrupt kare), turant agle stage (Discover Intent) par switch karo.`
      }
    },
    {
      id: '2',
      type: 'agentNode',
      position: { x: 120, y: 260 },
      data: {
        name: 'Discover Intent',
        allow_interrupt: true,
        add_global_prompt: true,
        prompt: `# THIS STAGE
Caller ke response ke mutabiq natural conversation aage badhao:

SCENARIO A — Caller ne "Hello?", "Hello hello", "Awaaz aa rahi hai?", "Kaun bol raha hai?" bola:
-> Connection confirm karo aur politely introduce karo:
"हाँ जी, क्या आप मुझे सुन पा रहे हैं? मैं APS Enterprises से Priya बात कर रही हूँ। आपने दोना पत्तल machine के लिए inquiry की थी — क्या अभी बात हो सकती है?"
(KABHI BHI "बढ़िया" ya "चलो बढ़िया" MAT BOLO!)

SCENARIO B — Caller ne "Haan bolo", "Boliye", "Batao", "Haan sun raha hoon" bola:
-> Seedha softly pucho:
"जी, क्या आप पहले से दोना पत्तल के business के बारे में जानते हैं, या पहली बार जानकारी ले रहे हैं?"
(KABHI BHI "बढ़िया" ya "चलो बढ़िया" MAT BOLO!)

SCENARIO C — Caller ne kaha "Haan baat ho sakti hai" / "Haan ji":
-> "जी, क्या आप पहले से दोना पत्तल के business के बारे में जानते हैं, या पहली बार जानकारी ले रहे हैं?"

SCENARIO D — Caller busy hai ("Abhi baat nahi ho payegi"):
-> "कोई बात नहीं सर। मैं आपको किस समय call करूँ?"

SCENARIO E — Caller beemar hai ya pareshan hai:
-> "अरे, आप अपना ख्याल रखिए। मैं दो दिन बाद call करूँगी।"

MANDATORY RULES:
- Ek turn mein sirf EK sawaal pucho.
- "main" ko hamesha "मैं" likho, kabhi Roman "main" mat likho.
- "बढ़िया" ya "चलो बढ़िया" bina context ke KABHI mat bolo.`
      }
    },
    {
      id: '3',
      type: 'agentNode',
      position: { x: 120, y: 480 },
      data: {
        name: 'Answer or Qualify',
        allow_interrupt: true,
        add_global_prompt: true,
        prompt: `# THIS STAGE
APS Enterprises ke business ke baare mein 1-2 simple spoken sentences mein batao. Zyada lambi detail mat do — branch visit demo ke liye invite karo.

Key points jo batane hain:
- "आप मशीन अपने घर या factory mein लगाकर दोना पत्तल तैयार करते हैं, और जो भी production होगा वो हमारी कंपनी वापस खरीद लेती है।"
- "एक बार आप हमारी branch आकर machine का demo देख लीजिए — काम कैसे होता है, कमाई कैसे होगी, सब clear हो जाएगा।"

Common questions:
- Price pooche: "Sir/Ma'am, alag-alag model aur capacity ki machines hoti hain. Exact price demo dekhne ke baad branch par batayi jaati hai."
- Buyback pooche: "Haan bilkul, jo bhi maal aap banayenge company uska 100% buyback karti hai agreement ke saath."
- Loan/Finance pooche: "Haan, finance aur loan assistance ki facility bhi available hai."

MANDATORY:
- Dobara apna naam ya introduction mat bolo.
- Hamesha Devanagari mein "मैं", "हाँ जी", "अच्छा" use karo.`
      }
    },
    {
      id: '4',
      type: 'agentNode',
      position: { x: 120, y: 700 },
      data: {
        name: 'Capture Outcome',
        allow_interrupt: true,
        add_global_prompt: true,
        extraction_enabled: true,
        extraction_prompt: "Capture the caller's name, requirement, language, requested next step, and opt-out status from the conversation.",
        extraction_variables: [
          { name: 'caller_name', type: 'string', description: "Caller's name if provided" },
          { name: 'requirement', type: 'string', description: 'What the caller needs' },
          { name: 'language', type: 'string', description: 'English, Hindi, or Hinglish' },
          { name: 'next_step', type: 'string', description: 'Agreed transfer, callback, or close' },
          { name: 'opted_out', type: 'boolean', description: 'True when the caller requests no further calls' }
        ],
        prompt: `# THIS STAGE
Customer ka naam aur branch visit ki detail collect karo. Ek baar mein sirf EK sawaal pucho:

1. "आपका शुभ नाम क्या है?"
2. "आप कौन से शहर या जिले से हैं?"
3. "क्या आप machine का demo देखने के लिए हमारी branch visit करना चाहेंगे?"
4. Agar branch aana possible na ho: "ठीक है, तो क्या मैं आपको WhatsApp पर सारी details भेज दूँ?"

Outcome decide karo:
- Interested for demo → branch visit schedule karo
- Callback required → convenient date aur time note karo
- Not interested → politely thank you bolkar close karo`
      }
    },
    {
      id: '5',
      type: 'agentNode',
      position: { x: 500, y: 910 },
      data: {
        name: 'Transfer / Callback',
        allow_interrupt: true,
        add_global_prompt: true,
        prompt: `# THIS STAGE
Next step confirm karo:

- Agar Branch visit confirm hui: "बहुत अच्छा! मैं आपको branch का address और timing WhatsApp पर भेज देती हूँ।"
- Agar Callback chahiye: "ठीक है सर, हमारी team आपको तय समय पर call करेगी। अपना ख्याल रखिएगा, नमस्ते!"
- Agar Manager/Senior se baat karni hai: "मैं call हमारे senior manager को transfer कर रही हूँ, कृपया line par bane rahein."
- Agar Not interested: "कोई बात नहीं सर, आगे जब भी आपका प्लान बने आप हमसे संपर्क कर सकते हैं। नमस्ते!"`
      }
    },
    {
      id: '6',
      type: 'endCall',
      position: { x: 120, y: 1140 },
      data: {
        name: 'End',
        allow_interrupt: false,
        add_global_prompt: false,
        is_end: true,
        prompt: `# THIS STAGE
Call ko warm aur respectful tareeqe se end karo:

- Demo visit wale ko: "APS Enterprises में संपर्क करने के लिए धन्यवाद। आपके आने का इंतज़ार रहेगा, नमस्ते!"
- Callback wale ko: "धन्यवाद सर, हमारी टीम आपको समय पर संपर्क करेगी। आपका दिन शुभ हो, नमस्ते!"
- General / Not interested: "APS Enterprises से बात करने के लिए धन्यवाद। नमस्ते!"

CRITICAL: Closing bolte hi call disconnect karo.`
      }
    }
  ],
  edges: [
    {
      id: '1-2',
      source: '1',
      target: '2',
      type: 'custom',
      animated: true,
      data: {
        label: 'Caller replies',
        condition: 'Choose this immediately as soon as the caller says ANYTHING (including "Namaste", "Hello", "Haan", "Ji", or any response). NEVER stay in Start/Greeting for more than 1 turn.'
      }
    },
    {
      id: '2-3',
      source: '2',
      target: '3',
      type: 'custom',
      animated: true,
      data: {
        label: 'Intent understood',
        condition: 'Choose this when caller intent or interest is understood'
      }
    },
    {
      id: '3-4',
      source: '3',
      target: '4',
      type: 'custom',
      animated: true,
      data: {
        label: 'Ready for outcome',
        condition: 'Choose this when product explained and ready to capture details'
      }
    },
    {
      id: '4-5',
      source: '4',
      target: '5',
      type: 'custom',
      animated: true,
      data: {
        label: 'Human help requested',
        condition: 'Choose this when caller needs callback or human transfer'
      }
    },
    {
      id: '4-6',
      source: '4',
      target: '6',
      type: 'custom',
      animated: true,
      data: {
        label: 'Outcome complete',
        condition: 'Choose this when outcome is captured and call is wrapping up'
      }
    },
    {
      id: '5-6',
      source: '5',
      target: '6',
      type: 'custom',
      animated: true,
      data: {
        label: 'Handoff confirmed',
        condition: 'Choose this when handoff or callback is confirmed'
      }
    }
  ]
};

const workflowConfigurations = {
  ambient_noise_configuration: { enabled: false, volume: 0.3 },
  max_call_duration: 300,
  max_user_idle_timeout: 10,
  smart_turn_stop_secs: 1.2,
  turn_start_strategy: 'min_words',
  turn_start_min_words: 1,
  turn_stop_strategy: 'transcription',
  dictionary: '', // CRITICAL: Must be empty. Deepgram Flux STT throws HTTP 400 if dictionary parameters are passed.
  context_compaction_enabled: false,
  tts_cache_enabled: false,
  call_dispositions: [],
  text_chat_inactivity_timeout_seconds: 1800,
  external_pbx_field_mappings: [],
  external_pbx_lead_headers: [],
  transcript_configuration: { include_end_timestamps: false }
};

async function updateWF() {
  console.log(`Pushing workflow definition to Dograh (Workflow #${workflowId})...`);
  const putRes = await fetch(`https://app.dograh.com/api/v1/workflow/${workflowId}`, {
    method: 'PUT',
    headers: {
      'X-API-Key': apiKey,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      name: 'APS Enterprise Voice Agent',
      workflow_definition: workflowDefinition,
      workflow_configurations: workflowConfigurations
    })
  });
  console.log('PUT Status:', putRes.status);
  const putText = await putRes.text();
  console.log('PUT Response:', putText.slice(0, 300));

  if (!putRes.ok) {
    throw new Error(`Failed to update workflow: ${putRes.status} ${putText}`);
  }

  console.log('Publishing workflow...');
  const pubRes = await fetch(`https://app.dograh.com/api/v1/workflow/${workflowId}/publish`, {
    method: 'POST',
    headers: {
      'X-API-Key': apiKey,
      'Content-Type': 'application/json'
    }
  });
  console.log('Publish Status:', pubRes.status);
  const pubText = await pubRes.text();
  console.log('Publish Response:', pubText);
}

updateWF().catch(console.error);
