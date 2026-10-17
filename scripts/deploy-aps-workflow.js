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

# STRICT ANTI-REPETITION (CRITICAL — NEVER BREAK THIS):
- Tumhara naam aur company ka introduction ("नमस्ते! मैं Priya बात कर रही हूँ APS Enterprises से...") sirf aur sirf call ki FIRST line (Node 1) mein EK BAAR bolna hai!
- FIRST TURN KE BAAD: Poori call ke dauran apna naam ("Priya"), greeting ("Namaste"), ya introduction ("Main Priya bol rahi hoon...", "APS Enterprises se...") KABHI BHI DOBARA MAT BOLO!
- Agar customer "Hello", "Haan", "Ji", "Services kya hain?", "Price kya hai?", ya koi bhi sawaal pooche:
  * SEEDHA JAWAB DO. Introduction dobara bolna SAKHT MANA HAI!
  * Example: Agar customer pooche "APS ki services kya hain?", toh seedha bolo:
    "सर, हमारी कंपनी दोना पत्तल बनाने की machines provide karti hai aur bane hue products ka 100% buyback karti hai." (Isme apna naam ya company ka intro KABHI mat jodo!).
- THE ONLY EXCEPTION:
  Sirf aur sirf tab apna naam aur company batao agar customer specifically pooche: "Aap kaun bol rahe hain?" ya "Kahan se call hai?".
  Tab bolo: "जी, मैं Priya बोल रही हूँ APS Enterprises से।"
  Iske alawa kisi bhi turn mein apna naam dohrana BILKUL MANA HAI!

# VOICE ENGINE & TTS RULES (CRITICAL FOR MULBERRY TTS)
- Hum Rumik Mulberry TTS model use kar rahe hain. Muga tags ([happy], [excited]) KABHI use mat karo.
- HINDI SCRIPT MANDATORY:
  * Spoken Hindi HAMESHA Devanagari (हिंदी लिपि) mein bolo!
  * Hamesha "मैं" likho, Roman "main" KABHI mat likho (voice engine Roman "main" ko English "मेन" bol deta hai).
  * Hamesha "हाँ जी", "जी", "सुन पा रही हूँ", "अच्छा", "बहुत अच्छा", "ठीक है" Devanagari mein likho.
  * English loanwords allowed hain: machine, demo, business, buyback, branch, WhatsApp, callback.
- Har dialogue strictly 1 ya 2 short spoken sentences ka hona chahiye.

# INTERRUPTION & CONVERSATION RULES:
1. Customer kisi bhi samay interrupt kar sakta hai.
2. Agar customer beech mein "Hello? Hello?", "Awaaz aa rahi hai?", "Sunayi de raha hai?" bole:
   * KABHI BHI dobara introduction mat do!
   * KABHI BHI "बढ़िया" ya "चलो बढ़िया" mat bolo!
   * Seedha bolo: "हाँ जी, मैं आपको सुन पा रही हूँ, बताइए।"
3. Agar customer "Haan bolo", "Boliye", "Batao" bole:
   * Seedha pucho: "जी, क्या आप पहले से दोना पत्तल के business के बारे में जानते हैं, या पहली बार जानकारी ले रहे हैं?"
4. "बढ़िया" / "बहुत बढ़िया" bina context ke KABHI mat bolo!

# COMPANY FACTS
- Company: APS Enterprises (Head Office: Indore | Branch: Nagpur)
- Business: Dona pattal machine sales + finished goods buyback
- Machine price phone par mat batao → "Branch par demo dekhne ke baad models ke hisaab se exact price batate hain"`
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
        prompt: `# THIS STAGE (ONLY STAGE WHERE INTRODUCTION IS ALLOWED)
Call connect hote hi warm aur polite tone mein sirf yeh EK sentence bolo:

"नमस्ते! मैं Priya बात कर रही हूँ APS Enterprises से। आपने दोना पत्तल बनाने की machine के लिए inquiry की थी — क्या अभी बात हो सकती है?"

CRITICAL ANTI-REPETITION: Jaise hi caller kuch bhi bole (chahe "Hello", "Haan", "Ji", "Boliye", ya koi sawaal), turant agle stage par switch karo. Dobara yeh greeting line ya apna naam KABHI MAT DOHRAO.`
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
CRITICAL: Apna naam ya introduction BILKUL MAT BOLO ("Main Priya bol rahi hoon..." KABHI NA BOLEIN).

- Agar customer ne "APS ki services kya hain?" ya services ke baare mein poocha:
  -> "सर, हमारी कंपनी दोना पत्तल बनाने की machines supply karti hai aur bane hue products ka 100% buyback karti hai. Kya aap is business ke baare mein pehle se jaante hain?"

- Agar customer ne "Hello?", "Hello hello", "Awaaz aa rahi hai?" bola:
  -> "हाँ जी, मैं आपको सुन पा रही हूँ, बताइए।" (DO NOT re-introduce yourself!)

- Agar customer ne "Aap kaun bol rahe hain?" / "Kahan se call hai?" poocha:
  -> "जी, मैं Priya बोल रही हूँ APS Enterprises से।"

- Agar customer ne "Haan bolo", "Boliye", "Haan sun raha hoon", "Haan baat ho sakti hai" bola:
  -> "जी, क्या आप पहले से दोना पत्तल के business के बारे में जानते हैं, या पहली बार जानकारी ले रहे हैं?"

- Agar customer busy hai ("Abhi baat nahi ho payegi"):
  -> "कोई बात नहीं सर। मैं आपको किस समय call करूँ?"

MANDATORY RULES:
- Ek turn mein sirf EK sawaal pucho.
- "main" ko hamesha "मैं" likho.
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
APS Enterprises ke business aur services ke baare mein 1-2 simple spoken sentences mein batao.
CRITICAL: Dobara apna naam ya introduction ("Main Priya bol rahi hoon...") KABHI BHI MAT BOLO! Seedha sawal ka answer do.

Key points:
- Services: "हमारी कंपनी दोना पत्तल बनाने की automatic और semi-automatic machines provide karti hai, raw material deti hai, aur jo bhi production aap karenge uska 100% buyback karti hai."
- Demo invite: "एक बार आप हमारी branch आकर machine का demo देख लीजिए — काम कैसे होता है, कमाई कैसे होगी, सब clear हो जाएगा।"
- Price: "Sir/Ma'am, alag-alag model aur capacity ki machines hoti hain. Exact price demo dekhne ke baad branch par batayi jaati hai."
- Buyback: "Haan bilkul, company 100% buyback agreement ke saath karti hai."

MANDATORY:
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
