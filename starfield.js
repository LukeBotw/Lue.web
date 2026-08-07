/* =========================================================================
   LUE — backdrop starfield
   Slow parallax drift with occasional shooting stars. Purely decorative.
   ========================================================================= */

(() => {
  const canvas = document.getElementById('starfield');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let w = 0, h = 0, dpr = 1;
  let stars = [];
  let shooting = null;
  let nextShootAt = performance.now() + 4000;

  function seed() {
    const density = Math.min(260, Math.round((w * h) / 7000));
    stars = [];
    for (let i = 0; i < density; i++) {
      const layer = Math.random();                  // 0 = far, 1 = near
      stars.push({
        x: Math.random() * w,
        y: Math.random() * h,
        r: 0.4 + layer * 1.3,
        drift: 0.006 + layer * 0.028,
        tw: Math.random() * Math.PI * 2,
        twSpeed: 0.4 + Math.random() * 1.1,
        hue: Math.random() < 0.16 ? 262 : 186,      // a few violet stars for depth
      });
    }
  }

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = window.innerWidth;
    h = window.innerHeight;
    canvas.width  = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width  = w + 'px';
    canvas.style.height = h + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    seed();
  }

  function spawnShootingStar() {
    const fromLeft = Math.random() < 0.5;
    shooting = {
      x: fromLeft ? -60 : w + 60,
      y: Math.random() * h * 0.55,
      vx: (fromLeft ? 1 : -1) * (5.5 + Math.random() * 3.5),
      vy: 1.4 + Math.random() * 1.6,
      life: 1,
    };
  }

  function frame(time) {
    ctx.clearRect(0, 0, w, h);

    for (const s of stars) {
      if (!reduced) {
        s.y += s.drift;
        if (s.y > h + 2) { s.y = -2; s.x = Math.random() * w; }
      }
      const twinkle = reduced ? 0.7 : 0.45 + 0.55 * Math.sin(time * 0.001 * s.twSpeed + s.tw);
      ctx.fillStyle = `hsla(${s.hue}, 70%, 78%, ${0.16 + twinkle * 0.42})`;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
    }

    if (!reduced) {
      if (!shooting && time > nextShootAt) spawnShootingStar();
      if (shooting) {
        const tailX = shooting.x - shooting.vx * 11;
        const tailY = shooting.y - shooting.vy * 11;
        const grad = ctx.createLinearGradient(shooting.x, shooting.y, tailX, tailY);
        grad.addColorStop(0, `rgba(210, 255, 245, ${0.75 * shooting.life})`);
        grad.addColorStop(1, 'rgba(210, 255, 245, 0)');
        ctx.strokeStyle = grad;
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(shooting.x, shooting.y);
        ctx.lineTo(tailX, tailY);
        ctx.stroke();

        shooting.x += shooting.vx;
        shooting.y += shooting.vy;
        shooting.life -= 0.012;
        if (shooting.life <= 0 || shooting.x < -120 || shooting.x > w + 120 || shooting.y > h + 120) {
          shooting = null;
          nextShootAt = time + 6000 + Math.random() * 12000;
        }
      }
    }

    requestAnimationFrame(frame);
  }

  resize();
  window.addEventListener('resize', resize, { passive: true });
  requestAnimationFrame(frame);
})();
