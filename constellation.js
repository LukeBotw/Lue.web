/* =========================================================================
   LUE — constellation image generation  (signature feature, carried over
   unchanged from the desktop build)
   =========================================================================
   Not real image generation — this asks the model for a handful of SVG path
   strokes tracing a recognizable outline (plus separate short strokes for
   fine detail, like guitar strings or flower petals). Models are much more
   accurate at SVG path syntax than at guessing raw coordinates, and multiple
   separate strokes let detail exist without a stray line dragging across the
   shape to connect unrelated features.

   The returned strokes are sampled into point clouds and handed to the orb,
   whose particles fly into position to form the drawing.
   ========================================================================= */

const LueConstellation = (() => {

  /* --- intent: does this message want a drawing? (same triggers as desktop) --- */
  const GEN_IMAGE_TRIGGERS = [
    /\bgenerate\b.*\b(image|picture|art|logo|photo|constellation)\b/i,
    /\bmake\b.*\b(image|picture) of\b/i,
    /\bdraw\b/i,
    /\bchart\b.*\b(constellation)\b/i,
    /\bshow me\b.*\b(a|an)\b.*\b(constellation|drawing)\b/i,
  ];

  function wantsImage(text) {
    return GEN_IMAGE_TRIGGERS.some((p) => p.test(text));
  }

  /** "draw me a lighthouse" -> "lighthouse" */
  function extractSubject(text) {
    return text
      .replace(/^\s*(please\s+)?(can you\s+|could you\s+)?/i, '')
      .replace(/^(generate|make|draw|chart|show me|create)\s+/i, '')
      .replace(/^(me\s+|us\s+)?(a|an|the)\s+/i, '')
      .replace(/\b(image|picture|art|drawing|constellation)\s+of\s+/i, '')
      .replace(/\bas a constellation\b/i, '')
      .replace(/[.!?]+\s*$/, '')
      .trim() || text.trim();
  }

  /* --- prompt (verbatim from the desktop build) --- */
  function buildPrompt(subject) {
    return (
      `Output ONLY this JSON, no other text, no markdown:\n` +
      `{"strokes": ["<svg path d attribute>", "..."]}\n\n` +
      `Coordinate space: x and y each range from -1 to 1, origin (0,0) at the center, ` +
      `matching a viewBox of "-1 -1 2 2".\n` +
      `Draw a recognizable line-art outline of: "${subject}".\n` +
      `Rules:\n` +
      `- Use 4 to 14 separate strokes total.\n` +
      `- One or two strokes for the main outline/silhouette.\n` +
      `- Additional SHORT, SEPARATE strokes for distinguishing detail — e.g. strings on an ` +
      `instrument, spokes on a wheel, petals on a flower, facial features on an animal. Do not ` +
      `connect detail strokes to the outline or to each other; keep them as their own path.\n` +
      `- Use SVG path commands M, L, C, Q, Z, and use curves (C/Q) for anything that isn't straight.\n` +
      `- Keep proportions recognizable and roughly centered in the -1..1 space.`
    );
  }

  function parseStrokes(response) {
    try {
      const start = response.indexOf('{');
      const end = response.lastIndexOf('}');
      if (start === -1 || end === -1) return null;
      const parsed = JSON.parse(response.slice(start, end + 1));
      const strokes = (parsed.strokes || []).filter(
        (s) => typeof s === 'string' && s.trim().length > 0
      );
      return strokes.length > 0 ? strokes : null;
    } catch {
      return null;
    }
  }

  /**
   * Asks the model for stroke paths. One retry — first attempts occasionally
   * return prose instead of pure JSON.
   */
  async function generate(subject, attempt = 1) {
    const result = await LueAI.ask({
      text: buildPrompt(subject),
      system: 'You output only raw JSON. Never wrap it in markdown fences and never add commentary.',
      history: [],
      maxTokens: 1600,
    });

    const strokes = parseStrokes(result.text);

    if ((!strokes || strokes.length < 2) && attempt < 2) {
      return generate(subject, attempt + 1);
    }
    return {
      strokes: strokes && strokes.length >= 2 ? strokes : null,
      provider: result.provider,
      label: result.label,
      fellBack: result.fellBack,
      reason: result.reason,
    };
  }

  /**
   * Walks an SVG path with the browser's own geometry engine and returns
   * evenly-spaced [x, y] samples in the -1..1 space.
   */
  function samplePath(d) {
    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    const path = document.createElementNS(svgNS, 'path');
    svg.style.position = 'absolute';
    svg.style.left = '-9999px';
    svg.setAttribute('aria-hidden', 'true');
    path.setAttribute('d', d);
    svg.appendChild(path);
    document.body.appendChild(svg);

    let points = [];
    try {
      const length = path.getTotalLength();
      if (length > 0) {
        const numSamples = Math.max(4, Math.min(40, Math.round(length * 12)));
        for (let i = 0; i < numSamples; i++) {
          const pt = path.getPointAtLength((i / (numSamples - 1)) * length);
          points.push([pt.x, pt.y]);
        }
      }
    } catch {
      points = [];
    }
    document.body.removeChild(svg);
    return points;
  }

  /** strokes (path strings) -> point groups the orb can morph into */
  function toPointGroups(strokes) {
    return strokes.map(samplePath).filter((pts) => pts.length >= 2);
  }

  return { wantsImage, extractSubject, generate, toPointGroups, parseStrokes };
})();
