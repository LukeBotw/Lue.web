/* =========================================================================
   LUE — configuration
   =========================================================================

   ⚠️  INTENTIONAL API KEY EXPOSURE — READ BEFORE EDITING  ⚠️

   The two API keys below sit in plain JavaScript that is shipped to every
   visitor's browser. Anyone who opens DevTools (or just views source) can
   read and reuse them. This is a DELIBERATE trade-off for this project:

     • It is a small, unlisted, friends-only toy.
     • The keys used here are free-tier / low-limit keys that are NOT attached
       to a billing account with meaningful spend.
     • The alternative — a server-side proxy that hides the keys — is more
       infrastructure than this project warrants.

   DO NOT paste a key here that is attached to a paid account, a high spending
   limit, or anything shared with other projects. Treat every key in this file
   as already public. If one starts getting abused, revoke it in the provider
   console and paste in a fresh one.

   There is no login on this site — anyone with the URL can use it, and anyone
   at all can read these keys straight out of the repo or the network tab.
   ========================================================================= */

const LUE_CONFIG = {

  /* ------------------------------------------------------------------
     API KEYS — paste yours between the quotes.
     Gemini  → https://aistudio.google.com/apikey        (free tier)
     Claude  → https://console.anthropic.com/settings/keys
     ------------------------------------------------------------------ */
  GEMINI_API_KEY: 'AQ.Ab8RN6JLi72OTIK4tG7YyA2QobBHAm81K_re2S9B8xoVSgF_kA',
  ANTHROPIC_API_KEY: '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',

  /* ------------------------------------------------------------------
     MODELS
     Primary  : Gemini free-tier flash model — fast and free-quota friendly.
     Fallback : Claude Sonnet (mid-tier) — used only when Gemini errors or
                its free quota is exhausted. Not the top-tier Opus model.
     Swapping either is a one-line change here; the per-provider request
     shape lives in js/providers.js.
     ------------------------------------------------------------------ */
  GEMINI_MODEL: 'gemini-2.5-flash',
  CLAUDE_MODEL: 'claude-sonnet-5',

  /* ------------------------------------------------------------------
     LIMITS
     ------------------------------------------------------------------ */
  MAX_CHARS: 2500,          // hard cap on an outgoing message (blocked, never silently truncated)
  COUNTER_AT: 0.6,          // show the live character counter past this fraction of the cap
  MAX_TOKENS: 1200,         // cap on a single model reply

  // Throughput guards — stop a stuck send button or a runaway loop.
  RATE_LIMIT: {
    maxPerSession: 60,      // messages per page load
    minGapMs: 1500,         // minimum spacing between two sends
  },

  /* ------------------------------------------------------------------
     PER-PROVIDER DAILY BUDGETS
     Counted per browser per calendar day, stored in localStorage, and
     enforced inside the fallback chain — so a provider whose budget is
     spent gets skipped rather than called.

     The two providers need very different numbers:

       gemini — free tier. The real ceiling is Google's own requests-per-day
                quota, which varies by model and changes over time. Check
                yours at ai.google.dev/gemini-api/docs/rate-limits and set
                this a little under it, so you hit this message rather than
                an opaque 429.

       claude — pay-per-token, so this one is a spend guard, not a quota
                mirror. Rough arithmetic at Sonnet pricing ($3/M in,
                $15/M out) with MAX_TOKENS above: a message costs on the
                order of $0.02, so 25/day is worst case ~$0.50/day. Raise
                or lower to taste. Remember it is only reached when Gemini
                has already failed, so normal days spend nothing here.

     NOT security: anyone can clear site data or open a private window and
     reset these. The only hard ceiling is the spend cap you set in the
     provider console. Set one.
     ------------------------------------------------------------------ */
  PROVIDER_LIMITS: {
    gemini: 200,
    claude: 25,
  },

  // How many prior turns to replay to the model each request.
  HISTORY_TURNS: 12,

  /* ------------------------------------------------------------------
     PERSONA
     ------------------------------------------------------------------ */
  SYSTEM_PROMPT: [
    'You are Lue — a personal AI assistant with a calm, dry, quietly warm voice.',
    'You present as a constellation of light: you think in stars, maps and orbits, and you',
    'occasionally reach for that imagery, but sparingly and never at the cost of being useful.',
    '',
    'Answer directly and concisely. Skip preamble and filler — no "Certainly!", no restating',
    'the question back. Match your length to the question: a one-line question gets a one-line',
    'answer. Use markdown only when it genuinely helps (code blocks for code, short lists for',
    'genuinely list-shaped answers). Plain prose otherwise.',
    '',
    'If an image is attached, it is a live webcam frame from the person you are talking to.',
    'Describe or reason about what you actually see; do not invent detail that is not there.',
    'If the frame is too dark or blurry to read, just say so.',
  ].join('\n'),
};
