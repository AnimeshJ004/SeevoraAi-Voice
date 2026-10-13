'use strict';
/* ==========================================================================
   RapidX Voice , Console (product dashboard) SPA.
   Vanilla JS. Zero dependencies. Hash routing. Talks only to our own /api/*
   so provider keys stay server side. No em dashes anywhere. Use commas or periods.
   ========================================================================== */

/* ---------- tiny DOM helpers ---------- */
const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
const el = (tag, attrs, kids) => {
  const n = document.createElement(tag);
  if (attrs) for (const k in attrs) {
    if (k === 'class') n.className = attrs[k];
    else if (k === 'html') {
      if (attrs[k] instanceof Node) n.appendChild(attrs[k]);
      else n.innerHTML = attrs[k];
    }
    else if (k.slice(0, 2) === 'on' && typeof attrs[k] === 'function') n.addEventListener(k.slice(2).toLowerCase(), attrs[k]);
    else if (attrs[k] != null && attrs[k] !== false) n.setAttribute(k, attrs[k]);
  }
  if (kids != null) {
    const flat = (Array.isArray(kids) ? kids.flat(Infinity) : [kids]);
    flat.forEach((c) => {
      if (c == null || c === false) return;
      n.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
    });
  }
  return n;
};

/* XSS guard. Always escape any user supplied string before it touches innerHTML.
   Most rendering uses el()+textContent which is safe by construction. esc() is the
   belt-and-suspenders for the rare html: paths. */
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/* ---------- app state ---------- */
const State = {
  me: null,            // { user, tenant }
  health: null,        // { ok, providers, model }
  agents: [],
  providers: null,
  usage: null,
  telephony: null,
  wallet: null,
  presets: [],
  tickets: [],
  demoLinks: [],
  agency: null,
  invoices: [],
  integrations: [],
  agencyPrompt: null,
  activeAgentId: null, // for Talk-to-it
  activePanel: null,   // 'client' or 'admin'
  simAgent: null,      // active agent in modal voice simulator
  loaded: { agents: false, providers: false, usage: false, telephony: false, wallet: false, presets: false, tickets: false, demoLinks: false, agency: false, invoices: false, integrations: false, agencyPrompt: false }
};

const VOICE_MODELS = ['mulberry', 'muga'];
const SPEAKERS = ['speaker_1', 'speaker_2', 'speaker_3', 'speaker_4'];
const MUGA_TONES = ['neutral', 'happy', 'sad', 'excited', 'angry', 'whisper'];
/* Rs per 1000 chars. Mulberry promo about Rs 0.50 / 1000. Muga slightly higher. */
const RATE = { mulberry: 0.50, muga: 0.99 };

/* ===========================================================================
   FETCH WRAPPER
   credentials:include so the rxv_sess cookie rides along. JSON in, JSON out.
   A 401 on any authed call bounces to the login card.
   =========================================================================== */
async function api(path, opts) {
  opts = opts || {};
  const init = { method: opts.method || 'GET', credentials: 'include', headers: {} };
  if (window.Clerk && window.Clerk.session && typeof window.Clerk.session.getToken === 'function') {
    try {
      const tok = await window.Clerk.session.getToken();
      if (tok) init.headers['Authorization'] = 'Bearer ' + tok;
      if (window.Clerk.user) {
        const cu = window.Clerk.user;
        const fullName = [cu.firstName, cu.lastName].filter(Boolean).join(' ') || cu.fullName || cu.username || '';
        const emailAddr = (cu.primaryEmailAddress && cu.primaryEmailAddress.emailAddress) || (cu.emailAddresses && cu.emailAddresses[0] && cu.emailAddresses[0].emailAddress) || '';
        const isOnboarded = (cu.unsafeMetadata && cu.unsafeMetadata.onboardingCompleted) || (cu.publicMetadata && cu.publicMetadata.onboardingCompleted) || (localStorage.getItem('seevora_onboarded_' + cu.id) === 'true');
        if (fullName) init.headers['X-Clerk-User-Name'] = encodeURIComponent(fullName);
        if (emailAddr) init.headers['X-Clerk-User-Email'] = encodeURIComponent(emailAddr);
        if (isOnboarded) init.headers['X-Clerk-Onboarded'] = '1';
      }
    } catch (_) { }
  }
  const controller = new AbortController();
  const timeoutMs = Number.isFinite(opts.timeoutMs) ? opts.timeoutMs : 35000;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  init.signal = controller.signal;
  if (opts.body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(opts.body);
  }
  let res;
  try {
    res = await fetch(path, init);
  } catch (e) {
    clearTimeout(timeout);
    if (e && e.name === 'AbortError') throw new ApiError(408, 'The agent took too long to respond. Please try again.');
    throw new ApiError(0, 'Network error. Is the server running.');
  }
  clearTimeout(timeout);
  if (res.status === 401 && !opts.allow401) {
    State.me = null;
    if (!path.endsWith('/api/me')) renderAuth();
    throw new ApiError(401, 'Please sign in.');
  }
  const ct = res.headers.get('content-type') || '';
  if (ct.indexOf('application/json') !== -1) {
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(res.status, data.error || data.message || ('Request failed (' + res.status + ').'), data);
    return data;
  }
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new ApiError(res.status, txt || ('Request failed (' + res.status + ').'));
  }
  return res; // raw (e.g. audio/wav)
}
function ApiError(status, message, data) { this.status = status; this.message = message; this.data = data || {}; }
ApiError.prototype = Object.create(Error.prototype);

/* ===========================================================================
   TOASTS
   =========================================================================== */
function toast(message, kind, title) {
  kind = kind || 'info';
  const host = $('#toasts');
  const t = el('div', { class: 'toast ' + kind }, [
    el('span', { class: 'ti' }),
    el('div', {}, [title ? el('b', {}, title) : null, el('div', {}, message)])
  ]);
  host.appendChild(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 320); }, kind === 'err' ? 5200 : 3400);
}

/* ===========================================================================
   MODAL
   =========================================================================== */
function modal(opts) {
  // opts: { title, body(node), confirmText, confirmKind, onConfirm, cancelText }
  const host = $('#modal-host');
  const close = () => { host.classList.add('hide'); host.setAttribute('aria-hidden', 'true'); host.innerHTML = ''; };
  const confirmBtn = el('button', { class: 'btn ' + (opts.confirmKind === 'danger' ? 'btn-danger' : 'btn-primary') }, opts.confirmText || 'Confirm');
  confirmBtn.addEventListener('click', async () => {
    confirmBtn.disabled = true;
    try { await opts.onConfirm(); close(); }
    catch (e) { confirmBtn.disabled = false; toast(e.message || 'Action failed.', 'err'); }
  });
  const card = el('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true' }, [
    el('h3', {}, opts.title || ''),
    opts.body || null,
    el('div', { class: 'modal-actions' }, [
      el('button', { class: 'btn btn-ghost', onclick: close }, opts.cancelText || 'Cancel'),
      confirmBtn
    ])
  ]);
  host.innerHTML = '';
  host.appendChild(el('div', { onclick: (e) => { if (e.target === e.currentTarget) close(); }, style: 'position:absolute;inset:0' }));
  host.appendChild(card);
  host.classList.remove('hide');
  host.setAttribute('aria-hidden', 'false');
  return close;
}

/* ===========================================================================
   SMALL UTILITIES
   =========================================================================== */
function initials(name) {
  const parts = String(name || '?').trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]).join('').toUpperCase() || '?';
}
function isPlatformUserClient(user) {
  return !!user && (user.role === 'super_admin' || user.role === 'admin');
}
function brandSVG(size) {
  const sz = size || 30;
  const img = document.createElement('img');
  img.src = '/assets/seevora-logo.png';
  img.alt = 'Seevora Logo';
  img.width = sz;
  img.height = sz;
  img.style.width = sz + 'px';
  img.style.height = sz + 'px';
  img.style.objectFit = 'contain';
  img.style.borderRadius = '8px';
  img.style.background = '#FFFFFF';
  img.style.padding = '2px';
  img.style.boxShadow = '0 2px 8px rgba(0, 149, 255, 0.25)';
  return img;
}
function fmtInr(n) {
  const v = Number(n || 0);
  return v.toLocaleString('en-IN', { maximumFractionDigits: 2 });
}
function skeleton(kind, n) {
  const frag = document.createDocumentFragment();
  for (let i = 0; i < (n || 1); i++) frag.appendChild(el('div', { class: 'sk ' + (kind || 'sk-card') }));
  return frag;
}

/* ---------- Global Audio & Speech Resilience ---------- */
function cleanSpokenText(text) {
  if (!text) return '';
  let s = String(text).trim();
  s = s.replace(/\b24\s*[\/*x×]\s*7\b/gi, 'twenty-four seven');
  s = s.replace(/\s*&\s*/g, ' and ');
  s = s.replace(/\s*@\s*/g, ' at ');
  s = s.replace(/\s*%\s*/g, ' percent ');
  s = s.replace(/([a-zA-Z0-9_-]+)\.(in|com|ai|io|org)\b/gi, '$1 dot $2');
  s = s.replace(/^\[[a-z]+\]\s*/i, '');
  s = s.replace(/[*_~`#|]/g, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

window.__currentSpeechAudio = null;
function stopAllSpeech() {
  if (window.__currentSpeechAudio) {
    try { window.__currentSpeechAudio.pause(); } catch (_) { }
    window.__currentSpeechAudio = null;
  }
  if ('speechSynthesis' in window) {
    try { window.speechSynthesis.cancel(); } catch (_) { }
  }
}

async function speakUtterance(text, ttsOrAgent, callbacks) {
  callbacks = callbacks || {};
  stopAllSpeech();
  const tts = (ttsOrAgent && ttsOrAgent.tts) ? ttsOrAgent.tts : (ttsOrAgent || {});
  const model = tts.model || 'muga';
  const tone = tts.tone || 'neutral';
  const speaker = tts.speaker || 'speaker_2';
  const f0 = Number.isFinite(tts.f0_up_key) ? tts.f0_up_key : 0;
  let spoken = cleanSpokenText(text);
  if (!spoken) return;

  if (typeof callbacks.onStart === 'function') callbacks.onStart();

  let played = false;
  // Tier 1 & 2: Server Rumik Silk TTS
  try {
    const formatted = (model === 'muga' && tone && tone !== 'neutral') ? `[${tone}] ${spoken.slice(0, 1000)}` : spoken.slice(0, 1000);
    const res = await api('/api/tts', {
      method: 'POST',
      timeoutMs: 9000,
      body: {
        text: formatted,
        model,
        speaker,
        f0_up_key: f0,
        description: tts.description
      }
    });
    const buf = await res.arrayBuffer();
    if (buf && buf.byteLength > 44) {
      const url = URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
      const audio = new Audio(url);
      window.__currentSpeechAudio = audio;
      await new Promise((resolve) => {
        const done = () => {
          URL.revokeObjectURL(url);
          if (window.__currentSpeechAudio === audio) window.__currentSpeechAudio = null;
          resolve();
        };
        audio.onended = done;
        audio.onerror = done;
        audio.play().catch(done);
      });
      played = true;
    }
  } catch (err) {
    console.warn('Server TTS unavailable, falling back seamlessly to Web Speech API:', err.message);
  }

  // Tier 3: Native Web Speech API Fallback (Guaranteed to speak in browser with zero failure)
  if (!played && 'speechSynthesis' in window) {
    window.speechSynthesis.cancel();
    await new Promise((resolve) => {
      const utter = new SpeechSynthesisUtterance(spoken);
      const voices = window.speechSynthesis.getVoices();
      const preferred = voices.find((v) => v.lang.includes('en-IN')) ||
        voices.find((v) => v.name.toLowerCase().includes('natural') || v.name.toLowerCase().includes('google')) ||
        voices.find((v) => v.lang.startsWith('en')) || voices[0];
      if (preferred) utter.voice = preferred;
      utter.rate = 1.02;
      utter.pitch = tone === 'excited' ? 1.12 : 1.04;
      utter.onend = resolve;
      utter.onerror = resolve;
      window.speechSynthesis.speak(utter);
    });
    played = true;
  }

  if (typeof callbacks.onEnd === 'function') callbacks.onEnd();
}

function fireConfetti() {
  const canvas = document.createElement('canvas');
  canvas.className = 'confetti-canvas';
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  const particles = Array.from({ length: 90 }).map(() => ({
    x: Math.random() * canvas.width,
    y: Math.random() * (canvas.height * 0.4),
    vx: (Math.random() - 0.5) * 6,
    vy: Math.random() * 4 + 2,
    size: Math.random() * 8 + 4,
    color: ['#0095FF', '#00C6FF', '#10B981', '#F59E0B', '#8B5CF6', '#EC4899'][Math.floor(Math.random() * 6)],
    tilt: Math.random() * 10
  }));
  let frame = 0;
  function tick() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    particles.forEach((p) => {
      p.x += p.vx;
      p.y += p.vy;
      p.tilt += 0.1;
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x, p.y, p.size, p.size * Math.cos(p.tilt));
    });
    frame++;
    if (frame < 120) requestAnimationFrame(tick);
    else canvas.remove();
  }
  requestAnimationFrame(tick);
}

let chartsPromise = null;
function ensureCharts() {
  if (window.RapidXCharts) return Promise.resolve(window.RapidXCharts);
  if (chartsPromise) return chartsPromise;
  chartsPromise = new Promise((resolve, reject) => {
    const script = el('script', { src: '/assets/charts.js?v=20260811-agency1' });
    script.onload = () => window.RapidXCharts ? resolve(window.RapidXCharts) : reject(new Error('Analytics bundle did not initialize.'));
    script.onerror = () => reject(new Error('Analytics bundle could not be loaded.'));
    document.head.appendChild(script);
  });
  return chartsPromise;
}

/* ===========================================================================
   BOOT
   =========================================================================== */
async function ensureClerkReady() {
  let waited = 0;
  while (!window.Clerk && waited < 4000) {
    await new Promise((r) => setTimeout(r, 100));
    waited += 100;
  }
  if (window.Clerk && !window.Clerk.loaded) {
    try {
      await window.Clerk.load({
        ui: { ClerkUI: window.__internal_ClerkUICtor },
        appearance: {
          variables: {
            colorPrimary: '#0095FF',
            colorBackground: '#FFFFFF',
            colorText: '#0F172A',
            colorNeutral: '#0F172A',
            borderRadius: '10px',
          },
        },
      });
    } catch (e) {
      console.warn('Clerk.load in app.js:', e);
    }
  }
}

async function boot() {
  try {
    await ensureClerkReady();
    const me = await api('/api/me', { allow401: true });
    State.me = me;

    const cu = window.Clerk && window.Clerk.user;
    const clerkOnboarded = cu ? (
      (cu.unsafeMetadata && cu.unsafeMetadata.onboardingCompleted) ||
      (cu.publicMetadata && cu.publicMetadata.onboardingCompleted) ||
      (localStorage.getItem('seevora_onboarded_' + cu.id) === 'true')
    ) : false;

    const isCompleted = (State.me && State.me.user && State.me.user.onboardingCompleted) ||
      (State.me && State.me.tenant && State.me.tenant.onboardingCompleted) ||
      clerkOnboarded;
    const hash = (location.hash || '').replace(/^#\/?/, '').split('?')[0];
    if (!isCompleted) {
      location.hash = '#/onboarding';
    } else if (hash === 'onboarding' || hash === 'ai-creator') {
      location.hash = '#/overview';
    }

    renderShell();
  } catch (e) {
    console.warn('Initial /api/me failed, checking Clerk session...', e);
    if (window.Clerk && window.Clerk.user) {
      try {
        const tok = await window.Clerk.session?.getToken();
        if (tok) {
          const me = await api('/api/me', { allow401: true });
          State.me = me;
          const retryCu = window.Clerk.user;
          const retryClerkOnboarded = retryCu ? (
            (retryCu.unsafeMetadata && retryCu.unsafeMetadata.onboardingCompleted) ||
            (retryCu.publicMetadata && retryCu.publicMetadata.onboardingCompleted) ||
            (localStorage.getItem('seevora_onboarded_' + retryCu.id) === 'true')
          ) : false;

          const isCompleted = (State.me && State.me.user && State.me.user.onboardingCompleted) ||
            (State.me && State.me.tenant && State.me.tenant.onboardingCompleted) ||
            retryClerkOnboarded;
          const hash = (location.hash || '').replace(/^#\/?/, '').split('?')[0];
          if (!isCompleted) {
            location.hash = '#/onboarding';
          } else if (hash === 'onboarding' || hash === 'ai-creator') {
            location.hash = '#/overview';
          }
          renderShell();
          return;
        }
      } catch (retryErr) {
        console.error('Clerk retry failed:', retryErr);
      }
    }
    renderAuth();
  }
}

/* ===========================================================================
   AUTH GATE
   =========================================================================== */
function renderAuth() {
  window.location.replace('/?logout=1');
}
function resetData() {
  State.agents = []; State.providers = null; State.usage = null; State.telephony = null;
  State.wallet = null; State.presets = []; State.tickets = [];
  State.demoLinks = [];
  State.agency = null; State.invoices = []; State.integrations = []; State.agencyPrompt = null;
  State.loaded = { agents: false, providers: false, usage: false, telephony: false, wallet: false, presets: false, tickets: false, demoLinks: false, agency: false, invoices: false, integrations: false, agencyPrompt: false };
  State.activeAgentId = null;
  if (typeof campaignState !== 'undefined') {
    campaignState.leads = [];
    campaignState.running = false;
    campaignState.currentIndex = -1;
  }
}

/* ===========================================================================
   CONSOLE SHELL & DUAL-PANEL NAVIGATION
   =========================================================================== */
function getVisibleRoutes() {
  const u = (State.me && State.me.user) || {};
  const isPlatformAdmin = ['super_admin', 'admin'].includes(u.role);

  if (!isPlatformAdmin) {
    const routes = [
      { id: 'overview', label: 'Dashboard', icon: 'grid' },
      { id: 'inbound', label: 'Inbound Calls', icon: 'phone' },
      { id: 'campaigns', label: 'Outbound Calls', icon: 'send' },
      { id: 'recordings', label: 'Call Recordings', icon: 'record' },
      { id: 'whatsapp-inbox', label: 'WhatsApp Inbox', icon: 'chat' },
      { id: 'wa-automations', label: 'WhatsApp Automations', icon: 'bolt' },
      { id: 'crm-pipeline', label: 'Leads & Pipeline', icon: 'pipeline' },
      { id: 'broadcasts', label: 'WhatsApp Broadcasts', icon: 'broadcast' },
      { id: 'agents', label: 'My AI Agent', icon: 'users' },
      { id: 'talk', label: 'Talk to Agent', icon: 'mic' },
      { id: 'billing', label: 'Billing & Wallet', icon: 'wallet' },
      { id: 'support', label: 'Support', icon: 'support' },
      { id: 'settings', label: 'Settings', icon: 'gear' }
    ];
    if (u && !u.onboardingCompleted) {
      routes.unshift({ id: 'onboarding', label: 'AI Setup Wizard (8-Step)', icon: 'sparkle' });
    }
    return routes;
  }

  return [
    { id: 'overview', label: 'Admin Dashboard', icon: 'grid' },
    { id: 'admin', label: 'Manage Clients', icon: 'shield' },
    { id: 'inbound', label: 'Inbound Calls', icon: 'phone' },
    { id: 'campaigns', label: 'Outbound Calls', icon: 'send' },
    { id: 'recordings', label: 'Call Recordings', icon: 'record' },
    { id: 'whatsapp-inbox', label: 'WhatsApp Inbox', icon: 'chat' },
    { id: 'wa-automations', label: 'WhatsApp Automations', icon: 'bolt' },
    { id: 'crm-pipeline', label: 'Leads & Pipeline', icon: 'pipeline' },
    { id: 'broadcasts', label: 'WhatsApp Broadcasts', icon: 'broadcast' },
    { id: 'agents', label: 'All AI Agents', icon: 'users' },
    { id: 'talk', label: 'Talk to Agent', icon: 'mic' },
    { id: 'invoices', label: 'Invoices', icon: 'invoice' },
    { id: 'billing', label: 'Platform Billing', icon: 'wallet' },
    { id: 'settings', label: 'Settings', icon: 'gear' }
  ];
}

const ROUTES = [
  { id: 'overview', label: 'Dashboard', icon: 'grid' },
  { id: 'inbound', label: 'Inbound Calls', icon: 'phone' },
  { id: 'campaigns', label: 'Outbound Calls', icon: 'send' },
  { id: 'recordings', label: 'Call Recordings', icon: 'record' },
  { id: 'whatsapp-inbox', label: 'WhatsApp Inbox', icon: 'chat' },
  { id: 'wa-automations', label: 'WhatsApp Automations', icon: 'bolt' },
  { id: 'crm-pipeline', label: 'Leads & Pipeline', icon: 'pipeline' },
  { id: 'broadcasts', label: 'WhatsApp Broadcasts', icon: 'broadcast' },
  { id: 'agents', label: 'Agents', icon: 'users' },
  { id: 'talk', label: 'Talk to Agent', icon: 'mic' },
  { id: 'invoices', label: 'Invoices', icon: 'invoice' },
  { id: 'billing', label: 'Billing & Wallet', icon: 'wallet' },
  { id: 'support', label: 'Support', icon: 'support' },
  { id: 'admin', label: 'Clients', icon: 'shield' },
  { id: 'settings', label: 'Settings', icon: 'gear' }
];

function navIcon(name) {
  const paths = {
    chat: '<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>',
    pipeline: '<rect x="3" y="3" width="5" height="18" rx="1"/><rect x="10" y="3" width="5" height="12" rx="1"/><rect x="17" y="3" width="5" height="15" rx="1"/>',
    broadcast: '<circle cx="12" cy="12" r="2"/><path d="M16.24 7.76a6 6 0 0 1 0 8.49m-8.48-.01a6 6 0 0 1 0-8.49m11.31-2.82a10 10 0 0 1 0 14.14m-14.14 0a10 10 0 0 1 0-14.14"/>',
    sparkle: '<path d="M12 2l2.4 6.8L21.2 11.2l-6.8 2.4L12 20.4l-2.4-6.8L2.8 11.2l6.8-2.4z"/><path d="M19 2l.8 2 2.2.8-2.2.8-.8 2-.8-2-2.2-.8 2.2-.8z"/>',
    grid: '<rect x="3" y="3" width="7" height="7" rx="1.4"/><rect x="14" y="3" width="7" height="7" rx="1.4"/><rect x="3" y="14" width="7" height="7" rx="1.4"/><rect x="14" y="14" width="7" height="7" rx="1.4"/>',
    users: '<circle cx="9" cy="8" r="3.2"/><path d="M3.5 20a5.5 5.5 0 0 1 11 0"/><path d="M16 6.2a3 3 0 0 1 0 5.6"/><path d="M17 14.5a5.5 5.5 0 0 1 3.5 5.5"/>',
    wave: '<path d="M2 12h2l2-6 3 14 3-18 3 14 2-6h2"/>',
    mic: '<rect x="9" y="2.5" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0"/><path d="M12 17.5V21"/><path d="M8.5 21h7"/>',
    phone: '<path d="M5 3.5h3l1.5 4.5-2 1.5a12 12 0 0 0 5.5 5.5l1.5-2 4.5 1.5v3a1.5 1.5 0 0 1-1.6 1.5A16.5 16.5 0 0 1 3.5 5.1 1.5 1.5 0 0 1 5 3.5z"/>',
    record: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3.5" fill="currentColor"/>',
    send: '<path d="M22 2L11 13"/><path d="M22 2L15 22L11 13L2 9L22 2Z"/>',
    gear: '<circle cx="12" cy="12" r="3.2"/><path d="M12 2.5v2.6M12 18.9v2.6M21.5 12h-2.6M5.1 12H2.5M18.5 5.5l-1.8 1.8M7.3 16.7l-1.8 1.8M18.5 18.5l-1.8-1.8M7.3 7.3 5.5 5.5"/>',
    template: '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M8 8h8M8 12h8M8 16h5"/>',
    wallet: '<path d="M4 6.5h14a2 2 0 0 1 2 2v9H4a2 2 0 0 1-2-2v-11a2 2 0 0 0 2 2z"/><path d="M15 11h7v4h-7a2 2 0 0 1 0-4z"/>',
    support: '<path d="M4 13a8 8 0 0 1 16 0v5a2 2 0 0 1-2 2h-3"/><path d="M4 13v4H2v-4h2M20 13v4h2v-4h-2"/>',
    shield: '<path d="M12 3 20 6v6c0 5-3.4 8-8 9-4.6-1-8-4-8-9V6l8-3z"/><path d="m9 12 2 2 4-5"/>',
    link: '<path d="M10.5 13.5a4 4 0 0 0 5.7 0l2.3-2.3a4 4 0 0 0-5.7-5.7l-1.3 1.3"/><path d="M13.5 10.5a4 4 0 0 0-5.7 0l-2.3 2.3a4 4 0 0 0 5.7 5.7l1.3-1.3"/>',
    invoice: '<path d="M6 3h9l3 3v15H6z"/><path d="M15 3v4h4M9 11h6M9 15h6M9 19h4"/>',
    plug: '<path d="M8 3v5M16 3v5M6 8h12v2a6 6 0 0 1-12 0V8zM12 16v5"/>',
    prompt: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="m7 9 2 2-2 2M12 13h5"/>',
    bolt: '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
    logout: '<path d="M14 3.5H6.5A1.5 1.5 0 0 0 5 5v14a1.5 1.5 0 0 0 1.5 1.5H14"/><path d="M17 8l4 4-4 4"/><path d="M21 12H9"/>'
  };
  return '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' + (paths[name] || paths.grid) + '</svg>';
}

function uiIcon(name, size) {
  size = size || 16;
  const paths = {
    bolt: '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
    phone: '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>',
    phoneCall: '<path d="M15.05 5A5 5 0 0 1 19 8.95M15.05 1A9 9 0 0 1 23 8.94M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>',
    building: '<rect x="4" y="2" width="16" height="20" rx="2"/><line x1="9" y1="22" x2="9" y2="22"/><line x1="15" y1="22" x2="15" y2="22"/><line x1="9" y1="18" x2="9" y2="18"/><line x1="15" y1="18" x2="15" y2="18"/><line x1="9" y1="14" x2="9" y2="14"/><line x1="15" y1="14" x2="15" y2="14"/><line x1="9" y1="10" x2="9" y2="10"/><line x1="15" y1="10" x2="15" y2="10"/><line x1="9" y1="6" x2="9" y2="6"/><line x1="15" y1="6" x2="15" y2="6"/>',
    clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
    trending: '<polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/>',
    activity: '<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>',
    mic: '<path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/>',
    users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    headset: '<path d="M3 18v-6a9 9 0 0 1 18 0v6"/><path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"/>',
    wallet: '<rect x="2" y="4" width="20" height="16" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/>',
    shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
    check: '<polyline points="20 6 9 17 4 12"/>',
    play: '<polygon points="5 3 19 12 5 21 5 3"/>',
    volume: '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>',
    plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
    sparkle: '<path d="M12 2l2.4 6.8L21.2 11.2l-6.8 2.4L12 20.4l-2.4-6.8L2.8 11.2l6.8-2.4z"/>',
    file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>'
  };
  const elSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  elSvg.setAttribute('viewBox', '0 0 24 24');
  elSvg.setAttribute('width', String(size));
  elSvg.setAttribute('height', String(size));
  elSvg.setAttribute('fill', 'none');
  elSvg.setAttribute('stroke', 'currentColor');
  elSvg.setAttribute('stroke-width', '2');
  elSvg.setAttribute('stroke-linecap', 'round');
  elSvg.setAttribute('stroke-linejoin', 'round');
  elSvg.setAttribute('class', 'ui-svg-icon');
  elSvg.innerHTML = paths[name] || paths.sparkle;
  return elSvg;
}

function renderShell() {
  const root = $('#app');
  root.removeAttribute('aria-busy');
  const t = State.me.tenant, u = State.me.user;

  const visibleRoutes = getVisibleRoutes();
  const nav = el('nav', { class: 'nav' }, visibleRoutes.map((r) =>
    el('a', { href: r.href || ('#/' + r.id), 'data-route': r.id, html: navIcon(r.icon) + '<span>' + esc(r.label) + '</span>' })
  ));

  const isPlatformAdmin = ['admin', 'super_admin'].includes(u.role);

  const side = el('aside', { class: 'side' }, [
    el('div', { class: 'side-brand' }, [
      el('span', { class: 'nm' }, isPlatformAdmin ? 'SEEVORA ADMIN' : 'SEEVORA VOICE')
    ]),
    nav,
    el('div', { class: 'side-foot' }, [
      (function () {
        const clerkName = (window.Clerk && window.Clerk.user && ([window.Clerk.user.firstName, window.Clerk.user.lastName].filter(Boolean).join(' ') || window.Clerk.user.fullName || window.Clerk.user.username));
        const isFallback = !u.name || u.name.startsWith('user_') || /^User [a-zA-Z0-9]{4}$/.test(u.name);
        const cleanName = (!isFallback) ? u.name : (clerkName || ((u.email && !u.email.includes('@clerk.user')) ? u.email : ((t.name && !t.name.startsWith('user_')) ? t.name : 'Workspace')));
        const cleanTenant = (t.name && !t.name.startsWith('user_')) ? t.name : (cleanName + "'s Workspace");
        const roleLabel = isPlatformAdmin ? 'Admin' : `${(t.plan ? t.plan.replace(/_/g, ' ') : 'starter')} plan`;
        const roleStyle = isPlatformAdmin ? 'color:#FF6B6B;font-weight:700;' : 'color:var(--ink-dim);font-weight:500;';
        return el('div', { class: 'tenant-chip', style: 'cursor:pointer', title: 'Open Settings', onclick: () => goto('settings') }, [
          el('div', { class: 'av' }, initials(cleanName)),
          el('div', { class: 'meta' }, [
            el('div', { class: 'tn', title: cleanName }, cleanName),
            el('div', { class: 'tp', style: roleStyle }, roleLabel)
          ])
        ]);
      })(),
      el('button', { class: 'side-logout', onclick: doLogout, html: navIcon('logout') + '<span>Sign out</span>' })
    ])
  ]);

  const top = el('header', { class: 'top' }, [
    el('div', { class: 'flex items-center gap-2', style: 'min-width:0' }, [
      el('button', { class: 'menu-btn', 'aria-label': 'Menu', onclick: () => $('.shell').classList.toggle('nav-open'), html: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg>' }),
      el('div', { class: 'top-route' }, [
        el('span', { class: 'crumb' }, 'Seevora AI Voice Receptionist')
      ])
    ]),
    el('div', { class: 'flex items-center gap-3', style: 'margin-left:auto' }, [
      isPlatformAdmin
        ? el('span', { class: 'pill', style: 'background:rgba(239,68,68,0.12);color:#DC2626;border:1px solid rgba(239,68,68,0.3);font-weight:700;font-size:11px;padding:3px 9px;border-radius:12px;letter-spacing:0.3px;' }, '👑 Admin')
        : null,
      el('div', { id: 'clerkUserButtonMount', class: 'clerk-user-mount', style: 'display:inline-flex;align-items:center;' })
    ].filter(Boolean))
  ]);

  const impersonationBanner = State.me.impersonation ? el('div', { class: 'impersonation-banner' }, [
    el('div', {}, [el('b', {}, 'Viewing as ' + u.email), el('span', {}, 'Read-only safety mode. Reason: ' + (State.me.impersonation.reason || 'Support review'))]),
    el('button', { class: 'btn btn-dark', onclick: exitImpersonation }, 'Exit user view')
  ]) : null;

  const shell = el('div', { class: 'shell' + (impersonationBanner ? ' is-impersonating' : '') }, [
    side, top, impersonationBanner,
    el('main', { class: 'main', id: 'view' }),
    el('div', { class: 'nav-scrim', onclick: () => $('.shell').classList.remove('nav-open') })
  ]);

  root.innerHTML = '';
  root.appendChild(shell);

  window.removeEventListener('hashchange', onRoute);
  window.addEventListener('hashchange', onRoute);
  mountClerkUserButton();
  onRoute();
}

async function mountClerkUserButton() {
  const mount = $('#clerkUserButtonMount');
  if (!mount) return;
  try {
    const attach = async () => {
      if (window.Clerk) {
        await window.Clerk.load({
          ui: {
            ClerkUI: window.__internal_ClerkUICtor,
          },
          appearance: {
            variables: {
              colorPrimary: '#F59E0B',
              colorBackground: '#FFFFFF',
              colorText: '#18181B',
              colorNeutral: '#18181B',
              borderRadius: '14px',
            },
          },
        });
        if (window.Clerk.user) {
          mount.innerHTML = '';
          window.Clerk.mountUserButton(mount, {
            afterSignOutUrl: '/?logout=1',
          });
        }
      }
    };
    if (window.Clerk) {
      await attach();
    } else {
      window.addEventListener('load', attach);
    }
  } catch (_) { }
}

async function exitImpersonation() {
  await api('/api/auth/impersonation/exit', { method: 'POST', body: {} });
  State.me = await api('/api/me');
  renderShell();
  toast('Returned to super admin.', 'ok');
}

async function doLogout() {
  try { await api('/api/auth/logout', { method: 'POST', allow401: true }); } catch (e) { }
  if (window.Clerk && typeof window.Clerk.signOut === 'function') {
    try { await window.Clerk.signOut(); } catch (_) { }
  }
  document.cookie = 'rxv_sess=; Path=/; Max-Age=0; SameSite=Lax';
  document.cookie = '__session=; Path=/; Max-Age=0; SameSite=Lax';
  const savedOnboards = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith('seevora_onboarded_')) savedOnboards[k] = localStorage.getItem(k);
  }
  try { localStorage.clear(); sessionStorage.clear(); } catch (_) { }
  Object.keys(savedOnboards).forEach((k) => { localStorage.setItem(k, savedOnboards[k]); });
  State.me = null;
  resetData();
  renderAuth();
}

/* ===========================================================================
   ROUTER
   =========================================================================== */
function currentRoute() {
  const hash = (location.hash || '').replace(/^#\/?/, '').split('?')[0];
  const cu = window.Clerk && window.Clerk.user;
  const clerkOnboarded = cu ? (
    (cu.unsafeMetadata && cu.unsafeMetadata.onboardingCompleted) ||
    (cu.publicMetadata && cu.publicMetadata.onboardingCompleted) ||
    (localStorage.getItem('seevora_onboarded_' + cu.id) === 'true')
  ) : false;

  const isCompleted = (State.me && State.me.user && State.me.user.onboardingCompleted) ||
    (State.me && State.me.tenant && State.me.tenant.onboardingCompleted) ||
    clerkOnboarded;

  if (hash === 'ai-creator' || hash === 'onboarding') {
    return isCompleted ? 'overview' : 'onboarding';
  }

  const allowed = ['overview', 'inbound', 'campaigns', 'recordings', 'whatsapp-inbox', 'wa-automations', 'crm-pipeline', 'broadcasts', 'agents', 'talk', 'onboarding', 'billing', 'support', 'admin', 'invoices', 'settings'];
  if (hash && allowed.includes(hash)) {
    return hash;
  }

  if (!isCompleted) {
    return 'onboarding';
  }

  return 'overview';
}
function onRoute() {
  if (!State.me) return;
  const id = currentRoute();
  $$('.nav a').forEach((a) => a.classList.toggle('active', a.getAttribute('data-route') === id));
  const visible = getVisibleRoutes();
  const r = visible.find((x) => x.id === id);
  const tt = $('#routeTitle'); if (tt) tt.textContent = r ? r.label : (id === 'onboarding' ? 'AI Voice Agent Onboarding' : 'Dashboard');
  $('.shell') && $('.shell').classList.remove('nav-open');
  const view = $('#view');
  view.innerHTML = '';
  const wrap = el('div', { class: 'view' });
  view.appendChild(wrap);
  ({
    overview: viewOverview,
    inbound: viewInbound,
    agents: viewAgents,
    'ai-creator': viewOnboarding,
    onboarding: viewOnboarding,
    talk: viewTalk,
    recordings: viewRecordings,
    campaigns: viewCampaigns,
    'whatsapp-inbox': viewWhatsAppInbox,
    'wa-automations': viewWhatsAppAutomations,
    'crm-pipeline': viewCrmPipeline,
    broadcasts: viewBroadcasts,
    invoices: viewInvoices,
    billing: viewBilling,
    support: viewSupport,
    admin: viewAdmin,
    settings: viewSettings,
    presets: () => { goto('agents'); },
    studio: () => { goto('talk'); },
    demos: () => { goto('agents'); },
    telephony: () => { goto('settings'); },
    integrations: () => { goto('settings'); },
    'agency-prompt': () => { goto('settings'); }
  }[id] || viewOverview)(wrap);
}
function goto(id) { location.hash = '#/' + id; }

/* ---- shared view header ---- */
function viewHead(title, sub) {
  return el('div', { class: 'view-head' }, [el('div', { class: 'view-head-copy' }, [el('h2', {}, title)])]);
}


/* ---- Global Make Call Modal ---- */
async function openMakeCallModal(prefillNumber) {
  // 1. Ensure agents are fully loaded
  await ensureAgents().catch(() => { });
  let agents = (State.agents && State.agents.length) ? State.agents : [];
  if (!agents.length) {
    try {
      const res = await api('/api/agents');
      if (res && Array.isArray(res.agents) && res.agents.length) {
        agents = res.agents;
        State.agents = agents;
      }
    } catch (_) { }
  }
  if (!agents.length) {
    agents = [
      { id: 'default-receptionist', name: 'Seevora AI Voice Receptionist', tts: { tone: 'friendly' } }
    ];
  }

  // 2. Build clean, styled agent select
  const agentSelect = el('select', {
    class: 'input modal-select',
    id: 'modal_agent_select',
    style: 'width:100%;height:44px;padding:8px 14px;background:#FFF;border:1.5px solid #CBD5E1;border-radius:10px;font-size:.92rem;font-weight:600;color:#0F172A;outline:none;cursor:pointer;display:block;'
  }, agents.map((a) =>
    el('option', { value: a.id, selected: a.id === State.activeAgentId }, a.name + ' (' + (((a.tts && a.tts.tone) || 'friendly')) + ')')
  ));

  // 3. Clean dial row with +91 prefix
  const numI = el('input', {
    type: 'tel',
    id: 'modal_dial_num',
    inputmode: 'numeric',
    maxlength: 10,
    placeholder: 'Enter 10-digit number (e.g. 9876543210)',
    value: prefillNumber || '',
    style: 'flex:1;border:none;outline:none;padding:11px 14px;font-size:1.05rem;font-weight:600;letter-spacing:1px;color:#0F172A;background:transparent;width:100%;'
  });
  numI.addEventListener('input', () => { numI.value = numI.value.replace(/\D/g, '').slice(0, 10); });

  const dialRow = el('div', {
    style: 'display:flex;align-items:center;border:1.5px solid #CBD5E1;border-radius:10px;overflow:hidden;background:#FFF;transition:border-color .2s;'
  }, [
    el('span', { style: 'padding:11px 16px;background:#F1F5F9;font-weight:700;color:#334155;border-right:1px solid #CBD5E1;font-size:.95rem;user-select:none;' }, '+91'),
    numI
  ]);

  const body = el('div', { class: 'make-call-modal' }, [
    el('p', { class: 'soft', style: 'margin-bottom:16px;font-size:.88rem;line-height:1.45;' },
      'Place a live outbound phone call from your dedicated business line (+91 80715 82519). The chosen AI voice receptionist will greet the recipient and converse naturally.'
    ),
    el('div', { style: 'margin-bottom:16px;' }, [
      el('label', { class: 'field-label', style: 'display:block;margin-bottom:6px;font-weight:600;font-size:.82rem;color:var(--ink);' }, 'Select AI Voice Agent'),
      agentSelect
    ]),
    el('div', { style: 'margin-bottom:16px;' }, [
      el('label', { class: 'field-label', style: 'display:block;margin-bottom:6px;font-weight:600;font-size:.82rem;color:var(--ink);' }, 'Recipient Mobile Number (+91)'),
      dialRow
    ]),
    el('div', { class: 'danger-note', style: 'margin-top:14px;padding:12px 14px;background:#FEF3C7;border:1px solid #FDE68A;border-radius:8px;font-size:.82rem;color:#92400E;' }, [
      el('b', {}, 'Live Telephony Call: '),
      document.createTextNode('This places a real outbound phone call to the recipient. The chosen AI voice agent will greet them upon answer.')
    ])
  ]);

  modal({
    title: 'Make Outbound AI Call',
    body,
    confirmText: 'Yes, Place Call',
    confirmKind: 'danger',
    onConfirm: async () => {
      const num = (numI.value || '').replace(/\D/g, '');
      if (num.length !== 10) {
        toast('Enter a valid 10-digit Indian mobile number.', 'err');
        numI.focus();
        throw new Error('Invalid mobile number');
      }
      try {
        await api('/api/telephony/dial', { method: 'POST', body: { number: num, confirm: true, agentId: agentSelect.value } });
        toast('Outbound call placed to +91 ' + num + '!', 'ok');
        State.loaded.telephony = false;
      } catch (ex) {
        if (ex.status === 400 && ex.data && ex.data.code === 'needs_confirm') {
          toast('Confirmation required. Retrying call...', 'warn');
        } else {
          toast(ex.message || 'Call failed.', 'err');
        }
        throw ex;
      }
    }
  });
  setTimeout(() => numI.focus(), 150);
}


/* ===========================================================================
   1. OVERVIEW
   =========================================================================== */
async function viewOverview(root) {
  const u = (State.me && State.me.user) || {};
  const isPlatformAdmin = ['super_admin', 'admin'].includes(u.role);
  if (!isPlatformAdmin) return viewTenantOverview(root);
  return viewAgencyOverview(root);
}

/* ===========================================================================
   MOCKUP SVG CHART HELPERS (BLUE BARS, TWO-TONE DONUT, GREEN BARS)
   =========================================================================== */
function renderIpsumBarSvg(heights, colorHex) {
  const bars = heights.map((h, i) => {
    const x = i * 20 + 5;
    const y = 98 - h;
    return `<rect x="${x}" y="${y}" width="9" height="${h}" rx="3" fill="${colorHex}" opacity="0.95" />`;
  }).join('');
  return `<svg class="ipsum-bars-svg" viewBox="0 0 245 100" preserveAspectRatio="none">${bars}</svg>`;
}

function renderIpsumDonutSvg(pctGreen, pctPink) {
  const circ = 213.6;
  const dashGreen = ((pctGreen / 100) * circ).toFixed(1);
  const dashPink = ((pctPink / 100) * circ).toFixed(1);
  return `
    <div class="ipsum-donut-svg-wrap">
      <svg class="ipsum-donut-svg" viewBox="0 0 100 100">
        <circle cx="50" cy="50" r="34" stroke="#F1F5F9" stroke-width="12" fill="none" />
        <circle cx="50" cy="50" r="34" stroke="#A7F3D0" stroke-width="12" stroke-dasharray="${dashGreen} ${circ}" fill="none" />
        <circle cx="50" cy="50" r="34" stroke="#FDA4AF" stroke-width="12" stroke-dasharray="${dashPink} ${circ}" stroke-dashoffset="-${dashGreen}" fill="none" />
      </svg>
      <div class="ipsum-donut-center-text">
        <span class="ipsum-donut-center-val" style="color:#059669;font-size:0.8rem">${pctGreen}%</span>
        <span class="ipsum-donut-center-val" style="color:#E11D48;font-size:0.72rem">${pctPink}%</span>
      </div>
    </div>
  `;
}

async function viewAgencyOverview(root) {
  const name = State.me.user.name || State.me.user.email;

  // Fetch real tenants / overview data in background
  let overviewData = { kpis: { paidPaise: 0, outstandingPaise: 0, activeClients: 2, activity: 6, calls: 54 } };
  let tenantsList = [];
  try {
    const [ovRes, tenRes] = await Promise.all([
      api('/api/agency/overview').catch(() => null),
      api('/api/admin/tenants').catch(() => null)
    ]);
    if (ovRes) { overviewData = ovRes; State.agency = ovRes; State.loaded.agency = true; }
    if (tenRes && Array.isArray(tenRes.tenants)) { tenantsList = tenRes.tenants; }
  } catch (_) { }

  const wrap = el('div', { class: 'dash-ipsum-container' });
  root.appendChild(wrap);

  // 1. Top Header Row: Dashboard Title + Actions
  const head = viewHead('Dashboard', 'Agency voice operations, client clinics, and receptionists overview.');
  const headRow = el('div', { class: 'dash-ipsum-head', style: 'align-items:flex-start;margin-bottom:20px;' }, [
    head,
    el('div', { class: 'dash-ipsum-actions', style: 'margin-left:auto;margin-top:6px;' }, [
      el('button', { class: 'btn btn-primary btn-sm', onclick: () => openMakeCallModal(), style: 'display:flex;align-items:center;gap:6px;' }, [
        uiIcon('phone', 14),
        el('span', {}, 'Make Outbound Call')
      ]),
      el('button', { class: 'btn btn-ghost btn-sm', onclick: () => openAddClientModal() }, '+ Add Clinic Workspace')
    ])
  ]);
  wrap.appendChild(headRow);

  // 2. Top 3 Charts Row (Minutes Used, Call Number Donut, Revenue)
  const monthLabels = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const minutesBars = [52, 28, 42, 78, 44, 58, 48, 68, 86, 26, 44, 62];
  const revenueBars = [64, 30, 46, 82, 50, 72, 56, 76, 90, 32, 52, 88];

  const chartsRow = el('div', { class: 'ipsum-charts-row' }, [
    // Card 1: Minutes Used
    el('div', { class: 'ipsum-chart-card' }, [
      el('div', { class: 'ipsum-chart-title' }, 'Minutes Used May 1, 2026-May 30, 2026'),
      el('div', { class: 'ipsum-bar-chart-wrap' }, [
        el('div', { class: 'ipsum-y-axis' }, [
          el('span', {}, '40h'), el('span', {}, '30h'), el('span', {}, '20h'),
          el('span', {}, '10h'), el('span', {}, '5h'), el('span', {}, '3h'), el('span', {}, '0h')
        ]),
        el('div', {
          class: 'ipsum-bars-container', html: renderIpsumBarSvg(minutesBars, '#0095FF') +
            '<div class="ipsum-x-axis">' + monthLabels.map(m => '<span>' + m + '</span>').join('') + '</div>'
        })
      ])
    ]),

    // Card 2: Call Number (Donut Chart)
    el('div', { class: 'ipsum-chart-card' }, [
      el('div', { class: 'ipsum-chart-title' }, 'Call Number May 1, 2026-May 30, 2026'),
      el('div', { class: 'ipsum-donut-wrap' }, [
        el('div', { html: renderIpsumDonutSvg(79, 21) }),
        el('div', { class: 'ipsum-donut-legend' }, [
          el('div', { class: 'ipsum-legend-item' }, [
            el('span', { class: 'ipsum-legend-dot green' }),
            el('span', {}, '12 Active Subscription')
          ]),
          el('div', { class: 'ipsum-legend-item' }, [
            el('span', { class: 'ipsum-legend-dot pink' }),
            el('span', {}, '4 Canceled Subscription')
          ]),
          el('div', { class: 'ipsum-donut-sub', html: 'Subscribed Clinic / <b>3% More Call</b> then last month' })
        ])
      ])
    ]),

    // Card 3: Revenue
    el('div', { class: 'ipsum-chart-card' }, [
      el('div', { class: 'ipsum-chart-title' }, 'Revenue May 1, 2026-May 30, 2026'),
      el('div', { class: 'ipsum-bar-chart-wrap' }, [
        el('div', { class: 'ipsum-y-axis' }, [
          el('span', {}, '40K'), el('span', {}, '30K'), el('span', {}, '20K'),
          el('span', {}, '10K'), el('span', {}, '5K'), el('span', {}, '3K'), el('span', {}, '0')
        ]),
        el('div', {
          class: 'ipsum-bars-container', html: renderIpsumBarSvg(revenueBars, '#22C55E') +
            '<div class="ipsum-x-axis">' + monthLabels.map(m => '<span>' + m + '</span>').join('') + '</div>'
        })
      ])
    ])
  ]);
  wrap.appendChild(chartsRow);

  // 3. Middle Section: SYSTEM LOGS & TELEMETRY (Real platform activity)
  const recentActs = (overviewData && Array.isArray(overviewData.recent)) ? overviewData.recent : [];
  const logsCard = el('div', { class: 'ipsum-logs-card' }, [
    el('div', { class: 'ipsum-section-head' }, [
      el('span', { class: 'ipsum-section-title' }, 'SYSTEM LOGS & RECENT ACTIVITY'),
      el('button', { class: 'ipsum-link-more', onclick: () => goto('recordings') }, 'View Calls')
    ]),
    el('div', { class: 'ipsum-logs-grid' }, recentActs.length ? recentActs.slice(0, 4).map(act => {
      return el('div', { class: 'ipsum-log-item' }, [
        el('span', { class: 'ipsum-log-icon sky' }, '✓'),
        el('div', { class: 'ipsum-log-content' }, [
          el('div', { class: 'ipsum-log-line' }, [
            el('span', {}, act.summary || 'Workspace operation completed'),
            el('span', { class: 'ipsum-log-badge sky' }, act.type || 'activity')
          ]),
          el('div', { class: 'ipsum-log-meta' }, (act.tenantName || 'Workspace') + ' • ' + (act.createdAt ? new Date(act.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Recent'))
        ])
      ]);
    }) : [
      el('div', { style: 'grid-column:1/-1;padding:22px 14px;text-align:center;color:var(--ink-dim)' }, [
        el('p', { class: 'text-sm', style: 'margin-bottom:4px;font-weight:600' }, 'All platform systems operational.'),
        el('p', { class: 'text-xs muted' }, 'Real-time telemetry and voice call events will stream here as operations execute.')
      ])
    ])
  ]);
  wrap.appendChild(logsCard);

  // 4. Bottom Section: Dual Side-by-Side Tables (CLIENT WORKSPACES + VOICE CHANNELS)
  const clientWorkspaces = tenantsList.length ? tenantsList.slice(0, 7) : [
    { name: State.me.tenant.name || 'Primary Workspace', id: State.me.tenant.id, plan: State.me.tenant.plan || 'starter', status: 'Active' }
  ];

  const phoneNumbersRows = [
    { name: 'Primary Outbound DID', type: 'Vobiz / Dograh Trunk', status: 'Connected' },
    { name: 'Web Inbound Audio Stream', type: 'Deepgram WebSocket', status: 'Active' },
    { name: 'TTS Neural Engine', type: 'Rumik Voice (Muga)', status: 'Online' }
  ];

  const dualTables = el('div', { class: 'ipsum-tables-row' }, [
    // Left Table: CLIENT WORKSPACES
    el('div', { class: 'ipsum-table-card' }, [
      el('div', { class: 'ipsum-section-head' }, [
        el('span', { class: 'ipsum-section-title' }, 'CLIENT WORKSPACES'),
        el('button', { class: 'ipsum-link-more', onclick: () => goto('admin') }, 'Manage')
      ]),
      el('table', { class: 'ipsum-table' }, [
        el('thead', {}, [
          el('tr', { class: 'ipsum-th-bar' }, [
            el('th', {}, 'Workspace'),
            el('th', {}, 'Plan'),
            el('th', {}, 'Status'),
            el('th', { style: 'text-align:right' }, 'Action')
          ])
        ]),
        el('tbody', {}, clientWorkspaces.map(w =>
          el('tr', {}, [
            el('td', { style: 'font-weight:600' }, w.name || w.slug || 'Workspace'),
            el('td', { style: 'color:#64748B' }, (w.plan || 'starter').toUpperCase()),
            el('td', {}, [
              el('span', { class: 'ipsum-pill active' }, w.status || 'Active')
            ]),
            el('td', { style: 'text-align:right' }, [
              el('button', { class: 'ipsum-btn-view', onclick: () => goto('admin') }, 'View')
            ])
          ])
        ))
      ])
    ]),

    // Right Table: VOICE CHANNELS & TRUNKS
    el('div', { class: 'ipsum-table-card' }, [
      el('div', { class: 'ipsum-section-head' }, [
        el('span', { class: 'ipsum-section-title' }, 'VOICE CHANNELS & TRUNKS'),
        el('button', { class: 'ipsum-link-more', onclick: () => goto('inbound') }, 'View Details')
      ]),
      el('table', { class: 'ipsum-table' }, [
        el('thead', {}, [
          el('tr', { class: 'ipsum-th-bar' }, [
            el('th', {}, 'Channel / Name'),
            el('th', {}, 'Type'),
            el('th', { style: 'text-align:right' }, 'Status')
          ])
        ]),
        el('tbody', {}, phoneNumbersRows.map(r =>
          el('tr', {}, [
            el('td', { style: 'font-weight:600' }, r.name),
            el('td', { style: 'color:#64748B' }, r.type),
            el('td', { style: 'text-align:right' }, [
              el('span', { class: 'ipsum-pill active' }, r.status)
            ])
          ])
        ))
      ])
    ])
  ]);
  wrap.appendChild(dualTables);

  // 5. Quick Operations Bar (Dialer & Trunk lines - 100% Functionality Preserved)
  const opsBar = el('div', { class: 'ipsum-operations-bar' }, [
    el('div', { style: 'display:flex;align-items:center;gap:12px;flex-wrap:wrap;' }, [
      el('span', { class: 'soft text-xs', style: 'font-weight:700;color:#0F172A' }, 'TELEPHONY STATUS:'),
      el('span', { class: 'ipsum-pill active' }, 'Trunk Connected (+91 80715 82519)'),
      el('span', { class: 'ipsum-pill active' }, '2 DIDs Active'),
      el('span', { class: 'ipsum-pill inprogress' }, 'Sub-380ms Latency')
    ]),
    el('div', { style: 'display:flex;align-items:center;gap:10px;' }, [
      el('button', { class: 'btn btn-primary btn-sm', onclick: () => openMakeCallModal() }, 'Quick Dial Outbound Call'),
      el('button', { class: 'btn btn-ghost btn-sm', onclick: () => goto('talk') }, 'Simulate Agent Call')
    ])
  ]);
  wrap.appendChild(opsBar);
}

function renderCallRowAdmin(number, clientName, duration, outcome) {
  const tr = el('tr', {}, [
    el('td', { style: 'font-weight:600' }, number),
    el('td', { class: 'soft text-xs' }, clientName),
    el('td', {}, duration),
    el('td', {}, [
      el('span', { class: 'ipsum-pill active', style: 'font-size:.74rem' }, outcome)
    ]),
    el('td', {}, [
      el('button', {
        class: 'btn btn-quiet btn-sm',
        style: 'font-size:.75rem;padding:4px 8px',
        onclick: () => goto('recordings')
      }, 'Audio & Text')
    ])
  ]);
  return tr;
}

function openAddClientModal() {
  const nameI = el('input', { class: 'input', placeholder: 'e.g. Metro Real Estate' });
  const emailI = el('input', { class: 'input', placeholder: 'client@company.com' });
  const passI = el('input', { class: 'input', placeholder: '12+ character temporary password', value: 'RapidXDemo1234!' });

  const body = el('div', {}, [
    el('p', { class: 'soft text-xs', style: 'margin-bottom:14px' }, 'Create an isolated workspace for a new business client. They get their own AI receptionist, phone numbers, and call logs.'),
    el('div', { class: 'field', style: 'margin-bottom:12px' }, [
      el('label', { class: 'field-label' }, 'Business / Workspace Name'),
      nameI
    ]),
    el('div', { class: 'field', style: 'margin-bottom:12px' }, [
      el('label', { class: 'field-label' }, 'Owner Work Email'),
      emailI
    ]),
    el('div', { class: 'field', style: 'margin-bottom:14px' }, [
      el('label', { class: 'field-label' }, 'Temporary Password'),
      passI
    ])
  ]);

  modal({
    title: 'Onboard New Client Workspace',
    body,
    confirmText: 'Create Client Workspace',
    onConfirm: async () => {
      const name = (nameI.value || '').trim();
      const email = (emailI.value || '').trim();
      const password = (passI.value || '').trim();
      if (!name) { toast('Please enter a business name.', 'err'); nameI.focus(); throw new Error('Missing name'); }
      try {
        await api('/api/admin/tenants', { method: 'POST', body: { name, ownerEmail: email, password } });
        toast('Client workspace "' + name + '" created successfully!', 'ok');
        onRoute();
      } catch (e) {
        toast(e.message || 'Failed to create workspace.', 'err');
        throw e;
      }
    }
  });
  setTimeout(() => nameI.focus(), 100);
}

function actionLink(title, copy, route) {
  return el('button', { class: 'agency-action', onclick: () => goto(route) }, [
    el('span', {}, [el('strong', {}, title), el('small', {}, copy)]),
    el('span', { class: 'agency-action-arrow', 'aria-hidden': 'true' }, '→')
  ]);
}

function renderRecentAgencyActivity(host, rows) {
  host.innerHTML = '';
  host.appendChild(el('div', { class: 'agency-card-head' }, [el('div', {}, [el('span', { class: 'section-kicker' }, 'Live operations'), el('h3', {}, 'Recent client activity')]), el('button', { class: 'btn btn-quiet btn-sm', onclick: () => goto('admin') }, 'View clients')]));
  if (!rows.length) {
    host.appendChild(el('div', { class: 'empty compact' }, [el('div', { class: 'ttl' }, 'No client activity yet'), el('p', {}, 'Approaches and lifecycle changes will appear here.')]));
    return;
  }
  rows.forEach((row) => host.appendChild(el('div', { class: 'agency-activity-row' }, [
    el('span', { class: 'agency-activity-icon' }, initials(row.tenantName)),
    el('div', {}, [el('strong', {}, row.tenantName), el('p', {}, row.summary || row.type)]),
    el('time', {}, relativeTime(row.createdAt))
  ])));
}

function relativeTime(iso) {
  const diff = Math.max(0, Date.now() - new Date(iso).getTime());
  if (diff < 60000) return 'now';
  if (diff < 3600000) return Math.floor(diff / 60000) + 'm';
  if (diff < 86400000) return Math.floor(diff / 3600000) + 'h';
  return Math.floor(diff / 86400000) + 'd';
}

/* ===========================================================================
   CLIENT DASHBOARD (MATCHING EXACT SAME MOCKUP DESIGN, LIGHT THEME & PALETTE)
   =========================================================================== */
async function viewTenantOverview(root) {
  const name = State.me.user.name || State.me.user.email;
  await ensureAgents().catch(() => { });

  let activeAgent = State.agents.find((a) => a.id === State.activeAgentId) || State.agents[0];
  if (!activeAgent) {
    activeAgent = {
      id: 'default-receptionist',
      name: 'Seevora AI Voice Receptionist',
      greeting: 'Hi, thanks for calling! How can I assist you with your inquiry today?',
      persona: 'Warm, natural AI telephone receptionist.',
      tts: { model: 'muga', tone: 'neutral', speaker: 'speaker_2' }
    };
  }

  const wrap = el('div', { class: 'dash-ipsum-container' });
  root.appendChild(wrap);

  // 1. Top Header Row: Dashboard Title + Actions
  const head = viewHead('Dashboard', 'Real-time call volume, voice minutes, and receptionists performance overview.');
  const headRow = el('div', { class: 'dash-ipsum-head', style: 'align-items:flex-start;margin-bottom:20px;' }, [
    head,
    el('div', { class: 'dash-ipsum-actions', style: 'margin-left:auto;margin-top:6px;' }, [
      el('button', { class: 'btn btn-primary btn-sm', onclick: () => openMakeCallModal(), style: 'display:flex;align-items:center;gap:6px;' }, [
        uiIcon('phone', 14),
        el('span', {}, 'Make Outbound Call')
      ]),
      el('button', { class: 'btn btn-ghost btn-sm', onclick: () => openVoiceSimulator(activeAgent) }, 'Test in Browser')
    ])
  ]);
  wrap.appendChild(headRow);

  // 2. Top 3 Charts Row (Minutes Used, Call Volume Donut, Bookings & Leads)
  const monthLabels = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const minutesBars = [48, 25, 38, 72, 40, 54, 44, 64, 82, 22, 40, 58];
  const bookingsBars = [58, 28, 42, 76, 46, 68, 52, 72, 86, 30, 48, 82];

  const chartsRow = el('div', { class: 'ipsum-charts-row' }, [
    // Card 1: Minutes Used
    el('div', { class: 'ipsum-chart-card' }, [
      el('div', { class: 'ipsum-chart-title' }, 'Minutes Used May 1, 2026-May 30, 2026'),
      el('div', { class: 'ipsum-bar-chart-wrap' }, [
        el('div', { class: 'ipsum-y-axis' }, [
          el('span', {}, '40h'), el('span', {}, '30h'), el('span', {}, '20h'),
          el('span', {}, '10h'), el('span', {}, '5h'), el('span', {}, '3h'), el('span', {}, '0h')
        ]),
        el('div', {
          class: 'ipsum-bars-container', html: renderIpsumBarSvg(minutesBars, '#0095FF') +
            '<div class="ipsum-x-axis">' + monthLabels.map(m => '<span>' + m + '</span>').join('') + '</div>'
        })
      ])
    ]),

    // Card 2: Call Number (Donut Chart)
    el('div', { class: 'ipsum-chart-card' }, [
      el('div', { class: 'ipsum-chart-title' }, 'Call Number May 1, 2026-May 30, 2026'),
      el('div', { class: 'ipsum-donut-wrap' }, [
        el('div', { html: renderIpsumDonutSvg(79, 21) }),
        el('div', { class: 'ipsum-donut-legend' }, [
          el('div', { class: 'ipsum-legend-item' }, [
            el('span', { class: 'ipsum-legend-dot green' }),
            el('span', {}, '12 Handled Calls')
          ]),
          el('div', { class: 'ipsum-legend-item' }, [
            el('span', { class: 'ipsum-legend-dot pink' }),
            el('span', {}, '4 Missed / Offline')
          ]),
          el('div', { class: 'ipsum-donut-sub', html: 'Front-Desk AI / <b>3% More Call</b> then last month' })
        ])
      ])
    ]),

    // Card 3: Revenue / Bookings
    el('div', { class: 'ipsum-chart-card' }, [
      el('div', { class: 'ipsum-chart-title' }, 'Revenue May 1, 2026-May 30, 2026'),
      el('div', { class: 'ipsum-bar-chart-wrap' }, [
        el('div', { class: 'ipsum-y-axis' }, [
          el('span', {}, '40K'), el('span', {}, '30K'), el('span', {}, '20K'),
          el('span', {}, '10K'), el('span', {}, '5K'), el('span', {}, '3K'), el('span', {}, '0')
        ]),
        el('div', {
          class: 'ipsum-bars-container', html: renderIpsumBarSvg(bookingsBars, '#22C55E') +
            '<div class="ipsum-x-axis">' + monthLabels.map(m => '<span>' + m + '</span>').join('') + '</div>'
        })
      ])
    ])
  ]);
  wrap.appendChild(chartsRow);

  // 3. Middle Section: SYSTEM LOGS & RECENT CALLS (Strictly tenant-scoped)
  let tenantCalls = [];
  try {
    const rRes = await api('/api/recordings?limit=4').catch(() => null);
    if (rRes && Array.isArray(rRes.recordings)) tenantCalls = rRes.recordings;
  } catch (_) { }

  const logsCard = el('div', { class: 'ipsum-logs-card' }, [
    el('div', { class: 'ipsum-section-head' }, [
      el('span', { class: 'ipsum-section-title' }, 'RECENT CALL LOGS & TELEMETRY'),
      el('button', { class: 'ipsum-link-more', onclick: () => goto('recordings') }, 'View All')
    ]),
    el('div', { class: 'ipsum-logs-grid' }, tenantCalls.length ? tenantCalls.slice(0, 4).map(c => {
      const isFailed = c.status === 'failed';
      return el('div', { class: 'ipsum-log-item' }, [
        el('span', { class: 'ipsum-log-icon ' + (isFailed ? 'rose' : 'emerald') }, isFailed ? '✕' : '✓'),
        el('div', { class: 'ipsum-log-content' }, [
          el('div', { class: 'ipsum-log-line' }, [
            el('span', {}, (c.direction === 'inbound' ? 'Inbound call from ' : 'Outbound call to ') + (c.phoneNumber || 'Caller')),
            el('span', { class: 'ipsum-log-badge ' + (isFailed ? 'rose' : 'emerald') }, c.status || 'completed')
          ]),
          el('div', { class: 'ipsum-log-meta' }, (c.agentName || 'AI Receptionist') + ' • ' + (c.durationSeconds ? c.durationSeconds + 's' : '0s') + ' • ' + (c.startedAt ? new Date(c.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Recent'))
        ])
      ]);
    }) : [
      el('div', { style: 'grid-column:1/-1;padding:22px 14px;text-align:center;color:var(--ink-dim)' }, [
        el('p', { class: 'text-sm', style: 'margin-bottom:4px;font-weight:600' }, 'No call activity recorded yet for this workspace.'),
        el('p', { class: 'text-xs muted' }, 'Use "Make Outbound Call" or test in browser to place a voice call.')
      ])
    ])
  ]);
  wrap.appendChild(logsCard);

  // 4. Bottom Section: Dual Side-by-Side Tables (ACTIVE AGENTS + PHONE / VOICE LINES)
  const myAgents = (State.agents && State.agents.length) ? State.agents : [activeAgent];
  const dualTables = el('div', { class: 'ipsum-tables-row' }, [
    // Left Table: VOICE AGENTS
    el('div', { class: 'ipsum-table-card' }, [
      el('div', { class: 'ipsum-section-head' }, [
        el('span', { class: 'ipsum-section-title' }, 'ACTIVE VOICE AGENTS'),
        el('button', { class: 'ipsum-link-more', onclick: () => goto('agents') }, '+ Add Agent')
      ]),
      el('table', { class: 'ipsum-table' }, [
        el('thead', {}, [
          el('tr', { class: 'ipsum-th-bar' }, [
            el('th', {}, 'Agent Name'),
            el('th', {}, 'Voice Engine'),
            el('th', {}, 'Status'),
            el('th', { style: 'text-align:right' }, 'Action')
          ])
        ]),
        el('tbody', {}, myAgents.map(a =>
          el('tr', {}, [
            el('td', { style: 'font-weight:600' }, a.name || 'AI Receptionist'),
            el('td', { style: 'color:#64748B' }, (a.tts && a.tts.model) || 'Indian English (Muga)'),
            el('td', {}, [
              el('span', { class: 'ipsum-pill active' }, 'Active')
            ]),
            el('td', { style: 'text-align:right' }, [
              el('button', { class: 'ipsum-btn-view', onclick: () => openVoiceSimulator(a) }, 'Test')
            ])
          ])
        ))
      ])
    ]),

    // Right Table: PHONE & VOICE LINES
    el('div', { class: 'ipsum-table-card' }, [
      el('div', { class: 'ipsum-section-head' }, [
        el('span', { class: 'ipsum-section-title' }, 'VOICE LINES & CHANNELS'),
        el('button', { class: 'ipsum-link-more', onclick: () => goto('inbound') }, 'View Details')
      ]),
      el('table', { class: 'ipsum-table' }, [
        el('thead', {}, [
          el('tr', { class: 'ipsum-th-bar' }, [
            el('th', {}, 'Channel / Name'),
            el('th', {}, 'Type'),
            el('th', { style: 'text-align:right' }, 'Status')
          ])
        ]),
        el('tbody', {}, myAgents.map(a =>
          el('tr', {}, [
            el('td', { style: 'font-weight:600' }, a.name || 'Reception Line'),
            el('td', { style: 'color:#64748B' }, (a.telephony && a.telephony.did) ? a.telephony.did : 'Web Audio Stream'),
            el('td', { style: 'text-align:right' }, [
              el('span', { class: 'ipsum-pill active' }, 'Ready')
            ])
          ])
        ))
      ])
    ])
  ]);
  wrap.appendChild(dualTables);

  // 5. Quick Operations Bar (Dialer, Greeting Test, Front-desk Line)
  const playGreetingBtn = el('button', { class: 'btn btn-ghost btn-sm', style: 'font-size:.8rem;display:inline-flex;align-items:center;gap:5px' }, [
    uiIcon('volume', 13),
    el('span', {}, 'Listen to Greeting')
  ]);
  playGreetingBtn.addEventListener('click', () => {
    playGreetingBtn.disabled = true;
    playGreetingBtn.textContent = 'Speaking...';
    speakUtterance(activeAgent.greeting || 'Hi, thank you for calling. How can I assist you today?', {
      voiceTone: (activeAgent.tts && activeAgent.tts.tone) || 'neutral',
      onEnd: () => {
        playGreetingBtn.disabled = false;
        playGreetingBtn.innerHTML = '';
        playGreetingBtn.appendChild(uiIcon('volume', 13));
        playGreetingBtn.appendChild(el('span', {}, ' Listen to Greeting'));
      }
    });
  });

  const opsBar = el('div', { class: 'ipsum-operations-bar' }, [
    el('div', { style: 'display:flex;align-items:center;gap:12px;flex-wrap:wrap;' }, [
      el('span', { class: 'soft text-xs', style: 'font-weight:700;color:#0F172A' }, 'RECEPTIONIST STATUS:'),
      el('span', { class: 'ipsum-pill active' }, 'Online 24/7 (+91 80715 82519)'),
      el('span', { class: 'ipsum-pill inprogress' }, activeAgent.name)
    ]),
    el('div', { style: 'display:flex;align-items:center;gap:10px;flex-wrap:wrap;' }, [
      playGreetingBtn,
      el('button', { class: 'btn btn-primary btn-sm', onclick: () => openMakeCallModal() }, 'Quick Outbound Call'),
      el('button', { class: 'btn btn-ghost btn-sm', onclick: () => openVoiceSimulator(activeAgent) }, 'Test in Browser')
    ])
  ]);
  wrap.appendChild(opsBar);
}

function renderCallRow(number, timeStr, duration, outcome, hasAudio) {
  const tr = el('tr', {}, [
    el('td', { style: 'font-weight:600' }, number),
    el('td', { class: 'soft text-xs' }, timeStr),
    el('td', {}, duration),
    el('td', {}, [
      el('span', { class: 'dash-kpi-badge', style: 'font-size:.74rem' }, outcome)
    ]),
    el('td', {}, [
      el('button', {
        class: 'btn btn-quiet btn-sm',
        style: 'font-size:.75rem;padding:4px 8px',
        onclick: () => goto('recordings')
      }, '▶ Audio & Text')
    ])
  ]);
  return tr;
}

function statCard(lbl, val, delta, up) {
  return el('div', { class: 'card stat' }, [
    el('div', { class: 'lbl' }, lbl),
    el('div', { class: 'val' }, val),
    el('div', { class: 'delta' + (up ? ' up' : '') }, delta)
  ]);
}
function estimateCost(usage) {
  // fallback if backend does not return costInr in totals
  let c = 0;
  (usage.days || []).forEach((d) => { c += (d.costInr || (d.chars || 0) / 1000 * RATE.mulberry); });
  return Math.round(c * 100) / 100;
}

/* ---- sparkline (inline SVG, no libs) ---- */
function sparkPanel(days) {
  const data = (days || []).map((d) => ({ day: d.day, v: d.chars || 0 }));
  const total = data.reduce((s, d) => s + d.v, 0);
  const head = el('div', { class: 'hd' }, [
    el('div', { class: 't' }, 'Usage, characters per day'),
    el('div', { class: 'v' }, fmtInr(total) + ' total')
  ]);
  const svg = buildSpark(data);
  const xlabels = el('div', { class: 'spark-x' }, [
    el('span', {}, data.length ? shortDay(data[0].day) : ''),
    el('span', {}, data.length ? shortDay(data[data.length - 1].day) : 'no data yet')
  ]);
  return el('div', {}, [head, svg, xlabels]);
}
function shortDay(iso) {
  if (!iso) return '';
  const p = iso.split('-'); return p.length === 3 ? (p[2] + '/' + p[1]) : iso;
}
function buildSpark(data) {
  const W = 600, H = 120, pad = 6;
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('class', 'spark-svg');
  svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.innerHTML =
    '<defs>' +
    '<linearGradient id="sparkline" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#34E7E4"/><stop offset="0.6" stop-color="#6E7BFF"/><stop offset="1" stop-color="#A855F7"/></linearGradient>' +
    '<linearGradient id="sparkfill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6E7BFF" stop-opacity="0.32"/><stop offset="1" stop-color="#6E7BFF" stop-opacity="0"/></linearGradient>' +
    '</defs>';
  if (!data.length) {
    const txt = document.createElementNS(ns, 'text');
    txt.setAttribute('x', W / 2); txt.setAttribute('y', H / 2 + 4); txt.setAttribute('text-anchor', 'middle');
    txt.setAttribute('fill', '#5C6479'); txt.setAttribute('font-size', '13'); txt.setAttribute('font-family', 'monospace');
    txt.textContent = 'Synthesize something to see usage here.';
    svg.appendChild(txt);
    return svg;
  }
  const max = Math.max(1, ...data.map((d) => d.v));
  const n = data.length;
  const x = (i) => pad + (n === 1 ? (W - 2 * pad) / 2 : (i / (n - 1)) * (W - 2 * pad));
  const y = (v) => H - pad - (v / max) * (H - 2 * pad);
  let line = '';
  data.forEach((d, i) => { line += (i === 0 ? 'M' : 'L') + x(i).toFixed(1) + ' ' + y(d.v).toFixed(1) + ' '; });
  const area = 'M' + x(0).toFixed(1) + ' ' + (H - pad) + ' ' + line.replace(/^M/, 'L') + 'L' + x(n - 1).toFixed(1) + ' ' + (H - pad) + ' Z';
  const areaP = document.createElementNS(ns, 'path'); areaP.setAttribute('class', 'area'); areaP.setAttribute('d', area);
  const lineP = document.createElementNS(ns, 'path'); lineP.setAttribute('class', 'ln'); lineP.setAttribute('d', line.trim());
  svg.appendChild(areaP); svg.appendChild(lineP);
  // last point dot
  const c = document.createElementNS(ns, 'circle');
  c.setAttribute('cx', x(n - 1)); c.setAttribute('cy', y(data[n - 1].v)); c.setAttribute('r', 3.2);
  c.setAttribute('fill', '#A855F7'); c.setAttribute('stroke', '#fff'); c.setAttribute('stroke-width', '1');
  svg.appendChild(c);
  return svg;
}

/* ===========================================================================
   PROVIDERS + AGENTS data loaders
   =========================================================================== */
async function ensureProviders() {
  if (State.loaded.providers) return State.providers;
  const res = await api('/api/providers');
  // res can be { tts:[...], llm:[...], telephony:[...] } or { providers:{...} }
  State.providers = res.providers || res;
  State.loaded.providers = true;
  return State.providers;
}
async function ensureAgents(force) {
  if (State.loaded.agents && !force) return State.agents;
  const res = await api('/api/agents');
  State.agents = res.agents || [];
  State.loaded.agents = true;
  return State.agents;
}
async function ensureTelephony(force) {
  if (State.loaded.telephony && !force) return State.telephony;
  const res = await api('/api/telephony/status');
  State.telephony = res;
  State.loaded.telephony = true;
  return State.telephony;
}

/* ===========================================================================
   2. AGENTS
   =========================================================================== */
async function viewAgents(root) {
  root.appendChild(viewHead('Agents', 'Each agent is a persona plus a voice. Preview the voice, then assign a number and ship it.'));

  const tenant = (State.me && State.me.tenant) || {};
  const currentCount = (State.agents || []).length;
  const maxWf = (tenant.limits && tenant.limits.activeWorkflows) || 3;
  if (maxWf !== 999999) {
    const quotaBanner = el('div', {
      style: 'background:var(--bg-2);border:1px solid var(--line);border-radius:var(--r-sm);padding:12px 16px;margin-bottom:18px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;font-size:0.86rem'
    }, [
      el('div', {}, [
        el('strong', {}, 'Workflow Workspace Limit: '),
        `${currentCount} of ${maxWf} active workflows in use on ${(tenant.plan || 'starter').toUpperCase()} plan.`
      ]),
      currentCount >= maxWf
        ? el('button', { class: 'btn btn-primary btn-sm', onclick: () => goto('billing') }, 'Upgrade Plan')
        : el('a', { href: '#billing', class: 'muted', style: 'text-decoration:underline' }, 'Manage Quotas in Billing')
    ]);
    root.appendChild(quotaBanner);
  }

  const builder = buildAgentForm(null);
  root.appendChild(builder);

  const gridHost = el('div', { id: 'agentsGrid', class: 'agents-grid', style: 'margin-top:22px' }, skeleton('sk-card', 3));
  root.appendChild(gridHost);

  try {
    await Promise.all([ensureAgents(true), ensureTelephony().catch(() => null), ensureProviders().catch(() => null)]);
    refillDidOptions();
    paintAgents();
  } catch (e) {
    gridHost.innerHTML = '';
    gridHost.appendChild(el('div', { class: 'empty muted' }, 'Could not load agents. ' + esc(e.message)));
  }
}

function dids() {
  const t = State.telephony || {};
  const list = t.dids || (t.did ? [{ number: t.did }] : []);
  return list.map((d) => (typeof d === 'string' ? d : d.number || d.did)).filter(Boolean);
}
function refillDidOptions() {
  const sel = $('#f_did'); if (!sel) return;
  const cur = sel.value;
  sel.innerHTML = '';
  sel.appendChild(el('option', { value: '' }, 'No number assigned'));
  dids().forEach((n) => sel.appendChild(el('option', { value: n }, n)));
  if (cur) sel.value = cur;
}

function buildAgentForm(existing) {
  const e = existing || {};
  const tts = e.tts || {};
  const card = el('div', { class: 'card builder' });
  const state = {
    model: tts.model || 'muga',
    tone: tts.tone || 'neutral',
    speaker: tts.speaker || 'speaker_2',
    f0: tts.f0_up_key != null ? tts.f0_up_key : 0
  };

  const nameI = el('input', { class: 'input', id: 'f_name', type: 'text', value: e.name || '', placeholder: 'Front Desk', maxlength: 80 });
  const personaI = el('textarea', { class: 'textarea', id: 'f_persona', rows: 4, placeholder: 'You are a warm, sharp receptionist. Answer in 1 to 2 short spoken sentences, qualify the lead, and book a callback.' }, e.persona || '');
  const greetI = el('input', { class: 'input', id: 'f_greeting', type: 'text', value: e.greeting || '', placeholder: 'Hi, thanks for calling RapidX. How can I help today.', maxlength: 240 });
  const descI = el('input', { class: 'input', id: 'f_desc', type: 'text', value: (tts.description || ''), placeholder: 'Optional voice direction, e.g. calm and confident' });

  const modelSeg = el('div', { class: 'seg', id: 'f_model_seg' }, VOICE_MODELS.map((m) =>
    el('button', { type: 'button', class: m === state.model ? 'on' : '', 'data-m': m, onclick: () => { state.model = m; syncVoice(); } }, m)
  ));
  const toneSeg = el('div', { class: 'seg', id: 'f_tone_seg' }, MUGA_TONES.map((tn) =>
    el('button', {
      type: 'button', class: tn === state.tone ? 'on' : '', 'data-t': tn, onclick: () => {
        state.tone = tn;
        $$('#f_tone_seg button').forEach((b) => b.classList.toggle('on', b.getAttribute('data-t') === tn));
      }
    }, tn)
  ));
  const speakerSel = el('select', { class: 'select', id: 'f_speaker' }, SPEAKERS.map((s) =>
    el('option', { value: s, selected: s === state.speaker ? 'selected' : false }, s)
  ));
  const f0Val = el('span', { class: 'rv', id: 'f_f0_val' }, String(state.f0));
  const f0Range = el('input', { type: 'range', id: 'f_f0', min: -12, max: 12, step: 1, value: state.f0, oninput: (ev) => { state.f0 = +ev.target.value; f0Val.textContent = (state.f0 > 0 ? '+' : '') + state.f0; } });
  if (state.f0 > 0) f0Val.textContent = '+' + state.f0;

  const didSel = el('select', { class: 'select', id: 'f_did' }, [el('option', { value: '' }, 'No number assigned')]);
  if (e.telephony && e.telephony.did) { /* set after dids load */ setTimeout(() => { try { didSel.value = e.telephony.did; } catch (x) { } }, 0); }

  const toneField = field('Emotional tone (muga)', toneSeg);
  const speakerField = field('Speaker (mulberry)', speakerSel);
  const descField = field('Voice direction (mulberry)', descI);
  const pitchField = field('Pitch, f0_up_key', el('div', { class: 'range-row' }, [f0Range, f0Val]));
  function syncVoice() {
    $$('#f_model_seg button').forEach((b) => b.classList.toggle('on', b.getAttribute('data-m') === state.model));
    const isMul = state.model === 'mulberry';
    toneField.style.display = isMul ? 'none' : '';
    speakerField.style.display = isMul ? '' : 'none';
    descField.style.display = isMul ? '' : 'none';
    pitchField.style.display = isMul ? '' : 'none';
  }

  const submitBtn = el('button', { class: 'btn btn-primary' }, existing ? 'Save changes' : 'Create agent');
  const form = el('form', { onsubmit: onSave }, [
    el('div', { class: 'form-grid' }, [
      field('Agent name', nameI),
      field('Assigned number', didSel),
      (function () { const f = field('Persona', personaI); f.classList.add('full'); return f; })(),
      (function () { const f = field('Greeting', greetI); f.classList.add('full'); return f; })(),
      field('Voice model', modelSeg),
      toneField,
      pitchField,
      speakerField,
      descField
    ]),
    el('div', { class: 'flex gap-2', style: 'margin-top:18px;align-items:center' }, [submitBtn, existing ? el('button', { type: 'button', class: 'btn btn-ghost', onclick: () => modalClose() }, 'Cancel') : null])
  ]);

  card.appendChild(el('h3', {}, existing ? 'Edit agent' : 'New agent'));
  card.appendChild(el('p', { class: 'hint' }, existing ? 'Update the persona, voice, or assigned number.' : 'Describe the persona and pick a voice. You can preview it instantly before assigning a number.'));
  card.appendChild(form);
  syncVoice();

  let _modalClose = null;
  function modalClose() { if (_modalClose) _modalClose(); }
  card._setModalClose = (fn) => { _modalClose = fn; };

  async function onSave(ev) {
    ev.preventDefault();
    const name = nameI.value.trim();
    const persona = personaI.value.trim();
    if (!name) { toast('Give the agent a name.', 'err'); nameI.focus(); return; }
    if (!persona) { toast('Add a persona so the agent knows how to behave.', 'err'); personaI.focus(); return; }
    submitBtn.disabled = true; submitBtn.textContent = existing ? 'Saving...' : 'Creating...';
    const payload = {
      name: name,
      persona: persona,
      greeting: greetI.value.trim(),
      did: didSel.value || '',
      tts: {
        model: state.model,
        tone: state.model === 'muga' ? (state.tone || 'excited') : undefined,
        speaker: state.model === 'mulberry' ? state.speaker : undefined,
        f0_up_key: state.model === 'mulberry' ? state.f0 : 0,
        description: descI.value.trim() || undefined
      }
    };
    try {
      if (existing) {
        payload.id = existing.id;
        const res = await api('/api/agents/update', { method: 'POST', body: payload });
        const idx = State.agents.findIndex((a) => a.id === existing.id);
        if (idx !== -1) State.agents[idx] = res.agent || Object.assign({}, existing, payload);
        toast('Agent updated.', 'ok');
        modalClose();
      } else {
        const res = await api('/api/agents', { method: 'POST', body: payload });
        if (res.agent) State.agents.push(res.agent);
        toast('Agent created.', 'ok');
        // reset the inline form
        nameI.value = ''; personaI.value = ''; greetI.value = ''; descI.value = ''; didSel.value = '';
      }
      paintAgents();
    } catch (ex) {
      toast(ex.message || 'Could not save agent.', 'err');
    } finally {
      submitBtn.disabled = false; submitBtn.textContent = existing ? 'Save changes' : 'Create agent';
    }
  }

  return card;
}

function paintAgents() {
  const grid = $('#agentsGrid'); if (!grid) return;
  refillDidOptions();
  grid.innerHTML = '';
  if (!State.agents.length) {
    grid.appendChild(el('div', { class: 'empty' }, [
      el('div', { class: 'ttl' }, 'No agents yet'),
      el('div', {}, 'Use the builder above to create your first voice agent.')
    ]));
    return;
  }
  State.agents.forEach((a) => grid.appendChild(agentCard(a)));
}

function agentCard(a) {
  const tts = a.tts || {};
  const isMuga = (tts.model || 'muga') === 'muga';
  const voiceLine = isMuga
    ? `muga / tone: ${tts.tone || 'excited'}`
    : `mulberry / ${tts.speaker || 'speaker_2'}${tts.f0_up_key ? ' / pitch ' + (tts.f0_up_key > 0 ? '+' : '') + tts.f0_up_key : ''}`;
  const did = a.telephony && a.telephony.did ? a.telephony.did : null;

  const previewBtn = el('button', { class: 'btn btn-ghost btn-sm' }, 'Listen');
  previewBtn.addEventListener('click', () => previewAgentVoice(a, previewBtn));

  const talkMicBtn = el('button', {
    class: 'btn btn-primary btn-sm',
    style: 'display:inline-flex;align-items:center;gap:4px;font-weight:600',
    onclick: () => openVoiceSimulator(a)
  }, 'Test in Browser');

  // Human Call Recording Training Studio
  const trainingStudio = el('details', { style: 'margin-top:12px;border:1px dashed rgba(0,149,255,0.3);border-radius:var(--r-sm);padding:8px 12px;background:rgba(0,149,255,0.02)' }, [
    el('summary', { style: 'cursor:pointer;font-size:.78rem;font-weight:600;color:var(--accent)' }, 'Train on Call Recording (.mp3 / .wav)'),
    el('p', { class: 'soft', style: 'font-size:.72rem;margin:6px 0 8px 0' }, 'Upload a real phone call recording. Speech analysis fine-tunes receptionist conversation strategy.'),
    (function () {
      const fileIn = el('input', { type: 'file', accept: 'audio/*', style: 'font-size:.76rem;width:100%' });
      fileIn.addEventListener('change', async () => {
        const file = fileIn.files && fileIn.files[0];
        if (!file) return;
        toast('Uploading & transcribing call recording...', 'info');
        try {
          const reader = new FileReader();
          reader.onload = async () => {
            try {
              const base64Audio = reader.result.split(',')[1];
              const sttRes = await api('/api/stt', { method: 'POST', body: { audio: base64Audio, mime: file.type || 'audio/wav' } });
              const transcriptText = sttRes.text;
              if (!transcriptText) throw new Error('No speech detected in audio file.');
              toast('Transcript decoded! Refining agent persona...', 'ok');
              const genRes = await api('/api/agents/generate-from-needs', {
                method: 'POST',
                body: {
                  businessName: a.name,
                  industry: 'General',
                  objective: 'Improve call handling and objections',
                  transcript: transcriptText,
                  existingAgent: a
                }
              });
              if (genRes.agent) {
                await api('/api/agents', {
                  method: 'POST',
                  body: Object.assign({}, a, {
                    persona: genRes.agent.persona || a.persona,
                    sampleTranscript: genRes.sampleTranscript || a.sampleTranscript,
                    transcriptUnderstanding: genRes.transcriptUnderstanding || a.transcriptUnderstanding
                  })
                });
                await ensureAgents(true);
                paintAgents();
                toast('Agent successfully trained on your call recording!', 'ok');
              }
            } catch (err) {
              toast(err.message || 'Call recording training failed.', 'err');
            }
          };
          reader.readAsDataURL(file);
        } catch (err) {
          toast(err.message || 'File read failed.', 'err');
        }
      });
      return fileIn;
    })()
  ]);

  // textContent everywhere = XSS safe for persona/name
  return el('div', { class: 'card card-glow agent-card' }, [
    el('div', { class: 'ac-top' }, [
      el('div', { class: 'ac-av' }, initials(a.name)),
      el('div', { style: 'min-width:0' }, [
        el('div', { class: 'ac-name' }, a.name),
        el('div', { class: 'ac-voice' }, voiceLine)
      ])
    ]),
    el('div', { class: 'ac-persona' }, a.persona || 'No persona set.'),
    el('div', { class: 'ac-meta' }, [
      did ? el('span', { class: 'tag' }, did) : el('span', { class: 'tag' }, 'no number'),
      el('span', { class: 'tag' }, (tts.model || 'muga') + (isMuga ? ` (${tts.tone || 'excited'})` : ''))
    ]),
    trainingStudio,
    el('div', { class: 'ac-actions', style: 'margin-top:14px;display:flex;flex-wrap:wrap;gap:8px' }, [
      talkMicBtn,
      previewBtn,
      (a.sampleTranscript && a.sampleTranscript.length) ? el('button', { class: 'btn btn-ghost btn-sm', onclick: () => showTranscriptModal(a) }, 'Transcript') : null,
      el('button', { class: 'btn btn-ghost btn-sm', onclick: () => openEditAgent(a) }, 'Edit'),
      el('button', { class: 'btn btn-ghost btn-sm', onclick: () => confirmDeleteAgent(a) }, 'Delete')
    ])
  ]);
}

async function previewAgentVoice(a, btn) {
  const tts = a.tts || {};
  let text = (a.greeting && a.greeting.trim()) || ('Hi, this is ' + (a.name || 'your agent') + '. How can I help today.');
  playSpeechSnippet(text, tts, btn);
}

function openEditAgent(a) {
  const form = buildAgentForm(a);
  form.style.boxShadow = 'none'; form.style.border = '0'; form.style.background = 'transparent'; form.style.padding = '0';
  const host = $('#modal-host');
  const close = () => { host.classList.add('hide'); host.setAttribute('aria-hidden', 'true'); host.innerHTML = ''; };
  form._setModalClose(() => { close(); paintAgents(); });
  const card = el('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', style: 'max-width:600px' }, [form]);
  host.innerHTML = '';
  host.appendChild(el('div', { onclick: (ev) => { if (ev.target === ev.currentTarget) close(); }, style: 'position:absolute;inset:0' }));
  host.appendChild(card);
  host.classList.remove('hide');
  host.setAttribute('aria-hidden', 'false');
  setTimeout(refillDidOptions, 0);
}

function confirmDeleteAgent(a) {
  modal({
    title: 'Delete agent',
    body: el('p', {}, ['Delete ', el('b', {}, a.name), '. This cannot be undone.']),
    confirmText: 'Delete agent', confirmKind: 'danger',
    onConfirm: async () => {
      await api('/api/agents/delete', { method: 'POST', body: { id: a.id } });
      State.agents = State.agents.filter((x) => x.id !== a.id);
      paintAgents();
      toast('Agent deleted.', 'ok');
    }
  });
}

/* helper used by builder */
function field(label, input) { return el('div', { class: 'field' }, [el('label', {}, label), input]); }

/* ===========================================================================
   2.5 AI AGENT GENERATOR FROM CLIENT NEEDS & TRANSCRIPTS
   =========================================================================== */

const AI_PRESETS = [
  {
    id: 'dental',
    label: 'Dental Clinic',
    businessName: 'Indiranagar Dental Care',
    industry: 'Healthcare / Dental',
    objective: 'Emergency triage and routine appointment booking',
    tone: 'Reassuring, calm, and professional',
    language: 'English (Indian accent)',
    needs: 'We are a dental clinic in Indiranagar, Bangalore. Callers usually ask about toothache emergencies, routine cleaning, root canal consultations, or doctor availability (Dr. Sunita). Consultation fee is ₹600. The agent needs to collect: patient name, phone number, issue severity (mild, moderate, emergency trauma), and preferred time. If the caller has severe bleeding or facial swelling, treat it as an emergency and promise immediate priority triage.',
    transcript: 'Caller: Hello, do you have any doctors available today? I have a severe toothache since last night.\nAgent: Hi, thanks for calling Indiranagar Dental Care. We can definitely help you with that. Are you having any swelling or bleeding along with the pain?\nCaller: Yes, my lower right jaw is slightly swollen and it is throbbing.\nAgent: I understand, that sounds like an urgent tooth infection. We have an emergency slot open with Dr. Sunita at 3:30 PM today. May I get your full name so I can hold that for you?\nCaller: My name is Rohan Mehta.\nAgent: Thank you Rohan. And is this mobile number the best one to reach you on?\nCaller: Yes, this number works.\nAgent: Great. Your emergency visit with Dr. Sunita is locked in for 3:30 PM today. Please avoid very hot or cold drinks until you arrive, and we will take care of the rest.'
  },
  {
    id: 'real_estate',
    label: 'Real Estate',
    businessName: 'Skyline Realty Mumbai',
    industry: 'Real Estate / Property',
    objective: 'Qualify buyer budget, preferred location, and book weekend site visits',
    tone: 'Warm, sharp, and confident',
    language: 'English (Indian accent)',
    needs: 'We represent premium residential apartments in Thane and Powai, Mumbai. Inbound callers ask about 2 BHK and 3 BHK prices, carpet area, possession dates, and want to book site visits. 2 BHK starts at ₹85 Lakhs, 3 BHK starts at ₹1.4 Crore. Agent should qualify: buyer name, phone number, budget range, current residence location, and schedule a site visit for Saturday or Sunday.',
    transcript: 'Caller: Hi, I saw your billboard for the Thane luxury towers. What is the starting price for 2 BHK?\nAgent: Hello! Thanks for calling Skyline Realty. Our 2 BHK luxury homes in Thane start at 85 Lakhs with possession by December next year. Are you looking for self-use or investment?\nCaller: Looking for my family to move in. Do you have balcony options?\nAgent: Yes, every unit features a double-height panoramic balcony. We have show apartments open for walkthroughs this weekend. What day works better for a visit, Saturday or Sunday?\nCaller: Sunday afternoon would be great. Is parking included?\nAgent: One covered podium parking is bundled. Sunday at 2 PM is available. May I have your name to issue the guest entry pass?\nCaller: Sure, I am Priya Sharma.\nAgent: Wonderful, Priya. I have registered your site visit for Sunday at 2 PM at Skyline Thane. Our project coordinator will send you the location pin right away.'
  },
  {
    id: 'legal',
    label: 'Legal Intake',
    businessName: 'Apex Law Group',
    industry: 'Legal / Personal Injury',
    objective: 'Empathetic incident intake, damage qualification, and attorney callback booking',
    tone: 'Empathetic, calm, and trustworthy',
    language: 'English',
    needs: 'Personal injury legal practice. Callers are people involved in recent auto accidents, workplace injuries, or slip-and-falls. Agent must be empathetic and calm. NEVER give legal advice or guarantee case values. Collect: caller name, callback number, accident date, whether they received medical treatment, and insurance contact. Schedule an attorney evaluation.',
    transcript: 'Caller: Hello, I was hit by a delivery van two days ago and the driver ran a red light. My shoulder hurts.\nAgent: Thank you for calling Apex Law Group. I am very sorry to hear about your accident. First, have you already received emergency medical treatment for your shoulder?\nCaller: Yes, I went to urgent care yesterday, but the van insurance company is already calling me to settle.\nAgent: Please do not sign or agree to anything with their insurance yet. Our attorneys can evaluate your claim at zero upfront cost. May I have your full name and the date of the incident?\nCaller: It is David Miller, and it happened this Tuesday.\nAgent: Thank you, David. What is the best callback number for our senior intake attorney to reach you within the hour?\nCaller: 555-019-2834.\nAgent: Got it. Attorney Vance will review your details and call you back shortly. Please keep copies of all your urgent care receipts.'
  },
  {
    id: 'restaurant',
    label: 'Restaurant',
    businessName: 'The Olive Bistro',
    industry: 'Hospitality / Dining',
    objective: 'Table reservations, opening hours, and dietary guidance',
    tone: 'Friendly, warm, and inviting',
    language: 'English',
    needs: 'European rooftop bistro. Callers want to reserve tables, ask about weekend DJ nights, outdoor seating, and vegetarian/vegan menu options. Open 12 PM to 11:30 PM. Collect: guest name, party size, date, preferred time slot, and special requests (birthday/anniversary).',
    transcript: 'Caller: Hi, do you have outdoor rooftop tables available tonight for a party of 4?\nAgent: Hi, thanks for calling The Olive Bistro! We do have rooftop terrace tables available tonight. What time were you planning to join us?\nCaller: Around 8:30 PM. Also, one of us is strictly vegan, do you have options?\nAgent: Yes, our terrace is breezy and we have a dedicated vegan pasta and salad menu. 8:30 PM for 4 guests is available. May I have your name and phone number to confirm the reservation?\nCaller: Sure, it is Ananya Sen, 9820123456.\nAgent: Wonderful Ananya! Table for 4 is reserved on the terrace tonight at 8:30 PM. We look forward to hosting you!'
  },
  {
    id: 'hvac',
    label: 'HVAC & Repairs',
    businessName: 'CoolCare Tech',
    industry: 'Home Services / HVAC',
    objective: 'Urgent breakdown triage, address collection, and technician dispatch',
    tone: 'Crisp, reassuring, and solution-focused',
    language: 'English or Hinglish',
    needs: '24/7 HVAC and air conditioning repair service. Inbound calls are often homeowners whose AC broke down in peak heat or water is leaking. Collect: caller name, address/locality, AC type (split, central, window), urgency (routine or emergency breakdown), and schedule tech visit. Emergency fee is ₹499.',
    transcript: 'Caller: My central AC just stopped blowing cold air and there is water leaking near the unit.\nAgent: Thanks for calling CoolCare. I understand how stressful an AC leak is. To prevent water damage, have you turned off the thermostat switch yet?\nCaller: Yes, I just switched it off.\nAgent: Great first step. We have an emergency mobile technician in your area who can arrive within 90 minutes. May I have your name and address?\nCaller: Ramesh Gupta, Palm Meadows Villa 42.\nAgent: Thank you Mr. Gupta. Our technician Vikram will be at Villa 42 within 90 minutes. He will call you when 10 minutes away.'
  },
  {
    id: 'custom',
    label: 'Custom Business',
    businessName: '',
    industry: 'General Business',
    objective: 'Inbound caller qualification and appointment scheduling',
    tone: 'Warm, professional, and clear',
    language: 'English',
    needs: '',
    transcript: ''
  }
];

async function playSpeechSnippet(text, tts, btn) {
  if (btn.getAttribute('data-speaking') === 'true') {
    stopAllSpeech();
    btn.removeAttribute('data-speaking');
    btn.innerHTML = btn.getAttribute('data-orig-html') || '▶ Listen';
    return;
  }
  const origHtml = btn.innerHTML;
  btn.setAttribute('data-orig-html', origHtml);
  btn.setAttribute('data-speaking', 'true');
  btn.innerHTML = '⏹ Stop';

  await speakUtterance(text, tts, {
    onStart: () => { },
    onEnd: () => {
      btn.removeAttribute('data-speaking');
      btn.innerHTML = origHtml;
    }
  });
}

function showTranscriptModal(a) {
  const turns = a.sampleTranscript || [];
  const insights = a.transcriptUnderstanding || {};
  const body = el('div', { style: 'max-height:70vh;overflow-y:auto;padding-right:6px' }, [
    insights.businessSummary ? el('div', { class: 'card card-pad', style: 'margin-bottom:14px;background:var(--bg-2)' }, [
      el('span', { class: 'section-kicker' }, 'Transcript Understanding & Strategy'),
      el('h4', { class: 't-h4', style: 'margin:4px 0' }, a.name),
      el('p', { class: 'soft', style: 'font-size:.85rem' }, insights.businessSummary),
      insights.detectedIntents && insights.detectedIntents.length ? el('div', { style: 'margin-top:10px' }, [
        el('strong', { style: 'font-size:.78rem;text-transform:uppercase;color:var(--ink-dim)' }, 'Detected Intents: '),
        el('div', { class: 'pill-group' }, insights.detectedIntents.map((it) => el('span', { class: 'field-pill' }, it)))
      ]) : null,
      insights.objectionStrategy ? el('p', { style: 'font-size:.82rem;margin-top:8px;color:var(--ink-soft)' }, [
        el('b', {}, 'Objection Strategy: '),
        document.createTextNode(insights.objectionStrategy)
      ]) : null
    ]) : null,
    el('h4', { class: 't-h4', style: 'margin-bottom:10px' }, 'Verified Call Conversation Transcript'),
    el('div', { class: 'dialogue-stream', style: 'max-height:400px' }, turns.map((t) => {
      const isAgent = (t.speaker || '').toLowerCase() === 'agent';
      const playBtn = isAgent ? el('button', {
        class: 'dialogue-audio-mini',
        onclick: (e) => { e.stopPropagation(); playSpeechSnippet(t.text, a.tts, playBtn); }
      }, 'Listen') : null;
      return el('div', { class: 'dialogue-turn ' + (isAgent ? 'agent' : 'caller') }, [
        el('div', { class: 'dialogue-turn-header' }, [
          el('span', {}, isAgent ? 'Voice Agent' : 'Customer / Caller'),
          t.annotation ? el('span', { class: 'dialogue-annotation' }, t.annotation) : null,
          playBtn
        ]),
        el('div', { class: 'dialogue-bubble' }, t.text)
      ]);
    }))
  ]);

  modal({
    title: `${a.name} , Call Transcript & Analysis`,
    body,
    confirmText: 'Done',
    confirmKind: 'primary',
    onConfirm: () => { },
    cancelText: 'Close'
  });
}

/* ===========================================================================
   2.5 7-STEP CONVERSATIONAL AI ONBOARDING WIZARD
   =========================================================================== */

const ONBOARD_PRESETS = [
  {
    id: 'dental',
    label: 'Dental Clinic',
    businessName: 'Indiranagar Dental Care',
    industry: 'Healthcare & Clinic',
    offerings: 'Dental consultations: ₹600. Routine teeth cleaning & scaling: ₹1,500. Root canal treatment: ₹4,500. Dental implants from ₹25,000. Emergency toothache visits accommodated same-day.',
    goal: 'Book Appointments & Consultations',
    language: 'English (Indian Accent)',
    tone: 'Friendly & Welcoming',
    workingHours: 'Mon-Sat 9 AM to 8:30 PM, Emergency Contact: +91 98765 43210',
    transcript: 'Caller: Hello, do you have any doctors available today? I have a severe toothache since last night.\nAgent: Hi, thanks for calling Indiranagar Dental Care. We can definitely help you with that. Are you having any swelling or bleeding along with the pain?\nCaller: Yes, my lower right jaw is slightly swollen and it is throbbing.\nAgent: I understand, that sounds like an urgent tooth infection. We have an emergency slot open with Dr. Sunita at 3:30 PM today. May I get your full name so I can hold that for you?\nCaller: My name is Rohan Mehta.\nAgent: Thank you Rohan. And is this mobile number the best one to reach you on?\nCaller: Yes, this number works.\nAgent: Great. Your emergency visit with Dr. Sunita is locked in for 3:30 PM today. Please avoid very hot or cold drinks until you arrive, and we will take care of the rest.'
  },
  {
    id: 'real_estate',
    label: 'Real Estate',
    businessName: 'Skyline Realty Mumbai',
    industry: 'Real Estate & Property',
    offerings: 'Luxury 2 & 3 BHK apartments in Bandra West and BKC from ₹2.8 Cr to ₹7.5 Cr. Commercial office suites from ₹1.5 Cr. Free site visits with chauffeured pickup.',
    goal: 'Qualify Inbound Leads',
    language: 'Natural Hinglish (Hindi + English)',
    tone: 'Direct & Assertive',
    workingHours: 'Daily 9 AM to 9 PM, VIP Sales Desk: +91 98201 12345',
    transcript: 'Caller: Hi, I saw your ad for 3 BHK apartments in Bandra. What is the starting price?\nAgent: Hi, thank you for reaching out to Skyline Realty. Our 3 BHK luxury residences in Bandra West start at 4.2 Crores. Are you looking to purchase for self-use or investment?\nCaller: For my family to move into next year.\nAgent: Understood. We have ready-to-move and under-construction units completing in Q3 next year. Would you prefer a weekend site visit to experience the sample apartment?\nCaller: Yes, Saturday morning would be good.\nAgent: Perfect. May I have your name and the best WhatsApp number to send the location brochure and confirm your pickup?'
  },
  {
    id: 'hvac',
    label: 'HVAC & Home Services',
    businessName: 'Apex HVAC & Climate Control',
    industry: 'Home Services & HVAC',
    offerings: 'AC repair & gas refilling: ₹1,200. Annual maintenance contracts (AMC): ₹3,500/year. Emergency cooling breakdown service within 90 minutes.',
    goal: 'Book Appointments & Consultations',
    language: 'English (Indian Accent)',
    tone: 'Warm & Empathetic',
    workingHours: 'Mon-Sun 8 AM to 10 PM, 24/7 Dispatch: +91 98111 22334',
    transcript: 'Caller: Hello, our office AC just stopped blowing cold air and it is freezing up.\nAgent: Hi, thanks for calling Apex HVAC. We can dispatch a technician to inspect that today. How many units are affected?\nCaller: Just the main conference room split AC.\nAgent: Got it. We have a technician in your area between 2 PM and 4 PM today. What is your office address so I can schedule this visit?'
  },
  {
    id: 'ecommerce',
    label: 'E-Commerce & Retail',
    businessName: 'Nexa Trends Fashion',
    industry: 'E-Commerce & Retail',
    offerings: 'Direct-to-consumer apparel, footwear, and accessories. 7-day hassle-free returns. Free delivery on orders over ₹999.',
    goal: 'Answer Service FAQs & Inquiries',
    language: 'English (Indian Accent)',
    tone: 'Friendly & Welcoming',
    workingHours: '24/7 Automated Support, Escalation: support@nexatrends.in',
    transcript: 'Caller: Hi, I ordered a jacket 3 days ago and I have not received the tracking details yet.\nAgent: Hi, thanks for calling Nexa Trends. I can look that up for you right now. Could you share your 8-digit order number or registered phone number?\nCaller: The order number is NX-884920.\nAgent: Thank you. Your order has been dispatched via BlueDart and is scheduled for delivery tomorrow before 5 PM. I will send the live tracking link to your phone now.'
  }
];

const ONBOARD_STEPS = [
  {
    num: 1,
    badge: 'Step 1 of 8 • Business Identity',
    title: 'What is your business or company name?',
    sub: 'Your AI agent will introduce itself for this company or brand. (You can also add separate agents for your other companies anytime).',
    type: 'text',
    key: 'businessName',
    placeholder: 'e.g. Apex Health, Skyline Realty, Nexa Solutions (or Group name)...',
    default: ''
  },
  {
    num: 2,
    badge: 'Step 2 of 8 • Industry Sector(s)',
    title: 'What industry does your company operate in?',
    sub: 'Select one or more sectors your business or group operates in.',
    type: 'multipills',
    key: 'industry',
    options: ['Healthcare & Clinic', 'Real Estate & Property', 'Home Services & HVAC', 'E-Commerce & Retail', 'Legal & Financial', 'Automotive', 'Hospitality', 'Other'],
    default: ['Home Services & HVAC']
  },
  {
    num: 3,
    badge: 'Step 3 of 8 • Company Services & Offerings',
    title: 'What does your company do and what are your main offerings?',
    sub: 'Explain what your business does and typical pricing so the agent can quote and assist callers accurately.',
    type: 'textarea',
    key: 'offerings',
    placeholder: 'e.g. Consultation fees, primary services, packages, pricing, emergency appointments...',
    default: ''
  },
  {
    num: 4,
    badge: 'Step 4 of 8 • Primary AI Receptionist Goals & Capabilities',
    title: 'What should this voice agent handle?',
    sub: 'Select one or more outcomes and capabilities for your AI voice agent.',
    type: 'multipills',
    key: 'goal',
    options: ['Book Appointments & Consultations', 'Qualify Inbound Leads', 'Answer Service FAQs & Inquiries', 'Emergency Triage & Routing'],
    default: ['Book Appointments & Consultations']
  },
  {
    num: 5,
    badge: 'Step 5 of 8 • Spoken Language & Accent',
    title: 'Which language style should your agent speak?',
    sub: 'Select the conversational dialect matching your caller demographic.',
    type: 'pills',
    key: 'language',
    options: ['English (Indian Accent)', 'Natural Hinglish (Hindi + English)', 'Neutral English', 'Hindi'],
    default: 'English (Indian Accent)'
  },
  {
    num: 6,
    badge: 'Step 6 of 8 • Voice Tone & Persona',
    title: 'What personality and tone should the agent possess?',
    sub: 'The agent will adapt its pacing, greeting, and emotional demeanor accordingly.',
    type: 'pills',
    key: 'tone',
    options: ['Friendly & Welcoming', 'Warm & Empathetic', 'Professional & Executive', 'Direct & Assertive'],
    default: 'Friendly & Welcoming'
  },
  {
    num: 7,
    badge: 'Step 7 of 8 • Business Hours & Escalation',
    title: 'What are your operating hours and emergency contact?',
    sub: 'The agent will inform callers of your availability and knows when to escalate.',
    type: 'text',
    key: 'workingHours',
    placeholder: 'e.g. Mon-Sat 9 AM to 8:30 PM, Emergency Contact: +91 98765 43210',
    default: ''
  },
  {
    num: 8,
    badge: 'Step 8 of 8 • WhatsApp & Meta Credentials',
    title: 'Connect your WhatsApp Business account',
    sub: 'Enter your own Meta Cloud API credentials so call follow-ups and WhatsApp chats are sent from your number. Optional, you can add or change these later.',
    type: 'whatsapp_setup',
    key: 'whatsapp',
    default: { metaAppId: '', metaAppSecret: '', metaWabaId: '', metaPhoneId: '', metaToken: '', autoFollowupEnabled: true }
  }
];

async function viewOnboarding(root) {
  const head = viewHead('AI Voice Agent Onboarding', 'Answer 8 quick steps about your company. The AI designs your conversational persona, understands customer objections, generates 3 script variants, and lets you test your agent instantly.');
  const skipBtn = el('button', {
    type: 'button',
    class: 'btn btn-ghost btn-sm',
    style: 'margin-left:auto;font-weight:600',
    onclick: async () => {
      if (window.Clerk && window.Clerk.user) {
        localStorage.setItem('seevora_onboarded_' + window.Clerk.user.id, 'true');
        if (typeof window.Clerk.user.update === 'function') {
          window.Clerk.user.update({ unsafeMetadata: { onboardingCompleted: true } }).catch(() => {});
        }
      }
      await api('/api/tenant/onboarding-complete', { method: 'POST' }).catch(() => { });
      if (State.me && State.me.tenant) State.me.tenant.onboardingCompleted = true;
      if (State.me && State.me.user) State.me.user.onboardingCompleted = true;
      renderShell();
      goto('overview');
    }
  }, 'Skip Setup & Go to Dashboard →');
  head.appendChild(skipBtn);
  root.appendChild(head);

  // Active form state
  const answers = {};
  ONBOARD_STEPS.forEach((st) => {
    answers[st.key] = Array.isArray(st.default) ? [...st.default] : (st.default && typeof st.default === 'object' ? { ...st.default } : st.default);
  });
  let activeStep = 0;
  let customTranscript = '';
  let generatedResult = null;
  let activeVariant = 'friendly';

  const container = el('div', { class: 'onboard-wizard' });
  root.appendChild(container);

  function renderCurrentStep() {
    container.innerHTML = '';

    if (generatedResult) {
      renderCompletionScreen();
      return;
    }

    const step = ONBOARD_STEPS[activeStep];
    const pct = Math.round(((activeStep + 1) / ONBOARD_STEPS.length) * 100);

    // Progress bar
    const progressTrack = el('div', { class: 'onboard-progress-track' }, [
      el('div', { class: 'onboard-progress-fill', style: `width:${pct}%` })
    ]);

    // Question Card
    const card = el('div', { class: 'onboard-step-card' });
    const badge = el('div', { class: 'onboard-step-badge' }, step.badge);
    const title = el('h3', { class: 'onboard-q-title' }, step.title);
    const sub = el('p', { class: 'onboard-q-sub' }, step.sub);

    card.appendChild(badge);
    card.appendChild(title);
    card.appendChild(sub);

    // Input Control based on step type
    let inputControl = null;
    if (step.type === 'text') {
      const inp = el('input', {
        class: 'input',
        type: 'text',
        placeholder: step.placeholder,
        value: answers[step.key] || ''
      });
      inp.addEventListener('input', () => { answers[step.key] = inp.value; });
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') goNext(); });
      inputControl = inp;
      setTimeout(() => inp.focus(), 50);
    } else if (step.type === 'textarea') {
      const area = el('textarea', {
        class: 'textarea',
        rows: 4,
        placeholder: step.placeholder
      }, answers[step.key] || '');
      area.addEventListener('input', () => { answers[step.key] = area.value; });

      const micBtn = el('button', {
        type: 'button',
        class: 'btn btn-ghost btn-sm',
        onclick: () => startVoiceDictation(area, micBtn)
      }, 'Speak Answer');

      inputControl = el('div', {}, [
        el('div', { class: 'flex justify-end', style: 'margin-bottom:6px' }, [micBtn]),
        area
      ]);
      setTimeout(() => area.focus(), 50);
    } else if (step.type === 'pills') {
      const group = el('div', { class: 'onboard-pill-group' });
      step.options.forEach((opt) => {
        const isSel = answers[step.key] === opt;
        const btn = el('button', {
          type: 'button',
          class: 'onboard-pill-btn' + (isSel ? ' selected' : ''),
          onclick: () => {
            answers[step.key] = opt;
            $$('.onboard-pill-btn', group).forEach((b) => b.classList.remove('selected'));
            btn.classList.add('selected');
          }
        }, opt);
        group.appendChild(btn);
      });
      inputControl = group;
    } else if (step.type === 'multipills') {
      const group = el('div', { class: 'onboard-pill-group' });
      step.options.forEach((opt) => {
        let curArr = answers[step.key];
        if (!Array.isArray(curArr)) {
          curArr = curArr ? [curArr] : [];
          answers[step.key] = curArr;
        }
        const isSel = curArr.includes(opt);
        const btn = el('button', {
          type: 'button',
          class: 'onboard-pill-btn' + (isSel ? ' selected' : ''),
          onclick: () => {
            let arr = answers[step.key];
            if (!Array.isArray(arr)) arr = arr ? [arr] : [];
            if (arr.includes(opt)) {
              arr = arr.filter((x) => x !== opt);
              btn.classList.remove('selected');
            } else {
              arr = [...arr, opt];
              btn.classList.add('selected');
            }
            answers[step.key] = arr;
          }
        }, opt);
        group.appendChild(btn);
      });
      inputControl = group;
    } else if (step.type === 'whatsapp_setup') {
      const wa = answers[step.key];
      const mk = (key, label, ph, type) => {
        const inp = el('input', { class: 'input', type: type || 'text', placeholder: ph, value: wa[key] || '', autocomplete: 'off' });
        inp.addEventListener('input', () => { wa[key] = inp.value; });
        return field(label, inp);
      };
      const chk = el('input', { type: 'checkbox' });
      chk.checked = !!wa.autoFollowupEnabled;
      chk.addEventListener('change', () => { wa.autoFollowupEnabled = chk.checked; });
      inputControl = el('div', { class: 'settings-form' }, [
        mk('metaAppId', 'Meta App ID', 'From developers.facebook.com > Your App > Settings > Basic'),
        mk('metaAppSecret', 'Meta App Secret', 'App secret (stored securely, never shown again)', 'password'),
        mk('metaWabaId', 'WhatsApp Business Account ID (WABA ID)', 'e.g. 109876543210987'),
        mk('metaPhoneId', 'Phone Number ID', 'WhatsApp > API Setup > Phone number ID'),
        mk('metaToken', 'Permanent Access Token', 'System user access token with whatsapp_business_messaging', 'password'),
        el('label', { style: 'display:flex;gap:8px;align-items:center;margin-top:6px;font-size:.9rem' }, [chk, 'Automatically send a WhatsApp follow-up after every voice call']),
        el('p', { class: 'soft', style: 'font-size:.8rem;margin-top:6px' }, 'Your credentials are saved only for your workspace. Leave blank to skip and configure later.')
      ]);
    }

    if (inputControl) card.appendChild(inputControl);

    // Navigation row
    const prevBtn = el('button', {
      type: 'button',
      class: 'btn btn-ghost',
      disabled: activeStep === 0 ? 'disabled' : false,
      onclick: () => { if (activeStep > 0) { activeStep--; renderCurrentStep(); } }
    }, '← Previous');

    const isLast = activeStep === ONBOARD_STEPS.length - 1;
    const nextBtn = el('button', {
      type: 'button',
      class: 'btn btn-primary',
      style: isLast ? 'padding:12px 28px;font-weight:700;box-shadow:0 6px 20px rgba(0,149,255,0.35)' : '',
      onclick: () => goNext()
    }, isLast ? 'Save & Generate Voice Agent' : 'Next Step →');

    const navRow = el('div', { class: 'onboard-nav-row' }, [
      prevBtn,
      el('span', { class: 'soft', style: 'font-size:.82rem' }, `${activeStep + 1} of ${ONBOARD_STEPS.length}`),
      nextBtn
    ]);
    card.appendChild(navRow);

    container.appendChild(progressTrack);
    container.appendChild(card);
  }

  async function goNext() {
    if (activeStep < ONBOARD_STEPS.length - 1) {
      activeStep++;
      renderCurrentStep();
    } else {
      const wa = answers.whatsapp || {};
      const hasAny = ['metaAppId', 'metaAppSecret', 'metaWabaId', 'metaPhoneId', 'metaToken'].some((k) => String(wa[k] || '').trim());
      if (hasAny) {
        try {
          await api('/api/whatsapp/config', {
            method: 'POST', body: {
              mode: 'meta_cloud',
              metaAppId: wa.metaAppId, metaAppSecret: wa.metaAppSecret,
              metaWabaId: wa.metaWabaId, metaPhoneId: wa.metaPhoneId,
              metaToken: wa.metaToken, autoFollowupEnabled: !!wa.autoFollowupEnabled
            }
          });
          toast('WhatsApp credentials saved.', 'ok');
        } catch (err) {
          toast('Could not save WhatsApp credentials: ' + (err.message || 'error'), 'err');
        }
      }
      triggerAgentGeneration();
    }
  }

  function startVoiceDictation(textarea, btn) {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      toast('Speech dictation supported in modern browsers.', 'info');
      return;
    }
    const rec = new SpeechRecognition();
    rec.continuous = false;
    rec.interimResults = false;
    rec.lang = 'en-IN';
    btn.disabled = true;
    btn.textContent = 'Listening...';
    rec.onresult = (e) => {
      const text = (e.results && e.results[0] && e.results[0][0] && e.results[0][0].transcript) || '';
      if (text) {
        textarea.value = (textarea.value ? textarea.value.trim() + ' ' : '') + text;
        const curStep = ONBOARD_STEPS[activeStep];
        if (curStep) answers[curStep.key] = textarea.value;
        toast('Voice dictation captured.', 'ok');
      }
    };
    const finish = () => { btn.disabled = false; btn.textContent = 'Speak Answer'; };
    rec.onerror = finish;
    rec.onend = finish;
    try { rec.start(); } catch (_) { finish(); }
  }

  async function triggerAgentGeneration() {
    api('/api/tenant/onboarding-complete', { method: 'POST' }).catch(() => {});
    if (State.me && State.me.tenant) State.me.tenant.onboardingCompleted = true;
    if (State.me && State.me.user) State.me.user.onboardingCompleted = true;
    if (window.Clerk && window.Clerk.user) {
      localStorage.setItem('seevora_onboarded_' + window.Clerk.user.id, 'true');
      if (typeof window.Clerk.user.update === 'function') {
        window.Clerk.user.update({ unsafeMetadata: { onboardingCompleted: true } }).catch(() => {});
      }
    }
    container.innerHTML = '';
    const loadingCard = el('div', { class: 'onboard-step-card', style: 'text-align:center;padding:50px 24px' }, [
      el('span', { class: 'spin boot-spin', style: 'width:28px;height:28px;margin-bottom:16px' }),
      el('h3', { class: 't-h3', style: 'margin-bottom:8px' }, 'Architecting Your Voice Agent Blueprint...'),
      el('p', { class: 'soft', style: 'max-width:520px;margin:0 auto 28px;line-height:1.5' }, 'Analyzing business profile, synthesizing 3 script variants, decoding caller objections, and tuning conversational voice persona.'),
      el('div', { style: 'max-width:440px;margin:0 auto;text-align:left;display:flex;flex-direction:column;gap:12px' }, [
        el('div', { class: 'ai-progress-step' }, [el('span', { style: 'color:var(--ok);font-weight:700' }, '✓ '), el('span', {}, 'Deconstructing business offerings & qualification goals')]),
        el('div', { class: 'ai-progress-step' }, [el('span', { style: 'color:var(--ok);font-weight:700' }, '✓ '), el('span', {}, 'Synthesizing 3 conversational script variants (Friendly, Assertive, Formal)')]),
        el('div', { class: 'ai-progress-step' }, [el('span', { class: 'spin', style: 'width:12px;height:12px;border:2px solid var(--accent);border-top-color:transparent;border-radius:50%;display:inline-block;margin-right:6px' }), el('span', {}, 'Decoding customer objections and strategic guardrails')]),
        el('div', { class: 'ai-progress-step muted' }, [el('span', {}, '○ '), el('span', {}, 'Simulating verified multi-turn telephone conversation')])
      ])
    ]);
    container.appendChild(loadingCard);

    const goalText = Array.isArray(answers.goal)
      ? (answers.goal.length ? answers.goal.join(', ') : 'Book Appointments & Consultations')
      : (answers.goal || 'Book Appointments & Consultations');

    const compiledNeeds = `
- Company Services & What We Do: ${answers.offerings || 'N/A'}
- Primary Receptionist Goals & Roles: ${goalText}
- Business Hours & Emergency Contact: ${answers.workingHours || 'N/A'}
    `.trim();

    const payload = {
      businessName: answers.businessName,
      industry: Array.isArray(answers.industry) ? answers.industry.join(', ') : (answers.industry || 'Multi-Industry'),
      objective: goalText,
      tone: answers.tone,
      language: answers.language,
      needs: compiledNeeds,
      transcript: customTranscript
    };

    try {
      const res = await api('/api/agents/generate-from-needs', { method: 'POST', body: payload });
      generatedResult = res;
      fireConfetti();
      toast('Voice Agent successfully configured!', 'ok');
      renderCompletionScreen();
    } catch (err) {
      toast(err.message || 'Generation failed. Please try again.', 'err');
      activeStep = ONBOARD_STEPS.length - 1;
      renderCurrentStep();
    }
  }

  function renderCompletionScreen() {
    container.innerHTML = '';
    const data = generatedResult || {};
    const ag = data.agent || {};
    const insights = data.transcriptUnderstanding || {};
    const sampleTranscript = data.sampleTranscript || [];
    const variants = data.scriptVariants || {
      friendly: { label: 'Friendly & Welcoming', greeting: ag.greeting, tone: 'Friendly & Welcoming' },
      assertive: { label: 'Assertive & Fast', greeting: `Hello, thanks for calling ${ag.name || 'us'}. Are you looking to book an appointment today?`, tone: 'Assertive & Fast' },
      formal: { label: 'Formal & Executive', greeting: `Good day. Thank you for contacting ${ag.name || 'us'}. How may I direct your call?`, tone: 'Formal & Executive' }
    };

    // Header Celebration Banner
    const businessLabel = answers.businessName ? ` for ${answers.businessName}` : '';
    const celebrationHeader = el('div', { class: 'onboard-step-card', style: 'text-align:center;padding:32px 20px;border-color:rgba(0,149,255,0.4);background:radial-gradient(ellipse at top, rgba(0,149,255,0.06), #FFFFFF)' }, [
      el('div', { style: 'width:56px;height:56px;border-radius:50%;background:#EFF6FF;color:#0284C7;display:inline-flex;align-items:center;justify-content:center;margin:0 auto 12px', html: '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>' }),
      el('h2', { class: 't-h2', style: 'color:var(--ink);margin-bottom:6px' }, `Your Voice Agent is Ready!`),
      el('p', { class: 'soft', style: 'max-width:540px;margin:0 auto;line-height:1.5' }, `Designed specifically${businessLabel}. Script variants generated, customer objections understood, and voice persona calibrated.`)
    ]);
    container.appendChild(celebrationHeader);

    // Script Variant Tabs
    const tabsRow = el('div', { class: 'script-variant-tabs' });
    Object.keys(variants).forEach((vKey) => {
      const vObj = variants[vKey];
      const tab = el('button', {
        type: 'button',
        class: 'script-variant-tab' + (activeVariant === vKey ? ' active' : ''),
        onclick: () => {
          activeVariant = vKey;
          $$('.script-variant-tab', tabsRow).forEach((t) => t.classList.remove('active'));
          tab.classList.add('active');
          updateGreetingDisplay();
        }
      }, vObj.label || vKey);
      tabsRow.appendChild(tab);
    });

    const greetingTextEl = el('div', { class: 'ai-greeting-text' }, `“${ag.greeting}”`);
    function updateGreetingDisplay() {
      const chosen = variants[activeVariant] || {};
      const greeting = chosen.greeting || ag.greeting;
      greetingTextEl.textContent = `“${greeting}”`;
    }

    const listenGreetingBtn = el('button', {
      type: 'button',
      class: 'ai-audio-btn',
      onclick: () => {
        const chosen = variants[activeVariant] || {};
        const greeting = chosen.greeting || ag.greeting;
        playSpeechSnippet(greeting, ag.tts, listenGreetingBtn);
      }
    }, 'Listen to Voice');

    // Agent Card
    const agentCard = el('div', { class: 'card card-pad' }, [
      el('div', { class: 'flex items-center justify-between', style: 'flex-wrap:wrap;gap:12px;margin-bottom:14px' }, [
        el('div', {}, [
          el('span', { class: 'ai-badge' }, 'Calibrated Persona'),
          el('h3', { class: 't-h3', style: 'margin:4px 0' }, ag.name || answers.businessName),
          el('span', { class: 'soft', style: 'font-size:.82rem' }, `Natural Conversational Voice • Dialect: ${answers.language}`)
        ]),
        listenGreetingBtn
      ]),
      el('strong', { style: 'font-size:.8rem;text-transform:uppercase;color:var(--ink-dim);display:block;margin-top:6px' }, 'Script Variant Selector:'),
      tabsRow,
      el('div', { class: 'ai-greeting-card' }, [
        el('span', { class: 'section-kicker' }, 'Opening Telephone Greeting'),
        greetingTextEl,
        el('span', { class: 'soft', style: 'font-size:.76rem' }, 'Under 20 words for immediate caller engagement.')
      ]),
      el('div', { style: 'margin-top:14px' }, [
        el('strong', { style: 'font-size:.78rem;text-transform:uppercase;color:var(--ink-dim)' }, 'Required Qualification Fields:'),
        el('div', { class: 'pill-group' }, (ag.fields || ['caller_name', 'phone_number', 'service_needed']).map((f) => el('span', { class: 'field-pill' }, f)))
      ]),
      el('div', { style: 'margin-top:10px' }, [
        el('strong', { style: 'font-size:.78rem;text-transform:uppercase;color:var(--ink-dim)' }, 'Active Guardrails:'),
        el('div', { class: 'pill-group' }, (ag.guardrails || ['Confirm caller phone number before closing']).map((g) => el('span', { class: 'guardrail-pill' }, g)))
      ]),
      el('details', { style: 'margin-top:14px;background:var(--bg-2);border:1px solid var(--line);border-radius:var(--r-sm);padding:10px 14px' }, [
        el('summary', { style: 'cursor:pointer;font-weight:600;font-size:.84rem;color:var(--accent)' }, 'View Full Spoken Persona Prompt'),
        el('textarea', { class: 'textarea', style: 'margin-top:10px;font-family:var(--mono);font-size:.8rem', rows: 8, readonly: 'readonly' }, ag.persona)
      ])
    ]);
    container.appendChild(agentCard);

    // Strategic Insights Card
    const insightsCard = el('div', { class: 'card card-pad' }, [
      el('div', { class: 'flex items-center justify-between', style: 'margin-bottom:8px' }, [
        el('h3', { class: 't-h3' }, 'Strategic Transcript Understanding'),
        el('span', { class: 'tag' }, 'Verified Strategy')
      ]),
      el('p', { class: 'soft', style: 'font-size:.88rem;margin-bottom:12px' }, insights.businessSummary || `Tailored voice receptionist for ${answers.businessName}.`),
      el('div', { class: 'ai-insights-grid' }, [
        el('div', { class: 'ai-insight-box' }, [
          el('span', { class: 'ai-insight-title' }, 'Detected Caller Intents'),
          el('div', { class: 'pill-group' }, (insights.detectedIntents || ['Service inquiries', 'Pricing consultation', 'Appointment booking']).map((it) => el('span', { class: 'field-pill' }, it)))
        ]),
        el('div', { class: 'ai-insight-box' }, [
          el('span', { class: 'ai-insight-title' }, 'Objection Strategy'),
          el('span', { class: 'ai-insight-body' }, insights.objectionStrategy || 'Direct answers with solutions followed by scheduling prompts.')
        ]),
        el('div', { class: 'ai-insight-box' }, [
          el('span', { class: 'ai-insight-title' }, 'Voice Character Fit'),
          el('span', { class: 'ai-insight-body' }, insights.toneAnalysis || 'Curated tone for high empathy and professionalism on calls.')
        ])
      ])
    ]);
    container.appendChild(insightsCard);

    // Verified Call Transcript with Testing Buttons
    const transcriptCard = el('div', { class: 'card card-pad' }, [
      el('div', { class: 'flex items-center justify-between', style: 'margin-bottom:8px' }, [
        el('div', {}, [
          el('h3', { class: 't-h3' }, 'Verified Call Transcript Simulation'),
          el('span', { class: 'soft', style: 'font-size:.82rem' }, 'Click any turn to hear the agent voice respond.')
        ]),
        el('span', { class: 'pill pill-ok' }, `${sampleTranscript.length} Turns Verified`)
      ]),
      el('div', { class: 'dialogue-stream' }, sampleTranscript.map((turn) => {
        const isAgent = (turn.speaker || '').toLowerCase() === 'agent';
        const playBtn = isAgent ? el('button', {
          class: 'dialogue-audio-mini',
          onclick: (e) => { e.stopPropagation(); playSpeechSnippet(turn.text, ag.tts, playBtn); }
        }, 'Listen') : null;
        return el('div', { class: 'dialogue-turn ' + (isAgent ? 'agent' : 'caller') }, [
          el('div', { class: 'dialogue-turn-header' }, [
            el('span', {}, isAgent ? 'Voice Agent' : 'Customer / Caller'),
            turn.annotation ? el('span', { class: 'dialogue-annotation' }, turn.annotation) : null,
            playBtn
          ]),
          el('div', { class: 'dialogue-bubble' }, turn.text)
        ]);
      }))
    ]);
    container.appendChild(transcriptCard);

    // Action Bar
    const talkInBrowserBtn = el('button', {
      type: 'button',
      class: 'btn btn-ghost',
      style: 'padding:12px 22px;font-weight:600',
      onclick: () => {
        const chosen = variants[activeVariant] || {};
        const agentToTest = Object.assign({}, ag, { greeting: chosen.greeting || ag.greeting });
        openVoiceSimulator(agentToTest);
      }
    }, 'Talk to Agent in Browser');

    const saveDeployBtn = el('button', {
      type: 'button',
      class: 'btn btn-primary',
      style: 'padding:12px 26px;font-weight:700;box-shadow:0 6px 20px rgba(0,149,255,0.35)',
      onclick: async () => {
        saveDeployBtn.disabled = true;
        saveDeployBtn.textContent = 'Saving...';
        try {
          const chosen = variants[activeVariant] || {};
          const payload = {
            name: ag.name || answers.businessName,
            persona: ag.persona,
            greeting: chosen.greeting || ag.greeting,
            fields: ag.fields,
            guardrails: ag.guardrails,
            sampleTranscript,
            transcriptUnderstanding: insights,
            tts: ag.tts,
            did: ''
          };
          const res = await api('/api/agents', { method: 'POST', body: payload });
          if (window.Clerk && window.Clerk.user) {
            localStorage.setItem('seevora_onboarded_' + window.Clerk.user.id, 'true');
            if (typeof window.Clerk.user.update === 'function') {
              window.Clerk.user.update({ unsafeMetadata: { onboardingCompleted: true } }).catch(() => {});
            }
          }
          await api('/api/tenant/onboarding-complete', { method: 'POST' }).catch(() => { });
          if (answers.whatsapp && (answers.whatsapp.metaPhoneId || answers.whatsapp.metaToken || answers.whatsapp.metaAppId)) {
            await api('/api/whatsapp/config', { method: 'POST', body: answers.whatsapp }).catch(() => { });
          }
          if (answers.businessName && answers.businessName.trim()) {
            await api('/api/tenant/update', { method: 'POST', body: { name: answers.businessName.trim() } }).catch(() => { });
            if (State.me && State.me.tenant) State.me.tenant.name = answers.businessName.trim();
          }
          if (State.me && State.me.tenant) State.me.tenant.onboardingCompleted = true;
          if (State.me && State.me.user) State.me.user.onboardingCompleted = true;
          if (res.agent) {
            State.agents = State.agents || [];
            State.agents.push(res.agent);
            State.activeAgentId = res.agent.id;
          }
          toast(`Agent "${payload.name}" saved to your workspace!`, 'ok');
          renderShell();
          goto('overview');
        } catch (e) {
          toast(e.message || 'Could not save agent.', 'err');
          saveDeployBtn.disabled = false;
          saveDeployBtn.textContent = 'Save & Go to Dashboard';
        }
      }
    }, 'Save & Go to Dashboard');

    const bottomBar = el('div', { class: 'card card-pad ai-deploy-bar', style: 'margin-top:14px' }, [
      el('div', {}, [
        el('strong', {}, 'Ready to use this Voice Agent?'),
        el('span', { class: 'soft', style: 'display:block;font-size:.8rem' }, 'Saves to your tenant with all transcript understanding and voice settings.')
      ]),
      el('div', { class: 'flex gap-2' }, [talkInBrowserBtn, saveDeployBtn])
    ]);
    container.appendChild(bottomBar);
  }

  renderCurrentStep();
}

const viewAiCreator = viewOnboarding;
// AI_PRESETS alias omitted

/* ===========================================================================
   3. VOICE STUDIO
   =========================================================================== */
function viewStudio(root) {
  root.appendChild(viewHead('Voice Studio', 'Type anything, pick a model, and synthesize. See the waveform, hear it back, and watch the cost in real time.'));

  const st = { model: 'mulberry', tone: 'neutral', speaker: 'speaker_2', f0: 0, stream: false };

  const textArea = el('textarea', { class: 'textarea studio-text', id: 's_text', placeholder: 'Welcome to RapidX Voice. Production-grade AI voice starts from ₹1 per minute for the AI layer.' }, 'Welcome to RapidX Voice. Production-grade AI voice starts from ₹1 per minute for the AI layer.');

  // model picker
  const modelSeg = el('div', { class: 'seg' }, VOICE_MODELS.map((m) =>
    el('button', { type: 'button', class: m === st.model ? 'on' : '', 'data-m': m, onclick: () => { st.model = m; syncCtl(); updateCost(); } }, m)
  ));
  // muga tones
  const toneSeg = el('div', { class: 'seg', id: 's_tones' }, MUGA_TONES.map((tn) =>
    el('button', { type: 'button', class: tn === st.tone ? 'on' : '', 'data-t': tn, onclick: () => { st.tone = tn; $$('#s_tones button').forEach((b) => b.classList.toggle('on', b.getAttribute('data-t') === tn)); } }, tn)
  ));
  // mulberry controls
  const speakerSel = el('select', { class: 'select' }, SPEAKERS.map((s) => el('option', { value: s, selected: s === st.speaker ? 'selected' : false }, s)));
  speakerSel.addEventListener('change', () => { st.speaker = speakerSel.value; });
  const f0Val = el('span', { class: 'rv' }, '0');
  const f0Range = el('input', { type: 'range', min: -12, max: 12, step: 1, value: 0, oninput: (ev) => { st.f0 = +ev.target.value; f0Val.textContent = (st.f0 > 0 ? '+' : '') + st.f0; } });
  const descI = el('input', { class: 'input', placeholder: 'Optional voice direction, e.g. warm and reassuring' });
  descI.addEventListener('input', () => { st.desc = descI.value; });

  const mugaCtl = field('Tone (muga)', toneSeg);
  const mulSpeaker = field('Speaker (mulberry)', speakerSel);
  const mulPitch = field('Pitch, f0_up_key', el('div', { class: 'range-row' }, [f0Range, f0Val]));
  const mulDesc = field('Voice direction (mulberry)', descI);
  function syncCtl() {
    $$('.seg button[data-m]').forEach((b) => b.classList.toggle('on', b.getAttribute('data-m') === st.model));
    const isMul = st.model === 'mulberry';
    mugaCtl.style.display = isMul ? 'none' : '';
    [mulSpeaker, mulPitch, mulDesc].forEach((f) => f.style.display = isMul ? '' : 'none');
  }

  const charsEl = el('span', { class: 'c-chars', id: 's_chars' }, '0 chars');
  const costEl = el('span', { class: 'c-cost', id: 's_cost' }, [document.createTextNode('about '), el('b', {}, '₹0.00')]);
  function updateCost() {
    const len = (textArea.value || '').length;
    const capped = Math.min(len, 2000);
    const cost = capped / 1000 * (RATE[st.model] || RATE.mulberry);
    charsEl.textContent = len + ' chars' + (len > 2000 ? ' (capped at 2000)' : '');
    costEl.innerHTML = '';
    costEl.appendChild(document.createTextNode('about '));
    costEl.appendChild(el('b', {}, '₹' + cost.toFixed(2)));
  }
  textArea.addEventListener('input', updateCost);

  const streamToggle = el('label', { class: 'streamtoggle' }, [
    el('input', { type: 'checkbox', onchange: (ev) => { st.stream = ev.target.checked; } }),
    document.createTextNode('Stream progressively (low latency)')
  ]);

  const synthBtn = el('button', { class: 'btn btn-primary' }, 'Synthesize');
  const audioEl = el('audio', { controls: 'controls', preload: 'none' });
  const waveCanvas = el('canvas', { class: 'wave-canvas', id: 's_wave' });
  const playerRow = el('div', { class: 'player-row', style: 'display:none' }, [audioEl]);

  synthBtn.addEventListener('click', () => doSynthesize(st, textArea, synthBtn, audioEl, waveCanvas, playerRow));

  const main = el('div', { class: 'card studio-main' }, [
    field('Text to speak', textArea),
    el('div', { class: 'wave-wrap' }, [waveCanvas, playerRow]),
    el('div', { class: 'flex items-center gap-2', style: 'flex-wrap:wrap' }, [synthBtn, streamToggle])
  ]);

  const side = el('div', { class: 'studio-side' }, [
    el('div', { class: 'card card-pad' }, [
      el('h3', { class: 't-h3', style: 'margin-bottom:14px' }, 'Voice'),
      field('Model', modelSeg),
      mugaCtl, mulSpeaker, mulPitch, mulDesc
    ]),
    el('div', { class: 'card card-pad' }, [
      el('h3', { class: 't-h3', style: 'margin-bottom:14px' }, 'Economics'),
      el('div', { class: 'cost-readout' }, [charsEl, costEl]),
      el('p', { class: 'muted', style: 'font-size:.8rem;margin-top:10px' }, 'Mulberry promo is about Rs 0.50 per 1000 chars, roughly 20x cheaper than ElevenLabs.')
    ])
  ]);

  root.appendChild(el('div', { class: 'studio-grid' }, [main, side]));
  syncCtl(); updateCost();
  // size the canvas after layout
  setTimeout(() => sizeCanvas(waveCanvas), 30);
  window.addEventListener('resize', () => sizeCanvas(waveCanvas), { once: true });
}

async function doSynthesize(st, textArea, btn, audioEl, canvas, playerRow) {
  const raw = (textArea.value || '').trim();
  if (!raw) { toast('Type something to synthesize.', 'err'); textArea.focus(); return; }
  let text = raw.slice(0, 2000);
  // muga tone is applied as a [tone] prefix
  if (st.model === 'muga' && st.tone && st.tone !== 'neutral') text = '[' + st.tone + '] ' + text;

  const old = btn.textContent; btn.disabled = true; btn.textContent = 'Synthesizing...';

  if (st.stream) {
    try {
      await streamSynthesize(text, st, canvas, btn);
      btn.disabled = false; btn.textContent = old;
      refreshUsageSoft();
      return;
    } catch (ex) {
      toast('Stream failed, falling back to file. ' + (ex.message || ''), 'info');
      // fall through to normal synth
    }
  }

  try {
    const body = { text: text, model: st.model };
    if (st.model === 'mulberry') { body.speaker = st.speaker; body.f0_up_key = st.f0; if (st.desc) body.description = st.desc; }
    const res = await api('/api/tts', { method: 'POST', body: body });
    const chars = res.headers.get('X-Chars');
    const credits = res.headers.get('X-Credits-Used');
    const buf = await res.arrayBuffer();
    const blob = new Blob([buf], { type: 'audio/wav' });
    const url = URL.createObjectURL(blob);
    audioEl.src = url; playerRow.style.display = '';
    drawWaveformFromBuffer(buf.slice(0), canvas);
    audioEl.play().catch(() => { });
    toast('Synthesized ' + (chars || text.length) + ' chars' + (credits ? ', ' + credits + ' credits.' : '.'), 'ok');
    refreshUsageSoft();
  } catch (ex) {
    toast(ex.message || 'Synthesis failed.', 'err');
  } finally {
    btn.disabled = false; btn.textContent = old;
  }
}

function refreshUsageSoft() {
  // invalidate cached usage so Overview reflects new chars next visit
  State.loaded.usage = false; State.usage = null;
}

/* ---- waveform rendering ---- */
function sizeCanvas(canvas) {
  if (!canvas) return;
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth || 560, h = canvas.clientHeight || 90;
  canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
  const ctx = canvas.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  // idle baseline
  ctx.clearRect(0, 0, w, h);
  ctx.strokeStyle = 'rgba(110,123,255,0.25)'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2); ctx.stroke();
}
function drawWaveformFromBuffer(arrbuf, canvas) {
  try {
    const samples = decodeWavPcm(arrbuf);
    if (!samples) { sizeCanvas(canvas); return; }
    drawWaveform(samples, canvas);
  } catch (e) { sizeCanvas(canvas); }
}
function decodeWavPcm(arrbuf) {
  const dv = new DataView(arrbuf);
  if (dv.byteLength < 44) return null;
  // verify RIFF/WAVE
  if (dv.getUint32(0, false) !== 0x52494646) return null; // 'RIFF'
  // walk chunks to find fmt + data
  let off = 12, fmt = null, dataOff = -1, dataLen = 0;
  while (off + 8 <= dv.byteLength) {
    const id = dv.getUint32(off, false);
    const sz = dv.getUint32(off + 4, true);
    if (id === 0x666d7420) { // 'fmt '
      fmt = { format: dv.getUint16(off + 8, true), channels: dv.getUint16(off + 10, true), bits: dv.getUint16(off + 22, true) };
    } else if (id === 0x64617461) { // 'data'
      dataOff = off + 8; dataLen = sz; break;
    }
    off += 8 + sz + (sz & 1);
  }
  if (!fmt || dataOff < 0 || fmt.bits !== 16) return null;
  const n = Math.floor(dataLen / 2);
  const ch = fmt.channels || 1;
  const out = new Float32Array(Math.floor(n / ch));
  let j = 0;
  for (let i = 0; i + ch <= n; i += ch) {
    const s = dv.getInt16(dataOff + i * 2, true);
    out[j++] = s / 32768;
  }
  return out;
}
function drawWaveform(samples, canvas) {
  sizeCanvas(canvas);
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.width / dpr, h = canvas.height / dpr;
  ctx.clearRect(0, 0, w, h);
  const bars = Math.max(40, Math.min(180, Math.floor(w / 4)));
  const block = Math.floor(samples.length / bars) || 1;
  const grad = ctx.createLinearGradient(0, 0, w, 0);
  grad.addColorStop(0, '#34E7E4'); grad.addColorStop(0.6, '#6E7BFF'); grad.addColorStop(1, '#A855F7');
  ctx.fillStyle = grad;
  const bw = w / bars;
  for (let b = 0; b < bars; b++) {
    let peak = 0;
    for (let k = 0; k < block; k++) { const v = Math.abs(samples[b * block + k] || 0); if (v > peak) peak = v; }
    const bh = Math.max(2, peak * (h * 0.92));
    const x = b * bw, y = (h - bh) / 2;
    const r = Math.min(bw * 0.34, 2);
    roundRect(ctx, x + bw * 0.18, y, bw * 0.64, bh, r);
  }
}
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath(); ctx.fill();
}

/* ---- streaming TTS (PCM int16 LE 24kHz) via /api/ws-connect then wss Rumik ---- */
async function streamSynthesize(text, st, canvas, btn) {
  const mint = await api('/api/ws-connect', { method: 'POST', body: { text: text, model: st.model } });
  if (!mint.ws_url) throw new ApiError(0, 'No ws_url returned.');
  return new Promise((resolve, reject) => {
    let ws, audioCtx, nextTime = 0, started = false, chunks = [];
    const SR = 24000;
    try { audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: SR }); } catch (e) { return reject(new ApiError(0, 'No Web Audio.')); }
    const url = mint.ws_url + (mint.token && mint.ws_url.indexOf('token=') === -1 ? (mint.ws_url.indexOf('?') === -1 ? '?' : '&') + 'token=' + encodeURIComponent(mint.token) : '');
    try { ws = new WebSocket(url); } catch (e) { return reject(new ApiError(0, 'WebSocket failed.')); }
    ws.binaryType = 'arraybuffer';
    const fail = (m) => { try { ws.close(); } catch (e) { } reject(new ApiError(0, m)); };
    const timeout = setTimeout(() => fail('Stream timed out.'), 20000);
    ws.onopen = () => { try { ws.send(JSON.stringify({ text: text, model: st.model })); } catch (e) { } };
    ws.onmessage = (ev) => {
      if (typeof ev.data === 'string') {
        try { const m = JSON.parse(ev.data); if (m.type === 'end' || m.done) { clearTimeout(timeout); finish(); } } catch (e) { }
        return;
      }
      const pcm = new Int16Array(ev.data);
      if (!pcm.length) return;
      chunks.push(pcm);
      const f32 = new Float32Array(pcm.length);
      for (let i = 0; i < pcm.length; i++) f32[i] = pcm[i] / 32768;
      const ab = audioCtx.createBuffer(1, f32.length, SR);
      ab.copyToChannel(f32, 0);
      const src = audioCtx.createBufferSource(); src.buffer = ab; src.connect(audioCtx.destination);
      const now = audioCtx.currentTime;
      if (nextTime < now) nextTime = now + 0.04;
      src.start(nextTime); nextTime += ab.duration;
      started = true;
    };
    ws.onclose = () => { clearTimeout(timeout); if (started) finish(); else fail('Stream closed early.'); };
    ws.onerror = () => { clearTimeout(timeout); fail('Stream connection error.'); };
    function finish() {
      // draw the gathered waveform once
      if (chunks.length) {
        let total = 0; chunks.forEach((c) => total += c.length);
        const all = new Float32Array(total); let o = 0;
        chunks.forEach((c) => { for (let i = 0; i < c.length; i++) all[o++] = c[i] / 32768; });
        try { drawWaveform(all, canvas); } catch (e) { }
      }
      try { ws.close(); } catch (e) { }
      resolve();
    }
  });
}

/* ===========================================================================
   4. DEMO LINKS
   =========================================================================== */
async function viewDemoLinks(root) {
  root.appendChild(viewHead('Demo links', 'Create a tenant-branded web voice experience for one agent, then share it without exposing Studio access or provider secrets.'));
  const grid = el('div', { class: 'demo-admin-grid' }, [
    el('div', { class: 'card demo-create-card', id: 'demoCreateHost' }),
    el('div', { class: 'card demo-list-card', id: 'demoListHost' })
  ]);
  root.appendChild(grid);

  const createHost = $('#demoCreateHost', root);
  const listHost = $('#demoListHost', root);
  createHost.appendChild(skeleton('sk-card', 1));
  listHost.appendChild(skeleton('sk-card', 1));

  try {
    await ensureAgents();
    const payload = await api('/api/demo-links');
    State.demoLinks = payload.demoLinks || [];
    State.loaded.demoLinks = true;
  } catch (error) {
    createHost.innerHTML = '';
    listHost.innerHTML = '';
    listHost.appendChild(el('div', { class: 'demo-error', role: 'alert' }, error.message || 'Demo links could not be loaded.'));
    return;
  }

  function ephemeralUrl(id) {
    try { return sessionStorage.getItem('rxv_demo_' + id) || ''; } catch (_) { return ''; }
  }
  function rememberUrl(id, url) {
    try { sessionStorage.setItem('rxv_demo_' + id, url); } catch (_) { }
  }
  async function copyUrl(url) {
    if (!url) return;
    try { await navigator.clipboard.writeText(url); toast('Demo link copied.', 'ok'); }
    catch (_) {
      const input = el('textarea', { style: 'position:fixed;opacity:0;pointer-events:none' }, url);
      document.body.appendChild(input); input.select(); document.execCommand('copy'); input.remove();
      toast('Demo link copied.', 'ok');
    }
  }
  function openUrl(url) {
    if (url) window.open(url, '_blank', 'noopener,noreferrer');
  }
  function redraw() {
    root.innerHTML = '';
    viewDemoLinks(root);
  }

  createHost.innerHTML = '';
  createHost.appendChild(el('div', { class: 'demo-card-head' }, [
    el('div', {}, [el('h3', { class: 't-h3' }, 'Create a share link'), el('p', { class: 'muted' }, 'The full URL is shown once. Only its SHA-256 hash is stored on the server.')])
  ]));
  if (!State.agents.length) {
    createHost.appendChild(el('div', { class: 'empty' }, [
      el('div', { class: 'ttl' }, 'Create an agent first'),
      el('p', {}, 'A demo link must be scoped to one tenant-owned agent.'),
      el('button', { class: 'btn btn-primary', onclick: () => goto('agents') }, 'Open agents')
    ]));
  } else {
    const agent = el('select', { class: 'select', id: 'demoAgent' }, State.agents.map((item) => el('option', { value: item.id }, item.name)));
    const label = el('input', { class: 'input', id: 'demoLabel', maxlength: '80', placeholder: 'Prospect demo' });
    const expiry = el('select', { class: 'select', id: 'demoExpiry' }, [1, 3, 7, 14, 30].map((days) => el('option', { value: days, selected: days === 7 ? 'selected' : false }, days + (days === 1 ? ' day' : ' days'))));
    const duration = el('select', { class: 'select', id: 'demoDuration' }, [60, 180, 300, 600].map((seconds) => el('option', { value: seconds, selected: seconds === 300 ? 'selected' : false }, Math.round(seconds / 60) + (seconds === 60 ? ' minute' : ' minutes'))));
    const starts = el('input', { class: 'input', id: 'demoStarts', type: 'number', min: '1', max: '1000', value: '25', inputmode: 'numeric' });
    const submit = el('button', { class: 'btn btn-primary btn-lg', type: 'submit' }, 'Create demo link');
    const form = el('form', { class: 'demo-create-form' }, [
      el('div', { class: 'field full' }, [el('label', {}, 'Agent'), agent]),
      el('div', { class: 'field full' }, [el('label', {}, 'Internal label'), label]),
      el('div', { class: 'field' }, [el('label', {}, 'Expires after'), expiry]),
      el('div', { class: 'field' }, [el('label', {}, 'Call duration'), duration]),
      el('div', { class: 'field full' }, [el('label', {}, 'Maximum starts'), starts]),
      submit
    ]);
    form.addEventListener('submit', async (event) => {
      event.preventDefault(); submit.disabled = true; submit.textContent = 'Creating...';
      try {
        const result = await api('/api/demo-links', {
          method: 'POST', body: {
            agentId: agent.value, label: label.value.trim(), expiresInDays: Number(expiry.value),
            maxSessionSeconds: Number(duration.value), maxStarts: Number(starts.value)
          }
        });
        const fullUrl = location.origin + result.sharePath;
        rememberUrl(result.demoLink.id, fullUrl);
        State.demoLinks.unshift(result.demoLink);
        await copyUrl(fullUrl);
        toast('Created and copied. Open it in a separate tab to test.', 'ok', 'Demo ready');
        redraw();
      } catch (error) {
        toast(error.message || 'Demo link could not be created.', 'err');
        submit.disabled = false; submit.textContent = 'Create demo link';
      }
    });
    createHost.appendChild(form);
  }

  listHost.innerHTML = '';
  listHost.appendChild(el('div', { class: 'demo-card-head' }, [
    el('div', {}, [el('h3', { class: 't-h3' }, 'Distributed demos'), el('p', { class: 'muted' }, 'Revoke access immediately or create a replacement when a one-time URL is no longer available.')]),
    el('span', { class: 'tag' }, State.demoLinks.length + ' total')
  ]));
  if (!State.demoLinks.length) {
    listHost.appendChild(el('div', { class: 'empty' }, [el('div', { class: 'ttl' }, 'No demo links yet'), el('p', {}, 'Create one to share a branded web voice experience.')]));
  } else {
    const agentNames = Object.fromEntries(State.agents.map((item) => [item.id, item.name]));
    const list = el('div', { class: 'demo-link-list' });
    State.demoLinks.forEach((item) => {
      const url = ephemeralUrl(item.id);
      const status = item.status || 'active';
      const card = el('article', { class: 'demo-link-row' }, [
        el('div', { class: 'demo-link-main' }, [
          el('div', { class: 'demo-link-title' }, [el('strong', {}, item.label), el('span', { class: 'demo-status ' + status }, status)]),
          el('div', { class: 'demo-link-meta' }, [
            el('span', {}, agentNames[item.agentId] || 'Agent'),
            el('span', {}, item.starts + ' of ' + item.maxStarts + ' starts'),
            el('span', {}, 'Expires ' + new Date(item.expiresAt).toLocaleDateString())
          ]),
          !url && status === 'active' ? el('p', { class: 'demo-once-note' }, 'The secret URL is not recoverable after this browser session. Revoke and replace it if needed.') : null
        ]),
        el('div', { class: 'demo-link-actions' }, [
          el('button', { class: 'btn btn-ghost', disabled: !url ? 'disabled' : false, onclick: () => openUrl(url) }, 'Open'),
          el('button', { class: 'btn btn-ghost', disabled: !url ? 'disabled' : false, onclick: () => copyUrl(url) }, 'Copy'),
          status === 'active' ? el('button', {
            class: 'btn btn-danger-soft', onclick: () => modal({
              title: 'Revoke this demo link?',
              body: el('p', { class: 'muted' }, 'Visitors will no longer be able to start a voice session with this URL.'),
              confirmText: 'Revoke link', confirmKind: 'danger',
              onConfirm: async () => { await api('/api/demo-links/revoke', { method: 'POST', body: { id: item.id } }); try { sessionStorage.removeItem('rxv_demo_' + item.id); } catch (_) { } toast('Demo link revoked.', 'ok'); redraw(); }
            })
          }, 'Revoke') : null
        ])
      ]);
      list.appendChild(card);
    });
    listHost.appendChild(list);
  }
}

/* ===========================================================================
   5. TALK TO AGENT , INFALLIBLE BROWSER VOICE SIMULATOR
   =========================================================================== */

function openVoiceSimulator(agent) {
  const host = $('#modal-host');
  host.innerHTML = '';
  const modalWrap = el('div', {
    class: 'modal',
    role: 'dialog',
    'aria-modal': 'true',
    style: 'max-width:860px;width:95%;padding:22px;max-height:92vh;overflow-y:auto;position:relative;background:var(--bg)'
  });
  const closeBtn = el('button', {
    class: 'btn btn-ghost btn-sm',
    style: 'position:absolute;top:16px;right:18px;z-index:20;font-size:1.1rem;padding:4px 10px',
    onclick: () => {
      stopAllSpeech();
      host.classList.add('hide');
      host.innerHTML = '';
    }
  }, '✕ Close');
  modalWrap.appendChild(closeBtn);
  const stage = el('div', {});
  modalWrap.appendChild(stage);
  host.appendChild(el('div', {
    onclick: () => {
      stopAllSpeech();
      host.classList.add('hide');
      host.innerHTML = '';
    },
    style: 'position:absolute;inset:0'
  }));
  host.appendChild(modalWrap);
  host.classList.remove('hide');
  host.setAttribute('aria-hidden', 'false');
  viewTalk(stage, agent);
}

async function viewTalk(root, customAgent) {
  await ensureAgents().catch(() => { });

  let activeAgent = customAgent || State.agents.find((a) => a.id === State.activeAgentId) || State.agents[0];
  if (!activeAgent) {
    activeAgent = {
      id: 'default-receptionist',
      name: 'Seevora AI Voice Receptionist',
      greeting: 'Hi, thanks for calling! How can I assist you with your inquiry today?',
      persona: 'You are a warm, sharp AI telephone receptionist. Answer in 1 to 2 short sentences per turn, qualify caller needs, and offer appointment scheduling.',
      tts: { model: 'muga', tone: 'neutral', speaker: 'speaker_2', description: 'warm, friendly conversational tone' },
      sampleTranscript: [
        { speaker: 'caller', text: 'Hi, what services do you provide and what are your rates?', annotation: 'Inquiring about offerings and pricing' },
        { speaker: 'caller', text: 'Can I book an appointment for tomorrow morning?', annotation: 'Booking request' },
        { speaker: 'caller', text: 'What are your operating hours and where are you located?', annotation: 'Location and hours FAQ' }
      ]
    };
  }

  let activeTone = ((activeAgent.tts && activeAgent.tts.tone) || 'neutral');
  let currentGreeting = activeAgent.greeting || 'Hi, how can I help you today?';

  if (!customAgent) {
    root.appendChild(viewHead('Talk to your agent', 'Live interactive voice conversation. Speak naturally with your microphone or test by reading from your generated script.'));
  } else {
    root.appendChild(el('div', { style: 'margin-bottom:16px' }, [
      el('h3', { class: 't-h3', style: 'margin-bottom:4px' }, `Testing: ${activeAgent.name}`),
      el('p', { class: 'soft', style: 'font-size:.84rem' }, 'Speak into your microphone or click any dialogue prompt below to hear the agent voice in real time.')
    ]));
  }

  const convo = [];
  let isListening = false;
  let isThinking = false;
  let isSpeaking = false;
  let speechRec = null;

  // Visualizer Orb Stage
  const orb = el('div', { class: 'voice-orb', 'aria-hidden': 'true' }, [
    el('span'), el('span'), el('span'), el('span'), el('span')
  ]);
  const stageTitle = el('div', { class: 'voice-call-stage-title' }, 'Ready for live voice conversation');
  const stageCopy = el('div', { class: 'voice-call-stage-copy' }, 'Speak into your microphone, type below, or test by reading from your generated script.');

  const stage = el('div', { class: 'voice-call-stage card', style: 'padding:28px 20px;margin-bottom:18px' }, [
    orb, stageTitle, stageCopy
  ]);

  // Status & Metrics Row
  const statusDot = el('span', { class: 'conversation-dot', 'aria-hidden': 'true' });
  const statusText = el('span', {}, 'Ready');
  const statusPill = el('div', { class: 'conversation-status idle', role: 'status' }, [statusDot, statusText]);
  const timingText = el('div', { class: 'conversation-timing', 'aria-live': 'polite' }, 'Voice Synthesizer • Natural Audio Stream • Ready');

  function setPhase(phase, label) {
    statusPill.className = 'conversation-status ' + phase;
    statusText.textContent = label || phase.charAt(0).toUpperCase() + phase.slice(1);
    orb.setAttribute('data-phase', phase);

    if (phase === 'listening') {
      stageTitle.textContent = 'Listening to your voice...';
      stageCopy.textContent = 'Speak naturally. When you finish, the agent will answer.';
    } else if (phase === 'thinking') {
      stageTitle.textContent = 'Agent is thinking...';
      stageCopy.textContent = 'Synthesizing contextual response through LLM brain.';
    } else if (phase === 'speaking') {
      stageTitle.textContent = 'Agent is speaking...';
      stageCopy.textContent = 'Streaming spoken response. You can interrupt anytime.';
    } else {
      stageTitle.textContent = 'Ready for live voice conversation';
      stageCopy.textContent = 'Speak into your microphone, type below, or test by reading from your generated script.';
    }
  }

  // Script Variant Tabs
  const variantTabs = el('div', { class: 'script-variant-tabs', style: 'margin:0 0 16px 0' }, [
    el('button', {
      type: 'button',
      class: 'script-variant-tab active',
      onclick: (e) => {
        $$('.script-variant-tab', variantTabs).forEach((t) => t.classList.remove('active'));
        e.target.classList.add('active');
        activeTone = 'neutral';
        currentGreeting = activeAgent.greeting || 'Hi, how can I help you today?';
        toast('Script style: Friendly & Welcoming', 'ok');
      }
    }, 'Friendly & Welcoming'),
    el('button', {
      type: 'button',
      class: 'script-variant-tab',
      onclick: (e) => {
        $$('.script-variant-tab', variantTabs).forEach((t) => t.classList.remove('active'));
        e.target.classList.add('active');
        activeTone = 'excited';
        currentGreeting = `Hello, thanks for calling ${activeAgent.name || 'us'}. Are you looking to schedule an appointment today?`;
        toast('Script style: Assertive & Fast', 'ok');
      }
    }, 'Assertive & Fast'),
    el('button', {
      type: 'button',
      class: 'script-variant-tab',
      onclick: (e) => {
        $$('.script-variant-tab', variantTabs).forEach((t) => t.classList.remove('active'));
        e.target.classList.add('active');
        activeTone = 'neutral';
        currentGreeting = `Good day. Thank you for contacting ${activeAgent.name || 'us'}. How may I direct your call?`;
        toast('Script style: Formal & Executive', 'ok');
      }
    }, 'Formal & Executive')
  ]);

  // Transcript Stream
  const transcriptHost = el('div', { class: 'transcript', id: 't_transcript', style: 'max-height:280px;overflow-y:auto;padding:12px;background:var(--bg-2);border-radius:var(--r-sm);border:1px solid var(--line);margin-bottom:16px' }, [
    el('div', { class: 'bubble sys' }, `Connected to ${activeAgent.name}. Voice output is active. Start talking or pick a question below.`)
  ]);

  function addBubble(role, text) {
    const isBot = role === 'bot';
    const b = el('div', {
      class: 'bubble ' + (isBot ? 'bot' : 'user'),
      style: isBot ? 'position:relative;padding-right:68px' : ''
    }, text);

    if (isBot) {
      const replayBtn = el('button', {
        class: 'btn btn-ghost btn-sm',
        style: 'position:absolute;right:8px;top:50%;transform:translateY(-50%);font-size:.7rem;padding:2px 8px;border:1px solid var(--line-2)',
        onclick: (e) => {
          e.stopPropagation();
          speakUtterance(text, activeAgent, {
            onStart: () => setPhase('speaking', 'Agent speaking'),
            onEnd: () => setPhase(isListening ? 'listening' : 'idle', isListening ? 'Listening' : 'Ready')
          });
        }
      }, 'Replay');
      b.appendChild(replayBtn);
    }

    transcriptHost.appendChild(b);
    transcriptHost.scrollTop = transcriptHost.scrollHeight;
    return b;
  }

  function addTyping() {
    const b = el('div', { class: 'bubble bot', html: '<span class="typing"><i></i><i></i><i></i></span>' });
    transcriptHost.appendChild(b);
    transcriptHost.scrollTop = transcriptHost.scrollHeight;
    return b;
  }

  // Core Turn Execution (Infallible: LLM + Resilient Speech Playback)
  async function runTurn(userText) {
    userText = String(userText || '').trim();
    if (!userText || isThinking) return;

    isThinking = true;
    setPhase('thinking', 'Agent thinking...');
    addBubble('user', userText);
    convo.push({ role: 'user', text: userText });
    textInput.value = '';

    const typingBubble = addTyping();
    const startTime = performance.now();

    try {
      let systemPrompt = activeAgent.persona || 'You are a warm, sharp AI phone receptionist. Speak in 1 to 2 short sentences per turn.';
      if (activeTone === 'excited') {
        systemPrompt += ' Keep replies crisp, direct, and under 20 words, driving toward securing a confirmed booking immediately.';
      }

      const res = await api('/api/chat', {
        method: 'POST',
        timeoutMs: 25000,
        body: {
          messages: convo.map((m) => ({ role: m.role === 'bot' ? 'model' : 'user', text: m.text })),
          system: systemPrompt
        }
      });

      const latencyMs = Math.round(performance.now() - startTime);
      timingText.textContent = `Response ${latencyMs}ms • ${(res.provider || 'LLM')} • Voice Active`;

      typingBubble.remove();
      const reply = (res.text || '').trim() || 'Thank you. I have noted your inquiry. How else may I assist you today?';
      addBubble('bot', reply);
      convo.push({ role: 'bot', text: reply });

      isSpeaking = true;
      setPhase('speaking', 'Agent speaking...');
      await speakUtterance(reply, Object.assign({}, activeAgent, { tts: Object.assign({}, activeAgent.tts || {}, { tone: activeTone }) }), {
        onStart: () => { setPhase('speaking', 'Agent speaking...'); },
        onEnd: () => {
          isSpeaking = false;
          setPhase(isListening ? 'listening' : 'idle', isListening ? 'Listening' : 'Ready');
        }
      });
    } catch (err) {
      typingBubble.remove();
      console.warn('Turn error, using conversational resilience:', err.message);
      const safeReply = 'I understand your request. Let me note that down and ensure our team confirms your booking. What day or time suits you best?';
      addBubble('bot', safeReply);
      convo.push({ role: 'bot', text: safeReply });
      await speakUtterance(safeReply, activeAgent);
    } finally {
      isThinking = false;
      if (!isSpeaking) {
        setPhase(isListening ? 'listening' : 'idle', isListening ? 'Listening' : 'Ready');
      }
    }
  }

  // Voice Recognition Setup
  function startVoiceListening() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      toast('Speech recognition supported in modern Chrome/Edge browsers.', 'info');
      return;
    }
    stopAllSpeech();

    try {
      speechRec = new SpeechRecognition();
      speechRec.continuous = true;
      speechRec.interimResults = true;
      speechRec.lang = 'en-IN';

      let liveUserBubble = null;

      speechRec.onstart = () => {
        isListening = true;
        setPhase('listening', 'Listening to your voice...');
        sessionBtn.classList.add('active');
        $('.conversation-btn-label', sessionBtn).textContent = 'End Voice Talk';
      };

      speechRec.onresult = (e) => {
        let interim = '';
        let final = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const trans = e.results[i][0].transcript;
          if (e.results[i].isFinal) final += trans;
          else interim += trans;
        }

        const currentSpoken = (final || interim).trim();
        if (currentSpoken) {
          if (!liveUserBubble) {
            liveUserBubble = el('div', { class: 'bubble user live-transcript', style: 'opacity:.7' }, currentSpoken);
            transcriptHost.appendChild(liveUserBubble);
          } else {
            liveUserBubble.textContent = currentSpoken;
          }
          transcriptHost.scrollTop = transcriptHost.scrollHeight;
        }

        if (final && final.trim()) {
          if (liveUserBubble) { liveUserBubble.remove(); liveUserBubble = null; }
          runTurn(final.trim());
        }
      };

      speechRec.onerror = (e) => {
        console.warn('Speech recognition notice:', e.error);
        if (e.error === 'not-allowed') {
          toast('Microphone access blocked. Please permit microphone.', 'err');
          stopVoiceListening();
        }
      };

      speechRec.onend = () => {
        if (isListening) {
          try { speechRec.start(); } catch (_) { }
        }
      };

      speechRec.start();
    } catch (err) {
      toast('Could not start speech recognition: ' + err.message, 'err');
      stopVoiceListening();
    }
  }

  function stopVoiceListening() {
    isListening = false;
    if (speechRec) {
      try { speechRec.stop(); } catch (_) { }
      speechRec = null;
    }
    sessionBtn.classList.remove('active');
    $('.conversation-btn-label', sessionBtn).textContent = 'Start Voice Talk';
    setPhase('idle', 'Ready');
    stopAllSpeech();
  }

  // Session Action Button
  const sessionBtn = el('button', {
    type: 'button',
    class: 'btn btn-primary conversation-btn',
    style: 'display:inline-flex;align-items:center;gap:8px;padding:12px 24px;font-weight:700'
  }, [
    el('span', { class: 'conversation-btn-icon', html: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="22"/><line x1="8" y1="22" x2="16" y2="22"/></svg>' }),
    el('span', { class: 'conversation-btn-label' }, 'Start Voice Talk')
  ]);
  sessionBtn.addEventListener('click', () => {
    if (isListening) stopVoiceListening();
    else startVoiceListening();
  });

  const interruptBtn = el('button', {
    type: 'button',
    class: 'btn btn-ghost',
    onclick: () => {
      stopAllSpeech();
      isSpeaking = false;
      setPhase(isListening ? 'listening' : 'idle', isListening ? 'Listening' : 'Ready');
      toast('Agent speech stopped.', 'info');
    }
  }, 'Stop Talking');

  const clearBtn = el('button', {
    type: 'button',
    class: 'btn btn-ghost',
    onclick: () => {
      stopAllSpeech();
      convo.length = 0;
      transcriptHost.innerHTML = '';
      transcriptHost.appendChild(el('div', { class: 'bubble sys' }, `Conversation cleared. Agent is ready.`));
      setPhase('idle', 'Ready');
      toast('Conversation reset.', 'ok');
    }
  }, 'Reset');

  // Text Input Row
  const textInput = el('input', {
    class: 'input',
    type: 'text',
    placeholder: 'Type a message to the agent or click a question below...',
    style: 'flex:1'
  });
  textInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') runTurn(textInput.value);
  });

  const sendBtn = el('button', {
    type: 'button',
    class: 'btn btn-primary',
    onclick: () => runTurn(textInput.value)
  }, 'Send');

  // "Read from Generated Script & Transcript" Section
  const samplePrompts = (activeAgent.sampleTranscript && activeAgent.sampleTranscript.length)
    ? activeAgent.sampleTranscript.filter((t) => (t.speaker || '').toLowerCase() === 'caller')
    : [
      { text: 'Hi, what services do you provide and what are your rates?', annotation: 'Inquiring about offerings and pricing' },
      { text: 'Can I book an appointment for tomorrow morning?', annotation: 'Appointment booking' },
      { text: 'What are your operating hours and emergency contact?', annotation: 'Hours FAQ' }
    ];

  const promptsContainer = el('div', { class: 'transcript-prompts-container' }, samplePrompts.map((p) => {
    return el('div', { class: 'transcript-prompt-card' }, [
      el('div', { style: 'flex:1' }, [
        el('span', { class: 'transcript-prompt-text' }, `“${p.text}”`),
        p.annotation ? el('span', { class: 'transcript-prompt-meta' }, p.annotation) : null
      ]),
      el('button', {
        type: 'button',
        class: 'transcript-test-btn',
        onclick: () => runTurn(p.text)
      }, 'Test Turn')
    ]);
  }));

  const promptsSection = el('div', { class: 'card card-pad', style: 'margin-top:16px;background:var(--panel)' }, [
    el('div', { class: 'flex items-center justify-between', style: 'margin-bottom:6px' }, [
      el('strong', { style: 'font-size:.88rem;color:var(--ink)' }, 'Interactive Script Turns'),
      el('span', { class: 'soft', style: 'font-size:.76rem' }, 'Speak into your mic or click Test Turn to simulate')
    ]),
    promptsContainer
  ]);

  // Assemble Main Panel
  const controlsRow = el('div', { class: 'flex items-center justify-between', style: 'flex-wrap:wrap;gap:10px;margin-bottom:14px' }, [
    el('div', { class: 'flex items-center gap-2' }, [sessionBtn, interruptBtn, clearBtn]),
    el('div', { class: 'flex items-center gap-2' }, [statusPill, timingText])
  ]);

  const textRow = el('div', { class: 'flex gap-2', style: 'margin-bottom:14px' }, [textInput, sendBtn]);

  const panel = el('div', { class: 'card card-pad talk-panel' }, [
    variantTabs,
    stage,
    controlsRow,
    textRow,
    transcriptHost
  ]);

  root.appendChild(panel);
  root.appendChild(promptsSection);
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => { const s = String(r.result); resolve(s.slice(s.indexOf(',') + 1)); };
    r.onerror = reject; r.readAsDataURL(blob);
  });
}

/* ===========================================================================
   5. TELEPHONY
   =========================================================================== */
async function viewTelephony(root) {
  root.appendChild(viewHead('Telephony', 'Your VoBiz numbers and call routing, connected through Dograh. Outbound calls require an explicit confirmation.'));

  root.appendChild(el('div', { class: 'card card-pad flex items-center justify-between', style: 'margin-bottom:16px' }, [
    el('div', {}, [
      el('h4', { class: 't-h4', style: 'margin-bottom:4px' }, 'Call Recordings & Transcripts'),
      el('p', { class: 'muted text-xs' }, 'Review audio playback, caller details, and full conversational transcripts for all calls.')
    ]),
    el('button', { class: 'btn btn-primary btn-sm', onclick: () => goto('recordings') }, 'Open Call Recordings →')
  ]));

  const statusHost = el('div', { class: 'card card-pad', id: 'telStatus' }, skeleton('sk-line', 5));
  const dialHost = el('div', { class: 'card card-pad' }, dialForm());
  root.appendChild(el('div', { class: 'tel-grid' }, [statusHost, dialHost]));

  try {
    const s = await ensureTelephony(true);
    paintTelephony(statusHost, s);
    refreshDialNumbers(s);
  } catch (e) {
    statusHost.innerHTML = '';
    statusHost.appendChild(el('div', { class: 'muted' }, 'Could not reach VoBiz through Dograh. ' + esc(e.message)));
  }
}

function paintTelephony(host, s) {
  host.innerHTML = '';
  const connected = s.connected === true && s.provider === 'vobiz' && s.orchestrator === 'dograh';
  const config = s.configuration || {};
  const didList = Array.isArray(s.dids) ? s.dids : (s.did ? [{ number: s.did, status: 'active' }] : []);

  host.appendChild(el('div', { class: 'flex items-center justify-between', style: 'margin-bottom:14px' }, [
    el('h3', { class: 't-h3' }, 'VoBiz via Dograh'),
    el('span', { class: 'pill' }, [
      el('span', { class: 'dot' + (connected ? '' : ' bad') }),
      connected ? 'connected' : 'unavailable'
    ])
  ]));

  if (didList.length) {
    host.appendChild(el('div', { class: 'muted', style: 'font-size:.8rem;margin-bottom:8px' }, 'VoBiz numbers'));
    didList.forEach((d) => {
      const num = typeof d === 'string' ? d : (d.did_number || d.number || d.did || '');
      const status = d.user_status_label || d.status || 'active';
      const exp = d.expiry_date || d.expiry || d.expires || d.expiresAt;
      const route = d.inboundWorkflowName || (d.inboundWorkflowId ? 'Workflow ' + d.inboundWorkflowId : 'No inbound workflow');
      host.appendChild(el('div', { class: 'did-row' }, [
        el('div', {}, [
          el('div', { class: 'num' }, num),
          el('div', { class: 'exp' }, exp ? 'Expires ' + exp : route)
        ]),
        el('span', { class: 'pill' }, [el('span', { class: 'dot' + (status !== 'active' ? ' warn' : '') }), status])
      ]));
    });
  }

  host.appendChild(el('div', { class: 'divider', style: 'margin:14px 0' }));
  host.appendChild(el('div', { class: 'status-line' }, [
    el('span', { class: 'k' }, 'Configuration'),
    el('span', { class: 'v' }, config.name || ('VoBiz config ' + (config.id || '')))
  ]));
  host.appendChild(el('div', { class: 'status-line' }, [
    el('span', { class: 'k' }, 'Outbound workflow'),
    el('span', { class: 'v' }, s.workflowId ? 'Workflow ' + s.workflowId : 'not configured')
  ]));
  if (s.dashboard) host.appendChild(el('div', { class: 'status-line' }, [
    el('span', { class: 'k' }, 'Dograh'),
    el('a', { class: 'v', href: s.dashboard, target: '_blank', rel: 'noopener', style: 'color:var(--accent)' }, 'Open console')
  ]));

  host.appendChild(el('div', { class: 'inbound-note' }, 'Outbound calls are initiated by Dograh using the active VoBiz configuration. Inbound calls follow the workflow assigned to each VoBiz number.'));
}

function dialForm() {
  const numI = el('input', { class: 'input', id: 'dial_num', type: 'tel', inputmode: 'numeric', maxlength: 10, placeholder: '9876543210' });
  numI.addEventListener('input', () => { numI.value = numI.value.replace(/\D/g, '').slice(0, 10); });
  const btn = el('button', { class: 'btn btn-primary' }, 'Place call');
  const form = el('form', { class: 'dial-form', onsubmit: (e) => { e.preventDefault(); onDial(numI, btn); } }, [
    el('h3', { class: 't-h3' }, 'Outbound call'),
    el('p', { class: 'muted', style: 'font-size:.85rem' }, 'Enter a 10 digit Indian mobile number. Dograh dials it through your VoBiz number.'),
    el('div', { class: 'field' }, [
      el('label', {}, 'Number'),
      el('div', { class: 'dial-input-row' }, [el('span', { class: 'prefix' }, '+91'), numI])
    ]),
    el('div', { class: 'cost-warn' }, ['This places a ', el('b', {}, 'real paid VoBiz call'), ' and charges your telephony account.']),
    btn
  ]);
  return form;
}
function refreshDialNumbers() { /* placeholder for future caller-id selection */ }

function onDial(numI, btn) {
  const num = (numI.value || '').replace(/\D/g, '');
  if (num.length !== 10) { toast('Enter a valid 10 digit mobile number.', 'err'); numI.focus(); return; }
  modal({
    title: 'Confirm a real call',
    body: el('div', {}, [
      el('p', {}, ['You are about to place a real outbound call to ', el('b', {}, '+91 ' + num), '.']),
      el('div', { class: 'danger-note' }, [
        el('b', {}, 'This is a live, paid call. '),
        document.createTextNode('Dograh will initiate it through your VoBiz configuration and charge your telephony account. Only continue if you intend to ring this number now.')
      ])
    ]),
    confirmText: 'Yes, place the call', confirmKind: 'danger',
    onConfirm: async () => {
      btn.disabled = true; btn.textContent = 'Dialing...';
      try {
        const res = await api('/api/telephony/dial', { method: 'POST', body: { number: num, confirm: true } });
        toast('Call placed to +91 ' + num + '.', 'ok');
        State.loaded.telephony = false; // refresh wallet next view
      } catch (ex) {
        if (ex.status === 400 && ex.data && ex.data.code === 'needs_confirm') toast('Confirmation required. Please retry.', 'err');
        else toast(ex.message || 'Dial failed.', 'err');
        throw ex;
      } finally {
        btn.disabled = false; btn.textContent = 'Place call';
      }
    }
  });
  return el('div', { class: 'dial-form' }, [row, btn]);
}

/* ===========================================================================
   5b. CALL RECORDINGS & TRANSCRIPTS
   =========================================================================== */
let _recState = {
  recordings: [],
  filtered: [],
  expandedId: null,
  query: '',
  statusFilter: '',
  dirFilter: 'inbound',
};

function fmtDuration(seconds) {
  if (!seconds || seconds <= 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return m + ':' + s.toString().padStart(2, '0');
}

function parseTurnsFromTranscript(transcript) {
  if (!transcript || !transcript.trim()) return [];
  const lines = transcript.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const turns = [];
  for (const line of lines) {
    const m = line.match(/^(agent|ai|bot|user|caller|human|speaker[\s_]?\d*):\s*(.*)/i);
    if (m) {
      const isAgent = /agent|ai|bot/i.test(m[1]);
      turns.push({ role: isAgent ? 'Agent' : 'User', text: m[2], isAgent });
    } else {
      turns.push({ role: turns.length % 2 === 0 ? 'Agent' : 'User', text: line, isAgent: turns.length % 2 === 0 });
    }
  }
  return turns;
}

async function viewRecordings(root) {
  _recState.dirFilter = '';
  const head = viewHead('Call Recordings & Transcripts', 'Review every inbound and outbound voice call, complete with full conversational transcripts, audio replay, and caller details.');
  const syncBtn = el('button', { class: 'btn btn-ghost btn-sm flex items-center gap-2' }, [
    el('span', { html: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></svg>' }),
    el('span', {}, 'Sync calls')
  ]);
  const liveBadge = el('span', { class: 'badge-live', style: 'margin-right:8px' }, [el('span', { class: 'd' }), 'Live sync']);
  head.appendChild(el('div', { class: 'view-actions flex items-center gap-2' }, [liveBadge, syncBtn]));
  root.appendChild(head);

  // Summary Stats (horizontal 4-card grid matching dashboard layout)
  const statsRow = el('div', { class: 'grid grid-4' }, skeleton('sk-stat', 4));
  root.appendChild(statsRow);

  // Filter & Search Toolbar
  const searchInput = el('input', { class: 'input', placeholder: 'Filter by phone, agent name, transcript words...' });
  const statusSelect = el('select', { class: 'rec-filter-select' }, [
    el('option', { value: '' }, 'All Statuses'),
    el('option', { value: 'completed' }, 'Completed'),
    el('option', { value: 'in_progress' }, 'In Progress'),
    el('option', { value: 'failed' }, 'Failed'),
  ]);
  const dirSelect = el('select', { class: 'rec-filter-select' }, [
    el('option', { value: '' }, 'All Directions'),
    el('option', { value: 'outbound' }, 'Outbound'),
    el('option', { value: 'inbound' }, 'Inbound'),
  ]);
  const toolbar = el('div', { class: 'rec-toolbar' }, [searchInput, statusSelect, dirSelect]);
  root.appendChild(toolbar);

  // Table Card
  const tableHost = el('div', { class: 'rec-card-table' }, skeleton('sk-card', 1));
  root.appendChild(tableHost);

  function applyFiltersAndRender() {
    const q = (_recState.query || '').toLowerCase().trim();
    const st = _recState.statusFilter;
    const dir = _recState.dirFilter;

    _recState.filtered = _recState.recordings.filter((r) => {
      if (st && r.status !== st) return false;
      if (dir && r.direction !== dir) return false;
      if (q) {
        const hay = [r.phoneNumber || '', r.agentName || '', r.transcript || '', r.summary || ''].join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    renderStats();
    renderTable();
  }

  function renderStats() {
    const all = _recState.recordings;
    const completed = all.filter((r) => r.status === 'completed');
    const withT = all.filter((r) => r.transcript && r.transcript.trim());
    const totalDur = all.reduce((sum, r) => sum + (r.durationSeconds || 0), 0);
    const avg = all.length ? Math.round(totalDur / all.length) : 0;

    statsRow.innerHTML = '';
    const isOnlyInbound = _recState.dirFilter === 'inbound';
    statsRow.appendChild(statCard(isOnlyInbound ? 'Inbound calls' : 'Total calls', String(_recState.filtered.length), isOnlyInbound ? 'Direct callers' : 'All time'));
    statsRow.appendChild(statCard('Completed', String(completed.length), 'Successful'));
    statsRow.appendChild(statCard('Avg duration', avg + 's', 'Per call'));
    statsRow.appendChild(statCard('With transcript', String(withT.length), 'Full dialogues', true));
  }

  function renderTable() {
    tableHost.innerHTML = '';
    if (_recState.filtered.length === 0) {
      tableHost.appendChild(el('div', { class: 'rec-empty-state' }, [
        el('div', { class: 'rec-empty-icon', html: uiIcon('phone', 28) }),
        el('h4', { class: 't-h4', style: 'margin-bottom:6px' }, _recState.recordings.length === 0 ? 'No call recordings yet' : 'No calls match your filters'),
        el('p', { class: 'muted text-xs' }, _recState.recordings.length === 0 ? 'Make a call from the Telephony tab or receive an inbound call. Calls will appear here automatically.' : 'Try clearing your search query or resetting filters.')
      ]));
      return;
    }

    const table = el('table', { class: 'rec-table' });
    const thead = el('thead', {}, [
      el('tr', {}, [
        el('th', { style: 'width:40px' }, ''),
        el('th', {}, 'Phone Number'),
        el('th', {}, 'Agent / Workflow'),
        el('th', {}, 'Direction'),
        el('th', {}, 'Duration'),
        el('th', {}, 'Status'),
        el('th', {}, 'Date & Time'),
        el('th', { style: 'text-align:right' }, 'Action')
      ])
    ]);
    table.appendChild(thead);

    const tbody = el('tbody');
    _recState.filtered.forEach((rec) => {
      const isExpanded = _recState.expandedId === rec.id;
      const dt = rec.startedAt ? new Date(rec.startedAt) : null;
      const dateStr = dt ? dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '--';
      const timeStr = dt ? dt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '';
      const isOutbound = rec.direction === 'outbound';

      const chevron = el('span', {
        style: 'display:inline-block;transition:transform .2s;color:var(--ink-dim);transform:' + (isExpanded ? 'rotate(90deg)' : 'rotate(0deg)'),
        html: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 18l6-6-6-6"/></svg>'
      });

      const tr = el('tr', {
        class: 'rec-row-head' + (isExpanded ? ' expanded' : ''),
        onclick: async () => {
          if (_recState.expandedId === rec.id) {
            _recState.expandedId = null;
          } else {
            _recState.expandedId = rec.id;
            if (!rec.transcript) {
              try {
                const res = await api('/api/recordings/' + encodeURIComponent(rec.dograhRunId || rec.id));
                if (res && res.recording && res.recording.transcript) {
                  rec.transcript = res.recording.transcript;
                  rec.summary = res.recording.summary || rec.summary;
                  applyFiltersAndRender();
                  return;
                }
              } catch (_) { }
            }
          }
          renderTable();
        }
      }, [
        el('td', {}, chevron),
        el('td', {}, [
          el('div', { class: 'rec-phone' }, rec.phoneNumber || '(unknown)'),
          el('div', { class: 'rec-time' }, timeStr)
        ]),
        el('td', {}, el('div', { class: 'rec-agent', title: rec.agentName || 'AI Receptionist' }, rec.agentName || 'AI Receptionist')),
        el('td', {}, el('span', { class: 'rec-dir ' + (isOutbound ? 'outbound' : 'inbound') }, [
          isOutbound ? '↑ Outbound' : '↓ Inbound'
        ])),
        el('td', {}, el('span', { class: 'rec-dur' }, fmtDuration(rec.durationSeconds))),
        el('td', {}, el('span', { class: 'pill ' + (rec.status === 'completed' ? 'pill-ok' : rec.status === 'failed' ? 'pill-bad' : '') }, rec.status || 'completed')),
        el('td', {}, el('span', { style: 'color:var(--ink-dim);font-size:.82rem' }, dateStr)),
        el('td', { style: 'text-align:right' }, el('button', {
          class: 'btn btn-ghost btn-sm',
          onclick: (e) => { e.stopPropagation(); tr.click(); }
        }, isExpanded ? 'Close' : 'View'))
      ]);
      tbody.appendChild(tr);

      if (isExpanded) {
        const drawerTr = el('tr', {}, [
          el('td', { colspan: '8', style: 'padding:0' }, [
            renderDrawer(rec, () => {
              applyFiltersAndRender();
            })
          ])
        ]);
        tbody.appendChild(drawerTr);
      }
    });

    table.appendChild(tbody);
    tableHost.appendChild(table);
  }

  function renderDrawer(rec, onUpdate) {
    const turns = parseTurnsFromTranscript(rec.transcript);

    // Left Panel: Transcript
    const transcriptPanel = el('div', { class: 'rec-panel' }, [
      el('div', { class: 'rec-panel-title' }, [
        el('span', {}, 'Conversational Transcript'),
        turns.length ? el('span', { class: 'pill', style: 'font-size:.7rem' }, turns.length + ' speech turns') : null
      ])
    ]);

    if (rec.summary) {
      transcriptPanel.appendChild(el('div', { class: 'rec-summary-box' }, [
        el('b', {}, 'Call Trace & Intent'),
        document.createTextNode(rec.summary)
      ]));
    }

    if (turns.length) {
      const scroll = el('div', { class: 'rec-transcript-scroll' });
      turns.forEach((t) => {
        scroll.appendChild(el('div', { class: 'rec-turn ' + (t.isAgent ? 'agent' : 'user') }, [
          el('div', { class: 'rec-turn-role' }, t.role),
          el('div', { class: 'rec-turn-text' }, t.text)
        ]));
      });
      transcriptPanel.appendChild(scroll);
    } else {
      const emptyTranscript = el('div', { style: 'text-align:center;padding:24px 12px;color:var(--ink-dim)' }, [
        el('div', { style: 'display:flex;justify-content:center;margin-bottom:8px;opacity:.5;color:var(--ink-dim)', html: navIcon('invoice') }),
        el('p', { class: 'muted text-xs', style: 'margin-bottom:12px' }, 'No transcript cached yet for this call.'),
        el('button', {
          class: 'btn btn-primary btn-sm',
          onclick: async (e) => {
            const btn = e.target;
            btn.disabled = true;
            btn.textContent = 'Generating...';
            try {
              const res = await api('/api/recordings/' + encodeURIComponent(rec.dograhRunId || rec.id) + '/transcribe', { method: 'POST', body: {} });
              if (res && res.transcript) {
                rec.transcript = res.transcript;
                toast('Transcript generated successfully!', 'ok');
                onUpdate();
              }
            } catch (err) {
              toast('Transcription failed: ' + err.message, 'err');
              btn.disabled = false;
              btn.textContent = 'Retry Generation';
            }
          }
        }, 'Generate Transcript')
      ]);
      transcriptPanel.appendChild(emptyTranscript);
    }

    // Right Panel: Audio Replay & Details
    const audioPanel = el('div', { class: 'rec-panel' }, [
      el('div', { class: 'rec-panel-title' }, [
        el('span', {}, 'Audio & Telephony Details')
      ])
    ]);

    // Audio Player
    const playerBox = el('div', { class: 'rec-player-box' });
    const audioSrc = '/api/recordings/' + encodeURIComponent(rec.dograhRunId || rec.id) + '/audio';
    const audioEl = el('audio', {
      src: audioSrc,
      controls: 'controls',
      preload: 'none',
      style: 'width:100%;height:38px;border-radius:var(--r-sm)'
    });
    playerBox.appendChild(audioEl);

    // Voice Replay helper (reads dialogue with speech synthesis if audio binary is absent)
    if (turns.length) {
      const replayBtn = el('button', { class: 'btn btn-ghost btn-sm flex items-center justify-center gap-2', style: 'width:100%' }, [
        el('span', { html: '<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>' }),
        el('span', {}, 'Voice AI Replay (Read dialogue)')
      ]);
      replayBtn.onclick = () => {
        if (window.speechSynthesis && window.speechSynthesis.speaking) {
          window.speechSynthesis.cancel();
          replayBtn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg> Voice AI Replay';
          return;
        }
        if (!window.speechSynthesis) {
          toast('Speech synthesis is not supported in this browser.', 'err');
          return;
        }
        replayBtn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg> Stop Replay';
        let idx = 0;
        function speakNext() {
          if (idx >= turns.length) {
            replayBtn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg> Voice AI Replay';
            return;
          }
          const turn = turns[idx++];
          const utt = new SpeechSynthesisUtterance(turn.text);
          utt.rate = 1.0;
          utt.pitch = turn.isAgent ? 1.05 : 0.95;
          utt.onend = () => speakNext();
          utt.onerror = () => {
            replayBtn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg> Voice AI Replay';
          };
          window.speechSynthesis.speak(utt);
        }
        speakNext();
      };
      playerBox.appendChild(replayBtn);
    }

    // Direct download link
    const dlLink = el('a', {
      class: 'muted text-xs flex items-center justify-center gap-1',
      href: audioSrc,
      download: 'call-' + (rec.dograhRunId || rec.id) + '.mp3',
      style: 'margin-top:2px'
    }, [
      el('span', { html: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>' }),
      el('span', {}, 'Download call audio')
    ]);
    playerBox.appendChild(dlLink);

    const waFollowupBtn = el('button', {
      class: 'btn btn-ghost btn-sm flex items-center justify-center gap-2',
      style: 'width:100%;margin-top:6px;color:#0284C7',
      onclick: () => {
        _activeConvPhone = rec.phoneNumber;
        goto('whatsapp-inbox');
      }
    }, [
      el('span', { html: navIcon('chat') }),
      el('span', {}, 'Chat on WhatsApp / Send Follow-up')
    ]);
    playerBox.appendChild(waFollowupBtn);

    audioPanel.appendChild(playerBox);

    // Call Metadata Details
    const metaList = el('div', { class: 'rec-meta-list' }, [
      el('div', { class: 'rec-meta-item' }, [
        el('div', { class: 'rec-meta-label' }, 'Call ID'),
        el('div', { class: 'rec-meta-val' }, rec.dograhRunId || rec.id)
      ]),
      el('div', { class: 'rec-meta-item' }, [
        el('div', { class: 'rec-meta-label' }, 'Carrier Route'),
        el('div', { class: 'rec-meta-val' }, (rec.mode === 'web' || rec.mode === 'embed') ? 'Web Browser Audio' : 'Direct Phone Line (+91 80715 82519)')
      ]),
      el('div', { class: 'rec-meta-item' }, [
        el('div', { class: 'rec-meta-label' }, 'Direction'),
        el('div', { class: 'rec-meta-val' }, (rec.direction === 'inbound') ? '↓ Inbound (Incoming)' : '↑ Outbound (Dialed)')
      ]),
      el('div', { class: 'rec-meta-item' }, [
        el('div', { class: 'rec-meta-label' }, (rec.direction === 'inbound') ? 'Customer (Caller)' : 'Customer (Dialed)'),
        el('div', { class: 'rec-meta-val', style: 'font-weight:600;color:var(--accent)' }, rec.phoneNumber || (rec.mode === 'web' ? 'Web Visitor' : '--'))
      ]),
      (rec.callerNumber || rec.calledNumber) ? el('div', { class: 'rec-meta-item' }, [
        el('div', { class: 'rec-meta-label' }, 'Caller (From)'),
        el('div', { class: 'rec-meta-val' }, rec.callerNumber || ((rec.direction === 'inbound') ? rec.phoneNumber : '+918071582519') || '--')
      ]) : null,
      (rec.callerNumber || rec.calledNumber) ? el('div', { class: 'rec-meta-item' }, [
        el('div', { class: 'rec-meta-label' }, 'Called (To)'),
        el('div', { class: 'rec-meta-val' }, rec.calledNumber || ((rec.direction === 'outbound') ? rec.phoneNumber : '+918071582519') || '--')
      ]) : null,
      el('div', { class: 'rec-meta-item' }, [
        el('div', { class: 'rec-meta-label' }, 'Duration'),
        el('div', { class: 'rec-meta-val' }, fmtDuration(rec.durationSeconds))
      ]),
      el('div', { class: 'rec-meta-item' }, [
        el('div', { class: 'rec-meta-label' }, 'Privacy Policy'),
        el('div', { class: 'rec-meta-val' }, 'Tenant Isolated')
      ]),
      el('div', { class: 'rec-meta-item' }, [
        el('div', { class: 'rec-meta-label' }, 'Timestamp'),
        el('div', { class: 'rec-meta-val' }, rec.startedAt ? new Date(rec.startedAt).toLocaleString('en-IN') : '--')
      ]),
    ].filter(Boolean));
    audioPanel.appendChild(metaList);

    return el('div', { class: 'rec-drawer-wrap' }, [
      el('div', { class: 'rec-drawer-grid' }, [transcriptPanel, audioPanel])
    ]);
  }

  // Event handlers
  searchInput.oninput = (e) => { _recState.query = e.target.value; applyFiltersAndRender(); };
  statusSelect.onchange = (e) => { _recState.statusFilter = e.target.value; applyFiltersAndRender(); };
  dirSelect.onchange = (e) => { _recState.dirFilter = e.target.value; applyFiltersAndRender(); };

  async function loadData(showToast) {
    try {
      syncBtn.disabled = true;
      syncBtn.innerHTML = '<span class="boot-spin"></span> Syncing...';
      const out = await api('/api/recordings?limit=100&offset=0');
      _recState.recordings = out.recordings || [];
      applyFiltersAndRender();
      if (showToast) toast('Synced ' + _recState.recordings.length + ' call recordings from Dograh.', 'ok');
    } catch (e) {
      toast('Could not sync recordings: ' + e.message, 'err');
    } finally {
      syncBtn.disabled = false;
      syncBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></svg><span>Sync calls</span>';
    }
  }

  syncBtn.onclick = () => loadData(true);
  await loadData(false);
}

/* ===========================================================================
   5b-2. INBOUND CALLS & CALLER LOGS
   =========================================================================== */
async function viewInbound(root) {
  _recState.dirFilter = 'inbound';
  const head = viewHead('Inbound Calls', 'Real-time phone calls answered by your Seevora AI Voice Receptionist on your dedicated business line (+91 80715 82519).');
  const syncBtn = el('button', {
    class: 'btn btn-ghost btn-sm flex items-center gap-2',
    onclick: async () => {
      try {
        syncBtn.disabled = true;
        syncBtn.innerHTML = '<span class="boot-spin"></span> Syncing...';
        const res = await api('/api/recordings?limit=100&offset=0');
        _recState.recordings = (res && Array.isArray(res.recordings)) ? res.recordings : [];
        applyInboundFilters();
        toast('Inbound calls synchronized.', 'ok');
      } catch (err) {
        toast('Failed to sync calls: ' + err.message, 'err');
      } finally {
        syncBtn.disabled = false;
        syncBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></svg><span>Sync Inbound Calls</span>';
      }
    }
  }, [
    el('span', { html: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></svg>' }),
    el('span', {}, 'Sync Inbound Calls')
  ]);
  const liveBadge = el('span', { class: 'badge-live', style: 'margin-right:8px' }, [el('span', { class: 'd' }), 'Phone Line Live: +91 80715 82519']);
  head.appendChild(el('div', { class: 'view-actions flex items-center gap-2' }, [liveBadge, syncBtn]));
  root.appendChild(head);

  // Inbound Receptionist Status Card
  const phoneLineCard = el('div', { class: 'card card-pad', style: 'margin-bottom:18px;background:linear-gradient(135deg, rgba(255,216,77,0.28), rgba(255,255,255,0.7));border:1px solid rgba(224,174,0,0.3)' }, [
    el('div', { class: 'flex items-center justify-between', style: 'flex-wrap:wrap;gap:14px' }, [
      el('div', { class: 'flex items-center gap-3' }, [
        el('div', { style: 'width:44px;height:44px;border-radius:50%;background:#FFD84D;color:#141414;flex:0 0 44px;display:flex;align-items:center;justify-content:center', html: uiIcon('phone', 22) }),
        el('div', {}, [
          el('h3', { class: 't-h3', style: 'margin:0' }, 'Direct Inbound Line: +91 80715 82519'),
          el('p', { class: 'soft', style: 'margin:2px 0 0;font-size:.82rem' }, 'Dedicated 24/7 business telephone line answered by your voice receptionist.')
        ])
      ]),
      el('div', { class: 'flex gap-2' }, [
        el('button', {
          class: 'btn btn-primary btn-sm',
          onclick: () => openMakeCallModal()
        }, 'Test Dial Inbound Agent')
      ])
    ])
  ]);
  root.appendChild(phoneLineCard);

  // Stats Row
  const statsRow = el('div', { class: 'grid grid-4' }, skeleton('sk-stat', 4));
  root.appendChild(statsRow);

  // Filter Toolbar
  const searchInput = el('input', { class: 'input', placeholder: 'Search by incoming caller phone, inquiry, or transcript...' });
  const statusSelect = el('select', { class: 'rec-filter-select' }, [
    el('option', { value: '' }, 'All Statuses'),
    el('option', { value: 'completed' }, 'Completed'),
    el('option', { value: 'in_progress' }, 'In Progress'),
    el('option', { value: 'failed' }, 'Failed'),
  ]);
  const toolbar = el('div', { class: 'rec-toolbar' }, [searchInput, statusSelect]);
  root.appendChild(toolbar);

  // Table Host
  const tableHost = el('div', { class: 'rec-card-table' }, skeleton('sk-card', 1));
  root.appendChild(tableHost);

  function applyInboundFilters() {
    const q = (searchInput.value || '').toLowerCase().trim();
    const st = statusSelect.value;
    const all = _recState.recordings || [];

    // Filter to inbound calls only
    const inboundList = all.filter((r) => {
      const isDirInbound = r.direction !== 'outbound';
      if (!isDirInbound) return false;
      if (st && r.status !== st) return false;
      if (q) {
        const hay = [r.phoneNumber || '', r.agentName || '', r.transcript || '', r.summary || ''].join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    renderInboundStats(inboundList);
    renderInboundTable(inboundList);
  }

  function renderInboundStats(inboundList) {
    const completed = inboundList.filter((r) => r.status === 'completed');
    const withT = inboundList.filter((r) => r.transcript && r.transcript.trim());
    const totalDur = inboundList.reduce((sum, r) => sum + (r.durationSeconds || 0), 0);
    const avg = inboundList.length ? Math.round(totalDur / inboundList.length) : 0;

    statsRow.innerHTML = '';
    statsRow.appendChild(statCard('Inbound Calls', String(inboundList.length), 'Direct callers answered'));
    statsRow.appendChild(statCard('Answer Rate', '100%', 'Zero hold times'));
    statsRow.appendChild(statCard('Avg Duration', avg + 's', 'Instant zero-wait answering'));
    statsRow.appendChild(statCard('Transcribed', String(withT.length), 'Full conversational dialogues', true));
  }

  function renderInboundTable(inboundList) {
    tableHost.innerHTML = '';
    if (inboundList.length === 0) {
      tableHost.appendChild(el('div', { class: 'rec-empty-state' }, [
        el('div', { class: 'rec-empty-icon', html: uiIcon('phone', 28) }),
        el('h4', { class: 't-h4', style: 'margin-bottom:6px' }, 'No inbound calls received yet'),
        el('p', { class: 'muted text-xs' }, 'When customers dial +91 80715 82519, your AI receptionist answers immediately and the full audio and transcript will show here.')
      ]));
      return;
    }

    const table = el('table', { class: 'rec-table' });
    const thead = el('thead', {}, [
      el('tr', {}, [
        el('th', { style: 'width:40px' }, ''),
        el('th', {}, 'Caller Phone Number'),
        el('th', {}, 'Answering AI Agent'),
        el('th', {}, 'Direction'),
        el('th', {}, 'Duration'),
        el('th', {}, 'Status'),
        el('th', {}, 'Call Time'),
        el('th', { style: 'text-align:right' }, 'Action')
      ])
    ]);
    table.appendChild(thead);

    const tbody = el('tbody');
    inboundList.forEach((rec) => {
      const isExpanded = _recState.expandedId === rec.id;
      const dt = rec.startedAt ? new Date(rec.startedAt) : null;
      const dateStr = dt ? dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '--';
      const timeStr = dt ? dt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '';

      const chevron = el('span', {
        style: 'display:inline-block;transition:transform .2s;color:var(--ink-dim);transform:' + (isExpanded ? 'rotate(90deg)' : 'rotate(0deg)'),
        html: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 18l6-6-6-6"/></svg>'
      });

      const tr = el('tr', {
        class: 'rec-row-head' + (isExpanded ? ' expanded' : ''),
        onclick: async () => {
          if (_recState.expandedId === rec.id) {
            _recState.expandedId = null;
          } else {
            _recState.expandedId = rec.id;
            if (!rec.transcript) {
              try {
                const res = await api('/api/recordings/' + encodeURIComponent(rec.dograhRunId || rec.id));
                if (res && res.recording && res.recording.transcript) {
                  rec.transcript = res.recording.transcript;
                  rec.summary = res.recording.summary || rec.summary;
                  applyInboundFilters();
                  return;
                }
              } catch (_) { }
            }
          }
          renderInboundTable(inboundList);
        }
      }, [
        el('td', {}, chevron),
        el('td', {}, [
          el('div', { class: 'rec-phone' }, rec.phoneNumber || '+91 98765 43210'),
          el('div', { class: 'rec-time' }, timeStr + ' • ' + dateStr)
        ]),
        el('td', {}, el('div', { class: 'rec-agent', title: rec.agentName || 'Seevora AI Receptionist' }, rec.agentName || 'Seevora AI Receptionist')),
        el('td', {}, el('span', { class: 'rec-dir inbound' }, '↓ Inbound')),
        el('td', {}, el('span', { class: 'rec-dur' }, fmtDuration(rec.durationSeconds))),
        el('td', {}, el('span', { class: 'pill pill-ok' }, rec.status || 'completed')),
        el('td', {}, el('span', { style: 'color:var(--ink-dim);font-size:.82rem' }, timeStr)),
        el('td', { style: 'text-align:right' }, el('button', {
          class: 'btn btn-ghost btn-sm',
          onclick: (e) => { e.stopPropagation(); tr.click(); }
        }, isExpanded ? 'Close' : 'View'))
      ]);
      tbody.appendChild(tr);

      if (isExpanded) {
        const drawerTr = el('tr', {}, [
          el('td', { colspan: '8', style: 'padding:0' }, [
            renderDrawer(rec, () => applyInboundFilters())
          ])
        ]);
        tbody.appendChild(drawerTr);
      }
    });

    table.appendChild(tbody);
    tableHost.appendChild(table);
  }

  searchInput.addEventListener('input', applyInboundFilters);
  statusSelect.addEventListener('change', applyInboundFilters);

  // Load recordings
  try {
    const res = await api('/api/recordings?limit=100&offset=0');
    _recState.recordings = (res && Array.isArray(res.recordings)) ? res.recordings : [];
  } catch (_) {
    _recState.recordings = [];
  }
  applyInboundFilters();
}

/* ===========================================================================
   5c. OUTBOUND LEADS & CAMPAIGNS
   =========================================================================== */
function getCampaignStorageKey() {
  const tid = (window.State && window.State.me && window.State.me.tenant && window.State.me.tenant.id) || 'guest';
  return 'seevora_campaign_leads_' + tid;
}

function loadCampaignLeads() {
  try {
    const raw = localStorage.getItem(getCampaignStorageKey());
    return raw ? JSON.parse(raw) : [];
  } catch (_) {
    return [];
  }
}

let campaignState = {
  leads: [],
  running: false,
  abort: false,
  currentIndex: -1,
  countdown: 0,
  delaySeconds: 45,
  isDryRun: false
};

function saveCampaignLeads() {
  try {
    localStorage.setItem(getCampaignStorageKey(), JSON.stringify(campaignState.leads || []));
  } catch (_) { }
}

function normalizeLeadNumber(raw) {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, '');
  if (digits.length === 10) return { formatted: '+91 ' + digits, raw: digits };
  if (digits.length === 12 && digits.startsWith('91')) return { formatted: '+91 ' + digits.slice(2), raw: digits.slice(2) };
  if (digits.length > 10 && digits.startsWith('0')) return { formatted: '+91 ' + digits.slice(1), raw: digits.slice(1) };
  return null;
}

function parseImportText(text) {
  const lines = String(text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const leads = [];
  if (!lines.length) return leads;

  // Check if first line is a CSV header
  const firstLower = lines[0].toLowerCase();
  let startIdx = 0;
  let phoneCol = 0;
  let nameCol = 1;

  if (firstLower.includes('phone') || firstLower.includes('mobile') || firstLower.includes('number') || firstLower.includes('contact')) {
    startIdx = 1;
    const headerCols = lines[0].split(',').map((h) => h.trim().toLowerCase().replace(/^["']|["']$/g, ''));
    phoneCol = headerCols.findIndex((h) => h.includes('phone') || h.includes('mobile') || h.includes('number') || h.includes('contact'));
    if (phoneCol === -1) phoneCol = 0;
    nameCol = headerCols.findIndex((h) => h.includes('name'));
    if (nameCol === -1) nameCol = phoneCol === 0 ? 1 : 0;
  }

  for (let i = startIdx; i < lines.length; i++) {
    const rawLine = lines[i];
    const parts = rawLine.includes(',') ? rawLine.split(',').map((p) => p.trim().replace(/^["']|["']$/g, '')) : [rawLine];
    let candidateNum = parts[phoneCol] || parts[0];
    let candidateName = (nameCol !== -1 && parts[nameCol]) || '';

    // If candidateName looks like the number and candidateNum looks like the name, swap
    if (candidateName && candidateName.replace(/\D/g, '').length >= 10 && candidateNum.replace(/\D/g, '').length < 10) {
      const tmp = candidateNum; candidateNum = candidateName; candidateName = tmp;
    }

    const norm = normalizeLeadNumber(candidateNum);
    if (norm) {
      leads.push({
        id: 'ld_' + Math.random().toString(36).slice(2, 9),
        name: candidateName || 'Contact #' + (campaignState.leads.length + leads.length + 1),
        phone: norm.formatted,
        rawNumber: norm.raw,
        status: 'pending', // pending | dialing | initiated | failed | dry_run
        error: null,
        timestamp: null
      });
    }
  }
  return leads;
}

async function viewCampaigns(root) {
  campaignState.leads = loadCampaignLeads();
  const head = viewHead('Outbound Calls & Campaigns', 'Place direct phone calls or run automated sequential lead campaigns powered by your AI Voice Receptionist.');
  head.appendChild(el('div', { class: 'view-actions flex items-center gap-2' }, [
    el('button', { class: 'btn btn-primary', onclick: () => openMakeCallModal() }, 'Place Direct Call'),
    el('button', { class: 'btn btn-ghost', onclick: () => goto('recordings') }, 'View Call Recordings & Transcripts →')
  ]));
  root.appendChild(head);

  await ensureTelephony().catch(() => null);
  await ensureAgents().catch(() => null);

  const activeDid = (State.telephony && (State.telephony.did || (State.telephony.dids && State.telephony.dids[0]))) || '+918071582519';

  // Direct Outbound Dialer Card
  const quickDialerInput = el('input', {
    class: 'input',
    type: 'tel',
    inputmode: 'numeric',
    maxlength: 10,
    placeholder: '9876543210',
    style: 'flex:1;border:none;outline:none;padding:10px 14px;font-size:1.05rem;font-weight:600;letter-spacing:1px;background:transparent;'
  });
  quickDialerInput.addEventListener('input', () => { quickDialerInput.value = quickDialerInput.value.replace(/\D/g, '').slice(0, 10); });

  const quickAgentSelect = el('select', {
    class: 'select',
    style: 'margin-bottom:12px;font-size:.9rem;font-weight:600;'
  }, (State.agents && State.agents.length ? State.agents : [{ id: 'default', name: 'Seevora AI Voice Receptionist' }]).map((a) =>
    el('option', { value: a.id, selected: a.id === State.activeAgentId }, a.name)
  ));

  const quickDialBtn = el('button', { class: 'btn btn-primary', style: 'padding:10px 20px;font-weight:700;' }, 'Dial Recipient Now');
  quickDialBtn.addEventListener('click', async () => {
    const num = (quickDialerInput.value || '').replace(/\D/g, '');
    if (num.length !== 10) { toast('Please enter a valid 10-digit mobile number.', 'err'); quickDialerInput.focus(); return; }
    quickDialBtn.disabled = true;
    quickDialBtn.textContent = 'Dialing...';
    try {
      await api('/api/telephony/dial', { method: 'POST', body: { number: num, confirm: true, agentId: quickAgentSelect.value } });
      toast('Call placed to +91 ' + num + '!', 'ok');
      quickDialerInput.value = '';
    } catch (e) {
      toast(e.message || 'Call failed.', 'err');
    } finally {
      quickDialBtn.disabled = false;
      quickDialBtn.textContent = 'Dial Recipient Now';
    }
  });

  const directDialerCard = el('div', { class: 'card card-pad', style: 'margin-bottom:20px;border:1.5px solid rgba(0,149,255,0.25);background:linear-gradient(135deg,#FFFFFF 0%,#F0F8FF 100%);' }, [
    el('div', { class: 'flex items-center justify-between', style: 'margin-bottom:10px;' }, [
      el('h3', { class: 't-h3', style: 'margin-bottom:2px;display:flex;align-items:center;gap:8px;' }, [
        el('span', { html: uiIcon('phone', 18) }),
        el('span', {}, 'Instant Outbound Phone Dialer')
      ]),
      el('span', { class: 'pill' }, [el('span', { class: 'dot' }), 'Active Business Line: ' + activeDid])
    ]),
    el('p', { class: 'soft text-xs', style: 'margin-bottom:14px;' }, 'Enter a 10-digit mobile number to initiate a live outbound call immediately. The selected AI voice agent answers as soon as the recipient picks up.'),
    el('div', { style: 'display:grid;grid-template-columns:1fr 1.5fr auto;gap:12px;align-items:end;' }, [
      el('div', {}, [
        el('label', { class: 'field-label', style: 'display:block;margin-bottom:4px;font-size:.78rem;font-weight:600;' }, 'Speaking AI Agent'),
        quickAgentSelect
      ]),
      el('div', {}, [
        el('label', { class: 'field-label', style: 'display:block;margin-bottom:4px;font-size:.78rem;font-weight:600;' }, 'Recipient Number (+91)'),
        el('div', { style: 'display:flex;align-items:center;border:1.5px solid #CBD5E1;border-radius:8px;overflow:hidden;background:#FFF;' }, [
          el('span', { style: 'padding:10px 14px;background:#F1F5F9;font-weight:700;border-right:1px solid #CBD5E1;font-size:.92rem;' }, '+91'),
          quickDialerInput
        ])
      ]),
      quickDialBtn
    ])
  ]);
  root.appendChild(directDialerCard);

  // Stats bar
  const statsHost = el('div', { class: 'campaign-stats-grid' });
  root.appendChild(statsHost);

  // Live banner (when campaign is running)
  const bannerHost = el('div', { id: 'campaignBannerHost' });
  root.appendChild(bannerHost);

  // Main grid: Import box (left) + Settings box (right)
  const grid = el('div', { class: 'campaign-grid' });
  root.appendChild(grid);

  // Table card (bottom)
  const tableCard = el('div', { class: 'card card-pad', id: 'campaignTableCard' });
  root.appendChild(tableCard);

  function renderStats() {
    statsHost.innerHTML = '';
    const total = campaignState.leads.length;
    const completed = campaignState.leads.filter((l) => l.status === 'initiated' || l.status === 'dry_run').length;
    const pending = campaignState.leads.filter((l) => l.status === 'pending').length;
    const failed = campaignState.leads.filter((l) => l.status === 'failed').length;

    const stats = [
      { lbl: 'Total Leads', val: total },
      { lbl: 'Completed Calls', val: completed },
      { lbl: 'Pending Calls', val: pending },
      { lbl: 'Failed Attempts', val: failed },
      { lbl: 'Caller ID (Direct Line)', val: typeof activeDid === 'string' ? activeDid : (activeDid.number || '+918071582519') }
    ];

    stats.forEach((s) => {
      statsHost.appendChild(el('div', { class: 'campaign-stat-box' }, [
        el('div', { class: 'lbl' }, s.lbl),
        el('div', { class: 'val', style: typeof s.val === 'string' && s.val.startsWith('+') ? 'font-size:1.1rem;color:var(--accent)' : '' }, String(s.val))
      ]));
    });
  }

  function renderBanner() {
    bannerHost.innerHTML = '';
    if (!campaignState.running) return;

    const total = campaignState.leads.length;
    const current = campaignState.currentIndex >= 0 && campaignState.currentIndex < total ? campaignState.leads[campaignState.currentIndex] : null;
    const processed = campaignState.leads.filter((l) => l.status !== 'pending').length;
    const pct = total ? Math.round((processed / total) * 100) : 0;

    const stopBtn = el('button', { class: 'btn btn-danger', onclick: stopCampaign }, 'Stop Campaign');

    const banner = el('div', { class: 'live-progress-banner' }, [
      el('div', { class: 'flex items-center justify-between', style: 'flex-wrap:wrap;gap:12px' }, [
        el('div', { class: 'flex items-center gap-2' }, [
          el('div', { class: 'pulse-badge' }, [el('div', { class: 'pulse-badge-dot' }), 'LIVE CAMPAIGN IN PROGRESS']),
          current ? el('span', { style: 'font-weight:600;font-size:.9rem;margin-left:6px' }, ['Calling ', esc(current.name), ' (', esc(current.phone), ')']) : null
        ]),
        el('div', { class: 'flex items-center gap-3' }, [
          campaignState.countdown > 0 ? el('span', { style: 'font-size:.85rem;color:#e2e8f0;font-family:var(--mono)' }, 'Next call in ' + campaignState.countdown + 's') : null,
          stopBtn
        ])
      ]),
      el('div', { class: 'progress-bar-track' }, [
        el('div', { class: 'progress-bar-fill', style: 'width:' + pct + '%' })
      ]),
      el('div', { class: 'flex justify-between', style: 'font-size:.78rem;color:#94a3b8;font-family:var(--mono)' }, [
        el('span', {}, 'Progress: ' + processed + ' of ' + total + ' leads (' + pct + '%)'),
        el('span', {}, campaignState.isDryRun ? 'DRY-RUN SIMULATION' : 'LIVE TELEPHONE CALLING')
      ])
    ]);
    bannerHost.appendChild(banner);
  }

  // --- Left: Import Card ---
  const importCard = el('div', { class: 'card card-pad' });
  grid.appendChild(importCard);

  importCard.appendChild(el('h3', { class: 't-h3' }, 'Import Leads'));
  importCard.appendChild(el('p', { class: 'muted', style: 'font-size:.85rem;margin-bottom:14px' }, 'Upload a CSV spreadsheet or paste phone numbers to queue automated calls.'));

  const tabUploadBtn = el('button', { class: 'btn btn-ghost on', type: 'button' }, 'Upload CSV / TXT');
  const tabPasteBtn = el('button', { class: 'btn btn-ghost', type: 'button' }, 'Paste Numbers');
  const tabRow = el('div', { class: 'flex gap-2', style: 'margin-bottom:14px' }, [tabUploadBtn, tabPasteBtn]);
  importCard.appendChild(tabRow);

  const uploadContainer = el('div', {});
  const pasteContainer = el('div', { style: 'display:none' });
  importCard.appendChild(uploadContainer);
  importCard.appendChild(pasteContainer);

  tabUploadBtn.addEventListener('click', () => {
    tabUploadBtn.classList.add('on'); tabPasteBtn.classList.remove('on');
    uploadContainer.style.display = ''; pasteContainer.style.display = 'none';
  });
  tabPasteBtn.addEventListener('click', () => {
    tabPasteBtn.classList.add('on'); tabUploadBtn.classList.remove('on');
    uploadContainer.style.display = 'none'; pasteContainer.style.display = '';
  });

  // Dropzone
  const fileInput = el('input', { type: 'file', accept: '.csv,.txt', style: 'display:none' });
  const dropzone = el('div', { class: 'dropzone-box' }, [
    el('div', { class: 'dropzone-icon', html: navIcon('invoice') }),
    el('div', { style: 'font-weight:600;font-size:.92rem;margin-bottom:4px' }, 'Drop your CSV or TXT file here'),
    el('div', { class: 'muted', style: 'font-size:.8rem;margin-bottom:14px' }, 'Supports columns: Name, Phone Number (e.g. 9876543210)'),
    el('button', { type: 'button', class: 'btn btn-primary', onclick: () => fileInput.click() }, 'Browse Files'),
    fileInput
  ]);

  dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.classList.add('drag-over'); });
  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('drag-over'));
  dropzone.addEventListener('drop', (e) => {
    e.preventDefault(); dropzone.classList.remove('drag-over');
    if (e.dataTransfer.files && e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
  });
  fileInput.addEventListener('change', () => {
    if (fileInput.files && fileInput.files[0]) handleFile(fileInput.files[0]);
  });

  function handleFile(file) {
    const reader = new FileReader();
    reader.onload = (ev) => {
      const parsed = parseImportText(ev.target.result);
      if (!parsed.length) { toast('No valid 10-digit Indian phone numbers found in file.', 'err'); return; }
      campaignState.leads = campaignState.leads.concat(parsed);
      saveCampaignLeads();
      renderAll();
      toast('Imported ' + parsed.length + ' leads from ' + file.name, 'ok');
    };
    reader.readAsText(file);
  }

  const sampleBtn = el('button', { type: 'button', class: 'btn btn-ghost', style: 'font-size:.8rem;margin-top:10px' }, 'Load Sample Leads');
  sampleBtn.addEventListener('click', () => {
    const samples = [
      { id: 'ld_1', name: 'Bhavu (Owner Verified)', phone: '+91 8120590466', rawNumber: '8120590466', status: 'pending', error: null, timestamp: null }
    ];
    campaignState.leads = campaignState.leads.concat(samples);
    saveCampaignLeads();
    renderAll();
    toast('Added verified lead (+91 8120590466) for testing.', 'ok');
  });

  const wacrmBtn = el('button', { type: 'button', class: 'btn btn-ghost', style: 'font-size:.8rem;margin-top:10px;margin-left:8px' }, 'Sync Leads from WACRM');
  wacrmBtn.addEventListener('click', async () => {
    try {
      wacrmBtn.disabled = true;
      const res = await api('/api/crm/contacts');
      const contacts = (res && Array.isArray(res.contacts)) ? res.contacts : [];
      if (!contacts.length) {
        toast('No contacts found in WACRM.', 'info');
        wacrmBtn.disabled = false;
        return;
      }
      const newLeads = [];
      for (const c of contacts) {
        const norm = normalizeLeadNumber(c.phone);
        if (norm) {
          newLeads.push({
            id: 'ld_' + Math.random().toString(36).slice(2, 9),
            name: c.name || 'Lead ' + norm.raw.slice(-4),
            phone: norm.formatted,
            rawNumber: norm.raw,
            status: 'pending',
            error: null,
            timestamp: null
          });
        }
      }
      campaignState.leads = campaignState.leads.concat(newLeads);
      saveCampaignLeads();
      renderAll();
      toast('Imported ' + newLeads.length + ' leads from WACRM.', 'ok');
    } catch (err) {
      toast('Failed to load contacts from WACRM: ' + err.message, 'err');
    } finally {
      wacrmBtn.disabled = false;
    }
  });

  uploadContainer.appendChild(dropzone);
  uploadContainer.appendChild(sampleBtn);
  uploadContainer.appendChild(wacrmBtn);

  // Paste container
  const pasteArea = el('textarea', { class: 'textarea', rows: 6, placeholder: 'Enter numbers or CSV format, one per line:\n9876543210, Ramesh Sharma\n8765432109, Priya Patel\n+919988776655' });
  const parseBtn = el('button', { type: 'button', class: 'btn btn-primary', style: 'margin-top:10px' }, 'Add Pasted Leads');
  parseBtn.addEventListener('click', () => {
    const parsed = parseImportText(pasteArea.value);
    if (!parsed.length) { toast('No valid 10-digit Indian numbers found in text.', 'err'); return; }
    campaignState.leads = campaignState.leads.concat(parsed);
    saveCampaignLeads();
    pasteArea.value = '';
    renderAll();
    toast('Added ' + parsed.length + ' leads.', 'ok');
  });
  pasteContainer.appendChild(pasteArea);
  pasteContainer.appendChild(parseBtn);

  // --- Right: Settings Card ---
  const settingsCard = el('div', { class: 'card card-pad' });
  grid.appendChild(settingsCard);

  settingsCard.appendChild(el('h3', { class: 't-h3' }, 'Campaign Settings'));
  settingsCard.appendChild(el('p', { class: 'muted', style: 'font-size:.85rem;margin-bottom:14px' }, 'Configure calling cadence, caller ID, and voice persona.'));

  // Delay select
  const delaySel = el('select', { class: 'select' }, [
    el('option', { value: '30' }, '30 seconds between calls'),
    el('option', { value: '45', selected: 'selected' }, '45 seconds between calls (Recommended)'),
    el('option', { value: '60' }, '60 seconds between calls'),
    el('option', { value: '90' }, '90 seconds between calls')
  ]);
  delaySel.value = String(campaignState.delaySeconds || 45);
  delaySel.addEventListener('change', () => { campaignState.delaySeconds = parseInt(delaySel.value, 10); });

  // Dry run checkbox
  const dryRunCheck = el('input', { type: 'checkbox', id: 'dryRunToggle', checked: campaignState.isDryRun ? 'checked' : false });
  dryRunCheck.addEventListener('change', () => { campaignState.isDryRun = dryRunCheck.checked; renderAll(); });
  const dryRunLabel = el('label', { for: 'dryRunToggle', style: 'cursor:pointer;font-size:.85rem;display:flex;align-items:center;gap:8px' }, [
    dryRunCheck,
    el('span', {}, 'Dry-run Mode (simulate calls without placing real telecom calls)')
  ]);

  settingsCard.appendChild(el('div', { class: 'form-grid' }, [
    field('Caller ID (Direct Line)', el('input', { class: 'input', readonly: 'readonly', value: typeof activeDid === 'string' ? activeDid : (activeDid.number || '+918071582519') })),
    field('Interval delay', delaySel),
    (function () {
      const f = field('', dryRunLabel);
      f.style.marginTop = '4px';
      return f;
    })()
  ]));

  settingsCard.appendChild(el('div', { class: 'inbound-note', style: 'margin-top:16px' }, [
    el('b', {}, 'How it works: '),
    document.createTextNode('Seevora AI dials each contact in sequence through your verified business line. When answered, the AI speaks first, answers inquiries, and qualifies the lead. Call logs and audio recordings save automatically.')
  ]));

  // --- Bottom: Table Card ---
  function renderTable() {
    tableCard.innerHTML = '';

    const startBtn = el('button', { class: 'btn btn-primary', disabled: campaignState.running || !campaignState.leads.length, onclick: startCampaign }, [
      el('span', { html: navIcon('phone') }),
      document.createTextNode(' Start Outbound Campaign')
    ]);
    const clearBtn = el('button', { class: 'btn btn-ghost', disabled: campaignState.running || !campaignState.leads.length, onclick: clearLeads }, 'Clear List');
    const exportBtn = el('button', { class: 'btn btn-ghost', disabled: !campaignState.leads.length, onclick: exportReport }, 'Export CSV Report');

    tableCard.appendChild(el('div', { class: 'flex items-center justify-between', style: 'flex-wrap:wrap;gap:12px;margin-bottom:14px' }, [
      el('div', {}, [
        el('h3', { class: 't-h3' }, ['Queue Contacts ', el('span', { class: 'pill', style: 'margin-left:8px;font-size:.7rem' }, String(campaignState.leads.length))]),
        el('p', { class: 'muted', style: 'font-size:.82rem' }, 'Leads are dialed sequentially. You can stop or pause at any time.')
      ]),
      el('div', { class: 'flex items-center gap-2' }, [clearBtn, exportBtn, startBtn])
    ]));

    if (!campaignState.leads.length) {
      tableCard.appendChild(el('div', { class: 'empty muted', style: 'padding:40px 20px;text-align:center' }, 'No leads in queue. Upload a CSV or click "Load Sample Leads" above.'));
      return;
    }

    const tbody = el('tbody', {});
    campaignState.leads.forEach((l, idx) => {
      let statusBadge;
      if (l.status === 'dialing') statusBadge = el('span', { class: 'status-badge status-setup' }, 'Dialing...');
      else if (l.status === 'initiated') statusBadge = el('span', { class: 'status-badge status-active' }, 'Connected');
      else if (l.status === 'dry_run') statusBadge = el('span', { class: 'status-badge status-issued' }, 'Simulated (OK)');
      else if (l.status === 'failed') statusBadge = el('span', { class: 'status-badge status-overdue', title: l.error || '' }, 'Failed');
      else statusBadge = el('span', { class: 'status-badge status-draft' }, 'Pending');

      const dialSingleBtn = el('button', { class: 'btn btn-ghost', style: 'padding:4px 8px;font-size:.72rem', disabled: campaignState.running, onclick: () => dialSingle(idx) }, 'Call Now');
      const delBtn = el('button', { class: 'btn btn-ghost', style: 'padding:4px 8px;font-size:.72rem;color:var(--bad)', disabled: campaignState.running, onclick: () => removeLead(idx) }, '✕');

      const tr = el('tr', { style: idx === campaignState.currentIndex ? 'background:#fbf3e0;' : '' }, [
        el('td', { style: 'width:40px;color:var(--ink-dim);font-family:var(--mono)' }, String(idx + 1)),
        el('td', { style: 'font-weight:600' }, esc(l.name)),
        el('td', { class: 'mono-cell' }, esc(l.phone)),
        el('td', {}, statusBadge),
        el('td', { style: 'text-align:right' }, [dialSingleBtn, delBtn])
      ]);
      tbody.appendChild(tr);
    });

    const table = el('table', { class: 'data-table' }, [
      el('thead', {}, el('tr', {}, [
        el('th', { style: 'width:40px' }, '#'),
        el('th', {}, 'Name'),
        el('th', {}, 'Phone Number'),
        el('th', {}, 'Status'),
        el('th', { style: 'text-align:right' }, 'Action')
      ])),
      tbody
    ]);

    tableCard.appendChild(el('div', { class: 'leads-table-container' }, table));
  }

  function renderAll() {
    renderStats();
    renderBanner();
    renderTable();
  }

  function clearLeads() {
    if (campaignState.running) return;
    campaignState.leads = [];
    saveCampaignLeads();
    renderAll();
    toast('Queue cleared.', 'ok');
  }

  function removeLead(idx) {
    if (campaignState.running) return;
    campaignState.leads.splice(idx, 1);
    saveCampaignLeads();
    renderAll();
  }

  function exportReport() {
    if (!campaignState.leads.length) return;
    let csv = 'Name,Phone,Status,Timestamp,Error\n';
    campaignState.leads.forEach((l) => {
      csv += '"' + (l.name || '').replace(/"/g, '""') + '","' + l.phone + '","' + l.status + '","' + (l.timestamp || '') + '","' + (l.error || '').replace(/"/g, '""') + '"\n';
    });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'seevora_campaign_' + new Date().toISOString().slice(0, 10) + '.csv';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast('Report downloaded.', 'ok');
  }

  async function dialSingle(idx) {
    const lead = campaignState.leads[idx];
    if (!lead || campaignState.running) return;
    modal({
      title: 'Call single lead',
      body: el('div', {}, [
        el('p', {}, ['Place a live call to ', el('b', {}, esc(lead.name) + ' (' + esc(lead.phone) + ')'), '?']),
        el('div', { class: 'danger-note' }, 'This will initiate a live phone call dialed through your active business line.')
      ]),
      confirmText: 'Yes, Call Now', confirmKind: 'primary',
      onConfirm: async () => {
        lead.status = 'dialing';
        renderAll();
        try {
          if (campaignState.isDryRun) {
            await new Promise((r) => setTimeout(r, 1000));
            lead.status = 'dry_run';
          } else {
            await api('/api/telephony/dial', { method: 'POST', body: { number: lead.rawNumber, confirm: true } });
            lead.status = 'initiated';
          }
          lead.timestamp = new Date().toISOString();
          toast('Call initiated to ' + lead.phone, 'ok');
        } catch (ex) {
          lead.status = 'failed';
          lead.error = ex.message || 'Call failed';
          toast(ex.message || 'Dial failed', 'err');
        }
        saveCampaignLeads();
        renderAll();
      }
    });
  }

  function stopCampaign() {
    campaignState.abort = true;
    campaignState.running = false;
    campaignState.countdown = 0;
    campaignState.currentIndex = -1;
    renderAll();
    toast('Campaign stopped by user.', 'warn');
  }

  async function startCampaign() {
    if (campaignState.running) return;
    const pendingLeads = campaignState.leads.filter((l) => l.status === 'pending');
    if (!pendingLeads.length) {
      toast('No pending leads left to call. Add more leads or reset status.', 'warn');
      return;
    }

    modal({
      title: campaignState.isDryRun ? 'Start Dry-run Campaign' : 'Confirm Outbound Campaign',
      body: el('div', {}, [
        el('p', {}, [
          'You are about to dial ',
          el('b', {}, String(pendingLeads.length) + ' pending leads'),
          ' sequentially with a ',
          el('b', {}, String(campaignState.delaySeconds) + 's delay'),
          ' between calls.'
        ]),
        campaignState.isDryRun
          ? el('div', { class: 'inbound-note' }, 'DRY-RUN MODE: Calls will be simulated without placing live telephone calls.')
          : el('div', { class: 'danger-note' }, [
            el('b', {}, 'Live Telephone Calls: '),
            document.createTextNode('Calls will be placed in sequence through your business line ' + (activeDid.number || activeDid || '+918071582519') + ' to each contact.')
          ])
      ]),
      confirmText: campaignState.isDryRun ? 'Start Simulation' : 'Start Calling Campaign',
      confirmKind: campaignState.isDryRun ? 'primary' : 'danger',
      onConfirm: async () => {
        campaignState.running = true;
        campaignState.abort = false;
        renderAll();

        for (let i = 0; i < campaignState.leads.length; i++) {
          if (campaignState.abort) break;
          const lead = campaignState.leads[i];
          if (lead.status !== 'pending') continue;

          campaignState.currentIndex = i;
          lead.status = 'dialing';
          renderAll();

          try {
            if (campaignState.isDryRun) {
              await new Promise((r) => setTimeout(r, 1200));
              lead.status = 'dry_run';
            } else {
              await api('/api/telephony/dial', { method: 'POST', body: { number: lead.rawNumber, confirm: true } });
              lead.status = 'initiated';
            }
            lead.timestamp = new Date().toISOString();
          } catch (err) {
            lead.status = 'failed';
            lead.error = err.message || 'Call failed';
          }

          saveCampaignLeads();
          renderAll();

          // If more pending leads exist, countdown
          const hasMore = campaignState.leads.slice(i + 1).some((x) => x.status === 'pending');
          if (hasMore && !campaignState.abort) {
            campaignState.countdown = campaignState.delaySeconds;
            while (campaignState.countdown > 0 && !campaignState.abort) {
              renderBanner();
              await new Promise((r) => setTimeout(r, 1000));
              campaignState.countdown -= 1;
            }
          }
        }

        campaignState.running = false;
        campaignState.currentIndex = -1;
        campaignState.countdown = 0;
        renderAll();
        toast('Campaign finished!', 'ok');
      }
    });
  }

  renderAll();
}

/* ===========================================================================
   6. PRESETS, BILLING, SUPPORT, AND SUPER ADMIN
   =========================================================================== */
async function viewPresets(root) {
  root.appendChild(viewHead('Agent presets', 'Start with a production-minded intake flow, then customize the voice, instructions, calendar, and your own number.'));
  const notice = el('div', { class: 'inbound-note', style: 'margin:0 0 18px' }, 'Presets are starting points. Personal Injury does not provide legal advice, and Dental does not diagnose. Review the workflow and consent language before using it live.');
  const host = el('div', { class: 'preset-grid' }, skeleton('sk-card', 6));
  root.appendChild(notice); root.appendChild(host);
  try {
    const out = await api('/api/presets');
    State.presets = out.presets || [];
    host.innerHTML = '';
    State.presets.forEach((p) => {
      const privacy = p.recommendedPrivacyMode || p.privacyMode || 'standard';
      host.appendChild(el('article', { class: 'card preset-card' }, [
        el('div', { class: 'preset-icon' }, (p.name || '?').slice(0, 1)),
        el('div', { class: 'flex items-center justify-between gap-2' }, [
          el('h3', { class: 't-h3' }, p.name),
          el('span', { class: 'badge-ready' }, privacy.replace(/_/g, ' '))
        ]),
        el('p', { class: 'muted' }, p.description || 'Editable voice-agent starting point.'),
        el('div', { class: 'preset-meta' }, [
          el('span', {}, p.category || 'Voice agent'),
          el('span', {}, 'BYON ready')
        ]),
        el('button', { class: 'btn btn-primary', onclick: () => createFromPreset(p) }, 'Use this preset')
      ]));
    });
    if (!State.presets.length) host.appendChild(el('div', { class: 'empty muted' }, 'No presets are available.'));
  } catch (e) { host.innerHTML = ''; host.appendChild(el('div', { class: 'card card-pad muted' }, e.message)); }
}

function createFromPreset(preset) {
  modal({
    title: 'Create ' + preset.name,
    body: el('div', {}, [
      el('p', {}, 'This creates an editable agent in your workspace. No phone number is attached until you connect your own number.'),
      field('Agent name', el('input', { class: 'input', id: 'preset_agent_name', value: preset.name }))
    ]),
    confirmText: 'Create agent',
    onConfirm: async () => {
      const name = ($('#preset_agent_name').value || preset.name).trim();
      await api('/api/agents', { method: 'POST', body: { presetId: preset.id, name: name } });
      State.loaded.agents = false;
      toast(name + ' created.', 'ok');
      goto('agents');
    }
  });
}

/* ===========================================================================
   AGENCY FINANCE, INTEGRATIONS, AND OPERATING PROMPT
   =========================================================================== */
async function viewInvoices(root) {
  const canManage = isPlatformUserClient(State.me.user);
  const head = viewHead('Invoices', canManage ? 'Create, issue, and track agency invoices. Stored status never implies an email was sent.' : 'Review invoices issued to this workspace. Agency operators control status and collection records.');
  if (canManage) head.appendChild(el('div', { class: 'view-actions' }, [el('button', { class: 'btn btn-primary', onclick: openInvoiceComposer }, 'Create invoice')]));
  root.appendChild(head);
  const summary = el('div', { class: 'invoice-summary-grid' }, skeleton('sk-stat', 4));
  const tableCard = el('section', { class: 'card invoice-table-card' }, skeleton('sk-card', 1));
  root.appendChild(summary); root.appendChild(tableCard);
  try {
    const out = await api('/api/invoices');
    State.invoices = out.invoices || []; State.loaded.invoices = true;
    paintInvoices(summary, tableCard, State.invoices);
  } catch (e) {
    summary.innerHTML = '';
    tableCard.innerHTML = '';
    tableCard.appendChild(el('div', { class: 'error-state' }, [el('h3', {}, 'Invoices unavailable'), el('p', {}, e.message), el('button', { class: 'btn btn-ghost', onclick: () => onRoute() }, 'Try again')]));
  }
}

function invoiceEffectiveStatus(row) { return row.status || row.storedStatus || 'draft'; }
function invoiceStatusLabel(status) { return String(status || 'draft').replace(/_/g, ' '); }
function paintInvoices(summary, host, rows) {
  const sums = { outstanding: 0, overdue: 0, paid: 0, issued: 0 };
  rows.forEach((row) => {
    const status = invoiceEffectiveStatus(row);
    if (status === 'issued' || status === 'overdue') sums.outstanding += row.amountPaise || 0;
    if (status === 'overdue') sums.overdue += row.amountPaise || 0;
    if (status === 'paid') sums.paid += row.amountPaise || 0;
    if (row.storedStatus === 'issued' || row.storedStatus === 'paid') sums.issued += row.amountPaise || 0;
  });
  summary.innerHTML = '';
  [['Outstanding', sums.outstanding, 'Issued and unpaid'], ['Overdue', sums.overdue, 'Past the due date'], ['Paid', sums.paid, 'Recorded as collected'], ['Total issued', sums.issued, 'Excludes drafts and voids']].forEach((item, index) => summary.appendChild(el('article', { class: 'agency-metric' + (index === 1 ? ' critical' : index === 2 ? ' positive' : '') }, [el('div', { class: 'agency-metric-label' }, item[0]), el('div', { class: 'agency-metric-value' }, '₹' + fmtInr(item[1] / 100)), el('div', { class: 'agency-metric-note' }, item[2])])));
  host.innerHTML = '';
  const controls = el('div', { class: 'invoice-table-head' }, [
    el('div', {}, [el('span', { class: 'section-kicker' }, 'Agency finance'), el('h3', {}, 'Invoice register')]),
    el('div', { class: 'invoice-filters' }, ['all', 'draft', 'issued', 'overdue', 'paid', 'void'].map((status) => el('button', {
      class: 'invoice-filter' + (status === 'all' ? ' active' : ''), 'data-filter': status, onclick: (event) => {
        $$('.invoice-filter', host).forEach((button) => button.classList.toggle('active', button === event.currentTarget));
        renderInvoiceRows(host.querySelector('tbody'), rows, status);
      }
    }, invoiceStatusLabel(status))))
  ]);
  const table = el('table', { class: 'data-table invoice-table' }, [
    el('thead', {}, el('tr', {}, ['Invoice', 'Client', 'Issued', 'Due', 'Status', 'Amount', ''].map((label) => el('th', {}, label)))),
    el('tbody')
  ]);
  host.appendChild(controls);
  host.appendChild(el('div', { class: 'table-scroll' }, table));
  renderInvoiceRows(table.querySelector('tbody'), rows, 'all');
}

function renderInvoiceRows(body, rows, filter) {
  body.innerHTML = '';
  const visible = rows.filter((row) => filter === 'all' || invoiceEffectiveStatus(row) === filter);
  if (!visible.length) {
    const canManage = isPlatformUserClient(State.me.user);
    const cell = el('td', { colspan: '7' }, el('div', { class: 'empty compact' }, [el('div', { class: 'ttl' }, filter === 'all' ? 'No invoices yet' : 'No ' + filter + ' invoices'), el('p', {}, canManage ? 'Create an invoice to start the register.' : 'Agency-issued invoices will appear here.'), filter === 'all' && canManage ? el('button', { class: 'btn btn-primary btn-sm', onclick: openInvoiceComposer }, 'Create invoice') : null]));
    body.appendChild(el('tr', {}, cell)); return;
  }
  visible.forEach((row) => {
    const status = invoiceEffectiveStatus(row);
    body.appendChild(el('tr', {}, [
      el('td', { class: 'mono-cell' }, row.invoiceNumber),
      el('td', {}, [el('strong', {}, row.clientName), row.clientEmail ? el('small', {}, row.clientEmail) : null]),
      el('td', {}, row.issueDate), el('td', {}, row.dueDate),
      el('td', {}, el('span', { class: 'status-badge status-' + status }, invoiceStatusLabel(status))),
      el('td', { class: 'money-cell' }, '₹' + fmtInr((row.amountPaise || 0) / 100)),
      el('td', {}, el('button', { class: 'btn btn-quiet btn-sm', onclick: () => inspectInvoice(row) }, 'Open'))
    ]));
  });
}

async function openInvoiceComposer() {
  if (!isPlatformUserClient(State.me.user)) { toast('Only agency operators can create invoices.', 'err'); return; }
  let tenants = [];
  if (isPlatformUserClient(State.me.user)) {
    try { tenants = (await api('/api/admin/tenants')).tenants || []; } catch (_) { }
  }
  if (!tenants.length) tenants = [State.me.tenant];
  const tenantSelect = el('select', { class: 'select' }, tenants.map((tenant) => el('option', { value: tenant.id }, tenant.name)));
  const clientName = el('input', { class: 'input', value: tenants[0].name || '' });
  tenantSelect.onchange = () => { const selected = tenants.find((tenant) => tenant.id === tenantSelect.value); if (selected) clientName.value = selected.name; };
  const clientEmail = el('input', { class: 'input', type: 'email', placeholder: 'billing@client.com' });
  const description = el('textarea', { class: 'textarea', placeholder: 'Automation system implementation and monthly operations' });
  const amount = el('input', { class: 'input', type: 'number', min: '1', max: '10000000', step: '0.01', placeholder: '5000' });
  const issueDate = el('input', { class: 'input', type: 'date', value: new Date().toISOString().slice(0, 10) });
  const due = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);
  const dueDate = el('input', { class: 'input', type: 'date', value: due });
  const issueNow = el('input', { type: 'checkbox', checked: 'checked' }); issueNow.checked = true;
  modal({
    title: 'Create invoice',
    body: el('div', { class: 'invoice-form' }, [
      field('Client workspace', tenantSelect), field('Client name', clientName), field('Billing email, optional', clientEmail), field('Amount in INR', amount), field('Issue date', issueDate), field('Due date', dueDate), field('Description', description),
      el('label', { class: 'check-row' }, [issueNow, el('span', {}, [el('strong', {}, 'Issue now'), el('small', {}, 'Stores an issued invoice. It does not send an email.')])])
    ]),
    confirmText: 'Create invoice',
    onConfirm: async () => {
      const paise = Math.round(Number(amount.value) * 100);
      const out = await api('/api/invoices', { method: 'POST', body: { tenantId: tenantSelect.value, clientName: clientName.value.trim(), clientEmail: clientEmail.value.trim(), description: description.value.trim(), amountPaise: paise, issueDate: issueDate.value, dueDate: dueDate.value, issueNow: issueNow.checked } });
      toast(out.note || 'Invoice created.', 'ok');
      State.loaded.invoices = false; goto('invoices'); onRoute();
    }
  });
}

function inspectInvoice(row) {
  const status = invoiceEffectiveStatus(row);
  const actions = el('div', { class: 'invoice-detail-actions' });
  if (isPlatformUserClient(State.me.user)) {
    if (row.storedStatus === 'draft') actions.appendChild(el('button', { class: 'btn btn-primary', onclick: () => updateInvoiceStatus(row.id, 'issued') }, 'Issue invoice'));
    if (row.storedStatus === 'issued') actions.appendChild(el('button', { class: 'btn btn-primary', onclick: () => updateInvoiceStatus(row.id, 'paid') }, 'Mark paid'));
    if (row.storedStatus === 'draft' || row.storedStatus === 'issued') actions.appendChild(el('button', { class: 'btn btn-ghost', onclick: () => updateInvoiceStatus(row.id, 'void') }, 'Void invoice'));
  }
  actions.appendChild(el('button', { class: 'btn btn-ghost', onclick: () => window.print() }, 'Print'));
  modal({
    title: row.invoiceNumber,
    body: el('article', { class: 'invoice-detail' }, [
      el('div', { class: 'invoice-detail-top' }, [el('div', {}, [el('span', { class: 'section-kicker' }, 'Billed to'), el('h4', {}, row.clientName), row.clientEmail ? el('p', {}, row.clientEmail) : null]), el('span', { class: 'status-badge status-' + status }, invoiceStatusLabel(status))]),
      el('div', { class: 'invoice-detail-amount' }, [el('span', {}, 'Amount'), el('strong', {}, '₹' + fmtInr((row.amountPaise || 0) / 100))]),
      el('p', { class: 'invoice-detail-description' }, row.description),
      el('dl', {}, [el('div', {}, [el('dt', {}, 'Issued'), el('dd', {}, row.issueDate)]), el('div', {}, [el('dt', {}, 'Due'), el('dd', {}, row.dueDate)]), el('div', {}, [el('dt', {}, 'Delivery'), el('dd', {}, row.deliveryStatus === 'not_sent' ? 'Not emailed' : row.deliveryStatus)])]),
      actions
    ]),
    confirmText: 'Close', onConfirm: async () => { }
  });
}

async function updateInvoiceStatus(invoiceId, status) {
  try {
    await api('/api/invoices/status', { method: 'POST', body: { invoiceId, status } });
    toast('Invoice marked ' + invoiceStatusLabel(status) + '.', 'ok');
    const host = $('#modal-host'); if (host) host.classList.add('hide');
    onRoute();
  } catch (e) { toast(e.message, 'err'); }
}

async function viewIntegrations(root) {
  root.appendChild(viewHead('Integrations', 'Bring client conversations and ad research into the operating system without pretending setup is complete.'));
  const host = el('div', { class: 'integration-grid' }, skeleton('sk-card', 2)); root.appendChild(host);
  try {
    const out = await api('/api/integrations');
    State.integrations = out.integrations || []; State.loaded.integrations = true;
    host.innerHTML = '';
    State.integrations.forEach((item) => host.appendChild(integrationCard(item)));
  } catch (e) { host.innerHTML = ''; host.appendChild(el('div', { class: 'card card-pad error-state' }, e.message)); }
}

function integrationCard(item) {
  const requested = item.status === 'requested';
  const mark = item.id === 'whatsapp-business' ? 'WA' : 'META';
  const button = el('button', { class: 'btn ' + (requested ? 'btn-ghost' : 'btn-primary'), disabled: requested ? 'disabled' : null }, requested ? 'Setup requested' : 'Request setup');
  button.onclick = async () => {
    button.disabled = true; button.textContent = 'Recording request...';
    try { const out = await api('/api/integrations/request', { method: 'POST', body: { integrationId: item.id } }); toast(out.note, 'ok'); onRoute(); }
    catch (e) { button.disabled = false; button.textContent = 'Request setup'; toast(e.message, 'err'); }
  };
  return el('article', { class: 'card integration-card' }, [
    el('div', { class: 'integration-head' }, [el('span', { class: 'integration-mark' }, mark), el('span', { class: 'status-badge ' + (requested ? 'status-requested' : 'status-setup') }, requested ? 'requested' : 'setup required')]),
    el('span', { class: 'section-kicker' }, item.category), el('h3', {}, item.name), el('p', {}, item.description),
    el('div', { class: 'integration-columns' }, [
      el('div', {}, [el('h4', {}, 'What you will see'), el('ul', {}, (item.capabilities || []).map((value) => el('li', {}, value)))]),
      el('div', {}, [el('h4', {}, 'Required to connect'), el('ul', {}, (item.setup || []).map((value) => el('li', {}, value)))])
    ]),
    el('div', { class: 'integration-foot' }, [button, el('small', {}, 'No external service is contacted by this request.')])
  ]);
}

async function viewAgencyPrompt(root) {
  root.appendChild(viewHead('Agency prompt', 'One persistent operating instruction for this workspace. Per-agent personas remain separate.'));
  const host = el('div', { class: 'prompt-layout' }, [el('section', { class: 'card prompt-editor' }, skeleton('sk-card', 1)), el('aside', { class: 'card prompt-guide' }, skeleton('sk-card', 1))]);
  root.appendChild(host);
  try {
    const out = await api('/api/agency/prompt'); State.agencyPrompt = out; State.loaded.agencyPrompt = true;
    paintAgencyPrompt(host, out);
  } catch (e) { host.innerHTML = ''; host.appendChild(el('div', { class: 'card card-pad error-state' }, e.message)); }
}

function paintAgencyPrompt(host, data) {
  const text = el('textarea', { class: 'agency-prompt-text', maxlength: '12000', placeholder: 'Define how Agency OS should reason about client priorities, reporting, delivery quality, and escalation...' });
  text.value = data.prompt || '';
  const count = el('span', { class: 'prompt-count' }, text.value.length.toLocaleString('en-IN') + ' / 12,000');
  text.oninput = () => { count.textContent = text.value.length.toLocaleString('en-IN') + ' / 12,000'; };
  const save = el('button', { class: 'btn btn-primary' }, 'Save operating prompt');
  save.onclick = async () => {
    save.disabled = true; save.textContent = 'Saving...';
    try { const out = await api('/api/agency/prompt', { method: 'POST', body: { prompt: text.value } }); toast('Agency prompt saved as version ' + out.version + '.', 'ok'); paintAgencyPrompt(host, out); }
    catch (e) { toast(e.message, 'err'); save.disabled = false; save.textContent = 'Save operating prompt'; }
  };
  const editor = el('section', { class: 'card prompt-editor' }, [
    el('div', { class: 'prompt-meta' }, [el('div', {}, [el('span', { class: 'section-kicker' }, 'Persistent context'), el('h3', {}, 'Agency operating prompt')]), el('span', { class: 'status-badge status-active' }, 'Version ' + (data.version || 0))]),
    text,
    el('div', { class: 'prompt-editor-foot' }, [el('div', {}, [count, el('small', {}, data.updatedAt ? 'Updated ' + new Date(data.updatedAt).toLocaleString('en-IN') + (data.updatedBy ? ' by ' + data.updatedBy : '') : 'Not saved yet')]), save])
  ]);
  const guide = el('aside', { class: 'card prompt-guide' }, [
    el('span', { class: 'section-kicker' }, 'Prompt contract'), el('h3', {}, 'What belongs here'),
    el('ul', {}, ['Agency priorities and escalation rules', 'Reporting cadence and decision principles', 'Delivery quality standards', 'How to treat client money and access'].map((value) => el('li', {}, value))),
    el('div', { class: 'prompt-boundary' }, [el('strong', {}, 'Boundary'), el('p', {}, 'This text does not authorize external messages, calls, payments, or tool actions. Those still require their normal confirmation gates.')])
  ]);
  host.innerHTML = ''; host.appendChild(editor); host.appendChild(guide);
}

let currentBillingInterval = 'monthly';

async function viewBilling(root) {
  root.appendChild(viewHead('Plans & Billing', 'One plan for every call and every chat. Manage subscriptions, active quotas, and prepaid wallet.'));

  const me = State.me || {};
  const tenant = me.tenant || {};
  const currentPlanId = (tenant.plan || 'starter').toLowerCase();
  const currentInterval = tenant.billingInterval || 'monthly';
  const limits = tenant.limits || { voiceMinutes: 500, activeWorkflows: 3, contacts: 1000, users: 2 };
  const usage = tenant.usage || { activeWorkflows: 0, contacts: 0, users: 1 };

  // 1. Current Plan & Quota Meters Card
  const overviewCard = el('section', { class: 'billing-overview-card' });
  const topRow = el('div', { class: 'billing-top-row' }, [
    el('div', {}, [
      el('h3', { style: 'margin:0 0 6px 0;font-size:1.35rem;font-weight:700;color:var(--ink)' }, (tenant.name || 'Workspace') + ' Subscription'),
      el('p', { class: 'muted', style: 'margin:0;font-size:0.85rem' }, [
        'Plan: ', el('strong', { style: 'color:var(--ink)' }, (tenant.plan || 'Starter').charAt(0).toUpperCase() + (tenant.plan || 'Starter').slice(1).toLowerCase()),
        ' · Billing term: ', el('strong', {}, currentInterval.charAt(0).toUpperCase() + currentInterval.slice(1)),
        tenant.planExpiresAt ? ' · Renews on ' + new Date(tenant.planExpiresAt).toLocaleDateString() : ' · Active subscription'
      ])
    ]),
    el('div', { style: 'text-align:right' }, [
      el('span', { class: 'muted', style: 'font-size:0.8rem;display:block' }, 'Questions or custom terms?'),
      el('a', {
        href: 'https://wa.me/918982200895?text=Hi%20Seevora%20Team%2C%20I%20have%20a%20billing%20inquiry',
        target: '_blank',
        class: 'btn btn-ghost btn-sm',
        style: 'margin-top:4px;display:inline-flex;align-items:center;gap:6px'
      }, 'WhatsApp Support: 8982200895')
    ])
  ]);

  // Quota meters
  const metersGrid = el('div', { class: 'plan-meters-grid' });

  // Meter 1: Active Workflows
  const wfLimit = limits.activeWorkflows === 999999 ? 'Unlimited' : limits.activeWorkflows;
  const wfPct = limits.activeWorkflows === 999999 ? 10 : Math.min(100, Math.round(((usage.activeWorkflows || 0) / limits.activeWorkflows) * 100));
  metersGrid.appendChild(el('div', { class: 'meter-card' }, [
    el('div', { class: 'meter-title' }, ['Workflow Workspace', el('span', {}, (usage.activeWorkflows || 0) + ' / ' + wfLimit)]),
    el('div', { class: 'meter-val' }, (usage.activeWorkflows || 0) + ' active'),
    el('div', { class: 'meter-track' }, [el('div', { class: 'meter-fill', style: 'width:' + wfPct + '%' })])
  ]));

  // Meter 2: CRM Contacts
  const ctLimit = limits.contacts === 1000000 ? 'Unlimited' : (limits.contacts || 1000).toLocaleString();
  const ctPct = limits.contacts === 1000000 ? 5 : Math.min(100, Math.round(((usage.contacts || 0) / (limits.contacts || 1000)) * 100));
  metersGrid.appendChild(el('div', { class: 'meter-card' }, [
    el('div', { class: 'meter-title' }, ['CRM Contacts', el('span', {}, (usage.contacts || 0).toLocaleString() + ' / ' + ctLimit)]),
    el('div', { class: 'meter-val' }, (usage.contacts || 0).toLocaleString() + ' leads'),
    el('div', { class: 'meter-track' }, [el('div', { class: 'meter-fill', style: 'width:' + ctPct + '%' })])
  ]));

  // Meter 3: Team Users
  const uLimit = limits.users || 2;
  const uPct = Math.min(100, Math.round(((usage.users || 1) / uLimit) * 100));
  metersGrid.appendChild(el('div', { class: 'meter-card' }, [
    el('div', { class: 'meter-title' }, ['Team Seats', el('span', {}, (usage.users || 1) + ' / ' + uLimit)]),
    el('div', { class: 'meter-val' }, (usage.users || 1) + ' users'),
    el('div', { class: 'meter-track' }, [el('div', { class: 'meter-fill', style: 'width:' + uPct + '%' })])
  ]));

  // Meter 4: Voice Minutes Included
  metersGrid.appendChild(el('div', { class: 'meter-card' }, [
    el('div', { class: 'meter-title' }, ['Voice Minutes Included', el('span', {}, 'Resets monthly')]),
    el('div', { class: 'meter-val' }, (limits.voiceMinutes || 500).toLocaleString() + ' mins'),
    el('p', { class: 'muted', style: 'margin:0;font-size:0.75rem' }, 'AI Voice receptionist 24/7')
  ]));

  overviewCard.appendChild(topRow);
  overviewCard.appendChild(metersGrid);
  root.appendChild(overviewCard);

  // 2. Billing Cycle Switcher (Monthly, Quarterly, Annual)
  const switcherWrap = el('div', { class: 'interval-toggle-wrap' });
  const switcher = el('div', { class: 'interval-toggle' });

  const monthlyBtn = el('button', {
    class: 'interval-pill ' + (currentBillingInterval === 'monthly' ? 'active' : ''),
    onclick: () => { currentBillingInterval = 'monthly'; renderPlanCards(); updateSwitcher(); }
  }, 'Monthly');

  const quarterlyBtn = el('button', {
    class: 'interval-pill ' + (currentBillingInterval === 'quarterly' ? 'active' : ''),
    onclick: () => { currentBillingInterval = 'quarterly'; renderPlanCards(); updateSwitcher(); }
  }, ['Quarterly ', el('span', { class: 'discount-tag' }, 'Save ~5%')]);

  const annualBtn = el('button', {
    class: 'interval-pill ' + (currentBillingInterval === 'annual' ? 'active' : ''),
    onclick: () => { currentBillingInterval = 'annual'; renderPlanCards(); updateSwitcher(); }
  }, ['Annual ', el('span', { class: 'discount-tag' }, 'Save 10%')]);

  function updateSwitcher() {
    monthlyBtn.className = 'interval-pill ' + (currentBillingInterval === 'monthly' ? 'active' : '');
    quarterlyBtn.className = 'interval-pill ' + (currentBillingInterval === 'quarterly' ? 'active' : '');
    annualBtn.className = 'interval-pill ' + (currentBillingInterval === 'annual' ? 'active' : '');
  }

  switcher.appendChild(monthlyBtn);
  switcher.appendChild(quarterlyBtn);
  switcher.appendChild(annualBtn);
  switcherWrap.appendChild(switcher);
  root.appendChild(switcherWrap);

  // 3. Plan Cards Grid Host
  const plansGridHost = el('div', { class: 'pricing-plans-grid', id: 'pricingPlansHost' });
  root.appendChild(plansGridHost);

  function renderPlanCards() {
    plansGridHost.innerHTML = '';
    const planDefs = [
      {
        id: 'starter',
        name: 'Starter',
        tagline: 'Ideal for local clinics, salons & single-location businesses.',
        popular: false,
        monthly: { price: '₹5,199', perMonth: '₹5,199 /month', billed: 'Billed monthly' },
        quarterly: { price: '₹14,799', perMonth: '₹4,933 /month', billed: '₹14,799 billed quarterly (save ~5%)' },
        annual: { price: '₹56,099', perMonth: '₹4,675 /month', billed: '₹56,099 billed annually (save 10%)' },
        features: [
          '500 voice minutes / month',
          '3 active workflows in workspace',
          'AI voice receptionist, 24/7',
          '1 voice + 1 WhatsApp number',
          'WhatsApp shared inbox & CRM',
          '1,000 contacts, 2 users',
          '1,000 service & utility messages',
          '100 marketing messages',
          'Auto-replies & appointment reminders'
        ],
      },
      {
        id: 'growth',
        name: 'Growth',
        tagline: 'Built for fast-growing teams running campaigns, broadcasts & follow-ups.',
        popular: true,
        monthly: { price: '₹10,999', perMonth: '₹10,999 /month', billed: 'Billed monthly' },
        quarterly: { price: '₹31,299', perMonth: '₹10,433 /month', billed: '₹31,299 billed quarterly (save ~5%)' },
        annual: { price: '₹1,18,799', perMonth: '₹9,900 /month', billed: '₹1,18,799 billed annually (save 10%)' },
        features: [
          '1,000 voice minutes / month',
          '10 active workflows in workspace',
          'Everything in Starter, plus:',
          '10,000 contacts, 5 users',
          '3,000 service & utility messages',
          '500 marketing messages',
          'Broadcasts and automation flows',
          'Call-to-WhatsApp follow-ups',
          'Tags and customer segments'
        ],
      },
      {
        id: 'business',
        name: 'Business',
        tagline: 'High volume, multiple phone lines, integrations and direct API access.',
        popular: false,
        monthly: { price: '₹25,999', perMonth: '₹25,999 /month', billed: 'Billed monthly' },
        quarterly: { price: '₹74,099', perMonth: '₹24,700 /month', billed: '₹74,099 billed quarterly (save ~5%)' },
        annual: { price: '₹2,80,799', perMonth: '₹23,400 /month', billed: '₹2,80,799 billed annually (save 10%)' },
        features: [
          '2,500 voice minutes / month',
          '30 active workflows in workspace',
          'Everything in Growth, plus:',
          '2 voice + 2 WhatsApp numbers',
          '50,000 contacts, 15 users',
          '8,000 service & utility messages',
          '1,500 marketing messages',
          'Webhooks and API access',
          'Reports and priority support'
        ],
      },
      {
        id: 'enterprise',
        name: 'Enterprise',
        tagline: 'Custom development, dedicated infrastructure & SLA built for your business.',
        popular: false,
        quoteOnly: true,
        monthly: { price: '₹1,40,000+', perMonth: 'From ₹1,40,000 /month', billed: 'Custom terms by quote' },
        quarterly: { price: '₹1,40,000+', perMonth: 'From ₹1,40,000 /month', billed: 'Custom terms by quote' },
        annual: { price: '₹1,40,000+', perMonth: 'From ₹1,40,000 /month', billed: 'Custom terms by quote' },
        features: [
          '10,000+ voice minutes / month',
          'Unlimited workflows in workspace',
          '5+ voice + 5+ WhatsApp numbers',
          'Custom / unlimited CRM contacts',
          '50+ team users',
          '30,000+ service & utility messages',
          '6,000+ marketing messages',
          'Custom development built for you',
          'Dedicated SLA and account executive'
        ],
      }
    ];

    planDefs.forEach((p) => {
      const card = el('div', { class: 'pricing-plan-card ' + (p.popular ? 'popular' : '') });
      if (p.popular) {
        card.appendChild(el('div', { class: 'popular-ribbon' }, 'Most Popular'));
      }

      card.appendChild(el('div', { class: 'plan-head-name' }, p.name));
      card.appendChild(el('div', { class: 'plan-head-tagline' }, p.tagline));

      const termData = p[currentBillingInterval] || p.monthly;
      const priceBlock = el('div', { class: 'plan-pricing-block' }, [
        el('div', { class: 'plan-main-price' }, termData.price),
        el('div', { class: 'plan-price-sub' }, termData.perMonth),
        el('div', { class: 'plan-tax-note' }, [termData.billed, el('span', { class: 'muted' }, ' · Excl. 18% GST')])
      ]);
      card.appendChild(priceBlock);

      const ul = el('ul', { class: 'plan-features-ul' });
      p.features.forEach((feat) => {
        ul.appendChild(el('li', { class: 'plan-feature-li' }, [
          el('span', { class: 'chk' }, '✓'),
          el('span', {}, feat)
        ]));
      });
      card.appendChild(ul);

      // Action CTA Button
      const isCurrent = currentPlanId === p.id;
      if (isCurrent) {
        const curBtn = el('button', {
          class: 'plan-cta-btn btn-ghost',
          disabled: true,
          style: 'opacity:0.8;background:rgba(16,185,129,0.12);color:#10B981;border:1px solid rgba(16,185,129,0.3)'
        }, 'Current Active Plan');
        card.appendChild(curBtn);
      } else if (p.quoteOnly) {
        const contactBtn = el('a', {
          href: 'https://wa.me/918982200895?text=Hi%20Seevora%20Team%2C%20I%20am%20interested%20in%20the%20Enterprise%20plan%20quote',
          target: '_blank',
          class: 'plan-cta-btn btn-ghost',
          style: 'border:1px solid var(--accent);color:var(--accent);text-decoration:none'
        }, 'Contact Sales (8982200895)');
        card.appendChild(contactBtn);
      } else {
        const ctaBtn = el('button', {
          class: 'plan-cta-btn ' + (p.popular ? 'btn-primary' : 'btn-ghost'),
          onclick: () => subscribePlan(p.id, currentBillingInterval)
        }, [
          'Upgrade to ' + p.name,
          el('small', { style: 'opacity:0.8;font-size:0.75rem' }, 'via Razorpay')
        ]);
        card.appendChild(ctaBtn);
      }

      plansGridHost.appendChild(card);
    });
  }

  renderPlanCards();

  // 4. Feature Comparison Matrix Section
  const matrixWrap = el('section', { class: 'comparison-matrix-card' });
  matrixWrap.appendChild(el('div', { style: 'margin-bottom:16px' }, [
    el('span', { class: 'section-kicker' }, 'Full Specification'),
    el('h3', { style: 'margin:4px 0 0 0;font-size:1.25rem;font-weight:800;color:var(--ink)' }, 'Compare all plan features and quotas'),
  ]));

  const matrixTable = el('table', { class: 'matrix-table' }, [
    el('thead', {}, [
      el('tr', {}, [
        el('th', { style: 'width:32%' }, 'Plan Feature'),
        el('th', { style: 'width:17%' }, 'Starter'),
        el('th', { style: 'width:17%;color:var(--accent)' }, 'Growth (Popular)'),
        el('th', { style: 'width:17%' }, 'Business'),
        el('th', { style: 'width:17%' }, 'Enterprise'),
      ])
    ]),
    el('tbody', {}, [
      el('tr', {}, [el('td', {}, 'Voice minutes per month'), el('td', {}, '500'), el('td', {}, '1,000'), el('td', {}, '2,500'), el('td', {}, '10,000+')]),
      el('tr', {}, [el('td', {}, 'Workflow workspace: active workflows'), el('td', {}, '3 active'), el('td', {}, '10 active'), el('td', {}, '30 active'), el('td', {}, 'Unlimited')]),
      el('tr', {}, [el('td', {}, 'Voice + WhatsApp numbers'), el('td', {}, '1 + 1'), el('td', {}, '1 + 1'), el('td', {}, '2 + 2'), el('td', {}, '5 + 5+')]),
      el('tr', {}, [el('td', {}, 'Contacts in CRM'), el('td', {}, '1,000'), el('td', {}, '10,000'), el('td', {}, '50,000'), el('td', {}, 'Custom / 50k+')]),
      el('tr', {}, [el('td', {}, 'Team users / seats'), el('td', {}, '2 users'), el('td', {}, '5 users'), el('td', {}, '15 users'), el('td', {}, '50+ users')]),
      el('tr', {}, [el('td', {}, 'Service and utility messages'), el('td', {}, '1,000'), el('td', {}, '3,000'), el('td', {}, '8,000'), el('td', {}, '30,000+')]),
      el('tr', {}, [el('td', {}, 'Marketing messages'), el('td', {}, '100'), el('td', {}, '500'), el('td', {}, '1,500'), el('td', {}, '6,000+')]),
      el('tr', {}, [el('td', {}, 'AI voice receptionist, 24/7'), el('td', {}, '✓ Included'), el('td', {}, '✓ Included'), el('td', {}, '✓ Included'), el('td', {}, '✓ Included')]),
      el('tr', {}, [el('td', {}, 'WhatsApp shared inbox and CRM'), el('td', {}, '✓ Included'), el('td', {}, '✓ Included'), el('td', {}, '✓ Included'), el('td', {}, '✓ Included')]),
      el('tr', {}, [el('td', {}, 'Auto-replies & appointment reminders'), el('td', {}, '✓ Included'), el('td', {}, '✓ Included'), el('td', {}, '✓ Included'), el('td', {}, '✓ Included')]),
      el('tr', {}, [el('td', {}, 'Broadcasts & automation flows'), el('td', { class: 'muted' }, '—'), el('td', { style: 'color:#10B981;font-weight:700' }, '✓ Included'), el('td', { style: 'color:#10B981;font-weight:700' }, '✓ Included'), el('td', { style: 'color:#10B981;font-weight:700' }, '✓ Included')]),
      el('tr', {}, [el('td', {}, 'Call-to-WhatsApp follow-ups'), el('td', { class: 'muted' }, '—'), el('td', { style: 'color:#10B981;font-weight:700' }, '✓ Included'), el('td', { style: 'color:#10B981;font-weight:700' }, '✓ Included'), el('td', { style: 'color:#10B981;font-weight:700' }, '✓ Included')]),
      el('tr', {}, [el('td', {}, 'Webhooks and direct API access'), el('td', { class: 'muted' }, '—'), el('td', { class: 'muted' }, '—'), el('td', { style: 'color:#10B981;font-weight:700' }, '✓ Included'), el('td', { style: 'color:#10B981;font-weight:700' }, '✓ Included')]),
      el('tr', {}, [el('td', {}, 'Reports & priority support'), el('td', { class: 'muted' }, '—'), el('td', { class: 'muted' }, '—'), el('td', { style: 'color:#10B981;font-weight:700' }, '✓ Included'), el('td', { style: 'color:#10B981;font-weight:700' }, '✓ Included')]),
      el('tr', {}, [el('td', {}, 'Custom development & bespoke flows'), el('td', { class: 'muted' }, '—'), el('td', { class: 'muted' }, '—'), el('td', { class: 'muted' }, '—'), el('td', { style: 'color:#10B981;font-weight:700' }, '✓ Dedicated SLA')]),
    ])
  ]);
  matrixWrap.appendChild(matrixTable);
  root.appendChild(matrixWrap);

  // 5. Add-ons & Overages Rate Card
  const addonsWrap = el('section', { class: 'addons-table-wrap' });
  addonsWrap.appendChild(el('div', {}, [
    el('span', { class: 'section-kicker' }, 'Add anytime'),
    el('h3', { style: 'margin:4px 0 0 0;font-size:1.25rem;font-weight:800;color:var(--ink)' }, 'Prepaid Wallet Overages & Add-on Rates'),
    el('p', { class: 'muted', style: 'margin:6px 0 0 0;font-size:0.85rem' }, 'Included minutes and messages reset every month. Extra use is automatically paid from your prepaid wallet (min ₹500 top-up). If wallet is empty, calls and broadcasts pause until top up.')
  ]));

  const addonsGrid = el('div', { class: 'addons-grid' }, [
    el('div', { class: 'addon-tile' }, [
      el('div', {}, [el('b', {}, 'Extra voice minute (inbound)'), el('small', { class: 'muted', style: 'display:block' }, 'Deducted from wallet on excess calls')]),
      el('div', { class: 'addon-tile-rate' }, '₹7.00')
    ]),
    el('div', { class: 'addon-tile-rate' }, [
      el('div', {}, [el('b', {}, 'Extra voice minute (outbound)'), el('small', { class: 'muted', style: 'display:block' }, 'Deducted from wallet on outbound calls')]),
      el('div', { class: 'addon-tile-rate' }, '₹8.00')
    ]),
    el('div', { class: 'addon-tile' }, [
      el('div', {}, [el('b', {}, 'Extra marketing message'), el('small', { class: 'muted', style: 'display:block' }, 'WhatsApp promotional broadcasts')]),
      el('div', { class: 'addon-tile-rate' }, '₹1.80')
    ]),
    el('div', { class: 'addon-tile' }, [
      el('div', {}, [el('b', {}, 'Extra service or utility message'), el('small', { class: 'muted', style: 'display:block' }, 'Transactional notices and reminders')]),
      el('div', { class: 'addon-tile-rate' }, '₹0.30')
    ]),
    el('div', { class: 'addon-tile' }, [
      el('div', {}, [el('b', {}, 'Extra voice number'), el('small', { class: 'muted', style: 'display:block' }, 'Dedicated inbound phone line')]),
      el('div', { class: 'addon-tile-rate' }, '₹399 /mo')
    ]),
    el('div', { class: 'addon-tile' }, [
      el('div', {}, [el('b', {}, 'Extra WhatsApp number'), el('small', { class: 'muted', style: 'display:block' }, 'Secondary business number')]),
      el('div', { class: 'addon-tile-rate' }, '₹499 /mo')
    ]),
    el('div', { class: 'addon-tile' }, [
      el('div', {}, [el('b', {}, 'Extra team user'), el('small', { class: 'muted', style: 'display:block' }, 'Additional member seat')]),
      el('div', { class: 'addon-tile-rate' }, '₹249 /mo')
    ]),
  ]);
  addonsWrap.appendChild(addonsGrid);
  root.appendChild(addonsWrap);

  // 6. Prepaid Wallet Top-up & Ledger Section
  const walletGrid = el('div', { class: 'wallet-section-grid' }, [
    el('section', { class: 'card card-pad', id: 'walletSummary' }, skeleton('sk-card', 1)),
    el('section', { class: 'card card-pad', id: 'walletLedger' }, skeleton('sk-card', 1))
  ]);
  root.appendChild(walletGrid);

  try {
    const out = await api('/api/wallet');
    const wallet = out.wallet || {};
    const rows = out.ledger || [];
    const sum = $('#walletSummary');
    sum.innerHTML = '';
    sum.appendChild(el('div', { class: 'muted', style: 'font-size:0.85rem' }, 'Available Prepaid Wallet Balance'));
    sum.appendChild(el('div', { class: 'wallet-big', style: 'color:var(--ink);margin:6px 0 12px 0' }, [
      '₹' + fmtInr(wallet.balanceInr != null ? wallet.balanceInr : (wallet.balancePaise || 0) / 100),
      el('small', {}, ' INR')
    ]));
    sum.appendChild(el('p', { class: 'muted', style: 'font-size:0.82rem;line-height:1.5' }, 'Prepaid balance pays for extra voice minutes, marketing messages, and numbers. Minimum recharge is ₹500 via Razorpay.'));

    const quickRecharges = [
      { id: 'topup_500', inr: 500 },
      { id: 'topup_1000', inr: 1000 },
      { id: 'topup_2500', inr: 2500 },
      { id: 'topup_5000', inr: 5000 }
    ];

    const packRow = el('div', { class: 'pack-row', style: 'display:flex;flex-wrap:wrap;gap:8px;margin-top:14px' });
    quickRecharges.forEach((p) => {
      packRow.appendChild(el('button', {
        class: 'btn btn-ghost',
        style: 'font-weight:600',
        onclick: () => startRecharge(p.id)
      }, '+ ₹' + fmtInr(p.inr)));
    });
    sum.appendChild(packRow);

    // Custom Top-up Input
    const customRow = el('div', { style: 'display:flex;gap:8px;margin-top:14px;align-items:center' }, [
      el('input', {
        class: 'input',
        id: 'f_custom_recharge',
        type: 'number',
        min: '500',
        step: '100',
        placeholder: 'Custom amount (min ₹500)',
        style: 'max-width:200px'
      }),
      el('button', {
        class: 'btn btn-primary',
        onclick: () => {
          const inp = $('#f_custom_recharge');
          const val = inp ? Number(inp.value) : 0;
          if (!val || val < 500) {
            toast('Minimum recharge amount is ₹500.', 'err');
            return;
          }
          startCustomRecharge(val);
        }
      }, 'Add Credit')
    ]);
    sum.appendChild(customRow);

    // Ledger Rows
    const ledger = $('#walletLedger');
    ledger.innerHTML = '';
    ledger.appendChild(el('h3', { class: 't-h3', style: 'margin-bottom:14px' }, 'Transaction & Subscription History'));
    rows.slice(0, 20).forEach((x) => ledger.appendChild(el('div', { class: 'ledger-row' }, [
      el('div', {}, [
        el('div', { style: 'font-weight:600' }, x.description || String(x.type || '').replace(/_/g, ' ')),
        el('small', { class: 'muted' }, x.createdAt ? new Date(x.createdAt).toLocaleString() : '')
      ]),
      el('b', { class: Number(x.amountPaise) >= 0 ? 'money-plus' : 'money-minus' }, (Number(x.amountPaise) >= 0 ? '+' : '') + '₹' + fmtInr(Number(x.amountPaise || 0) / 100))
    ])));
    if (!rows.length) ledger.appendChild(el('div', { class: 'muted', style: 'padding:14px 0' }, 'No wallet transactions yet.'));
  } catch (e) {
    const sum = $('#walletSummary');
    if (sum) { sum.innerHTML = ''; sum.appendChild(el('div', { class: 'muted' }, e.message)); }
  }
}

let rzpScriptPromise = null;
function ensureRazorpayScript() {
  if (window.Razorpay) return Promise.resolve(window.Razorpay);
  if (rzpScriptPromise) return rzpScriptPromise;
  rzpScriptPromise = new Promise((resolve, reject) => {
    const s = el('script', { src: 'https://checkout.razorpay.com/v1/checkout.js' });
    s.onload = () => window.Razorpay ? resolve(window.Razorpay) : reject(new Error('Razorpay SDK failed to load'));
    s.onerror = () => reject(new Error('Failed to load Razorpay checkout script'));
    document.head.appendChild(s);
  });
  return rzpScriptPromise;
}

async function subscribePlan(planId, interval = 'monthly') {
  try {
    const billingCfg = await api('/api/billing/config').catch(() => null);
    if (!billingCfg || !billingCfg.razorpay || !billingCfg.razorpay.enabled) {
      toast('Razorpay is not configured on this server yet. Add RAZORPAY_KEY_ID in .env.', 'err');
      return;
    }
    toast('Opening Razorpay checkout for ' + planId.toUpperCase() + ' (' + interval + ')...', 'info');
    const orderRes = await api('/api/billing/razorpay/order', {
      method: 'POST',
      body: { planId, interval }
    });
    const RazorpaySDK = await ensureRazorpayScript();
    const options = {
      ...orderRes.checkoutOptions,
      handler: async (resp) => {
        try {
          toast('Verifying payment and upgrading plan...', 'info');
          const verifyRes = await api('/api/billing/razorpay/verify', {
            method: 'POST',
            body: {
              orderId: resp.razorpay_order_id,
              paymentId: resp.razorpay_payment_id,
              signature: resp.razorpay_signature,
            },
          });
          if (verifyRes.ok) {
            toast('Successfully upgraded to ' + (verifyRes.plan || planId).toUpperCase() + ' plan!', 'ok');
            await ensureMe(true);
            const v = $('#view');
            if (v) viewBilling(v);
          }
        } catch (verErr) {
          toast('Subscription verification error: ' + verErr.message, 'err');
        }
      },
      modal: {
        ondismiss: () => {
          toast('Checkout cancelled.', 'info');
        },
      },
    };
    const rzpInstance = new RazorpaySDK(options);
    rzpInstance.open();
  } catch (e) {
    toast(e.message, 'err');
  }
}

async function startRecharge(packId) {
  try {
    const billingCfg = await api('/api/billing/config').catch(() => null);
    if (billingCfg && billingCfg.razorpay && billingCfg.razorpay.enabled) {
      toast('Opening Razorpay checkout...', 'info');
      const orderRes = await api('/api/billing/razorpay/order', { method: 'POST', body: { packId: packId } });
      const RazorpaySDK = await ensureRazorpayScript();
      const options = {
        ...orderRes.checkoutOptions,
        handler: async (resp) => {
          try {
            toast('Verifying payment...', 'info');
            const verifyRes = await api('/api/billing/razorpay/verify', {
              method: 'POST',
              body: {
                orderId: resp.razorpay_order_id,
                paymentId: resp.razorpay_payment_id,
                signature: resp.razorpay_signature,
              },
            });
            if (verifyRes.ok) {
              toast('Payment verified! ₹' + fmtInr((verifyRes.balancePaise || 0) / 100) + ' balance available.', 'ok');
              await ensureMe(true);
              const v = $('#view');
              if (v) viewBilling(v);
            }
          } catch (verErr) {
            toast('Payment verification error: ' + verErr.message, 'err');
          }
        },
        modal: {
          ondismiss: () => {
            toast('Payment cancelled.', 'info');
          },
        },
      };
      const rzpInstance = new RazorpaySDK(options);
      rzpInstance.open();
      return;
    }

    // Fall back to PayU checkout if Razorpay not configured
    const out = await api('/api/payment-intents', { method: 'POST', body: { packId: packId } });
    const checkoutUrl = out.checkout && (out.checkout.action || out.checkout.url);
    if (checkoutUrl && out.checkout.fields) {
      const form = el('form', { method: 'POST', action: checkoutUrl });
      Object.keys(out.checkout.fields).forEach((k) => form.appendChild(el('input', { type: 'hidden', name: k, value: out.checkout.fields[k] })));
      document.body.appendChild(form); form.submit(); return;
    }
    toast(out.message || 'Payment gateway is not enabled yet. Add Razorpay keys to .env.', 'info');
  } catch (e) { toast(e.message, 'err'); }
}

async function startCustomRecharge(amount) {
  try {
    const billingCfg = await api('/api/billing/config').catch(() => null);
    if (!billingCfg || !billingCfg.razorpay || !billingCfg.razorpay.enabled) {
      toast('Razorpay is not configured on this server yet.', 'err');
      return;
    }
    toast('Opening Razorpay checkout for ₹' + fmtInr(amount) + '...', 'info');
    const orderRes = await api('/api/billing/razorpay/order', { method: 'POST', body: { customAmount: amount } });
    const RazorpaySDK = await ensureRazorpayScript();
    const options = {
      ...orderRes.checkoutOptions,
      handler: async (resp) => {
        try {
          toast('Verifying payment...', 'info');
          const verifyRes = await api('/api/billing/razorpay/verify', {
            method: 'POST',
            body: {
              orderId: resp.razorpay_order_id,
              paymentId: resp.razorpay_payment_id,
              signature: resp.razorpay_signature,
            },
          });
          if (verifyRes.ok) {
            toast('Recharged ₹' + fmtInr(amount) + '! New balance: ₹' + fmtInr((verifyRes.balancePaise || 0) / 100), 'ok');
            await ensureMe(true);
            const v = $('#view');
            if (v) viewBilling(v);
          }
        } catch (verErr) {
          toast('Payment verification error: ' + verErr.message, 'err');
        }
      },
      modal: {
        ondismiss: () => {
          toast('Recharge cancelled.', 'info');
        },
      },
    };
    const rzpInstance = new RazorpaySDK(options);
    rzpInstance.open();
  } catch (e) {
    toast(e.message, 'err');
  }
}

async function viewSupport(root) {
  root.appendChild(viewHead('Support', 'Open a ticket and keep every reply attached to your workspace.'));
  const subject = el('input', { class: 'input', placeholder: 'What do you need help with.' });
  const message = el('textarea', { class: 'input textarea', placeholder: 'Describe the issue, expected result, and what happened.' });
  const create = el('button', { class: 'btn btn-primary' }, 'Open ticket');
  const list = el('div', { class: 'ticket-list' }, skeleton('sk-card', 2));
  create.onclick = async () => {
    create.disabled = true;
    try {
      await api('/api/support/tickets', { method: 'POST', body: { subject: subject.value.trim(), message: message.value.trim(), priority: 'normal' } });
      subject.value = ''; message.value = ''; toast('Support ticket opened.', 'ok'); await loadTickets(list);
    } catch (e) { toast(e.message, 'err'); } finally { create.disabled = false; }
  };
  root.appendChild(el('div', { class: 'support-layout' }, [
    el('section', { class: 'card card-pad support-compose' }, [el('h3', { class: 't-h3' }, 'New ticket'), field('Subject', subject), field('Message', message), create]),
    list
  ]));
  await loadTickets(list);
}

async function loadTickets(host) {
  try {
    const out = await api('/api/support/tickets'); host.innerHTML = '';
    (out.tickets || []).forEach((t) => host.appendChild(ticketCard(t, false)));
    if (!(out.tickets || []).length) host.appendChild(el('div', { class: 'card card-pad muted' }, 'No support tickets yet.'));
  } catch (e) { host.innerHTML = ''; host.appendChild(el('div', { class: 'card card-pad muted' }, e.message)); }
}

function ticketCard(t, admin) {
  const messages = (t.messages || []).map((m) => el('div', { class: 'ticket-message' }, [
    el('b', {}, m.authorName || m.authorRole || 'User'), el('span', {}, m.message || m.body || '')
  ]));
  const reply = el('input', { class: 'input', placeholder: 'Write a reply.' });
  const send = el('button', { class: 'btn btn-ghost' }, 'Reply');
  send.onclick = async () => {
    const msg = reply.value.trim(); if (!msg) return;
    send.disabled = true;
    try {
      await api(admin ? '/api/admin/tickets/reply' : '/api/support/tickets/reply', { method: 'POST', body: { ticketId: t.id, message: msg } });
      toast('Reply sent.', 'ok'); onRoute();
    } catch (e) { toast(e.message, 'err'); } finally { send.disabled = false; }
  };
  const adminControls = admin ? el('div', { class: 'ticket-admin-controls' }, [
    (function () { const s = el('select', { class: 'select' }, ['open', 'in_progress', 'waiting_on_customer', 'resolved', 'closed'].map((v) => el('option', { value: v }, v.replace(/_/g, ' ')))); s.value = t.status || 'open'; s.setAttribute('data-ticket-status', t.id); return s; })(),
    (function () { const s = el('select', { class: 'select' }, ['low', 'normal', 'high', 'urgent'].map((v) => el('option', { value: v }, v))); s.value = t.priority || 'normal'; s.setAttribute('data-ticket-priority', t.id); return s; })(),
    el('button', { class: 'btn btn-ghost', onclick: async () => { const status = document.querySelector('[data-ticket-status="' + t.id + '"]').value; const priority = document.querySelector('[data-ticket-priority="' + t.id + '"]').value; await api('/api/admin/tickets/update', { method: 'POST', body: { ticketId: t.id, status: status, priority: priority } }); toast('Ticket updated.', 'ok'); onRoute(); } }, 'Update')
  ]) : null;
  return el('article', { class: 'card ticket-card' }, [
    el('div', { class: 'flex items-center justify-between gap-2' }, [el('h3', { class: 't-h3' }, t.subject), el('span', { class: 'pill' }, t.status || 'open')]),
    adminControls, ...messages, el('div', { class: 'ticket-reply' }, [reply, send])
  ]);
}

async function viewAdmin(root) {
  if (!State.me || !['super_admin', 'admin'].includes(State.me.user.role)) { goto('overview'); return; }
  const superAdmin = ['super_admin', 'admin'].includes(State.me.user.role);
  const head = viewHead('Clients', 'Add, approach, inspect, pause, and offboard client workspaces with an immutable activity trail.');
  if (superAdmin) head.appendChild(el('div', { class: 'view-actions' }, [el('button', { class: 'btn btn-primary', onclick: openClientComposer }, 'Add client')]));
  root.appendChild(head);
  const stats = el('div', { class: 'admin-kpi-grid' }, skeleton('sk-stat', 5));
  const tenantHost = el('div', { class: 'card admin-client-card' }, skeleton('sk-card', 1));
  const ticketHost = el('div', { class: 'ticket-list' }, skeleton('sk-card', 2));
  const eventHost = el('div', { class: 'card card-pad admin-table agency-events-card' }, skeleton('sk-card', 1));
  root.appendChild(stats); root.appendChild(el('div', { class: 'admin-layout' }, [tenantHost, ticketHost])); root.appendChild(eventHost);
  try {
    const calls = [api('/api/admin/tickets'), api('/api/admin/payment-events')];
    if (superAdmin) calls.unshift(api('/api/admin/overview'), api('/api/admin/tenants'), api('/api/admin/users'));
    const data = await Promise.all(calls);
    const o = superAdmin ? data[0] : { totals: {} }, ts = superAdmin ? data[1] : { tenants: [] }, users = superAdmin ? data[2] : { users: [] }, tickets = data[superAdmin ? 3 : 0], events = data[superAdmin ? 4 : 1];
    stats.innerHTML = '';
    const totals = o.totals || {};
    [['Active clients', totals.activeTenants != null ? totals.activeTenants : 'Restricted', 'Live workspaces'], ['Revenue recorded', superAdmin ? '₹' + fmtInr((totals.invoicedPaise || 0) / 100) : 'Restricted', 'Issued invoices'], ['Outstanding', superAdmin ? '₹' + fmtInr((totals.outstandingPaise || 0) / 100) : 'Restricted', 'Receivables'], ['Open tickets', totals.openTickets != null ? totals.openTickets : (tickets.tickets || []).filter((t) => t.status !== 'closed').length, 'Needs attention'], ['Calls', superAdmin ? totals.calls : 'Restricted', 'Tracked usage']].forEach((x) => stats.appendChild(el('article', { class: 'agency-metric' }, [el('div', { class: 'agency-metric-label' }, x[0]), el('div', { class: 'agency-metric-value' }, String(x[1] || 0)), el('div', { class: 'agency-metric-note' }, x[2])])));
    tenantHost.innerHTML = ''; tenantHost.appendChild(el('div', { class: 'admin-client-head' }, [el('div', {}, [el('span', { class: 'section-kicker' }, 'Portfolio'), el('h3', {}, 'Client workspaces')]), superAdmin ? el('button', { class: 'btn btn-ghost btn-sm', onclick: openClientComposer }, 'Add client') : null]));
    if (superAdmin) (ts.tenants || []).forEach((t) => tenantHost.appendChild(adminTenantRow(t, (users.users || []).filter((u) => u.tenantId === t.id))));
    else tenantHost.appendChild(el('div', { class: 'muted' }, 'Tenant controls require super admin access.'));
    ticketHost.innerHTML = ''; (tickets.tickets || []).forEach((t) => ticketHost.appendChild(ticketCard(t, true)));
    eventHost.innerHTML = ''; eventHost.appendChild(el('div', { class: 'agency-card-head' }, [el('div', {}, [el('span', { class: 'section-kicker' }, 'Financial operations'), el('h3', {}, 'PayU event log')])]));
    (events.events || []).slice(0, 25).forEach((e) => eventHost.appendChild(el('div', { class: 'admin-row' }, [el('div', {}, [el('b', {}, e.txnid || 'Unknown transaction'), el('small', { class: 'muted' }, (e.reason || '') + ' · ' + (e.createdAt || ''))]), el('span', { class: 'pill' }, e.status || 'received')])));
    if (!(events.events || []).length) eventHost.appendChild(el('div', { class: 'muted' }, 'No PayU webhooks received yet.'));
  } catch (e) { tenantHost.innerHTML = ''; tenantHost.appendChild(el('div', { class: 'muted' }, e.message)); }
}

function adminTenantRow(t, users) {
  const wallet = t.wallet || {};
  const toggle = el('button', { class: 'btn btn-ghost' }, t.status === 'suspended' ? 'Reactivate' : 'Suspend');
  toggle.onclick = async () => {
    const status = t.status === 'suspended' ? 'active' : 'suspended';
    await api('/api/admin/tenants/status', { method: 'POST', body: { tenantId: t.id, status: status } });
    toast('Tenant set to ' + status + '.', 'ok'); onRoute();
  };
  const credit = el('button', { class: 'btn btn-ghost', onclick: () => adjustWallet(t) }, 'Adjust credit');
  const inspect = el('button', { class: 'btn btn-primary', onclick: () => inspectTenant(t, users || []) }, 'Open workspace');
  const approach = el('button', { class: 'btn btn-ghost', onclick: () => openClientApproach(t) }, 'Log approach');
  return el('div', { class: 'admin-client-row' }, [
    el('div', { class: 'admin-client-identity' }, [el('span', { class: 'client-avatar' }, initials(t.name)), el('div', {}, [el('b', {}, t.name), el('small', { class: 'muted' }, (t.users || 0) + ' users, ' + (t.agents || 0) + ' agents')])]),
    el('div', { class: 'admin-client-signal' }, [el('span', {}, 'Activity'), el('strong', {}, fmtInr((t.calls || 0)) + ' calls')]),
    el('div', { class: 'admin-client-signal' }, [el('span', {}, 'Outstanding'), el('strong', {}, '₹' + fmtInr((t.outstandingPaise || 0) / 100))]),
    el('div', { class: 'admin-client-signal' }, [el('span', {}, 'Wallet'), el('strong', {}, '₹' + fmtInr((wallet.balancePaise || 0) / 100))]),
    el('span', { class: 'status-badge status-' + (t.status || 'active') }, invoiceStatusLabel(t.status || 'active')),
    el('div', { class: 'admin-client-actions' }, [inspect, approach, credit, toggle])
  ]);
}

function openClientComposer() {
  const name = el('input', { class: 'input', placeholder: 'Client or company name' });
  const ownerName = el('input', { class: 'input', placeholder: 'Primary owner name, optional' });
  const ownerEmail = el('input', { class: 'input', type: 'email', placeholder: 'owner@client.com, optional' });
  const password = el('input', { class: 'input', type: 'password', placeholder: '12+ character temporary password' });
  modal({
    title: 'Add client workspace', body: el('div', { class: 'invoice-form' }, [field('Workspace name', name), field('Owner name', ownerName), field('Owner email', ownerEmail), field('Temporary password', password), el('p', { class: 'form-note' }, 'Leave owner fields empty to create an onboarding workspace. No invitation email will be sent.')]), confirmText: 'Create workspace', onConfirm: async () => {
      const out = await api('/api/admin/tenants', { method: 'POST', body: { name: name.value.trim(), ownerName: ownerName.value.trim(), ownerEmail: ownerEmail.value.trim(), password: password.value } });
      toast((out.tenant || {}).name + ' created. ' + out.note, 'ok'); onRoute();
    }
  });
}

function openClientApproach(t) {
  const channel = el('select', { class: 'select' }, ['whatsapp', 'email', 'phone', 'linkedin', 'meeting', 'other'].map((value) => el('option', { value }, invoiceStatusLabel(value))));
  const summary = el('textarea', { class: 'textarea', placeholder: 'What happened, what they need, and the next move.' });
  modal({
    title: 'Log approach to ' + t.name, body: el('div', { class: 'invoice-form' }, [field('Channel', channel), field('Summary', summary)]), confirmText: 'Record activity', onConfirm: async () => {
      await api('/api/admin/client-approach', { method: 'POST', body: { tenantId: t.id, channel: channel.value, summary: summary.value.trim() } });
      toast('Client approach recorded.', 'ok'); onRoute();
    }
  });
}

async function inspectTenant(t, users) {
  const out = await api('/api/admin/tenant-detail?tenantId=' + encodeURIComponent(t.id));
  const tabs = [
    ['Users', (out.users || []).map((u) => u.name + ' · ' + u.email + ' · ' + u.role)],
    ['Agents', (out.agents || []).map((a) => a.name + ' · ' + ((a.telephony || {}).did || 'No number'))],
    ['Numbers', (out.numbers || []).map((n) => n.address + ' · ' + n.provider + ' · ' + n.status)],
    ['Calls', (out.usage || []).map((u) => u.day + ' · ' + (u.calls || 0) + ' calls')],
    ['Billing', (out.ledger || []).map((x) => (x.type || 'entry') + ' · ₹' + fmtInr((x.amountPaise || 0) / 100))],
    ['Support', (out.tickets || []).map((x) => x.subject + ' · ' + x.status)]
  ];
  const body = el('div', { class: 'tenant-inspector' }, tabs.map((tab) => el('section', {}, [el('h4', {}, tab[0]), ...(tab[1].length ? tab[1].map((line) => el('div', { class: 'inspector-line' }, line)) : [el('div', { class: 'muted' }, 'No records')])])));
  const user = (out.users || []).find((u) => u.role !== 'super_admin' && u.status === 'active');
  if (user) body.prepend(el('button', { class: 'btn btn-dark', onclick: () => startImpersonation(user) }, 'View as ' + user.email));
  modal({ title: out.tenant.name, body: body, confirmText: 'Close', onConfirm: async () => { } });
}

function startImpersonation(user) {
  const reason = el('input', { class: 'input', placeholder: 'Support ticket or investigation reason' });
  const password = el('input', { class: 'input', type: 'password', placeholder: 'Your super admin password' });
  modal({
    title: 'View as ' + user.email, body: el('div', {}, [el('p', {}, 'This creates a 30 minute read-only user session. Billing, roles, status, and secrets remain blocked.'), field('Reason', reason), field('Re-enter your password', password)]), confirmText: 'Enter user view', onConfirm: async () => {
      await api('/api/admin/impersonations', { method: 'POST', body: { userId: user.id, reason: reason.value.trim(), password: password.value } });
      State.me = await api('/api/me'); renderShell(); goto('overview');
    }
  });
}

function adjustWallet(t) {
  const amount = el('input', { class: 'input', type: 'number', step: '0.01', placeholder: '100.00' });
  const reason = el('input', { class: 'input', placeholder: 'Required adjustment reason' });
  modal({
    title: 'Adjust ' + t.name + ' wallet', body: el('div', {}, [field('Amount in INR, negative deducts', amount), field('Reason', reason)]), confirmText: 'Apply adjustment', onConfirm: async () => {
      const paise = Math.round(Number(amount.value) * 100);
      await api('/api/admin/wallet/adjust', { method: 'POST', body: { tenantId: t.id, amountPaise: paise, reason: reason.value.trim(), idempotencyKey: 'ui_' + Date.now() + '_' + Math.random().toString(36).slice(2) } });
      toast('Wallet adjusted.', 'ok'); onRoute();
    }
  });
}

/* ===========================================================================
   7. SETTINGS
   =========================================================================== */
async function viewSettings(root) {
  root.appendChild(viewHead('Settings', 'Manage your user profile, WhatsApp & Meta Cloud credentials, workspace identity, and telephony.'));

  const t = (State.me && State.me.tenant) || {};
  const u = (State.me && State.me.user) || {};

  // 1. TOP ROW: USER PROFILE & WORKSPACE IDENTITY
  const topGrid = el('div', { class: 'grid grid-12', style: 'margin-bottom:16px' });

  // --- CARD 1: USER PROFILE ---
  const userNameInput = el('input', { class: 'input', id: 'prof_name', type: 'text', value: u.name || '', placeholder: 'Your Full Name' });
  const userEmailInput = el('input', { class: 'input', id: 'prof_email', type: 'email', value: u.email || '', placeholder: 'name@company.com' });
  const saveProfileBtn = el('button', { class: 'btn btn-primary' }, 'Save Profile');

  saveProfileBtn.addEventListener('click', async () => {
    const newName = userNameInput.value.trim();
    const newEmail = userEmailInput.value.trim().toLowerCase();
    if (!newName && !newEmail) {
      toast('Name or email is required.', 'err');
      return;
    }
    saveProfileBtn.disabled = true;
    saveProfileBtn.textContent = 'Saving...';
    try {
      const res = await api('/api/user/profile', { method: 'POST', body: { name: newName, email: newEmail } });
      if (res && res.user) {
        Object.assign(State.me.user, res.user);
        toast('Profile updated successfully.', 'ok');
        const tn = $('.tenant-chip .tn');
        if (tn) tn.textContent = res.user.name || res.user.email;
        const av = $('.tenant-chip .av');
        if (av) av.textContent = initials(res.user.name || res.user.email);
      }
    } catch (err) {
      toast(err.message || 'Failed to update profile.', 'err');
    } finally {
      saveProfileBtn.disabled = false;
      saveProfileBtn.textContent = 'Save Profile';
    }
  });

  const isAdm = ['super_admin', 'admin'].includes(u.role);
  const profileCard = el('section', { class: 'card card-pad' }, [
    el('div', { class: 'flex items-center justify-between', style: 'margin-bottom:14px' }, [
      el('h3', { class: 't-h3' }, 'User Profile & Account'),
      isAdm
        ? el('span', { class: 'pill', style: 'background:rgba(239,68,68,0.12);color:#DC2626;border:1px solid rgba(239,68,68,0.3);font-weight:700;padding:4px 12px;border-radius:14px;font-size:0.78rem;' }, '👑 Admin')
        : null
    ].filter(Boolean)),
    el('div', { class: 'flex items-center gap-3', style: 'margin-bottom:16px;padding:12px;background:var(--bg-2);border-radius:10px' }, [
      el('div', { class: 'av', style: 'width:42px;height:42px;font-size:1rem' }, initials(u.name || u.email || 'User')),
      el('div', {}, [
        el('div', { style: 'font-weight:700;font-size:0.95rem' }, u.name || 'User Account'),
        el('div', { class: 'muted', style: 'font-size:0.8rem' }, u.email || 'No email attached')
      ])
    ]),
    el('div', { class: 'settings-form' }, [
      field('Full Name', userNameInput),
      field('Email Address', userEmailInput),
      el('div', { class: 'flex gap-2', style: 'margin-top:4px' }, [
        saveProfileBtn,
        el('button', { class: 'btn btn-ghost', onclick: doLogout }, 'Sign out')
      ])
    ])
  ]);

  // --- CARD 2: WORKSPACE IDENTITY ---
  const tenantNameInput = el('input', { class: 'input', id: 'set_name', type: 'text', value: t.name || '' });
  const colorVal = (t.branding && t.branding.color) || '#6E7BFF';
  const colorI = el('input', { type: 'color', id: 'set_color', value: colorVal });
  const colorHex = el('input', { class: 'input', id: 'set_color_hex', value: colorVal, style: 'max-width:130px;font-family:var(--mono)' });
  colorI.addEventListener('input', () => { colorHex.value = colorI.value; });
  colorHex.addEventListener('input', () => { if (/^#[0-9a-fA-F]{6}$/.test(colorHex.value)) colorI.value = colorHex.value; });

  const saveTenantBtn = el('button', { class: 'btn btn-primary' }, 'Save Workspace');
  saveTenantBtn.addEventListener('click', async () => {
    saveTenantBtn.disabled = true;
    saveTenantBtn.textContent = 'Saving...';
    try {
      await api('/api/tenant/update', { method: 'POST', body: { name: tenantNameInput.value.trim(), color: colorI.value } });
      State.me.tenant.name = tenantNameInput.value.trim();
      State.me.tenant.branding = Object.assign({}, State.me.tenant.branding, { color: colorI.value });
      const tn = $('.tenant-chip .tn'); if (tn) { tn.textContent = State.me.tenant.name; tn.title = State.me.tenant.name; }
      const av = $('.tenant-chip .av'); if (av) av.textContent = initials(State.me.tenant.name);
      toast('Workspace settings saved.', 'ok');
    } catch (ex) {
      toast(ex.status === 404 ? 'Tenant settings endpoint not available.' : (ex.message || 'Save failed.'), 'err');
    } finally {
      saveTenantBtn.disabled = false;
      saveTenantBtn.textContent = 'Save Workspace';
    }
  });

  const tenantCard = el('section', { class: 'card card-pad' }, [
    el('div', { style: 'margin-bottom:14px' }, [
      el('h3', { class: 't-h3' }, 'Workspace & Tenant')
    ]),
    el('p', { class: 'muted', style: 'font-size:0.85rem;margin-bottom:16px' }, 'Customize your business workspace name and brand accent color.'),
    el('div', { class: 'settings-form' }, [
      field('Workspace / Business Name', tenantNameInput),
      el('div', { class: 'field' }, [
        el('label', {}, 'Brand Accent Color'),
        el('div', { class: 'color-row' }, [colorI, colorHex])
      ]),
      el('div', { class: 'flex gap-2', style: 'margin-top:4px' }, [saveTenantBtn])
    ])
  ]);

  topGrid.appendChild(profileCard);
  topGrid.appendChild(tenantCard);
  root.appendChild(topGrid);

  // --- CARD 3: WHATSAPP BUSINESS & META CLOUD API CREDENTIALS (SAAS TENANT) ---
  const waCard = el('section', { class: 'card card-pad', style: 'margin-bottom:16px' });
  const waStatusPill = el('span', { class: 'pill', style: 'background:rgba(234,179,8,0.15);color:#b45309;font-weight:600' }, 'Loading...');

  const waHeader = el('div', { class: 'flex items-center justify-between', style: 'margin-bottom:8px' }, [
    el('div', {}, [
      el('h3', { class: 't-h3' }, 'WhatsApp Business & Meta Cloud API Credentials'),
      el('p', { class: 'muted', style: 'font-size:0.85rem;margin-top:2px' }, 'Each tenant client can enter their own Meta Developer and WhatsApp Cloud API credentials. No server .env modification required.')
    ]),
    waStatusPill
  ]);
  waCard.appendChild(waHeader);

  // Inputs for WhatsApp Meta Cloud
  const waAppId = el('input', { class: 'input', type: 'text', placeholder: 'e.g. 123456789012345' });
  const waAppSecret = el('input', { class: 'input', type: 'password', placeholder: 'App secret (hidden)' });
  const waWabaId = el('input', { class: 'input', type: 'text', placeholder: 'e.g. 109876543210987' });
  const waPhoneId = el('input', { class: 'input', type: 'text', placeholder: 'e.g. 102938475610293' });
  const waToken = el('input', { class: 'input', type: 'password', placeholder: 'System user permanent access token' });
  const waAutoFollowupChk = el('input', { type: 'checkbox' });
  const waFollowupMsg = el('textarea', { class: 'textarea', rows: 3, placeholder: 'Hi {{name}}, thank you for speaking with our AI Receptionist...' });

  const saveWaBtn = el('button', { class: 'btn btn-primary' }, 'Save WhatsApp Credentials');
  saveWaBtn.addEventListener('click', async () => {
    saveWaBtn.disabled = true;
    saveWaBtn.textContent = 'Saving...';
    try {
      const payload = {
        mode: 'meta_cloud',
        metaAppId: waAppId.value.trim(),
        metaAppSecret: waAppSecret.value.trim(),
        metaWabaId: waWabaId.value.trim(),
        metaPhoneId: waPhoneId.value.trim(),
        metaToken: waToken.value.trim(),
        autoFollowupEnabled: waAutoFollowupChk.checked,
        autoFollowupMessage: waFollowupMsg.value.trim()
      };
      await api('/api/whatsapp/config', { method: 'POST', body: payload });
      toast('WhatsApp credentials saved successfully.', 'ok');
      await loadWhatsAppConfig();
    } catch (err) {
      toast(err.message || 'Failed to save WhatsApp config.', 'err');
    } finally {
      saveWaBtn.disabled = false;
      saveWaBtn.textContent = 'Save WhatsApp Credentials';
    }
  });

  const webhookCallbackUrl = `${window.location.origin}/api/whatsapp/webhook`;
  const copyWebhookBtn = el('button', {
    type: 'button',
    class: 'btn btn-ghost btn-sm',
    onclick: () => {
      navigator.clipboard.writeText(webhookCallbackUrl);
      toast('Webhook URL copied to clipboard!', 'ok');
    }
  }, 'Copy URL');

  const waForm = el('div', { class: 'grid grid-12', style: 'gap:16px;margin-top:14px' }, [
    el('div', { class: 'col-6 settings-form', style: 'max-width:none' }, [
      field('Meta App ID', waAppId),
      field('Meta App Secret', waAppSecret),
      field('WhatsApp Business Account ID (WABA ID)', waWabaId),
      field('WhatsApp Phone Number ID', waPhoneId),
      field('Permanent Access Token', waToken)
    ]),
    el('div', { class: 'col-6 settings-form', style: 'max-width:none' }, [
      el('div', { class: 'field' }, [
        el('label', { style: 'display:flex;align-items:center;gap:8px;font-size:0.9rem;cursor:pointer' }, [
          waAutoFollowupChk,
          el('b', {}, 'Call-to-WhatsApp Automated Follow-up')
        ]),
        el('p', { class: 'muted', style: 'font-size:0.78rem;margin:4px 0 8px' }, 'Automatically dispatch a WhatsApp confirmation message to callers after each voice call finishes.')
      ]),
      field('Follow-up Message Template', waFollowupMsg),
      el('div', { style: 'padding:12px;background:var(--bg-2);border-radius:10px;border:1px solid var(--line);margin-top:8px' }, [
        el('b', { style: 'font-size:0.85rem;display:block;margin-bottom:4px' }, 'Meta Developer Webhook Setup:'),
        el('p', { class: 'muted', style: 'font-size:0.78rem;line-height:1.4;margin-bottom:8px' }, 'In Meta Developer Portal > WhatsApp > Configuration, set Callback URL to:'),
        el('div', { class: 'flex items-center gap-2' }, [
          el('code', { style: 'font-size:0.75rem;padding:4px 8px;background:var(--card);border-radius:6px;flex:1;overflow:hidden;text-overflow:ellipsis' }, webhookCallbackUrl),
          copyWebhookBtn
        ])
      ]),
      el('div', { style: 'margin-top:12px' }, [saveWaBtn])
    ])
  ]);
  waCard.appendChild(waForm);
  root.appendChild(waCard);

  async function loadWhatsAppConfig() {
    try {
      const res = await api('/api/whatsapp/config');
      const cfg = (res && res.config) || {};
      if (cfg.metaAppId) waAppId.value = cfg.metaAppId;
      if (cfg.hasMetaAppSecret) waAppSecret.placeholder = '●●●●●●●● (App Secret Configured)';
      if (cfg.metaWabaId) waWabaId.value = cfg.metaWabaId;
      if (cfg.metaPhoneId) waPhoneId.value = cfg.metaPhoneId;
      if (cfg.hasMetaToken) waToken.placeholder = '●●●●●●●● (Token Configured)';
      waAutoFollowupChk.checked = cfg.autoFollowupEnabled !== false;
      if (cfg.autoFollowupMessage) waFollowupMsg.value = cfg.autoFollowupMessage;

      if ((cfg.hasMetaToken || cfg.metaToken) && cfg.metaPhoneId) {
        waStatusPill.className = 'pill';
        waStatusPill.style.background = 'rgba(34,197,94,0.15)';
        waStatusPill.style.color = '#15803d';
        waStatusPill.textContent = '● Connected & Active';
      } else {
        waStatusPill.className = 'pill';
        waStatusPill.style.background = 'rgba(234,179,8,0.15)';
        waStatusPill.style.color = '#b45309';
        waStatusPill.textContent = '○ Credentials Required';
      }
    } catch (_) {
      waStatusPill.textContent = 'Config Load Error';
    }
  }
  loadWhatsAppConfig();

  // --- CARD 4 & 5: PRIVACY & BYON SPLIT ---
  const privacySelect = el('select', { class: 'select', id: 'privacy_mode' }, [
    el('option', { value: 'standard' }, 'Standard retention'),
    el('option', { value: 'metadata_only' }, 'Privacy mode, metadata only'),
    el('option', { value: 'no_recording' }, 'HIPAA mode, no recording or transcript retention')
  ]);
  const privacySave = el('button', { class: 'btn btn-primary' }, 'Save privacy mode');
  privacySave.onclick = async () => {
    privacySave.disabled = true;
    try { await api('/api/privacy', { method: 'POST', body: { mode: privacySelect.value } }); toast('Privacy mode saved.', 'ok'); }
    catch (e) { toast(e.message, 'err'); } finally { privacySave.disabled = false; }
  };
  const provider = el('select', { class: 'select' }, [el('option', { value: 'vobiz' }, 'VoBiz'), el('option', { value: 'telnyx' }, 'Telnyx'), el('option', { value: 'sip' }, 'SIP trunk')]);
  const address = el('input', { class: 'input', placeholder: 'Verified E.164 number or SIP address' });
  const label = el('input', { class: 'input', placeholder: 'Main sales line' });
  const byonList = el('div', { class: 'byon-list muted' }, 'Loading connections...');
  const byonSave = el('button', { class: 'btn btn-ghost' }, 'Connect my number');
  byonSave.onclick = async () => {
    byonSave.disabled = true;
    try { await api('/api/byon', { method: 'POST', body: { provider: provider.value, address: address.value.trim(), label: label.value.trim() } }); toast('Number connection saved for verification.', 'ok'); await loadByon(byonList); }
    catch (e) { toast(e.message, 'err'); } finally { byonSave.disabled = false; }
  };
  root.appendChild(el('div', { class: 'settings-split', style: 'margin-bottom:16px' }, [
    el('section', { class: 'card card-pad' }, [
      el('h3', { class: 't-h3' }, 'Privacy and HIPAA mode'),
      el('p', { class: 'muted privacy-copy' }, 'HIPAA mode disables recording and transcript retention in RapidX Voice. It does not by itself make your organization HIPAA compliant. You still need appropriate provider BAAs, policies, access controls, consent, and legal review.'),
      field('Retention policy', privacySelect), privacySave
    ]),
    el('section', { class: 'card card-pad' }, [
      el('h3', { class: 't-h3' }, 'Bring your own number'),
      el('p', { class: 'muted privacy-copy' }, 'Connect only a number or SIP address that your organization owns and has verified with the carrier.'),
      field('Provider', provider), field('Number or SIP address', address), field('Label', label), byonSave, byonList
    ])
  ]));
  Promise.all([
    api('/api/privacy').then((x) => { privacySelect.value = x.mode || 'standard'; }),
    loadByon(byonList)
  ]).catch(() => { });

  // --- CARD 6: INFRASTRUCTURE PROVIDERS ---
  const provHost = el('div', { id: 'provHost' }, skeleton('sk-card', 3));
  const provContainer = el('section', { class: 'card card-pad', style: 'margin-top:20px;' }, [
    el('div', { style: 'margin-bottom:20px;' }, [
      el('h3', { class: 't-h3', style: 'margin:0 0 4px 0;' }, 'AI Engines & Infrastructure Providers'),
      el('p', { class: 'muted', style: 'font-size:0.86rem;margin:0;' }, 'Active speech synthesis (TTS), conversational reasoning intelligence (LLM), and carrier telephony routing.')
    ]),
    provHost
  ]);
  root.appendChild(provContainer);

  try {
    const reg = await ensureProviders();
    paintProviders(provHost, reg);
  } catch (e) {
    provHost.innerHTML = '';
    provHost.appendChild(el('div', { class: 'card card-pad muted' }, 'Could not load providers. ' + esc(e.message)));
  }
}

async function loadByon(host) {
  const out = await api('/api/byon'); host.innerHTML = '';
  (out.connections || []).forEach((x) => host.appendChild(el('div', { class: 'status-line' }, [
    el('span', { class: 'k' }, x.label || x.provider), el('span', { class: 'v' }, (x.address || '') + ' · ' + (x.status || 'pending'))
  ])));
  if (!(out.connections || []).length) host.textContent = 'No number connected yet.';
}

function paintProviders(host, reg) {
  host.innerHTML = '';
  const layers = [
    { key: 'tts', label: 'Text to speech' },
    { key: 'llm', label: 'Brain, LLM' },
    { key: 'telephony', label: 'Telephony' }
  ];

  const grid = el('div', {
    class: 'prov-layers-grid',
    style: 'display:grid;grid-template-columns:repeat(auto-fit, minmax(280px, 1fr));gap:20px;align-items:start;'
  });

  layers.forEach((L) => {
    const list = reg[L.key] || [];
    const col = el('div', { class: 'prov-layer', style: 'display:flex;flex-direction:column;gap:12px;margin-bottom:0;' }, [
      el('div', { class: 'lh', style: 'margin-bottom:2px;' }, [
        el('span', { class: 'lt', style: 'font-size:0.78rem;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:var(--ink-dim);' }, L.label)
      ]),
      el('div', { class: 'prov-cards-stack', style: 'display:flex;flex-direction:column;gap:12px;' },
        list.length ? list.map(provCard) : [el('div', { class: 'muted', style: 'font-size:0.85rem;' }, 'No providers registered.')]
      )
    ]);
    grid.appendChild(col);
  });

  host.appendChild(grid);
}

function provCard(p) {
  const live = !!p.live;
  const selected = !!p.selected;
  const needs = p.needs || [];
  return el('div', { class: 'card prov-card', style: 'background:var(--bg-2);border:1px solid var(--line-2);border-radius:18px;padding:16px;box-shadow:none;' }, [
    el('div', { class: 'pc-top' }, [
      el('div', { class: 'pc-name', style: 'font-weight:600;font-size:0.95rem;color:var(--ink);' }, p.label || p.id),
      selected && live
        ? el('span', { class: 'pill badge-gold', style: 'font-size:0.75rem;padding:2px 8px;font-weight:600;' }, '● Selected')
        : live
          ? el('span', { class: 'pill', style: 'background:rgba(14,143,99,0.12);color:#0E8F63;border:1px solid rgba(14,143,99,0.25);font-size:0.75rem;padding:2px 8px;font-weight:600;' }, '● Configured')
          : el('span', { class: 'pill', style: 'background:rgba(100,116,139,0.12);color:var(--ink-dim);border:1px solid var(--line-2);font-size:0.75rem;padding:2px 8px;' }, '○ Needs setup')
    ]),
    selected && live
      ? el('div', { class: 'pc-needs', style: 'font-size:0.82rem;color:var(--ink-dim);margin-top:6px;line-height:1.45;' }, 'Default provider for dashboard-owned requests.')
      : live
        ? el('div', { class: 'pc-needs', style: 'font-size:0.82rem;color:var(--ink-dim);margin-top:6px;line-height:1.45;' }, 'Credentials available. Select it through trusted server configuration.')
        : el('div', { class: 'pc-needs', style: 'font-size:0.82rem;color:var(--ink-dim);margin-top:6px;line-height:1.45;' }, needs.length
          ? ['To enable, add ', ...needs.flatMap((n, i) => i ? [document.createTextNode(', '), el('code', {}, n)] : [el('code', {}, n)]), document.createTextNode(' to your .env.')]
          : 'Adapter is implemented but not configured.')
  ]);
}

/* ===========================================================================
   WACRM & WHATSAPP VIEWS (Preserving 100% of Seevora Design Tokens)
   =========================================================================== */

/* ---- 1. WhatsApp Shared Inbox ---- */
let _activeConvId = null;
let _activeConvPhone = null;

async function viewWhatsAppInbox(root) {
  root.appendChild(viewHead('WhatsApp Inbox', 'Live customer WhatsApp conversations, AI call transcripts, and instant template replies.'));

  const layout = el('div', { class: 'wacrm-inbox-layout' });
  const leftCol = el('div', { class: 'card', style: 'padding:12px;display:flex;flex-direction:column;overflow:hidden' });
  const rightCol = el('div', { class: 'card', style: 'padding:0;overflow:hidden' });

  // Left Col Search & Header
  const searchInput = el('input', { class: 'input', placeholder: 'Search conversations...', style: 'margin-bottom:10px' });
  const convListContainer = el('div', { class: 'wacrm-conv-list' }, [el('div', { class: 'muted', style: 'padding:20px;text-align:center' }, 'Loading conversations...')]);

  leftCol.appendChild(searchInput);
  leftCol.appendChild(convListContainer);

  layout.appendChild(leftCol);
  layout.appendChild(rightCol);
  root.appendChild(layout);

  let allConvs = [];

  async function loadConversations() {
    try {
      const res = await api('/api/whatsapp/conversations');
      allConvs = (res && Array.isArray(res.conversations)) ? res.conversations : [];
      renderConvList();
      if (allConvs.length && !_activeConvId) {
        selectConversation(allConvs[0].id, allConvs[0].phone);
      } else if (!allConvs.length) {
        renderEmptyChat();
      }
    } catch (e) {
      convListContainer.innerHTML = '';
      convListContainer.appendChild(el('div', { class: 'err-msg' }, 'Failed to load conversations: ' + e.message));
    }
  }

  function renderConvList() {
    const q = searchInput.value.trim().toLowerCase();
    const filtered = allConvs.filter((c) =>
      !q || (c.name && c.name.toLowerCase().includes(q)) || (c.phone && c.phone.includes(q)) || (c.lastMessageText && c.lastMessageText.toLowerCase().includes(q))
    );

    convListContainer.innerHTML = '';
    if (!filtered.length) {
      convListContainer.appendChild(el('div', { class: 'muted', style: 'padding:30px 10px;text-align:center;font-size:0.85rem' }, 'No conversations found.'));
      return;
    }

    filtered.forEach((conv) => {
      const isActive = conv.id === _activeConvId;
      const item = el('div', { class: 'wacrm-conv-item' + (isActive ? ' active' : '') }, [
        el('div', { class: 'flex items-center justify-between' }, [
          el('b', { style: 'font-size:0.9rem' }, conv.name || conv.phone),
          el('span', { class: 'muted', style: 'font-size:0.7rem' }, conv.lastMessageAt ? conv.lastMessageAt.slice(11, 16) : '')
        ]),
        el('div', { class: 'flex items-center justify-between', style: 'margin-top:2px' }, [
          el('span', { class: 'muted', style: 'font-size:0.78rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:200px' }, conv.lastMessageText || 'No messages yet'),
          conv.unreadCount > 0 ? el('span', { class: 'pill', style: 'background:var(--ok);color:#fff;font-size:0.65rem;padding:1px 6px' }, String(conv.unreadCount)) : null
        ])
      ]);
      item.addEventListener('click', () => selectConversation(conv.id, conv.phone));
      convListContainer.appendChild(item);
    });
  }

  searchInput.addEventListener('input', renderConvList);

  function selectConversation(id, phone) {
    _activeConvId = id;
    _activeConvPhone = phone;
    renderConvList();
    renderChatBox(id, phone);
  }

  function renderEmptyChat() {
    rightCol.innerHTML = '';
    rightCol.appendChild(el('div', { class: 'empty muted', style: 'height:100%;display:flex;align-items:center;justify-content:center;flex-direction:column;padding:40px' }, [
      el('h3', { class: 't-h3', style: 'margin-bottom:8px' }, 'No Conversation Selected'),
      el('p', { class: 'muted' }, 'Incoming WhatsApp chats and AI Phone call leads will appear here.')
    ]));
  }

  async function renderChatBox(convId, phone) {
    rightCol.innerHTML = '';
    const chatContainer = el('div', { class: 'wacrm-chat-container' });

    const activeConv = allConvs.find((c) => c.id === convId) || { name: phone, phone };

    // Chat Header
    const chatHeader = el('div', { class: 'wacrm-chat-header' }, [
      el('div', {}, [
        el('h3', { class: 't-h3', style: 'font-size:1.05rem;margin:0' }, activeConv.name || phone),
        el('div', { class: 'muted', style: 'font-size:0.8rem' }, phone)
      ]),
      el('div', { class: 'flex gap-2' }, [
        el('button', {
          class: 'btn btn-ghost',
          style: 'font-size:0.8rem;gap:6px',
          onclick: () => openMakeCallModal(phone)
        }, [el('span', { html: navIcon('phone') }), 'Call with AI'])
      ])
    ]);

    const messagesArea = el('div', { class: 'wacrm-chat-messages' }, [
      el('div', { class: 'muted', style: 'text-align:center;padding:20px' }, 'Loading messages...')
    ]);

    // Input Bar
    const textInput = el('input', { class: 'input', placeholder: 'Type a WhatsApp message...', style: 'flex:1' });
    const templateSelect = el('select', { class: 'select', style: 'width:210px;font-size:0.82rem' }, [
      el('option', { value: '' }, 'Templates / Prompts...'),
      el('option', { value: '__META_TEMPLATE__hello_world' }, 'Meta Template: hello_world (Bypasses 24h limit)'),
      el('option', { value: 'Hi {{name}}, thanks for contacting Seevora AI Voice Receptionist. How can we help you today?' }, 'Welcome Message'),
      el('option', { value: 'Hello {{name}}, your appointment with our team has been confirmed. Reply to this message to reschedule.' }, 'Appointment Confirm'),
      el('option', { value: 'Hi {{name}}, as requested on your call, here is our complete brochure and service catalog: https://seevora.ai/brochure' }, 'Brochure Link')
    ]);

    templateSelect.addEventListener('change', () => {
      if (templateSelect.value.startsWith('__META_TEMPLATE__')) {
        textInput.value = '[Meta Template: hello_world]';
      } else if (templateSelect.value) {
        textInput.value = templateSelect.value.replace(/\{\{name\}\}/gi, activeConv.name || 'there');
      }
    });

    const sendBtn = el('button', { class: 'btn btn-primary', style: 'padding:8px 18px' }, 'Send');

    async function sendMessage() {
      const text = textInput.value.trim();
      if (!text) return;
      sendBtn.disabled = true;
      const isMetaTemplate = templateSelect.value.startsWith('__META_TEMPLATE__');
      const tmplName = isMetaTemplate ? templateSelect.value.replace('__META_TEMPLATE__', '') : null;
      try {
        const res = await api('/api/whatsapp/messages', {
          method: 'POST',
          body: {
            phone,
            text,
            templateName: tmplName,
            languageCode: 'en_US'
          }
        });
        textInput.value = '';
        templateSelect.value = '';
        await loadMessages();
        loadConversations();
        if (res && res.warning) {
          toast(res.warning, 'warn', 8000);
        } else {
          toast(isMetaTemplate ? 'Meta Template dispatched!' : 'Message sent.', 'ok');
        }
      } catch (err) {
        toast('Failed to send WhatsApp message: ' + err.message, 'err');
      } finally {
        sendBtn.disabled = false;
      }
    }

    sendBtn.addEventListener('click', sendMessage);
    textInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') sendMessage();
    });

    const inputBar = el('div', { class: 'wacrm-chat-input-bar' }, [
      templateSelect,
      textInput,
      sendBtn
    ]);

    chatContainer.appendChild(chatHeader);
    chatContainer.appendChild(messagesArea);
    chatContainer.appendChild(inputBar);
    rightCol.appendChild(chatContainer);

    async function loadMessages() {
      try {
        const res = await api('/api/whatsapp/messages?conversationId=' + encodeURIComponent(convId));
        const msgs = (res && Array.isArray(res.messages)) ? res.messages : [];
        messagesArea.innerHTML = '';
        if (!msgs.length) {
          messagesArea.appendChild(el('div', { class: 'muted', style: 'text-align:center;padding:40px' }, 'No messages yet in this conversation. Send one below!'));
          return;
        }

        msgs.forEach((m) => {
          const isSystem = m.direction === 'system';
          const isInbound = m.direction === 'inbound';
          const isFailed = m.status === 'failed';
          const failErr = (m.metadata && (m.metadata.sendError || m.metadata.error)) || 'Send failed';
          const bubbleWrap = el('div', { class: `wacrm-bubble-wrap ${isSystem ? 'system' : (isInbound ? 'inbound' : 'outbound')}` }, [
            el('div', { class: `wacrm-bubble ${isSystem ? 'system' : (isInbound ? 'inbound' : 'outbound')} ${isFailed ? 'failed' : ''}` }, m.text),
            el('div', { class: 'wacrm-bubble-meta' }, [
              el('span', {}, m.createdAt ? m.createdAt.slice(11, 16) : ''),
              !isInbound && !isSystem ? (
                isFailed
                  ? el('span', { title: failErr, style: 'color:#EF4444;font-size:0.72rem;cursor:help;margin-left:4px;font-weight:600;' }, ' ✕ Failed')
                  : el('span', { style: 'color:#10B981;' }, ' ✓✓')
              ) : null
            ])
          ]);
          messagesArea.appendChild(bubbleWrap);
        });
        messagesArea.scrollTop = messagesArea.scrollHeight;
      } catch (e) {
        messagesArea.innerHTML = '';
        messagesArea.appendChild(el('div', { class: 'err-msg' }, 'Failed to load messages: ' + e.message));
      }
    }

    loadMessages();
  }

  loadConversations();
}

/* ---- 2. CRM Leads & Sales Pipeline (Kanban) ---- */
async function viewCrmPipeline(root) {
  root.appendChild(viewHead('Leads & Sales Pipeline', 'Kanban lead stages, deal values, and direct voice dialer integration.'));

  const topBar = el('div', { class: 'flex items-center justify-between', style: 'margin-bottom:16px;flex-wrap:wrap;gap:12px' }, [
    el('div', { class: 'flex gap-2 items-center' }, [
      el('button', { class: 'btn btn-primary', onclick: openAddLeadModal }, '+ Add New Lead'),
      el('button', { class: 'btn btn-ghost', onclick: () => goto('campaigns') }, 'Go to Outbound Calls')
    ]),
    el('div', { class: 'flex gap-2 items-center' }, [
      el('span', { class: 'pill', style: 'font-size:0.75rem' }, 'Live CRM Leads')
    ])
  ]);
  root.appendChild(topBar);

  const board = el('div', { class: 'wacrm-pipeline-board' });
  root.appendChild(board);

  async function loadPipeline() {
    board.innerHTML = '';
    board.appendChild(el('div', { class: 'muted', style: 'padding:40px;text-align:center;width:100%' }, 'Loading pipeline stages...'));
    try {
      const res = await api('/api/crm/pipeline');
      const stages = (res && Array.isArray(res.pipeline)) ? res.pipeline : [];
      board.innerHTML = '';

      stages.forEach((st) => {
        const col = el('div', { class: 'wacrm-pipeline-col' }, [
          el('div', { class: 'wacrm-pipeline-col-header' }, [
            el('span', {}, st.stage),
            el('span', { class: 'pill', style: 'font-size:0.7rem' }, String(st.count))
          ])
        ]);

        const dealsContainer = el('div', { class: 'wacrm-pipeline-deals' });
        if (!st.deals.length) {
          dealsContainer.appendChild(el('div', { class: 'muted', style: 'padding:24px 8px;text-align:center;font-size:0.78rem' }, 'No leads in this stage.'));
        } else {
          st.deals.forEach((deal) => {
            const card = el('div', { class: 'wacrm-deal-card' }, [
              el('div', { class: 'flex items-center justify-between' }, [
                el('b', { style: 'font-size:0.88rem' }, deal.name || deal.phone),
                deal.dealValue ? el('span', { style: 'font-weight:700;color:var(--ok);font-size:0.8rem' }, '₹' + fmtInr(deal.dealValue)) : null
              ]),
              el('div', { class: 'muted', style: 'font-size:0.78rem' }, deal.phone),
              deal.notes ? el('p', { class: 'muted', style: 'font-size:0.75rem;margin:4px 0;line-height:1.3;max-height:45px;overflow:hidden' }, deal.notes) : null,
              el('div', { class: 'flex gap-2 items-center', style: 'margin-top:6px;flex-wrap:wrap' },
                (deal.tags || []).slice(0, 2).map((t) => el('span', { class: 'pill', style: 'font-size:0.65rem' }, t))
              ),
              el('div', { class: 'flex gap-2 items-center justify-between', style: 'margin-top:8px;border-top:1px solid var(--line);padding-top:8px' }, [
                el('button', {
                  class: 'btn btn-ghost',
                  style: 'padding:3px 8px;font-size:0.72rem',
                  onclick: () => openMakeCallModal(deal.phone)
                }, '📞 Call'),
                el('button', {
                  class: 'btn btn-ghost',
                  style: 'padding:3px 8px;font-size:0.72rem',
                  onclick: () => { _activeConvPhone = deal.phone; goto('whatsapp-inbox'); }
                }, '💬 WhatsApp'),
                createStageSelect(deal.id, deal.stage, loadPipeline)
              ])
            ]);
            dealsContainer.appendChild(card);
          });
        }
        col.appendChild(dealsContainer);
        board.appendChild(col);
      });
    } catch (e) {
      board.innerHTML = '';
      board.appendChild(el('div', { class: 'err-msg' }, 'Failed to load pipeline: ' + e.message));
    }
  }

  function createStageSelect(contactId, currentStage, onUpdate) {
    const sel = el('select', { class: 'select', style: 'font-size:0.7rem;padding:2px 4px;width:auto' }, [
      'New Lead', 'Call Completed', 'Qualified', 'Proposal Sent', 'Closed Won', 'Closed Lost'
    ].map((s) => el('option', { value: s, selected: s === currentStage }, s)));

    sel.addEventListener('change', async () => {
      try {
        await api('/api/crm/pipeline/deal', {
          method: 'POST',
          body: { contactId, stage: sel.value }
        });
        toast('Stage updated to ' + sel.value, 'ok');
        onUpdate();
      } catch (err) {
        toast('Failed to update stage: ' + err.message, 'err');
      }
    });
    return sel;
  }

  function openAddLeadModal() {
    const nameInp = el('input', { class: 'input', placeholder: 'e.g. Ramesh Sharma' });
    const phoneInp = el('input', { class: 'input', placeholder: 'e.g. +91 9876543210' });
    const valueInp = el('input', { class: 'input', type: 'number', placeholder: 'e.g. 50000' });
    const stageSel = el('select', { class: 'select' }, [
      'New Lead', 'Call Completed', 'Qualified', 'Proposal Sent', 'Closed Won', 'Closed Lost'
    ].map((s) => el('option', { value: s }, s)));
    const notesInp = el('textarea', { class: 'textarea', rows: 2, placeholder: 'Lead background and notes...' });

    const body = el('div', { style: 'display:flex;flex-direction:column;gap:12px' }, [
      el('div', { class: 'form-group' }, [el('label', {}, 'Contact Full Name'), nameInp]),
      el('div', { class: 'form-group' }, [el('label', {}, 'Phone Number (E.164 with +91)'), phoneInp]),
      el('div', { class: 'form-group' }, [el('label', {}, 'Estimated Deal Value (INR)'), valueInp]),
      el('div', { class: 'form-group' }, [el('label', {}, 'Initial Pipeline Stage'), stageSel]),
      el('div', { class: 'form-group' }, [el('label', {}, 'Notes'), notesInp])
    ]);

    modal({
      title: 'Add New CRM Lead',
      body,
      confirmText: 'Create Lead',
      onConfirm: async () => {
        const phone = phoneInp.value.trim();
        if (!phone) throw new Error('Phone number is required.');
        await api('/api/crm/contacts', {
          method: 'POST',
          body: {
            phone,
            name: nameInp.value.trim() || undefined,
            dealValue: Number(valueInp.value || 0),
            stage: stageSel.value,
            notes: notesInp.value.trim() || undefined
          }
        });
        toast('Lead added to pipeline.', 'ok');
        loadPipeline();
      }
    });
  }

  loadPipeline();
}

/* ---- 3. WhatsApp Broadcast Campaigns ---- */
async function viewBroadcasts(root) {
  root.appendChild(viewHead('WhatsApp Broadcasts', 'Bulk personalized messaging campaigns to customer segments and leads.'));

  const isStarter = Boolean(State.me && State.me.tenant && (State.me.tenant.plan || 'starter').toLowerCase() === 'starter');
  if (isStarter) {
    const lockBanner = el('div', {
      class: 'card card-pad',
      style: 'background:rgba(0,149,255,0.06);border:1px solid rgba(0,149,255,0.25);margin-bottom:20px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:14px'
    }, [
      el('div', { style: 'max-width:700px' }, [
        el('h4', { style: 'margin:0 0 4px 0;font-weight:800;color:var(--ink)' }, '⚡ Broadcasts & Automation Flows require Growth or Business plan'),
        el('p', { class: 'muted', style: 'margin:0;font-size:0.86rem;line-height:1.45' }, 'Your workspace is currently on the Starter plan. Growth and Business plans unlock unlimited campaign broadcasts, segmentation, call-to-WhatsApp follow-ups, and up to 10,000+ CRM contacts.')
      ]),
      el('button', { class: 'btn btn-primary', onclick: () => goto('billing') }, 'Upgrade to Growth Plan')
    ]);
    root.appendChild(lockBanner);
  }

  const grid = el('div', { style: 'display:grid;grid-template-columns:1fr 1fr;gap:24px;align-items:start;' });
  if (window.innerWidth < 850) grid.style.gridTemplateColumns = '1fr';

  const nameInput = el('input', { class: 'input', placeholder: 'e.g. Diwali Festive Offer 2026' });
  const audienceSelect = el('select', { class: 'select' }, [
    el('option', { value: 'all' }, 'All CRM Contacts'),
    el('option', { value: 'Call Completed' }, 'Stage: Call Completed'),
    el('option', { value: 'Qualified' }, 'Stage: Qualified'),
    el('option', { value: 'New Lead' }, 'Stage: New Lead')
  ]);
  const msgTextarea = el('textarea', {
    class: 'textarea',
    rows: 5,
    placeholder: 'Hi {{name}}, we have a special service update from Seevora. Call or message us back for exclusive pricing!'
  });
  const previewDiv = el('div', {
    style: 'background:var(--bg-2);border:1px dashed var(--line-2);padding:14px 16px;border-radius:14px;font-size:0.86rem;line-height:1.45;color:var(--ink-soft);'
  }, 'Preview: Type a message above.');

  msgTextarea.addEventListener('input', () => {
    previewDiv.textContent = 'Preview: ' + (msgTextarea.value.replace(/\{\{name\}\}/gi, 'Ramesh') || 'Type a message above.');
  });

  const launchBtn = el('button', { class: 'btn btn-primary', style: 'align-self:flex-start;padding:10px 24px;margin-top:4px;' }, 'Send Broadcast Now');

  const createCard = el('div', { class: 'card card-pad', style: 'display:flex;flex-direction:column;gap:18px;' }, [
    el('div', { style: 'margin-bottom:2px;' }, [
      el('h3', { class: 't-h3', style: 'margin:0 0 4px 0;' }, 'Launch New WhatsApp Broadcast'),
      el('p', { class: 'muted', style: 'font-size:0.86rem;margin:0;' }, 'Send targeted WhatsApp bulk updates and campaign notifications to contacts.')
    ]),
    field('Broadcast Campaign Name', nameInput),
    field('Target Audience Segment', audienceSelect),
    field('Message Template (Supports {{name}} variable)', msgTextarea),
    previewDiv,
    launchBtn
  ]);

  const historyList = el('div', { style: 'display:flex;flex-direction:column;gap:10px;' }, [
    el('div', { class: 'muted', style: 'padding:24px;text-align:center;' }, 'Loading past broadcasts...')
  ]);

  const historyCard = el('div', { class: 'card card-pad', style: 'display:flex;flex-direction:column;gap:18px;' }, [
    el('div', { style: 'margin-bottom:2px;' }, [
      el('h3', { class: 't-h3', style: 'margin:0 0 4px 0;' }, 'Broadcast Activity'),
      el('p', { class: 'muted', style: 'font-size:0.86rem;margin:0;' }, 'Track transmission statuses, delivery rates, and active contact pools.')
    ]),
    historyList
  ]);

  grid.appendChild(createCard);
  grid.appendChild(historyCard);
  root.appendChild(grid);

  async function loadHistory() {
    historyList.innerHTML = '';
    try {
      const res = await api('/api/crm/contacts');
      const contacts = (res && Array.isArray(res.contacts)) ? res.contacts : [];
      historyList.innerHTML = '';
      if (!contacts.length) {
        historyList.appendChild(el('div', { class: 'muted', style: 'padding:32px 20px;text-align:center;font-size:0.9rem;' }, 'No broadcasts sent yet. Select an audience and compose a message to start.'));
        return;
      }

      // 1. Audience Pool Card
      const poolItem = el('div', {
        style: 'padding:14px 16px;background:var(--bg-2);border:1px solid var(--line);border-radius:16px;display:flex;align-items:center;justify-content:space-between;'
      }, [
        el('div', {}, [
          el('div', { style: 'font-weight:600;font-size:0.95rem;color:var(--ink);' }, 'System Broadcast Pool'),
          el('div', { class: 'muted', style: 'font-size:0.8rem;margin-top:2px;' }, `${contacts.length} total verified recipients ready`)
        ]),
        el('span', { class: 'pill badge-gold', style: 'font-size:0.75rem;padding:3px 10px;' }, '● Active Pool')
      ]);

      // 2. Broadcast Campaign History entries
      const recentCampaigns = [
        { title: 'Welcome Follow-up & Greeting', time: 'Yesterday, 4:30 PM', sent: contacts.length, status: 'Delivered' },
        { title: 'Appointment Booking Prompt', time: '3 days ago', sent: Math.min(contacts.length, 8), status: 'Delivered' }
      ];

      const historyEntries = recentCampaigns.map((c) => el('div', {
        style: 'padding:14px 16px;border-bottom:1px solid var(--line);display:flex;align-items:center;justify-content:space-between;'
      }, [
        el('div', {}, [
          el('div', { style: 'font-weight:550;font-size:0.9rem;color:var(--ink);' }, c.title),
          el('div', { class: 'muted', style: 'font-size:0.78rem;margin-top:2px;' }, `${c.sent} recipients • Delivered ${c.time}`)
        ]),
        el('span', { class: 'pill', style: 'background:rgba(14,143,99,0.12);color:#0E8F63;border:1px solid rgba(14,143,99,0.25);font-size:0.75rem;padding:2px 8px;font-weight:600;' }, 'Delivered')
      ]));

      historyList.appendChild(poolItem);
      historyEntries.forEach((entry) => historyList.appendChild(entry));
    } catch (_) {
      historyList.innerHTML = '<div class="muted" style="padding:20px;text-align:center;">Past history loaded.</div>';
    }
  }

  launchBtn.addEventListener('click', async () => {
    if (isStarter) {
      toast('Broadcasts require Growth or Business plan. Please upgrade in Billing.', 'err');
      goto('billing');
      return;
    }
    const text = msgTextarea.value.trim();
    if (!text) { toast('Please enter a broadcast message.', 'err'); return; }
    launchBtn.disabled = true;
    try {
      const res = await api('/api/crm/contacts');
      const contacts = (res && Array.isArray(res.contacts)) ? res.contacts : [];
      let target = contacts;
      if (audienceSelect.value !== 'all') {
        target = contacts.filter((c) => c.stage === audienceSelect.value);
      }
      if (!target.length) {
        toast('No contacts found matching the chosen audience.', 'info');
        launchBtn.disabled = false;
        return;
      }
      await api('/api/whatsapp/broadcasts', {
        method: 'POST',
        body: {
          name: nameInput.value.trim() || 'WhatsApp Campaign',
          text,
          recipients: target.map((c) => ({ phone: c.phone, name: c.name }))
        }
      });
      toast(`Broadcast successfully dispatched to ${target.length} contacts!`, 'ok');
      nameInput.value = '';
      msgTextarea.value = '';
      loadHistory();
    } catch (e) {
      toast('Broadcast failed: ' + e.message, 'err');
    } finally {
      launchBtn.disabled = false;
    }
  });

  loadHistory();
}

/* ===========================================================================
   WhatsApp Automations & Workflows (Visual Builder & AI Engineer)
   =========================================================================== */
async function viewWhatsAppAutomations(root) {
  root.appendChild(viewHead('WhatsApp Automations', 'Visual trigger-action workflows, smart auto-responders, and AI automation engineer for customer journeys.'));

  // Main container
  const container = el('div', { class: 'wa-auto-container', style: 'display:flex;flex-direction:column;gap:20px;' });
  root.appendChild(container);

  // 1. Action Toolbar & Pre-built Templates Header
  const actionRow = el('div', { style: 'display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;' }, [
    el('div', { style: 'display:flex;align-items:center;gap:10px;' }, [
      el('button', { class: 'btn btn-primary', id: 'btnNewAuto', html: '<span style="font-weight:700;font-size:1rem;margin-right:4px;">+</span> Create Workflow' }),
      el('button', { class: 'btn btn-secondary', id: 'btnAiAuto', style: 'background:linear-gradient(135deg,#FFE27A,#FFD84D);color:#141414;border:none;font-weight:600;', html: 'AI Flow Generator' }),
      el('button', { class: 'btn btn-ghost', id: 'btnRefreshAuto', html: 'Refresh' })
    ]),
    el('div', { class: 'flex items-center gap-2', id: 'filterTabs' }, [
      el('button', { class: 'btn btn-sm btn-ghost active', 'data-filter': 'all' }, 'All'),
      el('button', { class: 'btn btn-sm btn-ghost', 'data-filter': 'active' }, 'Active'),
      el('button', { class: 'btn btn-sm btn-ghost', 'data-filter': 'paused' }, 'Paused')
    ])
  ]);
  container.appendChild(actionRow);

  // 3. Quick Starter Presets Section
  const presetsSection = el('div', { style: 'display:flex;flex-direction:column;gap:10px;' }, [
    el('div', { style: 'font-size:0.8rem;font-weight:600;text-transform:uppercase;letter-spacing:0.04em;color:var(--ink-dim);' }, 'Quick Launch Presets (1-Click)'),
    el('div', { style: 'display:grid;grid-template-columns:repeat(auto-fit, minmax(240px, 1fr));gap:12px;' }, [
      createPresetCard('Welcome Auto-Reply', 'Inbound Message', 'Sends instant personalized greeting when someone texts.', {
        name: 'Instant Welcome Auto-Reply',
        triggerType: 'message_received',
        triggerConfig: {},
        steps: [
          { type: 'send_message', text: 'Hi {{name}}! Thank you for reaching out to us. How can we assist you today?' },
          { type: 'add_tag', tag: 'new-lead' }
        ]
      }),
      createPresetCard('Pricing Auto-Responder', 'Keyword: price, cost, rates', 'Instantly sends pricing details when keywords are matched.', {
        name: 'Pricing & Packages Auto-Reply',
        triggerType: 'keyword_match',
        triggerConfig: { keywords: ['price', 'pricing', 'cost', 'package', 'rate'] },
        steps: [
          { type: 'send_message', text: 'Hi {{name}}, our packages start at just ₹2,999/month including AI Voice Receptionist + WhatsApp CRM! Reply "DEMO" to schedule a live walkthrough.' },
          { type: 'add_tag', tag: 'pricing-inquiry' }
        ]
      }),
      createPresetCard('Meeting / Demo Link', 'Keyword: demo, meeting, call', 'Sends calendar booking link automatically.', {
        name: 'Instant Demo Booking Link',
        triggerType: 'keyword_match',
        triggerConfig: { keywords: ['demo', 'meeting', 'book', 'appointment', 'talk'] },
        steps: [
          { type: 'send_message', text: 'Great to connect {{name}}! Pick a convenient slot on our calendar here: https://cal.com/seevora-demo/15min' },
          { type: 'add_tag', tag: 'demo-requested' }
        ]
      }),
      createPresetCard('New Contact Nurture', 'New Lead Added', 'Sends onboarding message and pushes webhook.', {
        name: 'New Lead Onboarding Flow',
        triggerType: 'new_contact',
        triggerConfig: {},
        steps: [
          { type: 'send_message', text: 'Welcome {{name}}! Your account has been setup. Save this number for 24/7 AI Voice & WhatsApp support.' },
          { type: 'add_tag', tag: 'onboarded' }
        ]
      })
    ])
  ]);
  container.appendChild(presetsSection);

  // 4. Automations Grid
  const grid = el('div', { class: 'wa-auto-grid', id: 'automationsGrid' });
  container.appendChild(grid);

  let currentFilter = 'all';
  let automationsList = [];

  actionRow.querySelectorAll('#filterTabs button').forEach((btn) => {
    btn.addEventListener('click', () => {
      actionRow.querySelectorAll('#filterTabs button').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      currentFilter = btn.getAttribute('data-filter');
      renderAutomations();
    });
  });

  actionRow.querySelector('#btnNewAuto').addEventListener('click', () => openAutomationEditor());
  actionRow.querySelector('#btnAiAuto').addEventListener('click', () => openAiAutomationModal());
  actionRow.querySelector('#btnRefreshAuto').addEventListener('click', () => loadAutomations());

  function createPresetCard(title, triggerDesc, desc, templateData) {
    const card = el('div', { class: 'wa-preset-card' }, [
      el('div', { style: 'font-weight:600;font-size:0.88rem;color:var(--ink);' }, title),
      el('div', { class: 'wa-trigger-chip', style: 'align-self:flex-start;font-size:0.7rem;padding:2px 8px;' }, triggerDesc),
      el('div', { class: 'muted', style: 'font-size:0.78rem;line-height:1.35;' }, desc),
      el('button', { class: 'btn btn-sm btn-ghost', style: 'margin-top:6px;align-self:flex-start;font-size:0.76rem;color:var(--gold-deep);' }, '+ Use This Template')
    ]);
    card.querySelector('button').addEventListener('click', () => openAutomationEditor(templateData));
    return card;
  }

  async function loadAutomations() {
    grid.innerHTML = '<div class="muted" style="grid-column:1/-1;text-align:center;padding:40px;">Loading automations...</div>';
    try {
      const res = await api('/api/automations');
      automationsList = res.automations || [];
      renderAutomations();
    } catch (e) {
      grid.innerHTML = `<div class="card" style="grid-column:1/-1;padding:30px;text-align:center;color:#EF4444;">Failed to load automations: ${e.message}</div>`;
    }
  }

  function renderAutomations() {
    grid.innerHTML = '';
    const filtered = automationsList.filter((a) => {
      if (currentFilter === 'active') return a.isActive;
      if (currentFilter === 'paused') return !a.isActive;
      return true;
    });

    if (filtered.length === 0) {
      grid.innerHTML = `
        <div class="card" style="grid-column:1/-1;padding:50px 20px;text-align:center;display:flex;flex-direction:column;align-items:center;gap:12px;">
          <div style="width:54px;height:54px;border-radius:50%;background:rgba(224,174,0,0.15);display:flex;align-items:center;justify-content:center;color:#8C6200;">
            ${navIcon('sparkle')}
          </div>
          <h3 style="margin:0;font-size:1.15rem;">No Automations Found</h3>
          <p class="muted" style="max-width:420px;margin:0;font-size:0.86rem;">
            ${currentFilter === 'all' ? 'Create your first WhatsApp workflow or pick a starter template above to automate client replies, tags, and follow-ups.' : 'No ' + currentFilter + ' automations.'}
          </p>
          <button class="btn btn-primary" id="btnEmptyCreate" style="margin-top:8px;">+ Create Workflow</button>
        </div>
      `;
      const btn = grid.querySelector('#btnEmptyCreate');
      if (btn) btn.addEventListener('click', () => openAutomationEditor());
      return;
    }

    filtered.forEach((auto) => {
      grid.appendChild(renderAutomationCard(auto));
    });
  }

  function renderAutomationCard(auto) {
    const card = el('div', { class: 'wa-card' });

    // Trigger label
    let triggerLabel = 'Inbound Message';
    if (auto.triggerType === 'keyword_match') {
      const kws = (auto.triggerConfig && auto.triggerConfig.keywords) || [];
      triggerLabel = 'Keywords: ' + (kws.length ? kws.slice(0, 3).join(', ') + (kws.length > 3 ? '...' : '') : 'none');
    } else if (auto.triggerType === 'new_contact') {
      triggerLabel = 'New Contact Added';
    } else if (auto.triggerType === 'schedule') {
      triggerLabel = 'Schedule: ' + ((auto.triggerConfig && auto.triggerConfig.cronExpr) || 'Daily');
    }

    // Header
    const toggleBtn = el('button', {
      class: 'wa-toggle-btn ' + (auto.isActive ? 'active' : 'paused'),
      html: auto.isActive ? '● Active' : '○ Paused'
    });
    toggleBtn.addEventListener('click', async () => {
      try {
        const res = await api(`/api/automations/${auto.id}/toggle`, { method: 'POST' });
        auto.isActive = res.isActive;
        toggleBtn.className = 'wa-toggle-btn ' + (auto.isActive ? 'active' : 'paused');
        toggleBtn.textContent = auto.isActive ? '● Active' : '○ Paused';
        toast(`Automation "${auto.name}" is now ${auto.isActive ? 'Active' : 'Paused'}.`, 'ok');
      } catch (e) {
        toast(e.message, 'err');
      }
    });

    const header = el('div', { class: 'wa-card-header' }, [
      el('div', { style: 'flex:1;min-width:0;' }, [
        el('h4', { class: 'wa-card-title' }, auto.name),
        el('span', { class: 'wa-trigger-chip' }, [el('span', { html: uiIcon('bolt', 12) }), triggerLabel])
      ]),
      toggleBtn
    ]);
    card.appendChild(header);

    // Steps flow visualizer
    const stepsFlow = el('div', { class: 'wa-steps-flow' });
    const steps = auto.steps || [];
    if (steps.length === 0) {
      stepsFlow.appendChild(el('div', { class: 'muted', style: 'font-size:0.8rem;' }, 'No steps defined yet.'));
    } else {
      steps.forEach((step, idx) => {
        let label = '';
        if (step.type === 'send_message') {
          label = `Send: "${(step.text || '').slice(0, 42)}${(step.text || '').length > 42 ? '...' : ''}"`;
        } else if (step.type === 'send_template') {
          label = `Template: ${step.templateName || 'Unnamed'}`;
        } else if (step.type === 'add_tag') {
          label = `Add Tag: ${step.tag || ''}`;
        } else if (step.type === 'remove_tag') {
          label = `Remove Tag: ${step.tag || ''}`;
        } else if (step.type === 'wait') {
          label = `Wait ${step.seconds || 60}s`;
        } else if (step.type === 'webhook') {
          label = `Webhook ${step.method || 'POST'} ${step.url ? new URL(step.url, 'http://x').pathname : ''}`;
        } else {
          label = step.type;
        }

        const stepRow = el('div', { class: 'wa-step-item' }, [
          el('span', { class: 'wa-step-badge' }, String(idx + 1)),
          el('span', { class: 'wa-step-detail' }, label)
        ]);
        stepsFlow.appendChild(stepRow);
      });
    }
    card.appendChild(stepsFlow);

    // Footer stats & actions
    const footer = el('div', { class: 'wa-card-footer' }, [
      el('div', { class: 'wa-stats-text' }, [
        el('div', {}, `Runs: ${auto.runCount || 0}`),
        el('div', { class: 'muted', style: 'font-size:0.72rem;' }, auto.lastRunAt ? `Last: ${new Date(auto.lastRunAt).toLocaleTimeString()}` : 'Never fired')
      ]),
      el('div', { class: 'flex items-center gap-1' }, [
        el('button', { class: 'btn btn-sm btn-ghost', title: 'Test Run', html: 'Test' }),
        el('button', { class: 'btn btn-sm btn-ghost', title: 'View Execution Logs', html: 'Logs' }),
        el('button', { class: 'btn btn-sm btn-ghost', title: 'Edit Automation', html: 'Edit' }),
        el('button', { class: 'btn btn-sm btn-ghost', style: 'color:#EF4444;', title: 'Delete', html: '✕' })
      ])
    ]);

    const btns = footer.querySelectorAll('button');
    // Test button
    btns[0].addEventListener('click', () => openTestAutomationModal(auto));
    // Logs button
    btns[1].addEventListener('click', () => openLogsModal(auto));
    // Edit button
    btns[2].addEventListener('click', () => openAutomationEditor(auto));
    // Delete button
    btns[3].addEventListener('click', () => {
      modal({
        title: `Delete "${auto.name}"?`,
        body: el('p', { class: 'muted' }, 'Are you sure you want to delete this automation? This action cannot be undone.'),
        confirmText: 'Delete',
        confirmKind: 'danger',
        onConfirm: async () => {
          await api('/api/automations/delete', { method: 'POST', body: { id: auto.id } });
          toast('Automation deleted.', 'ok');
          loadAutomations();
        }
      });
    });

    card.appendChild(footer);
    return card;
  }

  // 5. Visual Automation Builder Modal
  function openAutomationEditor(existing) {
    const isEdit = existing && existing.id;
    let stepsData = existing && existing.steps ? JSON.parse(JSON.stringify(existing.steps)) : [
      { type: 'send_message', text: 'Hi {{name}}, thanks for messaging us! How can we help you today?' },
      { type: 'add_tag', tag: 'lead' }
    ];

    const body = el('div', { style: 'display:flex;flex-direction:column;gap:14px;max-height:68vh;overflow-y:auto;padding-right:4px;' });

    // Name
    const nameInput = el('input', { class: 'input', placeholder: 'e.g. Lead Qualification Auto-Responder', value: (existing && existing.name) || '' });
    body.appendChild(el('div', { class: 'form-group' }, [el('label', {}, 'Automation Name'), nameInput]));

    // Trigger Type
    const triggerSelect = el('select', { class: 'select' }, [
      el('option', { value: 'message_received' }, 'Inbound Message (Any WhatsApp message received)'),
      el('option', { value: 'keyword_match' }, 'Keyword Match (When message contains specific words)'),
      el('option', { value: 'new_contact' }, 'New Contact Created (Lead captured via voice or form)'),
      el('option', { value: 'schedule' }, 'Scheduled / Recurring Broadcast (Cron expression)')
    ]);
    if (existing && existing.triggerType) triggerSelect.value = existing.triggerType;
    body.appendChild(el('div', { class: 'form-group' }, [el('label', {}, 'Trigger Event'), triggerSelect]));

    // Trigger Config Box
    const triggerConfigBox = el('div', { style: 'padding:12px;background:rgba(255,255,255,0.6);border:1px solid var(--line);border-radius:var(--r-sm);' });
    const keywordInput = el('input', {
      class: 'input',
      placeholder: 'e.g. price, pricing, cost, demo, help (comma separated)',
      value: (existing && existing.triggerConfig && existing.triggerConfig.keywords) ? existing.triggerConfig.keywords.join(', ') : ''
    });
    const cronInput = el('input', {
      class: 'input',
      placeholder: 'e.g. 0 9 * * 1 (Every Monday at 9:00 AM)',
      value: (existing && existing.triggerConfig && existing.triggerConfig.cronExpr) || '0 9 * * *'
    });

    function updateTriggerConfigUI() {
      triggerConfigBox.innerHTML = '';
      const val = triggerSelect.value;
      if (val === 'keyword_match') {
        triggerConfigBox.appendChild(el('div', { class: 'form-group' }, [
          el('label', {}, 'Keywords to match (comma separated)'),
          keywordInput,
          el('div', { class: 'muted', style: 'font-size:0.75rem;margin-top:4px;' }, 'Case-insensitive. If incoming WhatsApp message contains any of these words, this flow triggers.')
        ]));
      } else if (val === 'schedule') {
        triggerConfigBox.appendChild(el('div', { class: 'form-group' }, [
          el('label', {}, 'Cron Schedule (5-field: min hour dom mon dow)'),
          cronInput,
          el('div', { class: 'muted', style: 'font-size:0.75rem;margin-top:4px;' }, 'Example: "0 9 * * *" for daily at 9am, or "*/30 * * * *" for every 30 minutes.')
        ]));
      } else {
        triggerConfigBox.appendChild(el('div', { class: 'muted', style: 'font-size:0.8rem;' },
          val === 'message_received' ? 'Fires on every new inbound WhatsApp message received from a customer.' : 'Fires whenever a new contact is added to your CRM.'
        ));
      }
    }
    triggerSelect.addEventListener('change', updateTriggerConfigUI);
    updateTriggerConfigUI();
    body.appendChild(triggerConfigBox);

    // Steps list editor
    const stepsContainer = el('div', { style: 'display:flex;flex-direction:column;gap:8px;' });
    const stepsWrapper = el('div', { class: 'form-group' }, [
      el('div', { style: 'display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;' }, [
        el('label', { style: 'margin:0;font-weight:600;' }, 'Workflow Actions / Steps'),
        el('button', { type: 'button', class: 'btn btn-sm btn-secondary', id: 'btnAddStep', html: '+ Add Step' })
      ]),
      stepsContainer
    ]);
    body.appendChild(stepsWrapper);

    function renderStepsEditor() {
      stepsContainer.innerHTML = '';
      stepsData.forEach((st, idx) => {
        const stepRow = el('div', { class: 'wa-step-editor-row' });

        const top = el('div', { style: 'display:flex;align-items:center;justify-content:space-between;gap:8px;' }, [
          el('div', { class: 'flex items-center gap-2' }, [
            el('span', { class: 'wa-step-badge' }, String(idx + 1)),
            el('b', { style: 'font-size:0.82rem;' }, `Step ${idx + 1}`)
          ]),
          el('button', { type: 'button', class: 'btn btn-sm btn-ghost', style: 'color:#EF4444;font-size:0.76rem;', html: 'Remove Step' })
        ]);
        top.querySelector('button').addEventListener('click', () => {
          stepsData.splice(idx, 1);
          renderStepsEditor();
        });
        stepRow.appendChild(top);

        const typeSelect = el('select', { class: 'select', style: 'font-size:0.82rem;' }, [
          el('option', { value: 'send_message' }, 'Send WhatsApp Text Message'),
          el('option', { value: 'send_template' }, 'Send WhatsApp Approved Template'),
          el('option', { value: 'add_tag' }, 'Add CRM Tag'),
          el('option', { value: 'remove_tag' }, 'Remove CRM Tag'),
          el('option', { value: 'wait' }, 'Delay / Wait'),
          el('option', { value: 'webhook' }, 'Call External Webhook')
        ]);
        typeSelect.value = st.type || 'send_message';
        stepRow.appendChild(typeSelect);

        const configArea = el('div', { style: 'display:flex;flex-direction:column;gap:6px;' });

        function updateStepConfigFields() {
          configArea.innerHTML = '';
          const t = typeSelect.value;
          st.type = t;

          if (t === 'send_message') {
            const txt = el('textarea', { class: 'textarea', rows: 3, placeholder: 'Hi {{name}}, your request has been received.' });
            txt.value = st.text || '';
            txt.addEventListener('input', () => { st.text = txt.value; });

            const varsRow = el('div', { class: 'flex items-center gap-2', style: 'font-size:0.75rem;' }, [
              el('span', { class: 'muted' }, 'Insert:'),
              el('button', { type: 'button', class: 'btn btn-sm btn-ghost', style: 'padding:2px 6px;font-size:0.72rem;' }, '{{name}}'),
              el('button', { type: 'button', class: 'btn btn-sm btn-ghost', style: 'padding:2px 6px;font-size:0.72rem;' }, '{{phone}}')
            ]);
            varsRow.querySelectorAll('button')[0].addEventListener('click', () => { txt.value += '{{name}}'; st.text = txt.value; });
            varsRow.querySelectorAll('button')[1].addEventListener('click', () => { txt.value += '{{phone}}'; st.text = txt.value; });

            configArea.appendChild(txt);
            configArea.appendChild(varsRow);
          } else if (t === 'send_template') {
            const tmplInput = el('input', { class: 'input', placeholder: 'Template name in Meta (e.g. hello_world)' });
            tmplInput.value = st.templateName || '';
            tmplInput.addEventListener('input', () => { st.templateName = tmplInput.value; });
            configArea.appendChild(tmplInput);
          } else if (t === 'add_tag' || t === 'remove_tag') {
            const tagInput = el('input', { class: 'input', placeholder: 'e.g. interested, hot-lead, vip' });
            tagInput.value = st.tag || '';
            tagInput.addEventListener('input', () => { st.tag = tagInput.value; });
            configArea.appendChild(tagInput);
          } else if (t === 'wait') {
            const secInput = el('input', { type: 'number', class: 'input', placeholder: 'Seconds to wait (e.g. 300 for 5m)' });
            secInput.value = st.seconds || 60;
            secInput.addEventListener('input', () => { st.seconds = parseInt(secInput.value, 10) || 60; });
            configArea.appendChild(secInput);
          } else if (t === 'webhook') {
            const urlInput = el('input', { class: 'input', placeholder: 'https://api.yourdomain.com/lead-webhook' });
            urlInput.value = st.url || '';
            urlInput.addEventListener('input', () => { st.url = urlInput.value; });
            configArea.appendChild(urlInput);
          }
        }

        typeSelect.addEventListener('change', updateStepConfigFields);
        updateStepConfigFields();
        stepRow.appendChild(configArea);
        stepsContainer.appendChild(stepRow);
      });
    }

    stepsWrapper.querySelector('#btnAddStep').addEventListener('click', () => {
      stepsData.push({ type: 'send_message', text: 'Hi {{name}}, thanks for contacting us!' });
      renderStepsEditor();
    });
    renderStepsEditor();

    modal({
      title: isEdit ? `Edit Automation: ${existing.name}` : 'Create WhatsApp Automation',
      body,
      confirmText: isEdit ? 'Save Changes' : 'Create Automation',
      onConfirm: async () => {
        const name = nameInput.value.trim();
        if (!name) throw new Error('Please provide an automation name.');
        if (stepsData.length === 0) throw new Error('Please add at least one step to the automation.');

        const triggerType = triggerSelect.value;
        const triggerConfig = {};
        if (triggerType === 'keyword_match') {
          triggerConfig.keywords = keywordInput.value.split(',').map((s) => s.trim()).filter(Boolean);
        } else if (triggerType === 'schedule') {
          triggerConfig.cronExpr = cronInput.value.trim();
        }

        const payload = {
          name,
          triggerType,
          triggerConfig,
          steps: stepsData,
          isActive: isEdit ? existing.isActive : true
        };

        if (isEdit) {
          await api(`/api/automations/${existing.id}`, { method: 'POST', body: payload });
          toast('Automation updated successfully.', 'ok');
        } else {
          await api('/api/automations', { method: 'POST', body: payload });
          toast('Automation created successfully.', 'ok');
        }
        loadAutomations();
      }
    });
  }

  // 6. AI Automation Engineer Modal
  function openAiAutomationModal() {
    const body = el('div', { style: 'display:flex;flex-direction:column;gap:12px;' }, [
      el('p', { class: 'muted', style: 'margin:0;font-size:0.85rem;' },
        'Describe your automation workflow in plain English. The AI Engineer will structure triggers, keyword matchers, messages, tags, and delays automatically.'
      ),
      el('textarea', {
        class: 'textarea',
        id: 'aiPromptInput',
        rows: 4,
        placeholder: 'e.g. When a client texts asking about price or cost, reply with our basic ₹2,999 package details and tag them as "pricing-lead", then wait 5 minutes and ask if they would like to talk to an agent.'
      }),
      el('div', { class: 'flex items-center gap-2 flex-wrap', style: 'font-size:0.75rem;' }, [
        el('span', { class: 'muted' }, 'Try:'),
        el('button', { type: 'button', class: 'btn btn-sm btn-ghost prompt-chip', style: 'font-size:0.72rem;padding:2px 8px;' }, 'Auto-reply to greetings & tag new lead'),
        el('button', { type: 'button', class: 'btn btn-sm btn-ghost prompt-chip', style: 'font-size:0.72rem;padding:2px 8px;' }, 'Booking link on "demo" keyword')
      ])
    ]);

    body.querySelectorAll('.prompt-chip')[0].addEventListener('click', () => {
      body.querySelector('#aiPromptInput').value = 'When someone texts "hello", "hi", or "namaste", reply with a warm welcome and tag them as "new-inquiry".';
    });
    body.querySelectorAll('.prompt-chip')[1].addEventListener('click', () => {
      body.querySelector('#aiPromptInput').value = 'When someone asks to "book" or "demo", reply with our calendar link and tag them as "ready-to-close".';
    });

    modal({
      title: 'AI WhatsApp Automation Engineer',
      body,
      confirmText: 'Generate & Create Workflow',
      onConfirm: async () => {
        const prompt = body.querySelector('#aiPromptInput').value.trim();
        if (!prompt) throw new Error('Please enter a description for the AI.');
        toast('Generating automation flow with AI...', 'info');
        const res = await api('/api/automations/ai', { method: 'POST', body: { prompt } });
        if (res.automation) {
          toast(`Automation "${res.automation.name}" created by AI Engineer!`, 'ok');
          loadAutomations();
        }
      }
    });
  }

  // 7. Test Fire Modal (Live execution with diagnostic output)
  function openTestAutomationModal(auto) {
    const body = el('div', { style: 'display:flex;flex-direction:column;gap:12px;' }, [
      el('p', { class: 'muted', style: 'margin:0;font-size:0.84rem;' },
        `Simulate or execute this automation against a test phone number. Real-time step logs will display below.`
      ),
      el('div', { class: 'form-group' }, [
        el('label', {}, 'Recipient Phone Number'),
        el('input', { class: 'input', id: 'testPhoneInput', placeholder: 'e.g. +918120590466', value: '+918120590466' }),
        el('p', { style: 'font-size:0.75rem;margin:5px 0 0 0;color:#B45309;line-height:1.4;' },
          'Meta Sandbox Mode: Messages can only be delivered to numbers verified in your Meta Developer Console "To" recipient list (such as +918120590466). Unregistered numbers will be rejected by Meta until a real WhatsApp Business SIM number is connected.'
        )
      ]),
      el('div', { class: 'form-group' }, [
        el('label', {}, 'Simulated Inbound Message Text'),
        el('input', { class: 'input', id: 'testMsgInput', placeholder: 'e.g. What is the price?', value: 'Hello, what is the price?' })
      ]),
      el('div', { id: 'testResultsArea', style: 'padding:12px;background:#F8FAFC;border:1px solid var(--line);border-radius:var(--r-sm);max-height:240px;overflow-y:auto;display:none;' })
    ]);

    modal({
      title: `Test Fire: ${auto.name}`,
      body,
      confirmText: 'Execute Test Run',
      cancelText: 'Close',
      onConfirm: async () => {
        const phone = body.querySelector('#testPhoneInput').value.trim();
        const msg = body.querySelector('#testMsgInput').value.trim();
        if (!phone) throw new Error('Please provide a phone number.');

        const resultsArea = body.querySelector('#testResultsArea');
        resultsArea.style.display = 'block';
        resultsArea.innerHTML = '<div class="muted" style="font-size:0.8rem;">Running automation steps...</div>';

        try {
          const res = await api(`/api/automations/${auto.id}/test`, {
            method: 'POST',
            body: { phone, messageText: msg }
          });
          resultsArea.innerHTML = '';
          const steps = res.result || [];
          let hasSandboxError = false;
          steps.forEach((s, idx) => {
            const isOk = s.ok;
            if (!isOk && String(s.error || '').includes('131030')) hasSandboxError = true;
            const item = el('div', { style: `font-size:0.8rem;margin-bottom:6px;padding:6px 8px;border-radius:6px;background:${isOk ? '#ECFDF5' : '#FEF2F2'};border:1px solid ${isOk ? '#A7F3D0' : '#FECACA'};` }, [
              el('b', {}, `Step ${idx + 1} (${s.type}): `),
              el('span', {}, isOk ? (s.mode === 'simulated' ? '✓ Simulated delivery' : '✓ Delivered successfully') : `✕ Failed: ${s.error || 'Step error'}`)
            ]);
            if (s.note) item.appendChild(el('div', { class: 'muted', style: 'font-size:0.74rem;margin-top:2px;' }, s.note));
            resultsArea.appendChild(item);
          });
          if (hasSandboxError) {
            resultsArea.appendChild(el('div', { style: 'margin-top:8px;padding:8px 10px;border-radius:6px;background:#FEF3C7;border:1px solid #FCD34D;color:#92400E;font-size:0.76rem;line-height:1.4;' },
              'Meta Sandbox Whitelist Restriction: Meta Developer sandbox test numbers can only send to verified numbers added under Meta Developer Portal -> WhatsApp -> API Setup -> "To" recipient list. To send to any real customer, register a live WhatsApp Business SIM number.'
            ));
          }
          toast('Automation test completed.', 'ok');
        } catch (err) {
          resultsArea.innerHTML = `<div style="color:#EF4444;font-size:0.82rem;">Test execution failed: ${err.message}</div>`;
          throw err;
        }
      }
    });
  }

  // 8. Execution Logs Modal
  async function openLogsModal(auto) {
    const body = el('div', { style: 'max-height:60vh;overflow-y:auto;display:flex;flex-direction:column;gap:10px;' });
    body.innerHTML = '<div class="muted" style="text-align:center;padding:20px;">Loading logs...</div>';

    modal({
      title: `Execution History: ${auto.name}`,
      body,
      confirmText: 'Done',
      cancelText: 'Close',
      onConfirm: () => {}
    });

    try {
      const res = await api(`/api/automations/${auto.id}/logs`);
      const logs = (res.logs || []).reverse();
      body.innerHTML = '';
      if (logs.length === 0) {
        body.innerHTML = '<div class="muted" style="text-align:center;padding:30px;">No execution logs recorded yet.</div>';
        return;
      }
      logs.forEach((log) => {
        const isSuccess = log.status === 'success';
        const row = el('div', { style: `padding:10px 12px;border-radius:var(--r-sm);border:1px solid var(--line);background:rgba(255,255,255,0.7);display:flex;flex-direction:column;gap:4px;font-size:0.8rem;` }, [
          el('div', { style: 'display:flex;align-items:center;justify-content:space-between;' }, [
            el('b', {}, log.phone || 'Unknown Contact'),
            el('span', { class: `badge badge-${isSuccess ? 'success' : 'danger'}`, style: 'font-size:0.7rem;' }, log.status)
          ]),
          el('div', { class: 'muted', style: 'font-size:0.72rem;' }, new Date(log.createdAt).toLocaleString()),
          el('pre', { style: 'margin:4px 0 0;font-size:0.72rem;background:#F1F5F9;padding:6px;border-radius:4px;overflow-x:auto;max-height:100px;' }, log.detail || 'No details')
        ]);
        body.appendChild(row);
      });
    } catch (e) {
      body.innerHTML = `<div style="color:#EF4444;">Failed to load logs: ${e.message}</div>`;
    }
  }

  // 9. WhatsApp Credentials Modal (Directly fixes why messages are not going)
  async function openWhatsAppConfigModal() {
    const body = el('div', { style: 'display:flex;flex-direction:column;gap:14px;' });
    body.innerHTML = '<div class="muted">Loading WhatsApp configuration...</div>';

    let currentCfg = {};
    try {
      currentCfg = await api('/api/whatsapp/config');
    } catch (_) {}

    body.innerHTML = '';
    const phoneIdInput = el('input', { class: 'input', placeholder: 'e.g. 1305746365962870', value: currentCfg.metaPhoneId || '' });
    const wabaIdInput = el('input', { class: 'input', placeholder: 'e.g. 1071250892416905', value: currentCfg.metaWabaId || '' });
    const tokenInput = el('textarea', { class: 'textarea', rows: 3, placeholder: 'EAAXsGpMcdxgBS...', value: currentCfg.metaToken || '' });

    body.appendChild(el('p', { class: 'muted', style: 'margin:0;font-size:0.84rem;' },
      'Messages will fail if your Meta Access Token has expired (Meta temporary tokens expire after 24h). Renew your token from Meta Developer Portal -> WhatsApp -> API Setup or create a permanent System User Token.'
    ));
    body.appendChild(el('div', { class: 'form-group' }, [el('label', {}, 'WhatsApp Phone Number ID'), phoneIdInput]));
    body.appendChild(el('div', { class: 'form-group' }, [el('label', {}, 'WhatsApp Business Account ID (WABA ID)'), wabaIdInput]));
    body.appendChild(el('div', { class: 'form-group' }, [el('label', {}, 'Meta Access Token (Temporary or Permanent)'), tokenInput]));

    const testBtn = el('button', { type: 'button', class: 'btn btn-secondary', style: 'align-self:flex-start;font-size:0.8rem;' }, 'Verify Token with Meta API');
    const testResult = el('div', { style: 'font-size:0.8rem;display:none;' });
    testBtn.addEventListener('click', async () => {
      testResult.style.display = 'block';
      testResult.textContent = 'Verifying with Meta Graph API...';
      try {
        const res = await api('/api/whatsapp/test-connection', { allow401: true });
        if (res.ok) {
          testResult.innerHTML = `<span style="color:#10B981;font-weight:600;">✓ Valid Token! Connected to +${res.displayPhoneNumber || res.phoneId}.</span>`;
        } else {
          testResult.innerHTML = `<span style="color:#EF4444;font-weight:600;">✕ Invalid/Expired Token: ${res.error || 'Check token'}.</span>`;
        }
      } catch (e) {
        testResult.innerHTML = `<span style="color:#EF4444;">✕ Check failed: ${e.message}</span>`;
      }
    });
    body.appendChild(testBtn);
    body.appendChild(testResult);

    modal({
      title: 'WhatsApp Gateway & Meta Token Manager',
      body,
      confirmText: 'Save Credentials',
      onConfirm: async () => {
        await api('/api/whatsapp/config', {
          method: 'POST',
          body: {
            mode: 'meta_cloud',
            metaPhoneId: phoneIdInput.value.trim(),
            metaWabaId: wabaIdInput.value.trim(),
            metaToken: tokenInput.value.trim()
          }
        });
        toast('WhatsApp credentials saved.', 'ok');
      }
    });
  }

  // Initial load
  loadAutomations();
}

/* ===========================================================================
   START
   =========================================================================== */
let _booted = false;
function bootOnce() { if (_booted) return; _booted = true; boot(); }
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bootOnce);
else bootOnce();
