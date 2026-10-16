# Seevora Voice Agent Feature Specification — Gap Analysis

> Comparing the **Seevora Voice Agent Feature Specification for Developers** PDF against the current `rapidx-voice-agent-stack` project codebase.

---

## ✅ WHAT IS IMPLEMENTED (Present in the Codebase)

### 1. Core Platform & Architecture
| Feature | Status | Where |
|---|---|---|
| Multi-tenant SaaS architecture | ✅ Done | `server.js`, `lib/core.js` |
| Session-based auth (`rxv_sess` HttpOnly cookie) | ✅ Done | `server.js` |
| Scrypt password hashing | ✅ Done | `lib/core.js` |
| Tenant isolation (cross-tenant 403 guards) | ✅ Done | `server.js` |
| Atomic JSON writes (`db.json.tmp` + rename) | ✅ Done | `lib/core.js` |
| Role hierarchy: super_admin, admin, owner, member | ✅ Done | `lib/clerk.js`, `server.js` |
| Suspended tenant/user enforcement | ✅ Done | `server.js` |
| Demo tenant seeding on boot | ✅ Done | `server.js` (boot function) |
| Schema versioning + additive migration | ✅ Done | `lib/core.js` |
| Audit event trail | ✅ Done | `server.js` (`addAudit`) |

### 2. Authentication & Onboarding
| Feature | Status | Where |
|---|---|---|
| Signup with email, password, name, company | ✅ Done | `POST /api/auth/signup` |
| Login with brute-force rate limiting | ✅ Done | `POST /api/auth/login` (10/min) |
| Logout + cookie clearing | ✅ Done | `POST /api/auth/logout` |
| 12-char password minimum | ✅ Done | `server.js` |
| Trial wallet credit (₹10 on signup) | ✅ Done | `addLedgerEntry trial_grant` |
| Onboarding completion tracking | ✅ Done | `apiTenantOnboardingComplete` |
| Clerk OAuth integration | ✅ Done | `lib/clerk.js` |
| Demo login toggle (`ENABLE_DEMO_LOGIN`) | ✅ Done | `server.js` |
| Impersonation (super admin, 30-min session) | ✅ Done | `server.js`, `SAAS-QA-CHECKLIST.md` |

### 3. Voice Agent Builder
| Feature | Status | Where |
|---|---|---|
| Create agents (name, persona, greeting, TTS, DID) | ✅ Done | `POST /api/agents` |
| Update agents | ✅ Done | `POST /api/agents/update` |
| Delete agents | ✅ Done | `POST /api/agents/delete` |
| List agents (tenant scoped) | ✅ Done | `GET /api/agents` |
| Agent persona / knowledge base fields | ✅ Done | `server.js` (5000 char persona, 10000 char knowledge) |
| Agent fields & guardrails | ✅ Done | `server.js` |
| Sample transcript per agent | ✅ Done | `server.js` |
| Transcript understanding metadata | ✅ Done | `server.js` |
| Workflow limit enforcement per plan | ✅ Done | `lib/plans.js checkWorkflowLimit` |
| AI-assisted agent blueprint builder | ✅ Done | `buildFallbackAgentBlueprint` in server.js |

### 4. Agent Preset Library (8 System Presets)
| Preset | Status |
|---|---|
| Personal Injury Intake (legal) | ✅ Done |
| Dental Receptionist (healthcare) | ✅ Done |
| Real Estate Lead Qualifier | ✅ Done |
| Restaurant Reservations (hospitality) | ✅ Done |
| Appointment Booking (scheduling) | ✅ Done |
| Customer Support | ✅ Done |
| Lead Qualification (sales) | ✅ Done |
| AI Receptionist (general) | ✅ Done |

> All 8 presets are defined in `PRESET_LIBRARY` in `server.js` with fields, guardrails, and greetings.

### 5. Voice Engine / TTS (Rumik)
| Feature | Status | Where |
|---|---|---|
| Rumik TTS synthesis (`muga` + `mulberry`) | ✅ Done | `lib/providers.js` |
| 4 speakers (speaker_1 to speaker_4) | ✅ Done | `lib/providers.js` |
| f0_up_key pitch control | ✅ Done | `lib/providers.js` |
| WebSocket streaming TTS | ✅ Done | `/api/ws-connect`, `lib/providers.js` |
| Browser UA bypass (Cloudflare) | ✅ Done | `BROWSER_UA` const in providers.js |
| Rumik 2000 char cap + truncation | ✅ Done | `lib/providers.js` |
| TTS usage tracking (chars, cost) | ✅ Done | `server.js` |

### 6. STT (Speech-to-Text)
| Feature | Status | Where |
|---|---|---|
| Deepgram streaming transcription | ✅ Done | `lib/providers.js` |
| Deepgram batch transcription | ✅ Done | `lib/providers.js` |
| STT intentionally fixed to Deepgram | ✅ Done | `SAAS-API.md` + `providers.js` |

### 7. LLM Brain
| Feature | Status | Where |
|---|---|---|
| Groq (primary reasoning path) | ✅ Done | `lib/providers.js` |
| Gemini (secondary LLM) | ✅ Done | `lib/providers.js` |
| LLM model allowlist via env | ✅ Done | `GROQ_ALLOWED_MODELS`, `GEMINI_ALLOWED_MODELS` |
| Chat API | ✅ Done | `POST /api/chat` |
| LLM adapter contract (chat method) | ✅ Done | `lib/providers.js` |

### 8. Telephony
| Feature | Status | Where |
|---|---|---|
| VoBiz through Dograh (primary) | ✅ Done | `lib/providers.js` |
| Outbound dial with confirm guard | ✅ Done | `POST /api/telephony/dial` |
| Telephony status endpoint | ✅ Done | `GET /api/telephony/status` |
| BYON (Bring Your Own Number) collection | ✅ Done | `GET/POST /api/byon` |
| BYON providers: vobiz, twilio, telnyx, plivo, vonage, sip | ✅ Done | `SAAS-API.md` |
| Batch outbound dialer script | ✅ Done | `scripts/batch-outbound-dialer.js` |
| DID assignment per agent | ✅ Done | `agent.telephony.did` |

### 9. Billing & Wallet
| Feature | Status | Where |
|---|---|---|
| Immutable ledger entries | ✅ Done | `lib/core.js`, `server.js` |
| Prepaid wallet (INR paise) | ✅ Done | `GET /api/wallet` |
| PayU payment integration | ✅ Done | `lib/payu.js`, `POST /api/payment-intents` |
| Razorpay payment integration | ✅ Done | `lib/razorpay.js` |
| Server-owned credit packs | ✅ Done | `CREDIT_PACKS` in server.js |
| Idempotent payment callbacks | ✅ Done | `POST /api/payu/callback` |
| Admin wallet adjustment | ✅ Done | `POST /api/admin/wallet/adjust` |
| Trial grant (₹10 on signup) | ✅ Done | `addLedgerEntry` |
| Wallet top-up packs (₹500, ₹1k, ₹2.5k, ₹5k) | ✅ Done | `WALLET_TOPUP_PACKS` in plans.js |

### 10. Subscription Plans (Seevora Tiers)
| Feature | Status | Where |
|---|---|---|
| Starter Plan (₹5,199/mo, 500 mins, 3 workflows) | ✅ Done | `lib/plans.js` |
| Growth Plan (₹10,999/mo, 1000 mins, 10 workflows) | ✅ Done | `lib/plans.js` |
| Business Plan (₹25,999/mo, 2500 mins, 30 workflows) | ✅ Done | `lib/plans.js` |
| Enterprise Plan (₹1,40,000+/mo, custom) | ✅ Done | `lib/plans.js` |
| Monthly / Quarterly / Annual billing cycles | ✅ Done | `lib/plans.js` |
| Plan feature enforcement (broadcasts, webhooks, etc.) | ✅ Done | `lib/plans.js assertFeatureAllowed` |
| Overage add-ons rate card | ✅ Done | `SEEVORA_ADDONS` in plans.js |
| Workflow limit enforcement | ✅ Done | `plans.checkWorkflowLimit` |
| Contacts limit enforcement | ✅ Done | `plans.checkContactsLimit` |
| Users limit enforcement | ✅ Done | `plans.checkUsersLimit` |

### 11. WhatsApp CRM
| Feature | Status | Where |
|---|---|---|
| WhatsApp Cloud API integration | ✅ Done | `lib/wacrm.js` |
| WhatsApp shared inbox / message threading | ✅ Done | `lib/wacrm.js` |
| CRM Contacts, Deals, Pipelines | ✅ Done | `lib/wacrm.js` |
| Auto-replies & appointment reminders | ✅ Done | `lib/wacrm.js` |
| Broadcasts (Growth+ plan) | ✅ Done | `lib/wacrm.js` (plan-gated) |
| Call-to-WhatsApp follow-ups | ✅ Done | `lib/wacrm.js` |
| Tags and segments (Growth+) | ✅ Done | `lib/wacrm.js` (plan-gated) |
| Meta Webhook signature verification | ✅ Done | `lib/wacrm.js` |
| Service/utility vs marketing message quota | ✅ Done | `lib/plans.js` |
| E.164 phone number normalization | ✅ Done | `lib/wacrm.js normalizeE164` |

### 12. Support Ticketing
| Feature | Status | Where |
|---|---|---|
| Open, list, reply to tenant-scoped tickets | ✅ Done | `GET/POST /api/support/tickets` |
| Ticket status lifecycle | ✅ Done | open, in_progress, waiting, resolved, closed |
| Admin reply + status management | ✅ Done | `POST /api/admin/tickets/reply` |
| Priority assignment | ✅ Done | `server.js` |
| XSS-resistant ticket messages | ✅ Done | SAAS-QA-CHECKLIST |

### 13. Demo Links (Public Shareable Agent)
| Feature | Status | Where |
|---|---|---|
| Create shareable demo links per agent | ✅ Done | `POST /api/demo-links` |
| Revoke demo links | ✅ Done | `POST /api/demo-links/revoke` |
| List demo links (no secrets) | ✅ Done | `GET /api/demo-links` |
| SHA-256 token hashing (stored) | ✅ Done | `lib/demo-links.js` |
| Public demo metadata endpoint | ✅ Done | `GET /api/public/demo/<token>` |
| Public demo WebRTC session | ✅ Done | `POST /api/public/demo/<token>/session` |
| Expiry, start count, duration limits | ✅ Done | `lib/demo-links.js` |
| Same-origin TURN credentials proxy | ✅ Done | `server.js` |
| Concurrent session reservation | ✅ Done | `server.js` |

### 14. Privacy Mode
| Feature | Status | Where |
|---|---|---|
| Privacy modes: standard, metadata_only, no_recording | ✅ Done | `GET/POST /api/privacy` |
| Server-side enforcement (not just UI) | ✅ Done | SAAS-QA-CHECKLIST |
| No-recording blocks calls without verified upstream workflow | ✅ Done | SAAS-QA-CHECKLIST |
| Logs omit audio/transcript/secrets | ✅ Done | `lib/logger.js` |

### 15. Admin Panel
| Feature | Status | Where |
|---|---|---|
| Platform overview (tenants, users, tickets, wallets, calls) | ✅ Done | `GET /api/admin/overview` |
| Tenant management (list, suspend, close) | ✅ Done | `GET /api/admin/tenants`, `POST /api/admin/tenants/status` |
| User management (list, role, status) | ✅ Done | `GET /api/admin/users` |
| Create client workspace | ✅ Done | `POST /api/admin/tenants` |
| Admin audit log (500 entries) | ✅ Done | `GET /api/admin/audit` |
| Tenant audit log (200 entries) | ✅ Done | `GET /api/audit` |
| Admin wallet adjustment | ✅ Done | `POST /api/admin/wallet/adjust` |
| Client approach/touchpoint logging | ✅ Done | `POST /api/admin/client-approach` |

### 16. Agency OS Features
| Feature | Status | Where |
|---|---|---|
| Agency overview (revenue, receivables, activity) | ✅ Done | `GET /api/agency/overview` |
| Invoice management (create, list, status) | ✅ Done | `GET/POST /api/invoices` |
| Invoice lifecycle (draft, issued, paid, void) | ✅ Done | `POST /api/invoices/status` |
| Agency-wide operating prompt | ✅ Done | `GET/POST /api/agency/prompt` |
| WhatsApp + Meta Ad Library integrations | ✅ Done | `GET /api/integrations` |
| Integration request recording | ✅ Done | `POST /api/integrations/request` |

### 17. HVAC Desk (Specialized Vertical)
| Feature | Status | Where |
|---|---|---|
| HVAC jobs management (create/update/list) | ✅ Done | `GET/POST /api/hvac/desk`, `POST /api/hvac/jobs` |
| Cal.com calendar integration (event types, slots) | ✅ Done | `GET /api/hvac/event-types`, `GET /api/hvac/slots` |
| Cal.com booking creation | ✅ Done | `POST /api/hvac/book` |
| HVAC outcome tracking (booked, routed, follow_up, etc.) | ✅ Done | `HVAC_OUTCOMES` in server.js |

### 18. Browser / WebRTC Voice (Live Talk)
| Feature | Status | Where |
|---|---|---|
| Dograh SmallWebRTC session creation | ✅ Done | `POST /api/voice/session` |
| Short-lived embed token (server-side) | ✅ Done | `server.js` |
| Public demo WebRTC with TURN proxying | ✅ Done | `server.js`, `public/demo.html` |
| Real-time voice states (idle, connecting, listening, speaking, error) | ✅ Done | `public/demo.html` |
| Media track cleanup on exit | ✅ Done | SAAS-QA-CHECKLIST |

### 19. Workflows (Dograh)
| Feature | Status | Where |
|---|---|---|
| Seevora receptionist workflow | ✅ Done | `workflows/seevora-receptionist.json` |
| RIA receptionist workflow | ✅ Done | `workflows/ria-receptionist.json` |
| Rumik demo workflow | ✅ Done | `workflows/rumik-one-rupee-demo.json` |
| Workflow inspection/dump scripts | ✅ Done | `scripts/inspect-workflow.js`, `dump-workflow.js` |
| Hindi language fix script | ✅ Done | `scripts/fix-dograh-workflow-hindi.js` |

### 20. Frontend / Dashboard
| Feature | Status | Where |
|---|---|---|
| Marketing landing page | ✅ Done | `public/index.html` |
| App dashboard (SPA) | ✅ Done | `public/app.html`, `public/app.js` |
| HVAC desk page | ✅ Done | `public/hvac.html` |
| Public demo page | ✅ Done | `public/demo.html` |
| Privacy policy page | ✅ Done | `public/privacy.html` |
| Terms of service page | ✅ Done | `public/terms.html` |
| Data deletion page | ✅ Done | `public/data-deletion.html` |
| Recordings page | ✅ Done | `public/recordings.html` |
| Charts (Recharts island) | ✅ Done | `src/charts.jsx` |
| Brand design system (CSS tokens) | ✅ Done | `public/assets/` |

### 21. Infrastructure & DevOps
| Feature | Status | Where |
|---|---|---|
| Docker containerization | ✅ Done | `Dockerfile`, `docker-compose.yml` |
| Zero npm dependencies for core server | ✅ Done | Pure Node `http/crypto/fs` |
| Environment config (`.env`) | ✅ Done | `.env`, `.env.example` |
| Security audit | ✅ Done | `SECURITY-AUDIT.md` |
| Threat model | ✅ Done | `THREAT-MODEL.md` |
| GitHub Actions CI | ✅ Done | `.github/` |

---

## ❌ WHAT IS NOT IMPLEMENTED / MISSING OR INCOMPLETE

### 1. BYON — Full Production Implementation
| Missing Feature | Notes |
|---|---|
| Per-tenant Dograh organization binding | Currently a **placeholder** only. Real per-tenant Dograh org + API key isolation is NOT done. |
| Cross-tenant isolation at Dograh level | The QA checklist explicitly marks this as `[ ]` (incomplete). |
| The global Dograh key serves multiple tenants | Security concern — noted in `SAAS-API.md` as demo-only. |

> [!CAUTION]
> This is the most critical missing piece. Multi-tenant telephony is currently using a single shared Dograh API key which MUST be isolated per-tenant before accepting real money.

### 2. Number Marketplace / VoiceLink KYC
| Missing Feature | Notes |
|---|---|
| VoiceLink KYC adapter | Noted in QA checklist as `[ ]` — needs separate adapter without replacing Dograh v1.43. |
| Number purchase flow | Not implemented. Referenced design only from `Harddiikk/voice-engine`. |
| Sandbox KYC + purchase test | QA explicitly `[ ]`. |
| Inbound number purchase for tenants | Tenants cannot self-serve buy numbers. |

### 3. Payment System — Production Readiness
| Missing Feature | Notes |
|---|---|
| PayU sandbox callback E2E test | QA checklist `[ ]` |
| PostgreSQL migration for billing | Currently JSON store — not production-safe for payments with multiple replicas. |
| Signed refund/chargeback webhooks | `[ ]` in QA checklist. |
| Scheduled PayU reconciliation | Not implemented. |
| PayU dashboard webhook URLs | Still pointing to old domain (`api.auto4you.in`) — QA `[ ]`. |
| Razorpay production validation | Razorpay lib exists but no QA/test coverage confirmed. |

### 4. Calendar Integration — Full Appointment Capture
| Missing Feature | Notes |
|---|---|
| Connecting preset appointment capture to external calendar | QA checklist `[ ]`: "Connect appointment capture to the chosen external calendar after calendar credentials are supplied." |
| Calendar credentials provisioning UI | No UI for tenants to connect their own Cal.com account. |
| Cal.com is currently a single global key | `CALCOM_API_KEY` is server-wide, not per-tenant. |

### 5. Barge-in Interruption (Voice UX)
| Missing Feature | Notes |
|---|---|
| Verified barge-in interruption on demo page | QA checklist `[ ]`: "Explicitly drive and verify a barge-in interruption on the public demo page with a spoken test phrase." |
| Server-side duration enforcement in Dograh workflow | QA `[ ]`: "Enforce the server-selected maximum duration inside the upstream Dograh workflow." |

### 6. Production Voice Session Verification
| Missing Feature | Notes |
|---|---|
| Spoken greeting + spoken reply on production URL | QA `[ ]`: "Complete one spoken browser greeting and one spoken reply on the production URL." The embedded QA browser does not emit TURN allocation — requires Brave verification. |
| TURN/ICE full relay verification | Coturn runs on host networking but browser-to-production relay test is pending. |

### 7. Agent Voice Preview in Dashboard
| Missing Feature | Notes |
|---|---|
| Per-agent live voice preview button | Mentioned in SPEC.md section 6 ("live voice preview button per agent") but not verified as implemented in the current `public/app.js` (only 17KB, very basic shell). |
| Voice Studio waveform visualizer | SPEC.md describes waveform + audio player — the `src/charts.jsx` only has analytics charts. |
| Streaming TTS via ws-connect in dashboard | SPEC mentions "optional streaming via /api/ws-connect" in Voice Studio — unclear if frontend wires this. |

### 8. Provider Selection / Switching
| Missing Feature | Notes |
|---|---|
| Per-agent runtime provider switching via Dograh workflow bindings | SAAS-API.md explicitly states: "Until those bindings exist, provider selection applies only to dashboard-owned provider routes." |
| Tenant-level provider persistence that affects call routing | Dashboard provider selection does NOT change the live Dograh workflow. |
| ElevenLabs, Sarvam TTS stubs wired in UI | Planned stubs in providers.js but no UI to request/configure them. |

### 9. WhatsApp / Meta Features — Full Integration
| Missing Feature | Notes |
|---|---|
| Actual WhatsApp Business Cloud connection (live) | The `GET /api/integrations` shows truthful state — likely unconfigured unless `META_ACCESS_TOKEN` etc. are set in .env. |
| Meta Ad Library live data pull | Stub only — does not call Meta. |
| Requesting setup creates only internal record, does NOT connect | As per DESIGN.md: "Requesting setup creates an auditable internal request. It does not call Meta or WhatsApp." |

### 10. Outbound Dialing — Full Campaign UI
| Missing Feature | Notes |
|---|---|
| Bulk outbound campaign UI in dashboard | `scripts/batch-outbound-dialer.js` exists as a CLI script only, no dashboard UI for it. |
| Campaign progress tracking / reporting | Not present in the server routes. |
| Leads CSV import from dashboard | `leads-sample.csv` exists but import is manual/script-only. |

### 11. Reports & Analytics (Business Plan Feature)
| Missing Feature | Notes |
|---|---|
| Dedicated reports section (Business/Enterprise plan) | Feature flag `reportsPrioritySupport` is defined but no reports dashboard is built. |
| Voice minutes consumed vs. plan limit visualization | Usage route exists but no visual progress bars vs. plan limits in dashboard. |
| Call recording access / playback | `public/recordings.html` exists (578 bytes) — effectively a placeholder. |

### 12. Webhooks & API Access (Business Plan Feature)
| Missing Feature | Notes |
|---|---|
| Outbound webhook delivery to tenant URLs | `webhooksApi` feature flag exists in plans.js but no webhook dispatch logic found in server.js. |
| API key issuance for tenants | No `POST /api/api-keys` route found. Tenants cannot get API keys. |
| Webhook event catalog | Not documented or implemented. |

### 13. Custom Development / Enterprise Features
| Missing Feature | Notes |
|---|---|
| Dedicated SLA & account executive flow | Enterprise plan mentions this — no tooling in code. |
| Custom CRM contact fields | Not implemented beyond standard fields. |
| White-label / custom branding per tenant | `branding.color` exists but full white-label (custom domain, logo) is not implemented. |

### 14. Supabase / PostgreSQL Migration
| Missing Feature | Notes |
|---|---|
| `lib/db-supabase.js` exists | The file exists (11KB) but the system is still running on JSON flat-file store. |
| Migration to PostgreSQL before production payments | Explicitly flagged in QA checklist as `[ ]`. |

---

## ⚠️ PARTIAL / NEEDS VERIFICATION

| Feature | State | Note |
|---|---|---|
| Clerk SSO / OAuth login | Partial | `lib/clerk.js` is complete but requires `CLERK_SECRET_KEY` env to be set and Clerk project configured. |
| Privacy mode `no_recording` upstream enforcement | Partial | Server blocks calls but relies on unverified upstream Dograh workflow configuration. |
| HVAC Cal.com per-tenant keys | Partial | Single global `CALCOM_API_KEY` — not per-tenant. |
| Razorpay live payments | Partial | `lib/razorpay.js` complete, but no QA proof that end-to-end payment + webhook works in production. |
| Public demo barge-in | Partial | WebRTC session works (QA run 31 verified) but barge-in interruption not tested. |
| `public/app.js` full dashboard | Partial | Only 17KB — likely a shell that loads most logic dynamically; needs visual QA. |

---

## 📊 Summary Scorecard

| Category | Implemented | Missing/Partial |
|---|---|---|
| Core Auth & Multi-tenancy | ✅ Complete | — |
| Agent Builder + Presets | ✅ Complete | Agent voice preview UI unverified |
| Voice Engine (Rumik TTS + Deepgram STT) | ✅ Complete | — |
| LLM (Groq + Gemini) | ✅ Complete | — |
| Telephony (VoBiz/Dograh) | ✅ Functional | ❌ Not per-tenant isolated |
| BYON Number Management | ⚠️ Placeholder only | ❌ Not production-ready |
| Billing (PayU + Wallet + Ledger) | ✅ Code complete | ❌ Not PostgreSQL-backed |
| Subscription Plans (4 tiers) | ✅ Complete | — |
| WhatsApp CRM | ✅ Code complete | ⚠️ Requires Meta credentials |
| Support Tickets | ✅ Complete | — |
| Demo Links | ✅ Complete | ❌ Barge-in unverified |
| Privacy Mode | ✅ Complete | ⚠️ Upstream workflow dep |
| Admin Panel | ✅ Complete | — |
| Agency OS (Invoices, Prompt) | ✅ Complete | — |
| HVAC Desk + Cal.com | ✅ Functional | ⚠️ Single global API key |
| Reports & Analytics | ❌ Not built | Feature flag only |
| Webhooks & API Keys for tenants | ❌ Not built | Feature flag only |
| Custom/Enterprise features | ❌ Not built | — |
| Number Marketplace / KYC | ❌ Not built | — |
| PostgreSQL migration | ❌ Not done | Critical before scaling |
| Outbound campaign dashboard UI | ❌ Not built | Script only |
| White-label branding | ❌ Not built | Color-only branding |

---

> [!IMPORTANT]
> The **3 most critical gaps** before production SaaS launch:
> 1. **Per-tenant Dograh org isolation** — currently shared key serves all tenants.
> 2. **PostgreSQL for billing** — JSON store is not safe for concurrent payment writes at scale.
> 3. **PayU reconciliation + sandbox E2E** — payments untested end-to-end.
