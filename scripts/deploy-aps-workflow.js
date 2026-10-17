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

# APS ENTERPRISE COMPANY FACTS (sirf yahi batao, kuch invent mat karo)
- Company naam: APS Enterprises (APSM Enterprises)
- Head Office: Indore | Branch: Nagpur
- Business: Dona pattal banane ki machines bechna
- Buyback: Customer ghar par produce kare, APS wapas khareedegi
- Leads: JustDial, Facebook, online inquiry se aate hain

# LANGUAGE & PRONUNCIATION RULES — BAHUT ZAROORI
- HAMESHA Hindi / Hinglish mein baat karo
- "Namaste" se greet karo — kabhi "Hi" ya "Hello" se shuru mat karo
- PRONUNCIATION (CRITICAL): "Achha" ya "accha" ko KABHI BHI English letters mein "accha" ya "achha" mat likho! Voice TTS engine "accha" ko "Aaka" bolti hai! HAMESHA Devanagari mein "अच्छा" ya "बहुत अच्छा" likho, ya fir "theek hai" / "bilkul" / "बहुत बढ़िया" use karo!
- Agar customer Hindi mein bole → clear Hindi use karo
- Agar customer Hinglish mein bole → Hinglish use karo
- Machine, inquiry, demo, branch, callback — English words allowed hain

# ANTI-REPETITION & CONVERSATIONAL CONTINUITY (CRITICAL — NEVER BREAK THIS):
- Call ke dauran apna naam aur company ka introduction ("Main Priya bol rahi hoon APS Enterprises se...") sirf aur sirf call ki FIRST line (Node 1) mein EK BAAR bolna hai.
- FIRST TURN KE BAAD: Dobara apna naam, greeting, ya introduction ("Main Priya bol rahi hoon...", "APS Enterprises se...", "Namaste!") KABHI BHI MAT DOHRAO!
- Agar customer call ke beech mein "Hello", "Namaste", "Haan", "Ji", "Suno", ya "Awaaz aa rahi hai" bole:
  * KABHI BHI dobara "Namaste, main Priya bol rahi hoon..." mat bolo!
  * Directly reply do: "Haanji, boliye, main sun rahi hoon." ya "Ji, boliye." aur machine/business ke sawaal par aage badho.
- "Namaste" ya "Hello" sunkar call shuru se restart KABHI mat karo.

# INTERRUPTION & BARGE-IN:
- Customer kisi bhi samay interrupt kar sakta hai. Jaise hi customer bole, unki baat suno aur unke sawaal ka seedha jawab do.

# GUARDRAILS
- Phone par exact price KABHI mat batao → branch visit par demo dekhne ke baad batate hain
- Income ki guarantee mat do → production se earning opportunity hai
- Customer ko force mat karo
- Agar kuch pata nahi → "Main confirm karke batati hoon"`
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
Call connect hote hi sirf yeh EK sentence clearly bolo:

"नमस्ते! मैं Priya बोल रही हूं APS Enterprises से। आपने दोना पत्तल बनाने की machine के लिए inquiry की थी — क्या अभी बात हो सकती है?"

CRITICAL ANTI-REPETITION: Jaise hi caller kuch bhi bole (chahe "Haan", "Ji", "Hello", "Namaste", "Boliye", ya koi bhi jawab), turant agle stage (Discover Intent) par switch karo. Dobara yeh greeting line KABHI mat bolna.`
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
Customer se inquiry confirm karo aur unka interest samjho.
CRITICAL: Apna naam ya introduction dobara BILKUL MAT BOLO ("Main Priya bol rahi hoon..." KABHI NA BOLEIN).

Agar caller ne "Haan", "Ji", "Hello", ya "Namaste" bola hai, toh seedha pucho:
"बहुत बढ़िया! Kya aap pehle se dona pattal ke business ke baare mein jaante hain ya pehli baar sun rahe hain?"

Ek baar mein sirf EK sawaal poochho:
1. "Kya aap pehle se is business ke baare mein jaante hain ya pehli baar sun rahe hain?"
2. "Kya aapne pehle hamaari team se baat ki hai?"
3. "Aap kahan se hain — kaunse shahar se?"

MANDATORY: Hamesha caller ki language match karo (Hindi/Hinglish).
Agar customer busy ho → "Koi baat nahi, main kab call karoon?"
Agar customer beemar ho → sympathetic raho, specific day fix karo.
Agar customer ne kaha "baad mein lena hai" → "Kab tak plan hai aapka?"`
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
APS ke business ke baare mein 1-2 simple sentences mein batao. Zyada detail mat do — branch visit ke liye bulao.
CRITICAL: Dobara greeting ya apna naam mat bolo. "accha" mat likhna, "अच्छा" ya "बहुत बढ़िया" bolo.

Key points jo batane hain:
- "Aap machine ghar le jaate ho, dona pattal banate ho."
- "Jo bhi production hoga, hum wapas khareed lete hain."
- "Ek baar hamaari branch aake demo dekh lo — sab clear ho jaayega."

Agar customer price pooche → "Exact price branch par aake demo ke baad batate hain, kyunki alag-alag models hain."
Agar customer income guarantee maange → "Yeh ek business opportunity hai — production se income hoti hai."

MANDATORY: Hamesha caller ki language match karo.`
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
Customer ka naam aur details collect karo. Ek sawaal ek baar mein poochho:
CRITICAL: Dobara greeting ya introduction mat bolo.

1. "Aapka shubh naam kya hai?"
2. "Aap kahan se hain — kaunse city se?"
3. "Kya aap hamaari branch visit karna chahenge machine ka demo dekhne ke liye?"
4. Agar nahi aa sakte: "Theek hai, main kab call karoon aapko?"

Outcome decide karo:
- Interested → branch visit schedule karo
- Callback → time fix karo aur note karo
- Not interested → politely end karo`
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
Confirm karo ki next step kya hoga:
CRITICAL: "achha" ko English letters mein mat likhna, hamesha "बहुत अच्छा" ya "बहुत बढ़िया" bolo!

- Agar Branch visit confirm hui: "बहुत बढ़िया! Main aapko branch ka address aur timing WhatsApp par share kar deti hoon."
- Agar Callback chahiye: "Theek hai sir/ma'am, hamare senior executive aapko [day/time] par call karenge. Apna khayal rakhein, Namaste!"
- Agar Senior/Manager se baat karni hai: "Main call hamare senior manager ko transfer kar rahi hoon, kripya line par bane rahein."
- Agar Not interested: "Koi baat nahi sir/ma'am. Jab bhi plan ho, hum yahan hain. Namaste!"`
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
Call ko warm aur polite tareeqe se close karo aur call hang up karo:

- Agar Branch visit schedule hui: "Aapka aane ka intezar rahega. APS Enterprises se baat karne ke liye dhanyavaad, Namaste!"
- Agar Callback schedule hua: "Dhanyavaad sir/ma'am, hamari team aapko tay samay par contact karegi. Apna khayal rakhein, Namaste!"
- Agar Not interested: "Koi baat nahi sir/ma'am, aage jab bhi zaroorat ho hume yaad kijiyega. Aapka din shubh ho, Namaste!"
- Default goodbye: "APS Enterprises mein sampark karne ke liye shukriya. Namaste!"

CRITICAL: Closing bolte hi call turant hang up / disconnect karo. Aage koi baat continue mat karo.`
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
