/* =========================================================================
   LUE — orb
   =========================================================================
   Dense particle sphere + sci-fi HUD rings, carried over from the desktop
   build. The one change is that geometry is now stored in normalized -1..1
   space and projected at draw time, so the orb (and any constellation held
   on it) survives window resizes and orientation changes.
   ========================================================================= */

const LueOrb = (() => {

  const orbCanvas  = document.getElementById('orb');
  const ringCanvas = document.getElementById('rings');
  const stage      = document.getElementById('orbStage');
  const captionEl  = document.getElementById('orbCaption');

  const octx = orbCanvas.getContext('2d');
  const rctx = ringCanvas.getContext('2d');

  /* ---------- sizing ---------- */
  let size = 520;
  let CX = size / 2, CY = size / 2, R = size * 0.42;
  let dpr = Math.min(window.devicePixelRatio || 1, 2);   // cap DPR — Chromebooks

  function resize() {
    const rect = stage.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    // leave headroom for the ring labels, which sit outside the sphere radius
    const next = Math.max(200, Math.min(rect.width, rect.height) * 0.94);
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    size = next;
    CX = size / 2;
    CY = size / 2;
    R  = size * 0.36;

    [orbCanvas, ringCanvas].forEach((c) => {
      c.width  = Math.round(size * dpr);
      c.height = Math.round(size * dpr);
      c.style.width  = size + 'px';
      c.style.height = size + 'px';
    });
    octx.setTransform(dpr, 0, 0, dpr, 0, 0);
    rctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /* ---------- particle sphere ---------- */
  // Point count scales down on small screens so phones/Chromebooks stay smooth.
  const N = window.matchMedia('(max-width: 720px)').matches ? 2600 : 5200;
  const particles = [];
  for (let i = 0; i < N; i++) {
    // fibonacci sphere distribution for even coverage
    const t = i / N;
    const inc = Math.acos(1 - 2 * t);
    const az  = Math.PI * (1 + Math.sqrt(5)) * i;
    const jitter = 0.85 + Math.random() * 0.3;     // slight radius jitter -> textured look
    particles.push({
      theta: inc,
      phi: az,
      r: jitter,
      tw: Math.random() * Math.PI * 2,             // twinkle phase
      speed: 0.15 + Math.random() * 0.25,
    });
  }

  let rotY = 0;
  let energy = 0.35;                                // 0..1, driven by activity level

  /* ---------- constellation morph state ---------- */
  // mode: 'sphere' | 'toConstellation' | 'constellation' | 'toSphere'
  let morphMode  = 'sphere';
  let morphStart = 0;
  const MORPH_MS = 1400;
  const HOLD_MS  = 22000;                           // how long a drawing stays up
  let targetMap  = null;                            // particleIndex -> { nx, ny } in -1..1
  let strokeGroups = [];                            // point groups, kept separate for line drawing
  let revertTimer = null;

  function smoothstep(t) { return t * t * (3 - 2 * t); }

  function project(p, rot) {
    const x0 = Math.sin(p.theta) * Math.cos(p.phi + rot);
    const y0 = Math.cos(p.theta);
    const z0 = Math.sin(p.theta) * Math.sin(p.phi + rot);
    return { x: x0 * p.r, y: y0 * p.r, z: z0 * p.r };
  }

  /* ---------- public API ---------- */
  const api = {
    setEnergy(v) { energy = Math.max(0, Math.min(1, v)); },

    setCaption(text) {
      if (!captionEl) return;
      captionEl.textContent = text || '';
      captionEl.classList.toggle('show', Boolean(text));
    },

    /**
     * strokes: array of point-arrays, each point [x, y] in -1..1. Each stroke
     * is kept separate so disjoint detail (e.g. guitar strings) doesn't get a
     * stray connecting line dragged across the shape.
     */
    morphToConstellation(strokes) {
      if (!strokes || strokes.length === 0) return;
      clearTimeout(revertTimer);

      const CAP = Math.floor(N * 0.5);   // generous budget — typical output is well under this
      const totalPts = strokes.reduce((sum, s) => sum + s.length, 0);
      let working = strokes;
      if (totalPts > CAP) {
        const scale = CAP / totalPts;
        working = strokes.map((s) => {
          const keep = Math.max(2, Math.round(s.length * scale));
          const stride = s.length / keep;
          const out = [];
          for (let k = 0; k < keep; k++) out.push(s[Math.floor(k * stride)]);
          return out;
        });
      }

      const flatCount = working.reduce((sum, s) => sum + s.length, 0);
      const step = N / flatCount;
      targetMap = new Map();
      strokeGroups = [];
      let cursor = 0;
      working.forEach((strokePts) => {
        const group = [];
        strokePts.forEach(([nx, ny]) => {
          const particleIdx = Math.floor(cursor * step);
          const pt = { nx: nx * 1.05, ny: ny * 1.05 };
          targetMap.set(particleIdx, pt);
          group.push(pt);
          cursor++;
        });
        strokeGroups.push(group);
      });

      morphMode  = 'toConstellation';
      morphStart = performance.now();
      revertTimer = setTimeout(() => api.morphToSphere(), HOLD_MS);
    },

    morphToSphere() {
      clearTimeout(revertTimer);
      if (morphMode === 'sphere') return;
      morphMode  = 'toSphere';
      morphStart = performance.now();
      api.setCaption('');
    },

    isShowingArt() {
      return morphMode === 'constellation' || morphMode === 'toConstellation';
    },
  };

  /* ---------- orb draw loop ---------- */
  function drawOrb(time) {
    octx.clearRect(0, 0, size, size);
    rotY += 0.0022 + energy * 0.004;

    // advance the morph state machine
    let blend = 0;   // 0 = pure sphere, 1 = pure constellation, for target particles
    let bgDim = 0;   // 0 = normal background particles, 1 = fully dimmed
    if (morphMode === 'toConstellation') {
      const t = smoothstep(Math.min(1, (time - morphStart) / MORPH_MS));
      blend = t; bgDim = t;
      if (t >= 1) morphMode = 'constellation';
    } else if (morphMode === 'constellation') {
      blend = 1; bgDim = 1;
    } else if (morphMode === 'toSphere') {
      const t = smoothstep(Math.min(1, (time - morphStart) / MORPH_MS));
      blend = 1 - t; bgDim = 1 - t;
      if (t >= 1) { morphMode = 'sphere'; targetMap = null; strokeGroups = []; }
    }

    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      const proj = project(p, rotY);
      const depth = (proj.z + 1) / 2;               // 0..1
      const sx = CX + proj.x * R;
      const sy = CY + proj.y * R * 0.98;

      const twinkle = 0.55 + 0.45 * Math.sin(time * 0.001 * p.speed + p.tw);
      let alpha = (0.15 + depth * 0.85) * twinkle * (0.7 + energy * 0.3);
      let sizePx = 0.6 + depth * 1.6;
      let px = sx, py = sy;
      let hue = 178 + depth * 10;

      const target = targetMap && targetMap.get(i);
      if (target) {
        const tx = CX + target.nx * R;
        const ty = CY + target.ny * R;
        px = sx + (tx - sx) * blend;
        py = sy + (ty - sy) * blend;
        alpha = alpha + (1 - alpha) * blend;        // constellation stars burn bright
        sizePx = sizePx + (2.4 - sizePx) * blend;
        hue = 178 - 20 * blend;                     // shifts whiter/warmer as it resolves into art
      } else if (bgDim > 0) {
        alpha *= (1 - bgDim * 0.87);                // background sphere fades so the art reads clearly
      }

      octx.fillStyle = `hsla(${hue}, 75%, ${55 + depth * 25}%, ${alpha})`;
      octx.fillRect(px, py, sizePx, sizePx);
    }

    // connect-the-dots lines once the constellation has resolved — each stroke
    // drawn separately so detail (e.g. guitar strings) stays crisp
    if (morphMode === 'constellation' && strokeGroups.length > 0) {
      octx.strokeStyle = 'rgba(160,230,240,0.28)';
      octx.lineWidth = 0.7;
      for (const group of strokeGroups) {
        if (group.length < 2) continue;
        octx.beginPath();
        octx.moveTo(CX + group[0].nx * R, CY + group[0].ny * R);
        for (let i = 1; i < group.length; i++) {
          octx.lineTo(CX + group[i].nx * R, CY + group[i].ny * R);
        }
        octx.stroke();
      }
    }

    // soft core glow
    const g = octx.createRadialGradient(CX, CY, 0, CX, CY, R * 1.1);
    g.addColorStop(0, `rgba(120,230,240,${0.10 + energy * 0.12})`);
    g.addColorStop(1, 'rgba(120,230,240,0)');
    octx.fillStyle = g;
    octx.beginPath();
    octx.arc(CX, CY, R * 1.1, 0, Math.PI * 2);
    octx.fill();

    requestAnimationFrame(drawOrb);
  }

  /* ---------- HUD rings, ticks, labels, faint wireframe ---------- */
  const ringLabels = [
    { text: 'SYS.CORE',   angle: -150 },
    { text: 'NEURAL.NET', angle: -60  },
    { text: 'SEC.CORE',   angle: 25   },
    { text: 'I/O',        angle: 75   },
    { text: 'MEM',        angle: 150  },
    { text: 'PWR',        angle: -180 },
  ];
  const ringNodes = [];
  for (let i = 0; i < 18; i++) ringNodes.push((i / 18) * Math.PI * 2);

  // Precomputed once so the wireframe is stable instead of flickering randomly
  // every frame (the desktop build re-rolled it per frame, which strobed).
  const wirePairs = [];
  for (let i = 0; i < ringNodes.length; i++) {
    for (let j = i + 1; j < ringNodes.length; j++) {
      if (Math.random() < 0.22) wirePairs.push([i, j]);
    }
  }

  let ringRot = 0;
  function drawRings() {
    rctx.clearRect(0, 0, size, size);
    ringRot += 0.0004;

    // outer + inner ring circles
    rctx.strokeStyle = 'rgba(140,210,220,0.55)';
    rctx.lineWidth = 1;
    rctx.beginPath(); rctx.arc(CX, CY, R * 1.14, 0, Math.PI * 2); rctx.stroke();
    rctx.strokeStyle = 'rgba(140,210,220,0.3)';
    rctx.beginPath(); rctx.arc(CX, CY, R * 1.22, 0, Math.PI * 2); rctx.stroke();

    // tick marks
    rctx.strokeStyle = 'rgba(160,220,230,0.5)';
    for (let i = 0; i < 72; i++) {
      const a = (i / 72) * Math.PI * 2 + ringRot;
      const len = i % 6 === 0 ? 10 : 4;
      const rr = R * 1.14;
      rctx.beginPath();
      rctx.moveTo(CX + Math.cos(a) * rr, CY + Math.sin(a) * rr);
      rctx.lineTo(CX + Math.cos(a) * (rr + len), CY + Math.sin(a) * (rr + len));
      rctx.stroke();
    }

    // faint wireframe connecting nodes on the ring (network look)
    rctx.strokeStyle = 'rgba(150,200,215,0.12)';
    rctx.lineWidth = 0.6;
    const pts = ringNodes.map((a) => {
      const rr = R * 1.28;
      const ang = a + ringRot * 1.4;
      return { x: CX + Math.cos(ang) * rr, y: CY + Math.sin(ang) * rr };
    });
    for (const [i, j] of wirePairs) {
      rctx.beginPath();
      rctx.moveTo(pts[i].x, pts[i].y);
      rctx.lineTo(pts[j].x, pts[j].y);
      rctx.stroke();
    }

    // labels around the ring
    rctx.font = '10px ui-monospace, Consolas, monospace';
    rctx.fillStyle = 'rgba(170,225,235,0.85)';
    ringLabels.forEach((l) => {
      const a = (l.angle * Math.PI) / 180 + ringRot * 0.3;
      const rr = R * 1.34;
      rctx.save();
      rctx.translate(CX + Math.cos(a) * rr, CY + Math.sin(a) * rr);
      rctx.rotate(a + Math.PI / 2);
      rctx.textAlign = 'center';
      rctx.fillText(l.text, 0, 0);
      rctx.restore();
    });

    requestAnimationFrame(drawRings);
  }

  /* ---------- boot ---------- */
  let started = false;
  let stageObserver = null;   // held in scope on purpose: an unreferenced
                              // ResizeObserver can be garbage-collected, which
                              // silently stops it observing.
  api.start = function start() {
    if (started) return;
    started = true;
    resize();
    if (window.ResizeObserver) {
      stageObserver = new ResizeObserver(() => resize());
      stageObserver.observe(stage);
    }
    window.addEventListener('resize', resize, { passive: true });
    window.addEventListener('orientationchange', () => setTimeout(resize, 150));
    requestAnimationFrame(drawOrb);
    requestAnimationFrame(drawRings);
  };

  return api;
})();
