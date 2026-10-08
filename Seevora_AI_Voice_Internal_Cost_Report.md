# Seevora AI Voice Stack: Internal Cost & Infrastructure Pricing Report
**Confidential: For Internal Company Use Only**
*Last Updated: October 2026*

---

## 1. Executive Summary: Unit Economics at a Glance

Our custom voice stack (Deepgram Nova-3 + Groq Qwen-27B + Rumik Silk Muga + VoBiz Telephony + Google Cloud Run) is engineered to deliver **ultra-low latency with enterprise-grade profit margins**.

* **All-In Cost per Live Call Minute:** **~₹2.20 – ₹2.65 INR / minute**
* **Compared to US Legacy Stacks (Twilio + ElevenLabs + GPT-4):** ₹16 – ₹22 INR / minute (**85% Cost Savings**)
* **Fixed Monthly Infrastructure Cost:** **₹500 INR / month** (VoBiz DID rental; Google Cloud Run stays within Free Tier).

---

## 2. Layer-by-Layer Pricing Breakdown

### 📞 Layer 1: Telephony Carrier (VoBiz)
* **What it does:** Provides Indian virtual phone numbers (`+9180...`), handles telecom inbound routing, and connects outbound dialing.
* **Pricing Model:**
  * **Number Rental (Fixed):** **₹500 INR / month** per virtual number.
  * **Inbound Call Usage:** **~₹0.70 INR / minute** (pulse billing).
  * **Outbound Call Usage:** **~₹0.70 INR / minute**.
* **Official Verification Link:**  
  🔗 [https://vobiz.ai](https://vobiz.ai) | [https://console.vobiz.ai](https://console.vobiz.ai)

---

### 🎙️ Layer 2: Speech-to-Text (Deepgram Nova-3)
* **What it does:** Real-time streaming transcription of caller voice in English, Hindi, and multilingual Hinglish.
* **Pricing Model:**
  * **Pay-As-You-Go Rate:** **$0.0077 USD / audio minute** (~**₹0.65 INR / minute** at ₹85/USD).
  * **Free Credit on Signup:** **$200 USD free trial credit** (~26,000 free minutes).
* **Official Verification Link:**  
  🔗 [https://deepgram.com/pricing](https://deepgram.com/pricing)

---

### 🧠 Layer 3: Conversational Brain / LLM (Groq Cloud)
* **Model Used:** `qwen/qwen3.8-27b` (High-speed Hindi/English dynamic code-switching).
* **Pricing Model:**
  * **Developer Free Tier:** **$0 (100% Free)** within 30 RPM / 14,400 daily requests.
  * **Pay-As-You-Go (On-Demand Tier):**
    * Input Tokens: **$0.20 USD / 1M tokens** ($0.0002 / 1K tokens).
    * Output Tokens: **$0.40 USD / 1M tokens** ($0.0004 / 1K tokens).
    * **Cost per Call Minute:** An average 1-minute conversation uses ~6 conversational turns (~2,000 tokens), which equals **~$0.0008 USD (~₹0.07 INR / minute)**. Virtually negligible.
* **Official Verification Link:**  
  🔗 [https://groq.com/pricing](https://groq.com/pricing)

---

### 🗣️ Layer 4: Voice Synthesis / TTS (Rumik Silk)
* **Model Used:** `muga` (generative Indian conversational voice) / `mulberry` (low-latency streaming voice).
* **Pricing Model:**
  * **Promotional Rate:** **₹0.50 INR per 1,000 characters**.
  * **Standard Commercial Rate:** **₹2.50 INR per 1,000 characters**.
  * **Cost per Call Minute:** The AI speaks ~400 to 500 characters per minute (one or two short sentences per turn):
    * Promo: **~₹0.25 INR / minute**
    * Standard: **~₹1.00 – ₹1.25 INR / minute**
* **Official Verification Link:**  
  🔗 [https://rumik.ai](https://rumik.ai)

---

### ☁️ Layer 5: Cloud Hosting & Container Deployment (Google Cloud Run)
* **What it does:** Hosts the multi-tenant Studio backend, API endpoints, and WebSocket proxy servers.
* **Pricing Model:**
  * **Cloud Run Perpetual Free Tier (Every Month Forever):**
    * First **2,000,000 requests / month:** **FREE ($0)**
    * First **180,000 vCPU-seconds / month:** **FREE ($0)**
    * First **360,000 GiB-seconds / month:** **FREE ($0)**
  * **Monthly Expected Cost:** With `min-instances=0` (scales to zero when no calls occur) and 512 MiB RAM, standard business usage will cost **₹0 / month** (completely within the free tier). Under heavy enterprise volume (50k+ requests/month), cost is typically under **$2 to $5 USD (~₹170 – ₹420 INR / month)**.
* **Official Verification Link:**  
  🔗 [https://cloud.google.com/run/pricing](https://cloud.google.com/run/pricing)

---

### 🔄 Layer 6: Voice Orchestrator (Dograh)
* **What it does:** Bridges SIP telephony carriers with real-time media pipelines and handles telephony state.
* **Pricing Model:**
  * **Free / Developer Tier:** **$0** (Includes trial concurrency and test numbers).
  * **Commercial / Pro Plans:** Typically **$29 – $99 USD / month** depending on concurrent runners and enterprise SLA.
* **Official Verification Link:**  
  🔗 [https://dograh.com](https://dograh.com) | [https://app.dograh.com](https://app.dograh.com)

---

## 3. Total Per-Minute Cost Summary

| Layer | Provider & Model | Cost (USD) | Cost (INR) |
|---|---|---|---|
| **Carrier Telephony** | VoBiz (`+9180...`) | ~$0.0082 / min | **₹0.70 / min** |
| **Speech-to-Text** | Deepgram Nova-3 | $0.0077 / min | **₹0.65 / min** |
| **LLM Reasoning** | Groq (`qwen3.8-27b`) | $0.0008 / min | **₹0.07 / min** |
| **Voice Synthesis** | Rumik Muga (Standard) | ~$0.0120 / min | **₹1.05 / min** |
| **Cloud Hosting** | Google Cloud Run | $0.0000 | **₹0.00 / min** *(Free Tier)* |
| **TOTAL VARIABLE COST** | | **~$0.0287 / min** | **~₹2.47 INR / minute** |

*(Note: If Rumik promo rate applies, total cost drops to **~₹1.67 INR / minute**).*

---

## 4. Monthly Commercial Modeling (Client Margin & Profitability)

Assuming we charge a client a standard retainership of **₹35,000 INR / month** for up to **3,000 call minutes** (~100 minutes/day):

| Expense Item | Calculation | Monthly Cost (INR) |
|---|---|---|
| **VoBiz Number Rental** | 1 Dedicated Virtual DID | ₹500 |
| **Variable Call Usage** | 3,000 minutes × ₹2.47/min | ₹7,410 |
| **Google Cloud Run** | Serverless hosting (within free quota) | ₹0 |
| **Total Cost of Goods Sold (COGS)** | | **₹7,910 INR** |
| **Client Revenue** | Monthly retainer | **₹35,000 INR** |
| **Gross Profit** | ₹35,000 - ₹7,910 | **₹27,090 INR** |
| **Gross Margin %** | | **77.4%** |

---

## 5. Development & Deployment One-Time Costs

* **Source Code & Tech Stack:** Node.js (Zero-dependency custom engine) — **₹0 (Open Source)**
* **Version Control:** GitHub private repository — **₹0**
* **Container Registry & Deployment:** Google Artifact Registry / Cloud Build — **₹0 (Free tier allowance)**
* **Total Initial Development Infrastructure Cost:** **₹0**
