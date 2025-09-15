# Privacy Policy — HA‑Tracker GPT & Connect Proxy (Cloudflare Workers)

**Last updated:** 2025-08-25  
**Controller:** Victor Gonzalez Couso (individual developer)

This policy describes how data is processed when you use the “HA‑Tracker GPT” (a Custom GPT with Actions) together with the optional **Connect Proxy** hosted on **Cloudflare Workers**.

---

## 1) What this policy covers
- The GPT can call your **own Home Assistant (HA)** using HTTP endpoints exposed by your HA instance.  
- When you click **Connect**, the GPT authorizes via our **Cloudflare Worker** so it can call your HA on your behalf.  
- This policy covers the data that passes **through the proxy** and any data the GPT instructs the proxy to fetch from **your HA**.

> Note: OpenAI (ChatGPT) processes your prompts/tool calls under its own terms. Your Home Assistant also processes requests under its own policies (including Nabu Casa if used).

---

## 2) Data we process

### A) Inputs from ChatGPT to the proxy
We receive only the minimal parameters needed to fulfill your request, for example:
- the **person** or entity you asked about,
- **date/time ranges**,
- pagination/filters.  
We do **not** receive your entire ChatGPT conversation—only the fields the Action sends.

### B) Data retrieved from your Home Assistant
Depending on your request, your HA may return:
- **Persons** and attributes (friendly name, state, source device tracker).  
- **Device trackers** (latitude/longitude, optional speed, battery, geocoded label).  
- **Zones** (name, coordinates, radius).  
- **Filtered positions** (timestamps, coordinates, attributes like speed).

We do **not** access devices beyond the endpoints invoked by the GPT.

### C) Authentication & session data
When you connect:
- We complete HA’s **OAuth** flow and receive an **access token** (short‑lived) and a **refresh token** (long‑lived) **from your HA** so we can call your HA on your behalf.
- We store your **HA base URL** (e.g., Nabu Casa URL or your domain) and those tokens **encrypted at rest** in **Cloudflare Workers KV**.
- For the GPT↔proxy channel, we issue our own **proxy access token** (JWT) and a **proxy refresh token**. The GPT uses these to call the proxy. We **rotate** the proxy refresh token on each renewal.

### D) Technical metadata
For reliability, security, and abuse prevention we may log:
- timestamp, endpoint path, response status, execution time;
- coarse network data from the edge provider (e.g., country, IP as observed by Cloudflare).

We do **not** sell or rent data. We do **not** use it for advertising.

---

## 3) Purposes & legal bases
- **Provide the service:** execute the Actions you ask for (“Where is X now?”, “Stats between times”).  
- **Security & abuse prevention:** rate‑limiting, troubleshooting, fraud prevention.  
- **Legal bases** (GDPR): performance of a contract (Art. 6(1)(b)), legitimate interests (Art. 6(1)(f)), and your consent where required (e.g., connecting your HA).

---

## 4) Retention
- **HA session** (your HA base URL + HA tokens): kept while your session is active. It expires after **~14 days of inactivity** by default or when you disconnect.  
- **Proxy refresh tokens:** expire after **~30 days** by default and are **rotated** on every use.  
- **Proxy access tokens (JWT):** short‑lived (e.g., **15–60 minutes**).  
- **Edge logs/metadata:** retained short‑term (e.g., **≤30 days**) and aggregated thereafter.  
Actual durations may be adjusted for operations and security; we aim to keep data **no longer than necessary**.

---

## 5) Sharing & international transfers
- **Infrastructure:** Cloudflare Workers & KV host the proxy; Cloudflare acts as a processor. Data may be processed globally via their network (appropriate safeguards apply).  
- **OpenAI (ChatGPT):** acts under its own terms/policies.  
- **Nabu Casa / your HA host:** your HA processes your data under your configuration.  
- We do **not** sell data and we share only as required by law or to operate the service.

---

## 6) Security
- Transport security (**HTTPS**) for all network calls.  
- Tokens **encrypted at rest** (AES‑GCM) in Cloudflare KV; access controlled in the Worker.  
- **Auto‑refresh** of HA access tokens using HA refresh tokens.  
- **Proxy refresh tokens** are **rotated** on each use and have a fixed TTL.  
- Optional **allowed host** restrictions to limit which HA domains can be connected.

---

## 7) Your choices & rights
- **Disconnect:** use the GPT’s “disconnect” (or a call to the proxy’s `/disconnect` endpoint) to delete your proxy session and refresh tokens.  
- **Revoke in HA:** you can revoke the OAuth/Long‑Lived tokens in **Home Assistant → Profile → Security** at any time.  
- **Data rights:** subject to law, you may request access, deletion, correction, or portability of data we control, or object to certain processing.

---

## 8) Children
The service is not intended for children under 16. Do not use it if you are under the minimum age in your jurisdiction.

---

## 9) Changes
We may update this policy from time to time. Material changes will be indicated by updating the “Last updated” date and, where appropriate, by additional notice.

---

## 10) Third‑party references
- **OpenAI (ChatGPT)** — model and Actions platform.  
- **Cloudflare Workers & KV** — hosting and storage for the proxy.  
- **Home Assistant / Nabu Casa** — your smart home system and (optionally) your remote access provider.

