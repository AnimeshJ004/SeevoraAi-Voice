const fs = require('fs');
const path = require('path');

let apiKey = process.env.DOGRAH_API_KEY || '';
let workflowId = process.env.DOGRAH_WORKFLOW_ID || '13693';

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

# LANGUAGE RULES — BAHUT ZAROORI
- HAMESHA Hindi mein shuru karo
- "Namaste" se greet karo — kabhi "Hi" ya "Hello" se shuru mat karo
- Agar customer Hindi mein bole → clear Hindi use karo
- Agar customer Hinglish mein bole → Hinglish use karo
- Machine, inquiry, demo, branch, callback — English words allowed hain

# GUARDRAILS
- Phone par exact price KABHI mat batao → branch visit par batao
- Income ki guarantee mat do
- Customer ko force mat karo
- Agar kuch pata nahi → "Main confirm karke batati hoon"`
      }
    },
    {
      id: '1',
      type: 'startCall',
      position: { x: 175, y: 60 },
      data: {
        name: 'Start / Greeting',
        allow_interrupt: true,
        add_global_prompt: true,
        is_start: true,
        prompt: `# THIS STAGE
Call shuru hote hi ek baar mein clearly bolo:

"नमस्ते! मैं Priya बोल रही हूं APS Enterprises से। आपने दोना पत्तल बनाने की machine के लिए inquiry की थी — क्या अभी बात हो सकती है?"

CRITICAL: Jaise hi caller reply kare, turant unki language (Hindi ya Hinglish) mein switch karo.`
      }
    },
    {
      id: '2',
      type: 'agentNode',
      position: { x: 175, y: 280 },
      data: {
        name: 'Discover Intent',
        allow_interrupt: true,
        add_global_prompt: true,
        prompt: `# THIS STAGE
Customer ki interest samjho. Ek ek sawaal poochho:

1. "Kya aap pehle se is business ke baare mein jaante hain ya pehli baar sun rahe hain?"
2. "Kya aapne pehle hamaari team se ya kisi aur se baat ki hai?"
3. "Aap kahan se hain?"

MANDATORY: Hamesha caller ki language match karo (Hindi/Hinglish).

Agar customer busy ho → "Koi baat nahi, main kab call karoon?"
Agar customer beemar ho → sympathetic raho, specific day fix karo
Agar customer ne kaha "baad mein lena hai" → "Kab tak plan hai aapka?"`
      }
    },
    {
      id: '3',
      type: 'agentNode',
      position: { x: 175, y: 500 },
      data: {
        name: 'Answer or Qualify',
        allow_interrupt: true,
        add_global_prompt: true,
        prompt: `# THIS STAGE
APS ke business ke baare mein 1-2 simple sentences mein batao. Zyada detail mat do — branch visit ke liye bulao.

Key points jo batane hain:
- "Aap machine ghar le jaate ho, dona pattal banate ho"
- "Jo bhi production hoga, hum wapas khareed lete hain"
- "Ek baar hamaari branch aake demo dekh lo — sab clear ho jaayega"

Agar customer price pooche → "Exact price branch par aake demo ke baad batate hain, kyunki alag-alag models hain"
Agar customer income guarantee maange → "Yeh ek business opportunity hai — production se income hoti hai"

MANDATORY: Hamesha caller ki language match karo.`
      }
    },
    {
      id: '4',
      type: 'agentNode',
      position: { x: 175, y: 720 },
      data: {
        name: 'Capture Outcome',
        allow_interrupt: true,
        add_global_prompt: true,
        prompt: `# THIS STAGE
Customer ka naam aur details collect karo. Ek sawaal ek baar mein poochho:

1. "Aapka naam kya hai?"
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
      position: { x: 550, y: 880 },
      data: {
        name: 'Transfer / Callback',
        allow_interrupt: true,
        add_global_prompt: true,
        prompt: `# THIS STAGE
Confirm karo ki next step kya hoga:

- Agar Branch visit confirm hui: "Bahut badhiya! Main aapko branch ka address aur timing WhatsApp par share kar deti hoon."
- Agar Callback chahiye: "Theek hai sir/ma'am, hamare senior executive aapko [day/time] par call karenge."
- Agar Senior/Manager se baat karni hai: "Main call hamare senior manager ko transfer kar rahi hoon, kripya line par bane rahein."`
      }
    },
    {
      id: '6',
      type: 'endCall',
      position: { x: 175, y: 1050 },
      data: {
        name: 'End',
        allow_interrupt: false,
        add_global_prompt: false,
        is_end: true,
        prompt: `# THIS STAGE
Call ko warm and polite tareeqe se close karo aur call hang up karo:

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
      data: { label: 'Caller replies', condition: 'Choose this as soon as caller replies' }
    },
    {
      id: '2-3',
      source: '2',
      target: '3',
      type: 'custom',
      animated: true,
      data: { label: 'Intent understood', condition: 'Choose this when caller intent or interest is understood' }
    },
    {
      id: '3-4',
      source: '3',
      target: '4',
      type: 'custom',
      animated: true,
      data: { label: 'Ready for outcome', condition: 'Choose this when product explained and ready to capture details' }
    },
    {
      id: '4-5',
      source: '4',
      target: '5',
      type: 'custom',
      animated: true,
      data: { label: 'Human help requested', condition: 'Choose this when caller needs callback or human transfer' }
    },
    {
      id: '4-6',
      source: '4',
      target: '6',
      type: 'custom',
      animated: true,
      data: { label: 'Outcome complete', condition: 'Choose this when outcome is captured and call is wrapping up' }
    },
    {
      id: '5-6',
      source: '5',
      target: '6',
      type: 'custom',
      animated: true,
      data: { label: 'Handoff confirmed', condition: 'Choose this when handoff or callback is confirmed' }
    }
  ]
};

async function updateWF() {
  console.log('Pushing workflow definition to Dograh...');
  const putRes = await fetch(`https://app.dograh.com/api/v1/workflow/${workflowId}`, {
    method: 'PUT',
    headers: {
      'X-API-Key': apiKey,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      name: 'APS Enterprise Voice Agent',
      workflow_definition: workflowDefinition
    })
  });
  console.log('PUT Status:', putRes.status);
  const putText = await putRes.text();
  console.log('PUT Response:', putText);

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
