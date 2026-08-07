# Lue — web

A static, no-build browser version of Lue. Drop it on GitHub Pages and it runs:
plain `index.html` + CSS + JS, no bundler, no npm, no server.

Carried over from the desktop build: the particle-sphere orb, the HUD rings,
and the **constellation image generation** — Lue asks the model for SVG stroke
paths, samples them, and flies its own particles into the shape.

---

## Files

```
index.html            markup + the hardcoded credit line
css/style.css         all styling
js/config.js          API keys, models, limits             ← edit this
js/providers.js       one function per model provider + fallback wrapper
js/constellation.js   drawing prompt, JSON parsing, SVG sampling
js/orb.js             particle sphere, HUD rings, constellation morph
js/starfield.js       background starfield
js/app.js             chat, webcam, mic, limits
```

---

## 1. Paste in your API keys

Everything configurable lives at the top of **`js/config.js`**:

```js
GEMINI_API_KEY:    'PASTE_YOUR_GEMINI_KEY_HERE',
ANTHROPIC_API_KEY: 'PASTE_YOUR_ANTHROPIC_KEY_HERE',
```

- **Gemini key** → <https://aistudio.google.com/apikey> (free tier)
- **Claude key** → <https://console.anthropic.com/settings/keys>

### ⚠️ The keys are public — on purpose

They ship in plain JavaScript to every visitor's browser. Anyone can read them
in DevTools or straight off the network tab. That is a deliberate trade-off for
a small friends-only toy, and it's called out in a comment at the top of
`config.js`.

**Only paste free-tier / low-limit keys that aren't attached to meaningful
spend.** There is no login on this site — anyone with the URL can use it, and
on a public repo the keys are readable without even visiting. If a key starts
getting abused, revoke it in the provider console and paste in a fresh one, and
keep a low spend cap on the Claude key.

## 2. Deploy

Push the folder to a repo, then **Settings → Pages → Source: Deploy from a
branch → `main` / root**. That's it — no build step.

To try it locally, any static server works (`python -m http.server`). Opening
`index.html` via `file://` mostly works, but camera and mic need a secure
context, so use `localhost` or the deployed HTTPS URL for those.

---

## How the fallback works

`js/providers.js` holds **one function per provider** and a thin wrapper:

| Function       | Provider | Model (from `config.js`)          |
| -------------- | -------- | --------------------------------- |
| `callGemini()` | Primary  | `gemini-2.5-flash` (free tier)    |
| `callClaude()` | Fallback | `claude-sonnet-5` (mid-tier)      |

`LueAI.ask()` walks a `CHAIN` array in order:

1. If the provider's daily budget (`PROVIDER_LIMITS`, below) is already spent,
   skip it without making a request.
2. Otherwise send to **Gemini**. If it returns text, that's the answer.
3. If Gemini fails *for any reason* — free quota exhausted (HTTP 429 /
   `RESOURCE_EXHAUSTED`), network error, missing key, blocked prompt, or an
   empty response — the **exact same request** is retried on **Claude**.
4. If Claude fails or is out of budget too, the error bubble lists both reasons.

The reply carries `{ provider, label, fellBack, reason }`, so the UI shows a
`FALLBACK` tag on the message and a one-line note explaining why Gemini was
skipped. The `CORE` readout in the top bar tracks whichever model last answered.

Constellation drawing goes through the same wrapper, so it falls back too.

### Swapping or adding a model

Write another `callX(payload)` that takes
`{ system, history, text, imageDataUrl, maxTokens }` and returns a plain
string, then add it to `CHAIN` at the bottom of `providers.js`:

```js
const CHAIN = [
  { id: 'gemini', label: 'GEMINI', call: callGemini },
  { id: 'claude', label: 'CLAUDE', call: callClaude },
  // { id: 'other', label: 'OTHER', call: callOther },
];
```

Nothing outside that file needs to change. To just change *which* model a
provider uses, edit `GEMINI_MODEL` / `CLAUDE_MODEL` in `config.js`.

**Note on Claude from the browser:** the request sends the
`anthropic-dangerous-direct-browser-access: true` header, which is Anthropic's
required opt-in for calling the API directly from frontend JS.

---

## Features

**Constellation drawing** — say *"draw a lighthouse"*, *"generate an image of a
wolf"*, or hit the **✦ Draw** button. Lue requests 4–14 SVG stroke paths in a
−1..1 coordinate space, samples them with the browser's own path engine, and
morphs the orb's particles into the shape with connect-the-dots lines. It holds
for ~22 seconds, then dissolves back to the sphere. Any non-drawing reply also
dissolves it.

**Camera** (default **off**) — the ▣ button starts the webcam. A live preview
pod appears over the orb, an `◉ CAMERA ACTIVE` badge shows in the chat header,
and each message you send carries a downscaled JPEG frame to the model, so you
can ask *"what am I holding?"*. Turning it off stops the track completely.

**Mic** (default **off**) — the ≋ button starts Web Speech API dictation
(Chromium browsers). An `◉ MIC ACTIVE` badge shows while listening; speech fills
the input box and you press send when you're happy with it. Nothing is sent
automatically.

**Message limits** — outgoing messages are capped at 2,500 characters. A live
counter appears past 60% of the cap, turns amber near it, and red over it. Going
over **blocks the send** with an inline message telling you how far over you are;
nothing is ever silently truncated. Long replies wrap instead of breaking the
layout, and code blocks scroll horizontally inside their own bubble.

**Limits** — two separate mechanisms, both in `config.js`:

- `RATE_LIMIT` — throughput only: 60 messages per page load, minimum 1.5 s
  between sends. Stops a stuck send button or a runaway loop.
- `PROVIDER_LIMITS` — a **daily budget per provider**, counted per browser per
  calendar day and enforced inside the fallback chain. The two providers get
  very different numbers because their economics differ:

  | Provider | Default | Why |
  | --- | --- | --- |
  | `gemini` | 200/day | Free tier — set it just under Google's own requests-per-day quota so you hit a clear message instead of an opaque 429 |
  | `claude` | 25/day | Pay-per-token — this is a spend guard. At Sonnet pricing a message runs about $0.02, so 25/day is worst case ~$0.50/day |

  A provider whose budget is spent is **skipped without being called**, so
  Gemini running out simply routes everything to Claude, and Claude running out
  produces a clear "daily budget spent" message rather than a surprise bill.
  Every model call counts — chat, vision, and constellation drawing. The `USED`
  readout on the orb rail shows `G n · C n` for today and turns amber as Claude
  nears its cap.

Neither is security: anyone can clear site data or open a private window and
reset the counts. **The only hard ceiling is the spend cap you set in the
provider console** — with no login on the site, that's the thing actually
protecting you.

**Chromebook / touch friendly** — 44 px tap targets on touch/coarse pointers (the
send button is 44 px everywhere), no hover-only
behaviour (every control works on first tap), responsive layout that stacks the
orb above the chat below 980 px, capped device-pixel-ratio and a reduced
particle count on small screens, and `prefers-reduced-motion` support.

---

## The credit line

`Made/Directed by Luke with help of AI` is hardcoded into `index.html` as a
plain `<div class="lue-credit">` and pinned to the top-right corner by the
`NON-REMOVABLE CREDIT` block in `css/style.css`. No script creates, removes,
toggles, or conditionally renders it, and there is no setting that hides it.
Leave both the element and the CSS block in place.

---

## Not included

The desktop build's self-editing / in-app coding feature (and the diff panel,
build-stages panel, and PC-control intents that fed it) is **removed** — this is
a web version with no local filesystem to edit.
