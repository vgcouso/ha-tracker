# Privacy Policy — HA-Tracker GPT (Direct Token Mode, No Proxy)

**Last updated:** 2025-08-24
**Controller:** vgcouso (individual developer)

## What this policy covers
This policy applies to the “HA-Tracker GPT”, a Custom GPT that uses **Actions** to call each user’s own Home Assistant instance. **We do not operate any server-side proxy** and we do not receive your data.

> Note: OpenAI (ChatGPT) processes your prompts and tool calls under its own policies. Your Home Assistant instance processes the API requests you authorize.

## Data we process
- **We do not collect or store personal data.**
- Action calls are sent **directly from ChatGPT to your Home Assistant** at the URL you configure in your own GPT copy.
- The **Bearer (Long-Lived) token** is configured by you **inside your own GPT settings** and is **not shared with us**.

## What your Home Assistant may return
Depending on what you ask the GPT to do, your Home Assistant may return persons, device tracker locations, zones, and filtered positions. Those responses flow from your HA to your ChatGPT session. **We do not see or store them.**

## Retention
- We do not retain data or logs from your usage.
- Any retention of your prompts or Action calls is governed by **OpenAI’s policies** and by your own Home Assistant setup.

## Security
- No server is operated by us in this mode.
- Your token remains in your GPT configuration and is transmitted only to your Home Assistant when you invoke the Action.

## Your choices
- Revoke your Long-Lived Access Token in **Home Assistant → Profile → Security** at any time.
- Delete your GPT copy or remove the Action to stop any future requests.

## Changes
If we later introduce an optional **Connect Proxy** (OAuth), we will update this policy to describe what we store (e.g., encrypted tokens) and for how long.

**Third-party policies:**
- **OpenAI:** see OpenAI’s privacy policy.
- **Home Assistant:** you control your own instance and any related policies.
