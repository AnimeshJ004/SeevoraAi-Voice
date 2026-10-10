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
    else if (k === 'html') n.innerHTML = attrs[k];
    else if (k.slice(0, 2) === 'on' && typeof attrs[k] === 'function') n.addEventListener(k.slice(2).toLowerCase(), attrs[k]);
    else if (attrs[k] != null && attrs[k] !== false) n.setAttribute(k, attrs[k]);
  }
  if (kids != null) (Array.isArray(kids) ? kids : [kids]).forEach((c) => {
    if (c == null || c === false) return;
    n.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
  });
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
    try { window.__currentSpeechAudio.pause(); } catch (_) {}
    window.__currentSpeechAudio = null;
  }
  if ('speechSynthesis' in window) {
    try { window.speechSynthesis.cancel(); } catch (_) {}
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
async function boot() {
  try {
    const me = await api('/api/me', { allow401: true });
    State.me = me;
    renderShell();

    // Trigger AI Onboarding Wizard automatically for new clients on first sign-in
    const u = (me && me.user) || {};
    const t = (me && me.tenant) || {};
    const isPlatformAdmin = ['super_admin', 'admin'].includes(u.role);
    if (!isPlatformAdmin && !t.onboardingCompleted && !u.onboardingCompleted) {
      await ensureAgents().catch(() => {});
      if (!State.agents || State.agents.length === 0) {
        goto('onboarding');
      }
    }
  } catch (e) {
    if (e.status === 401) renderAuth();
    else { renderAuth(); }
  }
}

/* ===========================================================================
   AUTH GATE
   =========================================================================== */
function renderAuth() {
  window.location.replace('/');
}
function resetData() {
  State.agents = []; State.providers = null; State.usage = null; State.telephony = null;
  State.wallet = null; State.presets = []; State.tickets = [];
  State.demoLinks = [];
  State.agency = null; State.invoices = []; State.integrations = []; State.agencyPrompt = null;
  State.loaded = { agents: false, providers: false, usage: false, telephony: false, wallet: false, presets: false, tickets: false, demoLinks: false, agency: false, invoices: false, integrations: false, agencyPrompt: false };
  State.activeAgentId = null;
}

/* ===========================================================================
   CONSOLE SHELL & DUAL-PANEL NAVIGATION
   =========================================================================== */
function getVisibleRoutes() {
  const u = (State.me && State.me.user) || {};
  const isPlatformAdmin = ['super_admin', 'admin'].includes(u.role);

  if (!isPlatformAdmin) {
    return [
      { id: 'overview', label: 'Dashboard', icon: 'grid' },
      { id: 'inbound', label: 'Inbound Calls', icon: 'phone' },
      { id: 'campaigns', label: 'Outbound Calls', icon: 'send' },
      { id: 'recordings', label: 'Call Recordings & Transcripts', icon: 'record' },
      { id: 'agents', label: 'My AI Agent', icon: 'users' },
      { id: 'talk', label: 'Talk to Agent', icon: 'mic' },
      { id: 'billing', label: 'Billing & Wallet', icon: 'wallet' },
      { id: 'support', label: 'Support', icon: 'support' }
    ];
  }

  return [
    { id: 'overview', label: 'Agency Dashboard', icon: 'grid' },
    { id: 'inbound', label: 'Inbound Calls', icon: 'phone' },
    { id: 'campaigns', label: 'Outbound Calls', icon: 'send' },
    { id: 'recordings', label: 'All Call Recordings', icon: 'record' },
    { id: 'agents', label: 'AI Agents', icon: 'users' },
    { id: 'talk', label: 'Talk to Agent', icon: 'mic' },
    { id: 'admin', label: 'Clients', icon: 'shield' },
    { id: 'invoices', label: 'Invoices', icon: 'invoice' },
    { id: 'billing', label: 'Platform Billing', icon: 'wallet' },
    { id: 'settings', label: 'Settings', icon: 'gear' }
  ];
}

const ROUTES = [
  { id: 'overview', label: 'Dashboard', icon: 'grid' },
  { id: 'inbound', label: 'Inbound Calls', icon: 'phone' },
  { id: 'campaigns', label: 'Outbound Calls', icon: 'send' },
  { id: 'recordings', label: 'Call Recordings & Transcripts', icon: 'record' },
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
    logout: '<path d="M14 3.5H6.5A1.5 1.5 0 0 0 5 5v14a1.5 1.5 0 0 0 1.5 1.5H14"/><path d="M17 8l4 4-4 4"/><path d="M21 12H9"/>'
  };
  return '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' + (paths[name] || paths.grid) + '</svg>';
}

function uiIcon(name, size) {
  size = size || 16;
  const paths = {
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

  const side = el('aside', { class: 'side' }, [
    el('div', { class: 'side-brand' }, [
      el('span', { class: 'nm', style: 'font-weight:800;letter-spacing:1.5px;color:#FFFFFF;font-size:1.18rem;' }, 'SEEVORA.')
    ]),
    nav,
    el('div', { class: 'side-foot' }, [
      el('div', { class: 'tenant-chip' }, [
        el('div', { class: 'av' }, initials(t.name)),
        el('div', { class: 'meta' }, [
          el('div', { class: 'tn', title: t.name }, t.name),
          el('div', { class: 'tp' }, (t.plan ? t.plan.replace(/_/g, ' ') : 'studio') + ' plan')
        ])
      ]),
      el('button', { class: 'side-logout', onclick: doLogout, html: navIcon('logout') + '<span>Sign out</span>' })
    ])
  ]);

  const top = el('header', { class: 'top' }, [
    el('div', { class: 'flex items-center gap-2', style: 'min-width:0' }, [
      el('button', { class: 'menu-btn', 'aria-label': 'Menu', onclick: () => $('.shell').classList.toggle('nav-open'), html: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg>' }),
      el('div', { class: 'top-route' }, [
        el('span', { class: 'crumb' }, 'Seevora AI Voice Receptionist'),
        el('span', { class: 'ttl', id: 'routeTitle' }, 'Overview')
      ])
    ]),
    el('div', { class: 'health-row', id: 'healthRow' }, healthChips())
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
  loadHealth();
  onRoute();
}

async function exitImpersonation() {
  await api('/api/auth/impersonation/exit', { method: 'POST', body: {} });
  State.me = await api('/api/me');
  renderShell();
  toast('Returned to super admin.', 'ok');
}

async function doLogout() {
  try { await api('/api/auth/logout', { method: 'POST', allow401: true }); } catch (e) {}
  State.me = null; resetData();
  toast('Signed out.', 'info');
  renderAuth();
}

/* ---- health chips ---- */
function healthChips() {
  const layers = [
    { key: 'tts', label: 'TTS' },
    { key: 'llm', label: 'Brain' },
    { key: 'telephony', label: 'Telephony' }
  ];
  return layers.map((L) => {
    const chip = el('span', { class: 'hchip loading', 'data-layer': L.key }, [
      el('span', { class: 'dot' }),
      el('span', { class: 'lbl-txt' }, L.label)
    ]);
    return chip;
  });
}
async function loadHealth() {
  try {
    const h = await api('/api/health', { allow401: true });
    State.health = h;
    paintHealth();
  } catch (e) {
    $$('#healthRow .hchip').forEach((c) => { c.className = 'hchip bad'; });
  }
}
function paintHealth() {
  const h = State.health; if (!h) return;
  const map = {
    tts: h.providers && h.providers.tts ? Object.values(h.providers.tts).some(Boolean) : false,
    llm: h.providers && h.providers.llm ? Object.values(h.providers.llm).some(Boolean) : false,
    telephony: h.providers && h.providers.telephony ? Object.values(h.providers.telephony).some(Boolean) : false
  };
  $$('#healthRow .hchip').forEach((c) => {
    const layer = c.getAttribute('data-layer');
    c.classList.remove('loading');
    c.className = 'hchip ' + (map[layer] ? 'ok' : 'bad');
    c.setAttribute('data-layer', layer);
  });
}

/* ===========================================================================
   ROUTER
   =========================================================================== */
function currentRoute() {
  const hash = (location.hash || '').replace(/^#\/?/, '').split('?')[0];
  if (hash === 'ai-creator') return 'onboarding';
  const visible = getVisibleRoutes();
  const found = visible.find((r) => r.id === hash);
  if (found) return found.id;
  const allowed = ['overview', 'inbound', 'campaigns', 'recordings', 'agents', 'talk', 'onboarding', 'billing', 'support', 'admin', 'invoices', 'settings'];
  if (allowed.includes(hash)) return hash;
  return 'overview';
}
function onRoute() {
  if (!State.me) return;
  const id = currentRoute();
  $$('.nav a').forEach((a) => a.classList.toggle('active', a.getAttribute('data-route') === id));
  const visible = getVisibleRoutes();
  const r = visible.find((x) => x.id === id);
  const tt = $('#routeTitle'); if (tt) tt.textContent = r ? r.label : 'Dashboard';
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
  return el('div', { class: 'view-head' }, [el('div', { class: 'view-head-copy' }, [el('h2', {}, title), sub ? el('p', {}, sub) : null])]);
}


/* ---- Global Make Call Modal ---- */
async function openMakeCallModal(prefillNumber) {
  // 1. Ensure agents are fully loaded
  await ensureAgents().catch(() => {});
  let agents = (State.agents && State.agents.length) ? State.agents : [];
  if (!agents.length) {
    try {
      const res = await api('/api/agents');
      if (res && Array.isArray(res.agents) && res.agents.length) {
        agents = res.agents;
        State.agents = agents;
      }
    } catch (_) {}
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
  } catch (_) {}

  const wrap = el('div', { class: 'dash-ipsum-container' });
  root.appendChild(wrap);

  // 1. Top Header Row: Dashboard Title + Actions + Admin Profile
  const headRow = el('div', { class: 'dash-ipsum-head' }, [
    el('div', {}, [
      el('h1', { class: 'dash-ipsum-title' }, 'Dashboard')
    ]),
    el('div', { class: 'dash-ipsum-actions' }, [
      el('button', { class: 'btn btn-primary btn-sm', onclick: () => openMakeCallModal(), style: 'display:flex;align-items:center;gap:6px;' }, [
        uiIcon('phone', 14),
        el('span', {}, 'Make Outbound Call')
      ]),
      el('button', { class: 'btn btn-ghost btn-sm', onclick: () => openAddClientModal() }, '+ Add Clinic Workspace'),
      el('div', { class: 'dash-profile-chip' }, 'Admin Profile')
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
        el('div', { class: 'ipsum-bars-container', html: renderIpsumBarSvg(minutesBars, '#0095FF') +
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
        el('div', { class: 'ipsum-bars-container', html: renderIpsumBarSvg(revenueBars, '#22C55E') +
          '<div class="ipsum-x-axis">' + monthLabels.map(m => '<span>' + m + '</span>').join('') + '</div>'
        })
      ])
    ])
  ]);
  wrap.appendChild(chartsRow);

  // 3. Middle Section: SYSTEM LOGS (2x2 Grid)
  const logsCard = el('div', { class: 'ipsum-logs-card' }, [
    el('div', { class: 'ipsum-section-head' }, [
      el('span', { class: 'ipsum-section-title' }, 'SYSTEM LOGS'),
      el('button', { class: 'ipsum-link-more', onclick: () => goto('recordings') }, 'View More')
    ]),
    el('div', { class: 'ipsum-logs-grid' }, [
      // Log 1
      el('div', { class: 'ipsum-log-item' }, [
        el('span', { class: 'ipsum-log-icon amber' }, '✕'),
        el('div', { class: 'ipsum-log-content' }, [
          el('div', { class: 'ipsum-log-line' }, [
            el('span', {}, 'Call failed - no answer'),
            el('span', { class: 'ipsum-log-badge amber' }, 'Failed call')
          ]),
          el('div', { class: 'ipsum-log-meta' }, 'BrightCare Dental • 09:41 AM • +1 (905) 667-8887')
        ])
      ]),
      // Log 2
      el('div', { class: 'ipsum-log-item' }, [
        el('span', { class: 'ipsum-log-icon amber' }, '✕'),
        el('div', { class: 'ipsum-log-content' }, [
          el('div', { class: 'ipsum-log-line' }, [
            el('span', {}, 'Call failed - no answer'),
            el('span', { class: 'ipsum-log-badge amber' }, 'Failed call')
          ]),
          el('div', { class: 'ipsum-log-meta' }, 'Prime Smile Clinic • 09:41 AM • +1 (310) 555-7866')
        ])
      ]),
      // Log 3
      el('div', { class: 'ipsum-log-item' }, [
        el('span', { class: 'ipsum-log-icon rose' }, '!'),
        el('div', { class: 'ipsum-log-content' }, [
          el('div', { class: 'ipsum-log-line' }, [
            el('span', {}, 'API timeout on/calls endpoint'),
            el('span', { class: 'ipsum-log-badge rose' }, 'API error')
          ]),
          el('div', { class: 'ipsum-log-meta' }, 'Apex Dental Clinic • 09:41 AM • Retry 3/3 exhausted')
        ])
      ]),
      // Log 4
      el('div', { class: 'ipsum-log-item' }, [
        el('span', { class: 'ipsum-log-icon sky' }, '⏱'),
        el('div', { class: 'ipsum-log-content' }, [
          el('div', { class: 'ipsum-log-line' }, [
            el('span', {}, 'API timeout on/calls endpoint'),
            el('span', { class: 'ipsum-log-badge sky' }, 'Webhook')
          ]),
          el('div', { class: 'ipsum-log-meta' }, 'Evergreen Dental • 09:30 AM • http://hook.company.io/calls')
        ])
      ])
    ])
  ]);
  wrap.appendChild(logsCard);

  // 4. Bottom Section: Dual Side-by-Side Tables (CLINICS + PHONE NUMBERS)
  const clinicsRows = [
    { email: 'BrightCare Dental', phone: '+1 905 667 888 776', status: 'Active', class: 'active' },
    { email: 'Prime Smile Clinic', phone: '+1 905 667 888 776', status: 'Incomplete', class: 'incomplete' },
    { email: 'Evergreen Dental', phone: '+1 905 667 888 776', status: 'Active', class: 'active' },
    { email: 'Evergreen Dental', phone: '+1 905 667 888 776', status: 'Incomplete', class: 'incomplete' },
    { email: 'Summit Smiles', phone: '+1 905 667 888 776', status: 'Active', class: 'active' },
    { email: 'Integrity Dental Care', phone: '+1 905 667 888 776', status: 'Suspended', class: 'suspended' },
    { email: 'Integrity Dental Care', phone: '+1 905 667 888 776', status: 'Suspended', class: 'suspended' }
  ];

  const phoneNumbersRows = [
    { clinic: 'BrightCare Dental', type: 'Purchased', status: 'Active ˇ', class: 'active' },
    { clinic: 'Prime Smile Clinic', type: 'Delayed', status: 'Failed ˇ', class: 'failed' },
    { clinic: 'Evergreen Dental', type: 'Purchased', status: 'In Progress ˇ', class: 'inprogress' },
    { clinic: 'Integrity Dental Care', type: 'Ported', status: 'Active ˇ', class: 'active' },
    { clinic: 'Pearl Dental Center', type: 'Ported', status: 'Active ˇ', class: 'active' },
    { clinic: 'Prime Smile Clinic', type: 'Purchased', status: 'Active ˇ', class: 'active' },
    { clinic: 'Integrity Dental Care', type: 'Delayed', status: 'Failed ˇ', class: 'failed' }
  ];

  const dualTables = el('div', { class: 'ipsum-tables-row' }, [
    // Left Table: CLINICS
    el('div', { class: 'ipsum-table-card' }, [
      el('div', { class: 'ipsum-section-head' }, [
        el('span', { class: 'ipsum-section-title' }, 'CLINICS'),
        el('button', { class: 'ipsum-link-more', onclick: () => goto('admin') }, 'View More')
      ]),
      el('table', { class: 'ipsum-table' }, [
        el('thead', {}, [
          el('tr', { class: 'ipsum-th-bar' }, [
            el('th', {}, 'Email'),
            el('th', {}, 'Emergency number'),
            el('th', {}, 'Status'),
            el('th', { style: 'text-align:right' }, 'Actions')
          ])
        ]),
        el('tbody', {}, clinicsRows.map(r =>
          el('tr', {}, [
            el('td', { style: 'font-weight:600' }, r.email),
            el('td', { style: 'color:#64748B' }, r.phone),
            el('td', {}, [
              el('span', { class: 'ipsum-pill ' + r.class }, r.status)
            ]),
            el('td', { style: 'text-align:right' }, [
              el('button', { class: 'ipsum-btn-view', onclick: () => openMakeCallModal() }, 'View')
            ])
          ])
        ))
      ])
    ]),

    // Right Table: PHONE NUMBERS
    el('div', { class: 'ipsum-table-card' }, [
      el('div', { class: 'ipsum-section-head' }, [
        el('span', { class: 'ipsum-section-title' }, 'PHONE NUMBERS'),
        el('button', { class: 'ipsum-link-more', onclick: () => goto('inbound') }, 'View More')
      ]),
      el('table', { class: 'ipsum-table' }, [
        el('thead', {}, [
          el('tr', { class: 'ipsum-th-bar' }, [
            el('th', {}, 'Clinic name'),
            el('th', {}, 'Type'),
            el('th', { style: 'text-align:right' }, 'Status')
          ])
        ]),
        el('tbody', {}, phoneNumbersRows.map(r =>
          el('tr', {}, [
            el('td', { style: 'font-weight:600' }, r.clinic),
            el('td', { style: 'color:#64748B' }, r.type),
            el('td', { style: 'text-align:right' }, [
              el('span', { class: 'ipsum-pill ' + r.class }, r.status)
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
    host.appendChild(el('div', { class: 'empty compact' }, [el('div', { class: 'ttl' }, 'No client activity yet'), el('p', {}, 'Approaches and lifecycle changes will appear here.') ]));
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
  await ensureAgents().catch(() => {});

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

  // 1. Top Header Row: Dashboard Title + Actions + Client Profile
  const headRow = el('div', { class: 'dash-ipsum-head' }, [
    el('div', {}, [
      el('h1', { class: 'dash-ipsum-title' }, 'Dashboard')
    ]),
    el('div', { class: 'dash-ipsum-actions' }, [
      el('button', { class: 'btn btn-primary btn-sm', onclick: () => openMakeCallModal(), style: 'display:flex;align-items:center;gap:6px;' }, [
        uiIcon('phone', 14),
        el('span', {}, 'Make Outbound Call')
      ]),
      el('button', { class: 'btn btn-ghost btn-sm', onclick: () => openVoiceSimulator(activeAgent) }, 'Test in Browser'),
      el('div', { class: 'dash-profile-chip' }, 'Client Profile')
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
        el('div', { class: 'ipsum-bars-container', html: renderIpsumBarSvg(minutesBars, '#0095FF') +
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
        el('div', { class: 'ipsum-bars-container', html: renderIpsumBarSvg(bookingsBars, '#22C55E') +
          '<div class="ipsum-x-axis">' + monthLabels.map(m => '<span>' + m + '</span>').join('') + '</div>'
        })
      ])
    ])
  ]);
  wrap.appendChild(chartsRow);

  // 3. Middle Section: SYSTEM LOGS (2x2 Grid)
  const logsCard = el('div', { class: 'ipsum-logs-card' }, [
    el('div', { class: 'ipsum-section-head' }, [
      el('span', { class: 'ipsum-section-title' }, 'SYSTEM LOGS'),
      el('button', { class: 'ipsum-link-more', onclick: () => goto('recordings') }, 'View More')
    ]),
    el('div', { class: 'ipsum-logs-grid' }, [
      el('div', { class: 'ipsum-log-item' }, [
        el('span', { class: 'ipsum-log-icon amber' }, '✕'),
        el('div', { class: 'ipsum-log-content' }, [
          el('div', { class: 'ipsum-log-line' }, [
            el('span', {}, 'Call failed - no answer'),
            el('span', { class: 'ipsum-log-badge amber' }, 'Failed call')
          ]),
          el('div', { class: 'ipsum-log-meta' }, 'Front-Desk Receptionist • 09:41 AM • +1 (905) 667-8887')
        ])
      ]),
      el('div', { class: 'ipsum-log-item' }, [
        el('span', { class: 'ipsum-log-icon amber' }, '✕'),
        el('div', { class: 'ipsum-log-content' }, [
          el('div', { class: 'ipsum-log-line' }, [
            el('span', {}, 'Call failed - no answer'),
            el('span', { class: 'ipsum-log-badge amber' }, 'Failed call')
          ]),
          el('div', { class: 'ipsum-log-meta' }, 'Direct Line • 09:41 AM • +1 (310) 555-7866')
        ])
      ]),
      el('div', { class: 'ipsum-log-item' }, [
        el('span', { class: 'ipsum-log-icon rose' }, '!'),
        el('div', { class: 'ipsum-log-content' }, [
          el('div', { class: 'ipsum-log-line' }, [
            el('span', {}, 'API timeout on/calls endpoint'),
            el('span', { class: 'ipsum-log-badge rose' }, 'API error')
          ]),
          el('div', { class: 'ipsum-log-meta' }, 'Calendar Sync • 09:41 AM • Retry 3/3 exhausted')
        ])
      ]),
      el('div', { class: 'ipsum-log-item' }, [
        el('span', { class: 'ipsum-log-icon sky' }, '⏱'),
        el('div', { class: 'ipsum-log-content' }, [
          el('div', { class: 'ipsum-log-line' }, [
            el('span', {}, 'API timeout on/calls endpoint'),
            el('span', { class: 'ipsum-log-badge sky' }, 'Webhook')
          ]),
          el('div', { class: 'ipsum-log-meta' }, 'Live Receptionist • 09:30 AM • http://hook.company.io/calls')
        ])
      ])
    ])
  ]);
  wrap.appendChild(logsCard);

  // 4. Bottom Section: Dual Side-by-Side Tables (CLINICS + PHONE NUMBERS)
  const clientAppointments = [
    { email: 'BrightCare Dental', phone: '+1 905 667 888 776', status: 'Active', class: 'active' },
    { email: 'Prime Smile Clinic', phone: '+1 905 667 888 776', status: 'Incomplete', class: 'incomplete' },
    { email: 'Evergreen Dental', phone: '+1 905 667 888 776', status: 'Active', class: 'active' },
    { email: 'Evergreen Dental', phone: '+1 905 667 888 776', status: 'Incomplete', class: 'incomplete' },
    { email: 'Summit Smiles', phone: '+1 905 667 888 776', status: 'Active', class: 'active' },
    { email: 'Integrity Dental Care', phone: '+1 905 667 888 776', status: 'Suspended', class: 'suspended' },
    { email: 'Integrity Dental Care', phone: '+1 905 667 888 776', status: 'Suspended', class: 'suspended' }
  ];

  const clientPhoneLines = [
    { clinic: 'BrightCare Dental', type: 'Purchased', status: 'Active ˇ', class: 'active' },
    { clinic: 'Prime Smile Clinic', type: 'Delayed', status: 'Failed ˇ', class: 'failed' },
    { clinic: 'Evergreen Dental', type: 'Purchased', status: 'In Progress ˇ', class: 'inprogress' },
    { clinic: 'Integrity Dental Care', type: 'Ported', status: 'Active ˇ', class: 'active' },
    { clinic: 'Pearl Dental Center', type: 'Ported', status: 'Active ˇ', class: 'active' },
    { clinic: 'Prime Smile Clinic', type: 'Purchased', status: 'Active ˇ', class: 'active' },
    { clinic: 'Integrity Dental Care', type: 'Delayed', status: 'Failed ˇ', class: 'failed' }
  ];

  const dualTables = el('div', { class: 'ipsum-tables-row' }, [
    // Left Table: CLINICS
    el('div', { class: 'ipsum-table-card' }, [
      el('div', { class: 'ipsum-section-head' }, [
        el('span', { class: 'ipsum-section-title' }, 'CLINICS'),
        el('button', { class: 'ipsum-link-more', onclick: () => goto('recordings') }, 'View More')
      ]),
      el('table', { class: 'ipsum-table' }, [
        el('thead', {}, [
          el('tr', { class: 'ipsum-th-bar' }, [
            el('th', {}, 'Email'),
            el('th', {}, 'Emergency number'),
            el('th', {}, 'Status'),
            el('th', { style: 'text-align:right' }, 'Actions')
          ])
        ]),
        el('tbody', {}, clientAppointments.map(r =>
          el('tr', {}, [
            el('td', { style: 'font-weight:600' }, r.email),
            el('td', { style: 'color:#64748B' }, r.phone),
            el('td', {}, [
              el('span', { class: 'ipsum-pill ' + r.class }, r.status)
            ]),
            el('td', { style: 'text-align:right' }, [
              el('button', { class: 'ipsum-btn-view', onclick: () => openMakeCallModal() }, 'View')
            ])
          ])
        ))
      ])
    ]),

    // Right Table: PHONE NUMBERS
    el('div', { class: 'ipsum-table-card' }, [
      el('div', { class: 'ipsum-section-head' }, [
        el('span', { class: 'ipsum-section-title' }, 'PHONE NUMBERS'),
        el('button', { class: 'ipsum-link-more', onclick: () => goto('inbound') }, 'View More')
      ]),
      el('table', { class: 'ipsum-table' }, [
        el('thead', {}, [
          el('tr', { class: 'ipsum-th-bar' }, [
            el('th', {}, 'Clinic name'),
            el('th', {}, 'Type'),
            el('th', { style: 'text-align:right' }, 'Status')
          ])
        ]),
        el('tbody', {}, clientPhoneLines.map(r =>
          el('tr', {}, [
            el('td', { style: 'font-weight:600' }, r.clinic),
            el('td', { style: 'color:#64748B' }, r.type),
            el('td', { style: 'text-align:right' }, [
              el('span', { class: 'ipsum-pill ' + r.class }, r.status)
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
    el('button', { type: 'button', class: tn === state.tone ? 'on' : '', 'data-t': tn, onclick: () => {
      state.tone = tn;
      $$('#f_tone_seg button').forEach((b) => b.classList.toggle('on', b.getAttribute('data-t') === tn));
    } }, tn)
  ));
  const speakerSel = el('select', { class: 'select', id: 'f_speaker' }, SPEAKERS.map((s) =>
    el('option', { value: s, selected: s === state.speaker ? 'selected' : false }, s)
  ));
  const f0Val = el('span', { class: 'rv', id: 'f_f0_val' }, String(state.f0));
  const f0Range = el('input', { type: 'range', id: 'f_f0', min: -12, max: 12, step: 1, value: state.f0, oninput: (ev) => { state.f0 = +ev.target.value; f0Val.textContent = (state.f0 > 0 ? '+' : '') + state.f0; } });
  if (state.f0 > 0) f0Val.textContent = '+' + state.f0;

  const didSel = el('select', { class: 'select', id: 'f_did' }, [el('option', { value: '' }, 'No number assigned')]);
  if (e.telephony && e.telephony.did) { /* set after dids load */ setTimeout(() => { try { didSel.value = e.telephony.did; } catch (x) {} }, 0); }

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
    onStart: () => {},
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
    onConfirm: () => {},
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
    badge: 'Step 1 of 7 • Business Identity',
    title: 'What is your business or company name?',
    sub: 'Your AI agent will introduce itself as the voice representative for this business.',
    type: 'text',
    key: 'businessName',
    placeholder: 'e.g. Indiranagar Dental Care, Skyline Realty, Apex HVAC...',
    default: 'Indiranagar Dental Care'
  },
  {
    num: 2,
    badge: 'Step 2 of 7 • Industry Sector',
    title: 'What industry does your company operate in?',
    sub: 'Select the primary sector to tailor conversation vocabulary and customer behavior.',
    type: 'pills',
    key: 'industry',
    options: ['Healthcare & Clinic', 'Real Estate & Property', 'Home Services & HVAC', 'E-Commerce & Retail', 'Legal & Financial', 'Automotive', 'Hospitality', 'Other'],
    default: 'Healthcare & Clinic'
  },
  {
    num: 3,
    badge: 'Step 3 of 7 • Company Services & Offerings',
    title: 'What does your company do and what are your main offerings?',
    sub: 'Explain what your business does and typical pricing so the agent can quote and assist callers accurately.',
    type: 'textarea',
    key: 'offerings',
    placeholder: 'e.g. Dental consultations: ₹600. Routine teeth cleaning: ₹1,500. Root canal treatment: ₹4,500. Emergency toothache visits accommodated same-day.',
    default: 'Dental consultations: ₹600. Routine teeth cleaning & scaling: ₹1,500. Root canal treatment: ₹4,500. Dental implants from ₹25,000. Emergency toothache visits accommodated same-day.'
  },
  {
    num: 4,
    badge: 'Step 4 of 7 • Primary AI Receptionist Goal',
    title: 'What is the primary objective of this voice agent?',
    sub: 'What is the most important outcome the agent should drive on each call?',
    type: 'pills',
    key: 'goal',
    options: ['Book Appointments & Consultations', 'Qualify Inbound Leads', 'Answer Service FAQs & Inquiries', 'Emergency Triage & Routing'],
    default: 'Book Appointments & Consultations'
  },
  {
    num: 5,
    badge: 'Step 5 of 7 • Spoken Language & Accent',
    title: 'Which language style should your agent speak?',
    sub: 'Select the conversational dialect matching your caller demographic.',
    type: 'pills',
    key: 'language',
    options: ['English (Indian Accent)', 'Natural Hinglish (Hindi + English)', 'Neutral English', 'Hindi'],
    default: 'English (Indian Accent)'
  },
  {
    num: 6,
    badge: 'Step 6 of 7 • Voice Tone & Persona',
    title: 'What personality and tone should the agent possess?',
    sub: 'The agent will adapt its pacing, greeting, and emotional demeanor accordingly.',
    type: 'pills',
    key: 'tone',
    options: ['Friendly & Welcoming', 'Warm & Empathetic', 'Professional & Executive', 'Direct & Assertive'],
    default: 'Friendly & Welcoming'
  },
  {
    num: 7,
    badge: 'Step 7 of 7 • Business Hours & Escalation',
    title: 'What are your operating hours and emergency contact?',
    sub: 'The agent will inform callers of your availability and knows when to escalate.',
    type: 'text',
    key: 'workingHours',
    placeholder: 'e.g. Mon-Sat 9 AM to 8:30 PM, Emergency Contact: +91 98765 43210',
    default: 'Mon-Sat 9 AM to 8:30 PM, Emergency Contact: +91 98765 43210'
  }
];

async function viewOnboarding(root) {
  const head = viewHead('AI Voice Agent Onboarding', 'Answer 7 quick questions about your company. The AI designs your conversational persona, understands customer objections, generates 3 script variants, and lets you test your agent instantly.');
  const skipBtn = el('button', {
    type: 'button',
    class: 'btn btn-ghost btn-sm',
    style: 'margin-left:auto;font-weight:600',
    onclick: async () => {
      await api('/api/tenant/onboarding-complete', { method: 'POST' }).catch(() => {});
      if (State.me && State.me.tenant) State.me.tenant.onboardingCompleted = true;
      goto('overview');
    }
  }, 'Skip Setup & Go to Dashboard →');
  head.appendChild(skipBtn);
  root.appendChild(head);

  // Active form state prefilled with dental preset default
  const answers = {};
  ONBOARD_STEPS.forEach((st) => {
    answers[st.key] = Array.isArray(st.default) ? [...st.default] : st.default;
  });
  let activeStep = 0;
  let customTranscript = ONBOARD_PRESETS[0].transcript || '';
  let generatedResult = null;
  let activeVariant = 'friendly';

  // Preset selector chips
  const presetsRow = el('div', { class: 'preset-chips-scroll', style: 'margin-bottom:18px' });
  ONBOARD_PRESETS.forEach((preset, idx) => {
    const chip = el('button', {
      type: 'button',
      class: 'preset-chip' + (idx === 0 ? ' active' : ''),
      onclick: () => {
        $$('.preset-chip', presetsRow).forEach((c) => c.classList.remove('active'));
        chip.classList.add('active');
        applyPreset(preset);
      }
    }, preset.label);
    presetsRow.appendChild(chip);
  });
  root.appendChild(presetsRow);

  const container = el('div', { class: 'onboard-wizard' });
  root.appendChild(container);

  function applyPreset(p) {
    answers.businessName = p.businessName;
    answers.industry = p.industry;
    answers.offerings = p.offerings;
    answers.goal = p.goal;
    answers.language = p.language;
    answers.tone = p.tone;
    answers.workingHours = p.workingHours;
    customTranscript = p.transcript || '';
    renderCurrentStep();
    toast(`Loaded ${p.label} business template.`, 'ok');
  }

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
        const curArr = answers[step.key] || [];
        const isSel = curArr.includes(opt);
        const btn = el('button', {
          type: 'button',
          class: 'onboard-pill-btn' + (isSel ? ' selected' : ''),
          onclick: () => {
            const arr = answers[step.key] || [];
            if (arr.includes(opt)) {
              answers[step.key] = arr.filter((x) => x !== opt);
              btn.classList.remove('selected');
            } else {
              arr.push(opt);
              answers[step.key] = arr;
              btn.classList.add('selected');
            }
          }
        }, opt);
        group.appendChild(btn);
      });
      inputControl = group;
    }

    if (inputControl) card.appendChild(inputControl);

    // Call Recording / Transcript reverse engineering drawer on step 3 or 7
    if (activeStep === 2 || activeStep === 6) {
      const transcriptDrawer = el('details', { style: 'margin-top:20px;border:1px solid var(--line);border-radius:var(--r-sm);padding:10px 14px;background:var(--bg-2)' }, [
        el('summary', { style: 'cursor:pointer;font-weight:600;font-size:.84rem;color:var(--accent)' }, 'Paste Past Call Recording Transcript (Optional)'),
        el('p', { class: 'soft', style: 'font-size:.76rem;margin:6px 0 10px 0' }, 'The AI will reverse-engineer caller questions, friction points, and real customer vocabulary.'),
        (function () {
          const tArea = el('textarea', { class: 'textarea', rows: 4, placeholder: 'Caller: Hi, how much for a consultation?\nAgent: Consultations are ₹600...' }, customTranscript);
          tArea.addEventListener('input', () => { customTranscript = tArea.value; });
          return tArea;
        })()
      ]);
      card.appendChild(transcriptDrawer);
    }

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
    }, isLast ? 'Generate Voice Agent' : 'Next Step →');

    const navRow = el('div', { class: 'onboard-nav-row' }, [
      prevBtn,
      el('span', { class: 'soft', style: 'font-size:.82rem' }, `${activeStep + 1} of ${ONBOARD_STEPS.length}`),
      nextBtn
    ]);
    card.appendChild(navRow);

    container.appendChild(progressTrack);
    container.appendChild(card);
  }

  function goNext() {
    if (activeStep < ONBOARD_STEPS.length - 1) {
      activeStep++;
      renderCurrentStep();
    } else {
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

    const compiledNeeds = `
- Company Services & What We Do: ${answers.offerings || 'N/A'}
- Primary Receptionist Goal: ${answers.goal || 'Book Appointments & Consultations'}
- Business Hours & Emergency Contact: ${answers.workingHours || 'N/A'}
    `.trim();

    const payload = {
      businessName: answers.businessName,
      industry: answers.industry,
      objective: answers.goal,
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
    const celebrationHeader = el('div', { class: 'onboard-step-card', style: 'text-align:center;padding:32px 20px;border-color:rgba(0,149,255,0.4);background:radial-gradient(ellipse at top, rgba(0,149,255,0.06), #FFFFFF)' }, [
      el('div', { style: 'width:56px;height:56px;border-radius:50%;background:#EFF6FF;color:#0284C7;display:inline-flex;align-items:center;justify-content:center;margin:0 auto 12px', html: '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>' }),
      el('h2', { class: 't-h2', style: 'color:var(--ink);margin-bottom:6px' }, `Your Voice Agent is Ready!`),
      el('p', { class: 'soft', style: 'max-width:540px;margin:0 auto;line-height:1.5' }, `Designed specifically for ${answers.businessName}. Script variants generated, customer objections understood, and voice persona calibrated.`)
    ]);
    container.appendChild(celebrationHeader);

    // Projected ROI & Impact Cards
    const roiGrid = el('div', { class: 'roi-grid' }, [
      el('div', { class: 'roi-card' }, [
        el('div', { class: 'roi-val' }, '78%'),
        el('div', { class: 'roi-lbl' }, 'Staff Cost Reduction'),
        el('div', { class: 'roi-sub' }, 'vs full-time human receptionist')
      ]),
      el('div', { class: 'roi-card' }, [
        el('div', { class: 'roi-val' }, '100%'),
        el('div', { class: 'roi-lbl' }, '24/7 Answer Rate'),
        el('div', { class: 'roi-sub' }, 'Zero missed customer calls')
      ]),
      el('div', { class: 'roi-card' }, [
        el('div', { class: 'roi-val' }, 'Zero Wait'),
        el('div', { class: 'roi-lbl' }, 'Instant Response'),
        el('div', { class: 'roi-sub' }, 'Natural turn-taking conversation')
      ])
    ]);
    container.appendChild(roiGrid);

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
          await api('/api/tenant/onboarding-complete', { method: 'POST' }).catch(() => {});
          if (State.me && State.me.tenant) State.me.tenant.onboardingCompleted = true;
          if (res.agent) {
            State.agents.push(res.agent);
            State.activeAgentId = res.agent.id;
          }
          toast(`Agent "${payload.name}" saved to your workspace!`, 'ok');
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
    audioEl.play().catch(() => {});
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
    const fail = (m) => { try { ws.close(); } catch (e) {} reject(new ApiError(0, m)); };
    const timeout = setTimeout(() => fail('Stream timed out.'), 20000);
    ws.onopen = () => { try { ws.send(JSON.stringify({ text: text, model: st.model })); } catch (e) {} };
    ws.onmessage = (ev) => {
      if (typeof ev.data === 'string') {
        try { const m = JSON.parse(ev.data); if (m.type === 'end' || m.done) { clearTimeout(timeout); finish(); } } catch (e) {}
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
        try { drawWaveform(all, canvas); } catch (e) {}
      }
      try { ws.close(); } catch (e) {}
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
    try { sessionStorage.setItem('rxv_demo_' + id, url); } catch (_) {}
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
        const result = await api('/api/demo-links', { method: 'POST', body: {
          agentId: agent.value, label: label.value.trim(), expiresInDays: Number(expiry.value),
          maxSessionSeconds: Number(duration.value), maxStarts: Number(starts.value)
        } });
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
    listHost.appendChild(el('div', { class: 'empty' }, [el('div', { class: 'ttl' }, 'No demo links yet'), el('p', {}, 'Create one to share a branded web voice experience.') ]));
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
          status === 'active' ? el('button', { class: 'btn btn-danger-soft', onclick: () => modal({
            title: 'Revoke this demo link?',
            body: el('p', { class: 'muted' }, 'Visitors will no longer be able to start a voice session with this URL.'),
            confirmText: 'Revoke link', confirmKind: 'danger',
            onConfirm: async () => { await api('/api/demo-links/revoke', { method: 'POST', body: { id: item.id } }); try { sessionStorage.removeItem('rxv_demo_' + item.id); } catch (_) {} toast('Demo link revoked.', 'ok'); redraw(); }
          }) }, 'Revoke') : null
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
  await ensureAgents().catch(() => {});

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
          try { speechRec.start(); } catch (_) {}
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
      try { speechRec.stop(); } catch (_) {}
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
              } catch (_) {}
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
  const phoneLineCard = el('div', { class: 'card card-pad', style: 'margin-bottom:18px;background:linear-gradient(135deg, rgba(0,149,255,0.06), rgba(255,255,255,1));border:1px solid rgba(0,149,255,0.2)' }, [
    el('div', { class: 'flex items-center justify-between', style: 'flex-wrap:wrap;gap:14px' }, [
      el('div', { class: 'flex items-center gap-3' }, [
        el('div', { style: 'width:44px;height:44px;border-radius:12px;background:#0095FF;color:#FFF;display:flex;align-items:center;justify-content:center', html: uiIcon('phone', 22) }),
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
              } catch (_) {}
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
let campaignState = {
  leads: (function() {
    try { return JSON.parse(localStorage.getItem('seevora_campaign_leads') || '[]'); }
    catch(_) { return []; }
  })(),
  running: false,
  abort: false,
  currentIndex: -1,
  countdown: 0,
  delaySeconds: 45,
  isDryRun: false
};

function saveCampaignLeads() {
  try { localStorage.setItem('seevora_campaign_leads', JSON.stringify(campaignState.leads)); } catch(_) {}
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
      { id: 'ld_1', name: 'Bhavu (Owner Test)', phone: '+91 8120590466', rawNumber: '8120590466', status: 'pending', error: null, timestamp: null },
      { id: 'ld_2', name: 'Dr. Sharma (Clinic Lead)', phone: '+91 9876543210', rawNumber: '9876543210', status: 'pending', error: null, timestamp: null },
      { id: 'ld_3', name: 'Ananya Verma (Inquiry)', phone: '+91 8765432109', rawNumber: '8765432109', status: 'pending', error: null, timestamp: null }
    ];
    campaignState.leads = campaignState.leads.concat(samples);
    saveCampaignLeads();
    renderAll();
    toast('Added 3 sample leads for testing.', 'ok');
  });

  uploadContainer.appendChild(dropzone);
  uploadContainer.appendChild(sampleBtn);

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
    (function() {
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
  [['Outstanding', sums.outstanding, 'Issued and unpaid'], ['Overdue', sums.overdue, 'Past the due date'], ['Paid', sums.paid, 'Recorded as collected'], ['Total issued', sums.issued, 'Excludes drafts and voids']].forEach((item, index) => summary.appendChild(el('article', { class: 'agency-metric' + (index === 1 ? ' critical' : index === 2 ? ' positive' : '') }, [el('div', { class: 'agency-metric-label' }, item[0]), el('div', { class: 'agency-metric-value' }, '₹' + fmtInr(item[1] / 100)), el('div', { class: 'agency-metric-note' }, item[2])] )));
  host.innerHTML = '';
  const controls = el('div', { class: 'invoice-table-head' }, [
    el('div', {}, [el('span', { class: 'section-kicker' }, 'Agency finance'), el('h3', {}, 'Invoice register')]),
    el('div', { class: 'invoice-filters' }, ['all','draft','issued','overdue','paid','void'].map((status) => el('button', { class: 'invoice-filter' + (status === 'all' ? ' active' : ''), 'data-filter': status, onclick: (event) => {
      $$('.invoice-filter', host).forEach((button) => button.classList.toggle('active', button === event.currentTarget));
      renderInvoiceRows(host.querySelector('tbody'), rows, status);
    } }, invoiceStatusLabel(status))))
  ]);
  const table = el('table', { class: 'data-table invoice-table' }, [
    el('thead', {}, el('tr', {}, ['Invoice','Client','Issued','Due','Status','Amount',''].map((label) => el('th', {}, label)))),
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
    try { tenants = (await api('/api/admin/tenants')).tenants || []; } catch (_) {}
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
    confirmText: 'Close', onConfirm: async () => {}
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

async function viewBilling(root) {
  root.appendChild(viewHead('Billing', 'Prepaid INR wallet, immutable transaction history, and secure PayU checkout.'));
  const host = el('div', { class: 'grid grid-12' }, [
    el('section', { class: 'card card-pad', id: 'walletSummary' }, skeleton('sk-card', 1)),
    el('section', { class: 'card card-pad', id: 'walletLedger' }, skeleton('sk-card', 1))
  ]);
  root.appendChild(host);
  try {
    const out = await api('/api/wallet');
    const wallet = out.wallet || {}; const rows = out.ledger || [];
    const sum = $('#walletSummary'); sum.innerHTML = '';
    sum.appendChild(el('div', { class: 'muted' }, 'Available credit'));
    sum.appendChild(el('div', { class: 'wallet-big' }, ['₹' + fmtInr(wallet.balanceInr != null ? wallet.balanceInr : (wallet.balancePaise || 0) / 100), el('small', {}, ' INR') ]));
    sum.appendChild(el('p', { class: 'muted' }, 'New accounts receive a one-time ₹10 trial credit. Voice and carrier usage are deducted separately according to the live rate card.'));
    const packs = [{ id: 'starter', inr: 200 }, { id: 'growth', inr: 500 }, { id: 'scale', inr: 1000 }];
    sum.appendChild(el('div', { class: 'pack-row' }, packs.map((pack) => el('button', { class: 'btn btn-ghost', onclick: () => startRecharge(pack.id) }, 'Add ₹' + fmtInr(pack.inr)))));
    const ledger = $('#walletLedger'); ledger.innerHTML = '';
    ledger.appendChild(el('h3', { class: 't-h3', style: 'margin-bottom:14px' }, 'Transaction history'));
    rows.slice(0, 20).forEach((x) => ledger.appendChild(el('div', { class: 'ledger-row' }, [
      el('div', {}, [el('div', {}, x.description || String(x.type || '').replace(/_/g, ' ')), el('small', { class: 'muted' }, x.createdAt || '')]),
      el('b', { class: Number(x.amountPaise) >= 0 ? 'money-plus' : 'money-minus' }, (Number(x.amountPaise) >= 0 ? '+' : '') + '₹' + fmtInr(Number(x.amountPaise || 0) / 100))
    ])));
    if (!rows.length) ledger.appendChild(el('div', { class: 'muted' }, 'No wallet activity yet.'));
  } catch (e) { host.innerHTML = ''; host.appendChild(el('div', { class: 'card card-pad muted' }, e.message)); }
}

async function startRecharge(packId) {
  try {
    const out = await api('/api/payment-intents', { method: 'POST', body: { packId: packId } });
    const checkoutUrl = out.checkout && (out.checkout.action || out.checkout.url);
    if (checkoutUrl && out.checkout.fields) {
      const form = el('form', { method: 'POST', action: checkoutUrl });
      Object.keys(out.checkout.fields).forEach((k) => form.appendChild(el('input', { type: 'hidden', name: k, value: out.checkout.fields[k] })));
      document.body.appendChild(form); form.submit(); return;
    }
    toast(out.message || 'PayU checkout is not enabled yet. Your wallet was not charged.', 'info');
  } catch (e) { toast(e.message, 'err'); }
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
    (function () { const s = el('select', { class: 'select' }, ['open','in_progress','waiting_on_customer','resolved','closed'].map((v) => el('option', { value: v }, v.replace(/_/g, ' ')))); s.value = t.status || 'open'; s.setAttribute('data-ticket-status', t.id); return s; })(),
    (function () { const s = el('select', { class: 'select' }, ['low','normal','high','urgent'].map((v) => el('option', { value: v }, v))); s.value = t.priority || 'normal'; s.setAttribute('data-ticket-priority', t.id); return s; })(),
    el('button', { class: 'btn btn-ghost', onclick: async () => { const status = document.querySelector('[data-ticket-status="' + t.id + '"]').value; const priority = document.querySelector('[data-ticket-priority="' + t.id + '"]').value; await api('/api/admin/tickets/update', { method: 'POST', body: { ticketId: t.id, status: status, priority: priority } }); toast('Ticket updated.', 'ok'); onRoute(); } }, 'Update')
  ]) : null;
  return el('article', { class: 'card ticket-card' }, [
    el('div', { class: 'flex items-center justify-between gap-2' }, [el('h3', { class: 't-h3' }, t.subject), el('span', { class: 'pill' }, t.status || 'open')]),
    adminControls, ...messages, el('div', { class: 'ticket-reply' }, [reply, send])
  ]);
}

async function viewAdmin(root) {
  if (!State.me || !['super_admin', 'admin'].includes(State.me.user.role)) { goto('overview'); return; }
  const superAdmin = State.me.user.role === 'super_admin';
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
    eventHost.innerHTML = ''; eventHost.appendChild(el('div', { class: 'agency-card-head' }, [el('div', {}, [el('span', { class: 'section-kicker' }, 'Financial operations'), el('h3', {}, 'PayU event log')]) ]));
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
  modal({ title: 'Add client workspace', body: el('div', { class: 'invoice-form' }, [field('Workspace name', name), field('Owner name', ownerName), field('Owner email', ownerEmail), field('Temporary password', password), el('p', { class: 'form-note' }, 'Leave owner fields empty to create an onboarding workspace. No invitation email will be sent.')]), confirmText: 'Create workspace', onConfirm: async () => {
    const out = await api('/api/admin/tenants', { method: 'POST', body: { name: name.value.trim(), ownerName: ownerName.value.trim(), ownerEmail: ownerEmail.value.trim(), password: password.value } });
    toast((out.tenant || {}).name + ' created. ' + out.note, 'ok'); onRoute();
  }});
}

function openClientApproach(t) {
  const channel = el('select', { class: 'select' }, ['whatsapp','email','phone','linkedin','meeting','other'].map((value) => el('option', { value }, invoiceStatusLabel(value))));
  const summary = el('textarea', { class: 'textarea', placeholder: 'What happened, what they need, and the next move.' });
  modal({ title: 'Log approach to ' + t.name, body: el('div', { class: 'invoice-form' }, [field('Channel', channel), field('Summary', summary)]), confirmText: 'Record activity', onConfirm: async () => {
    await api('/api/admin/client-approach', { method: 'POST', body: { tenantId: t.id, channel: channel.value, summary: summary.value.trim() } });
    toast('Client approach recorded.', 'ok'); onRoute();
  }});
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
  modal({ title: out.tenant.name, body: body, confirmText: 'Close', onConfirm: async () => {} });
}

function startImpersonation(user) {
  const reason = el('input', { class: 'input', placeholder: 'Support ticket or investigation reason' });
  const password = el('input', { class: 'input', type: 'password', placeholder: 'Your super admin password' });
  modal({ title: 'View as ' + user.email, body: el('div', {}, [el('p', {}, 'This creates a 30 minute read-only user session. Billing, roles, status, and secrets remain blocked.'), field('Reason', reason), field('Re-enter your password', password)]), confirmText: 'Enter user view', onConfirm: async () => {
    await api('/api/admin/impersonations', { method: 'POST', body: { userId: user.id, reason: reason.value.trim(), password: password.value } });
    State.me = await api('/api/me'); renderShell(); goto('overview');
  }});
}

function adjustWallet(t) {
  const amount = el('input', { class: 'input', type: 'number', step: '0.01', placeholder: '100.00' });
  const reason = el('input', { class: 'input', placeholder: 'Required adjustment reason' });
  modal({ title: 'Adjust ' + t.name + ' wallet', body: el('div', {}, [field('Amount in INR, negative deducts', amount), field('Reason', reason)]), confirmText: 'Apply adjustment', onConfirm: async () => {
    const paise = Math.round(Number(amount.value) * 100);
    await api('/api/admin/wallet/adjust', { method: 'POST', body: { tenantId: t.id, amountPaise: paise, reason: reason.value.trim(), idempotencyKey: 'ui_' + Date.now() + '_' + Math.random().toString(36).slice(2) } });
    toast('Wallet adjusted.', 'ok'); onRoute();
  }});
}

/* ===========================================================================
   7. SETTINGS
   =========================================================================== */
async function viewSettings(root) {
  root.appendChild(viewHead('Settings', 'Implemented providers, selected server defaults, and your tenant identity. Live call workflows are configured separately.'));

  const provHost = el('div', { id: 'provHost' }, skeleton('sk-card', 3));
  root.appendChild(provHost);

  const t = State.me.tenant;
  const nameI = el('input', { class: 'input', id: 'set_name', type: 'text', value: t.name || '' });
  const colorVal = (t.branding && t.branding.color) || '#6E7BFF';
  const colorI = el('input', { type: 'color', id: 'set_color', value: colorVal });
  const colorHex = el('input', { class: 'input', id: 'set_color_hex', value: colorVal, style: 'max-width:130px;font-family:var(--mono)' });
  colorI.addEventListener('input', () => { colorHex.value = colorI.value; });
  colorHex.addEventListener('input', () => { if (/^#[0-9a-fA-F]{6}$/.test(colorHex.value)) colorI.value = colorHex.value; });

  const saveBtn = el('button', { class: 'btn btn-primary' }, 'Save tenant settings');
  saveBtn.addEventListener('click', async () => {
    saveBtn.disabled = true; saveBtn.textContent = 'Saving...';
    try {
      // tenant settings update is best effort. If the route is absent, surface a soft note.
      await api('/api/tenant/update', { method: 'POST', body: { name: nameI.value.trim(), color: colorI.value } });
      State.me.tenant.name = nameI.value.trim();
      State.me.tenant.branding = Object.assign({}, State.me.tenant.branding, { color: colorI.value });
      const tn = $('.tenant-chip .tn'); if (tn) { tn.textContent = State.me.tenant.name; tn.title = State.me.tenant.name; }
      const av = $('.tenant-chip .av'); if (av) av.textContent = initials(State.me.tenant.name);
      toast('Tenant settings saved.', 'ok');
    } catch (ex) {
      toast(ex.status === 404 ? 'Tenant settings endpoint not available in this build.' : (ex.message || 'Save failed.'), 'err');
    } finally {
      saveBtn.disabled = false; saveBtn.textContent = 'Save tenant settings';
    }
  });

  root.appendChild(el('div', { class: 'card card-pad', style: 'margin-top:8px' }, [
    el('h3', { class: 't-h3', style: 'margin-bottom:16px' }, 'Tenant'),
    el('div', { class: 'settings-form' }, [
      field('Tenant name', nameI),
      el('div', { class: 'field' }, [el('label', {}, 'Brand color'), el('div', { class: 'color-row' }, [colorI, colorHex])]),
      el('div', { class: 'flex gap-2', style: 'margin-top:6px' }, [saveBtn, el('button', { class: 'btn btn-ghost', onclick: doLogout }, 'Sign out')])
    ])
  ]));

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
  root.appendChild(el('div', { class: 'settings-split' }, [
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
  ]).catch(() => {});

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
  layers.forEach((L) => {
    const list = reg[L.key] || [];
    const wrap = el('div', { class: 'prov-layer' }, [
      el('div', { class: 'lh' }, [el('span', { class: 'lt' }, L.label)]),
      el('div', { class: 'prov-grid' }, list.length ? list.map(provCard) : [el('div', { class: 'muted' }, 'No providers registered.')])
    ]);
    host.appendChild(wrap);
  });
}
function provCard(p) {
  const live = !!p.live;
  const selected = !!p.selected;
  const needs = p.needs || [];
  return el('div', { class: 'card prov-card' }, [
    el('div', { class: 'pc-top' }, [
      el('div', { class: 'pc-name' }, p.label || p.id),
      selected && live
        ? el('span', { class: 'badge-live' }, [el('span', { class: 'd' }), 'Selected'])
        : live
          ? el('span', { class: 'badge-ready' }, [el('span', { class: 'd' }), 'Configured'])
          : el('span', { class: 'badge-ready' }, [el('span', { class: 'd' }), 'Needs setup'])
    ]),
    selected && live
      ? el('div', { class: 'pc-needs' }, 'Default provider for dashboard-owned requests.')
      : live
        ? el('div', { class: 'pc-needs' }, 'Credentials available. Select it through trusted server configuration.')
      : el('div', { class: 'pc-needs' }, needs.length
          ? ['To enable, add ', ...needs.flatMap((n, i) => i ? [document.createTextNode(', '), el('code', {}, n)] : [el('code', {}, n)]), document.createTextNode(' to your .env.')]
          : 'Adapter is implemented but not configured.')
  ]);
}

/* ===========================================================================
   START
   =========================================================================== */
let _booted = false;
function bootOnce() { if (_booted) return; _booted = true; boot(); }
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bootOnce);
else bootOnce();
