/* Billboard site, Nov 19 2026. The effects from the live site, adapted:
     typing       the bio types itself once it scrolls into view
     name         held still; one span per letter; a letter blinks out now and then
     sand         the mouse scatters the giant line into grains that drift home
     brain        sits where the name's "o" is (body[data-brain-as-o]); leans to the pointer
     robot cursor same frames and timings as the live site
     sparks       a click throws a few pixel sparks (body[data-sparks])
   body[data-fit-name] sizes the giant line so its widest word fills the row.
   ?static=1 skips the typing (for screenshots). */
(() => {
  const root = document.documentElement;
  const body = document.body;
  const cfg = body.dataset;
  const STATIC = root.classList.contains("static");
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const still = STATIC || reduced;

  /* ---------- name: one span per letter ---------- */
  const row = document.querySelector(".name-row");
  const name = row && row.querySelector("h1");
  if (name) {
    const raw = name.textContent.trim();
    name.setAttribute("aria-label", raw);
    name.textContent = "";
    for (const ch of raw) {
      const s = document.createElement("span");
      s.className = ch === " " ? "name-gap" : "name-char";
      s.textContent = ch;
      s.setAttribute("aria-hidden", "true");
      name.appendChild(s);
    }
  }
  const chars = Array.from(document.querySelectorAll(".name-char"));
  const startBlink = () => {
    if (still || !chars.length) return;
    const pulse = () => {
      const n = Math.random() < 0.72 ? 1 : 2;
      const picked = new Set();
      while (picked.size < n) picked.add(Math.floor(Math.random() * chars.length));
      picked.forEach((i) => {
        const c = chars[i];
        c.classList.add("is-masked");
        window.setTimeout(() => c.classList.remove("is-masked"), 130 + Math.random() * 290);
      });
      window.setTimeout(pulse, 860 + Math.random() * 1960);
    };
    window.setTimeout(pulse, 1200 + Math.random() * 1200);
  };

  /* ---------- typing, started when the bio comes into view ---------- */
  const lines = Array.from(document.querySelectorAll(".type-reveal"));
  if (!lines.length || still) {
    lines.forEach((el) => el.classList.add("typed"));
    startBlink();
  } else {
    const parts = lines.map((el) => {
      const full = el.textContent.trim();
      el.textContent = "";
      const on = document.createElement("span");
      on.className = "t-on";
      const off = document.createElement("span");
      off.className = "t-off";
      off.textContent = full;
      el.append(on, off);
      return { el, on, off, full };
    });
    const SPEED = 24;
    const typeLine = (L, done) => {
      let i = 0;
      L.el.classList.add("typed", "typing");
      const tick = () => {
        if (i >= L.full.length) {
          L.el.classList.remove("typing");
          done();
          return;
        }
        i += 1;
        L.on.textContent = L.full.slice(0, i);
        L.off.textContent = L.full.slice(i);
        const pause = /[.,;:!?]/.test(L.full[i - 1]) ? SPEED * 4 : 0;
        window.setTimeout(tick, SPEED + pause);
      };
      tick();
    };
    let idx = 0, started = false;
    const next = () => {
      if (idx >= parts.length) return;
      typeLine(parts[idx], () => {
        idx += 1;
        window.setTimeout(next, 220);
      });
    };
    const start = () => {
      if (started) return;
      started = true;
      window.setTimeout(next, 250);
    };
    const first = lines[0];
    if ("IntersectionObserver" in window) {
      const io = new IntersectionObserver((entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          io.disconnect();
          start();
        }
      }, { rootMargin: "0px 0px -12% 0px" });
      io.observe(first);
    } else {
      start();
    }
    startBlink();
  }

  /* ---------- giant line sized to fill its row ---------- */
  const fitName = () => {
    if (!name || cfg.fitName === undefined) return;
    const target = row.clientWidth;
    name.style.fontSize = "100px";
    let widest = 0, run = 0;
    for (const el of name.children) {
      if (el.classList.contains("name-gap")) { widest = Math.max(widest, run); run = 0; }
      else run += el.getBoundingClientRect().width;
    }
    widest = Math.max(widest, run);
    name.style.fontSize = Math.floor(((100 * target) / widest) * 0.985) + "px";
  };

  /* ---------- the brain takes the place of the name's "o" ---------- */
  const orb = document.querySelector(".brain-orb");
  const oSpan = orb && name && cfg.brainAsO !== undefined ? chars.find((c) => c.textContent === "o") : null;
  if (oSpan) oSpan.dataset.noink = "";
  const placeOrb = () => {
    if (!oSpan) return;
    const r = oSpan.getBoundingClientRect();
    const p = row.getBoundingClientRect();
    const size = parseFloat(getComputedStyle(name).fontSize);
    orb.style.width = (size * 0.76).toFixed(1) + "px";
    orb.style.left = (r.left - p.left + r.width / 2).toFixed(1) + "px";
    orb.style.top = (r.top - p.top + r.height * 0.5 + size * 0.1).toFixed(1) + "px";
  };

  /* ---------- sand ---------- */
  let sandLayout = null;
  if (name && !reduced) {
    const BACK = 1150, OUT = 380, MAX_HOLES = 24;
    let PAD = 70, R = 26, K = 1;
    const canvas = document.createElement("canvas");
    canvas.className = "sand-canvas";
    canvas.setAttribute("aria-hidden", "true");
    row.appendChild(canvas);
    const ctx = canvas.getContext("2d");
    const glyph = document.createElement("canvas");
    const gctx = glyph.getContext("2d", { willReadFrequently: true });

    let dpr = 1, w = 0, h = 0, ink = null, sampledAt = 0;
    let grains = [], holes = [], lastPt = null, running = false, lastFrame = 0;
    const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

    sandLayout = () => {
      dpr = window.devicePixelRatio || 1;
      // the brush grows with the letters
      R = Math.max(26, parseFloat(getComputedStyle(name).fontSize) * 0.13);
      K = Math.min(3, (R / 26) * (R / 26));
      PAD = Math.round(R * 2.7);
      w = name.offsetWidth;
      h = name.offsetHeight;
      canvas.style.left = name.offsetLeft - PAD + "px";
      canvas.style.top = name.offsetTop - PAD + "px";
      canvas.style.width = w + PAD * 2 + "px";
      canvas.style.height = h + PAD * 2 + "px";
      canvas.width = Math.round((w + PAD * 2) * dpr);
      canvas.height = Math.round((h + PAD * 2) * dpr);
      sampledAt = 0;
    };

    // draw the letters as they are, so grains only come from ink
    const sample = () => {
      const cs = getComputedStyle(name);
      glyph.width = w;
      glyph.height = h;
      gctx.font = `${parseFloat(cs.fontWeight) || 500} ${parseFloat(cs.fontSize)}px ${cs.fontFamily}`;
      gctx.fillStyle = "#000";
      const box = name.getBoundingClientRect();
      for (const span of chars) {
        if (span.classList.contains("is-masked") || span.dataset.noink !== undefined) continue;
        const r = span.getBoundingClientRect();
        const m = gctx.measureText(span.textContent);
        const asc = m.fontBoundingBoxAscent;
        const desc = m.fontBoundingBoxDescent;
        const baseline = r.top - box.top + (r.height - (asc + desc)) / 2 + asc;
        gctx.fillText(span.textContent, r.left - box.left, baseline);
      }
      ink = gctx.getImageData(0, 0, w, h).data;
      sampledAt = performance.now();
    };

    const inkAt = (x, y) => {
      x = Math.round(x);
      y = Math.round(y);
      if (!ink || x < 0 || y < 0 || x >= w || y >= h) return false;
      return ink[(y * w + x) * 4 + 3] > 128;
    };

    const brush = (x, y, vx, vy) => {
      const now = performance.now();
      if (now - sampledAt > 150) sample();
      holes.push({ x, y, t: now });
      if (holes.length > MAX_HOLES) holes.shift();
      let made = 0;
      for (let i = 0; i < 90 * K && made < 26 * K; i++) {
        const a = Math.random() * Math.PI * 2;
        const d = Math.sqrt(Math.random()) * R * 0.85;
        const hx = x + Math.cos(a) * d;
        const hy = y + Math.sin(a) * d;
        if (!inkAt(hx, hy)) continue;
        const len = Math.hypot(hx - x, hy - y) || 1;
        const kick = (2.2 + Math.random() * 3.2) * Math.sqrt(K);
        grains.push({
          hx, hy, x: hx, y: hy, t: now,
          vx: ((hx - x) / len) * kick + vx * 0.25 + (Math.random() - 0.5),
          vy: ((hy - y) / len) * kick + vy * 0.25 + (Math.random() - 0.5) - 0.6,
          s: (Math.random() < 0.3 ? 2 : 1.4) * (K > 1.5 ? 1.5 : 1),
        });
        made++;
      }
      const cap = Math.round(1400 * K);
      if (grains.length > cap) grains.splice(0, grains.length - cap);
      if (!running) {
        running = true;
        lastFrame = performance.now();
        requestAnimationFrame(tick);
      }
    };

    const applyMask = (now) => {
      holes = holes.filter((hl) => now - hl.t < BACK);
      if (!holes.length) {
        name.style.webkitMaskImage = "";
        name.style.maskImage = "";
        return;
      }
      const layers = holes
        .map((hl) => {
          const age = now - hl.t;
          const r = Math.max(age < OUT ? R : R * (1 - ease((age - OUT) / (BACK - OUT))), 0.1);
          return `radial-gradient(circle ${r.toFixed(1)}px at ${hl.x.toFixed(1)}px ${hl.y.toFixed(1)}px, transparent ${(r * 0.8).toFixed(1)}px, #000 ${r.toFixed(1)}px)`;
        })
        .join(", ");
      name.style.webkitMaskImage = layers;
      name.style.webkitMaskComposite = "source-in";
      name.style.maskImage = layers;
      name.style.maskComposite = "intersect";
    };

    const tick = (now) => {
      const dt = Math.min(Math.max((now - lastFrame) / 16.67, 0), 3);
      lastFrame = now;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w + PAD * 2, h + PAD * 2);
      ctx.fillStyle = getComputedStyle(name).color;
      grains = grains.filter((g) => now - g.t < BACK);
      for (const g of grains) {
        const age = now - g.t;
        if (age < OUT) {
          const f = Math.pow(0.9, dt);
          g.vx *= f;
          g.vy = g.vy * f + 0.12 * dt;
          g.x += g.vx * dt;
          g.y += g.vy * dt;
        } else {
          if (g.ox === undefined) {
            g.ox = g.x;
            g.oy = g.y;
          }
          const p = ease(Math.min((age - OUT) / (BACK - OUT), 1));
          g.x = g.ox + (g.hx - g.ox) * p;
          g.y = g.oy + (g.hy - g.oy) * p;
        }
        ctx.fillRect(g.x + PAD - g.s / 2, g.y + PAD - g.s / 2, g.s, g.s);
      }
      applyMask(now);
      if (grains.length || holes.length) {
        requestAnimationFrame(tick);
      } else {
        running = false;
        ctx.clearRect(0, 0, w + PAD * 2, h + PAD * 2);
      }
    };

    document.addEventListener(
      "pointermove",
      (e) => {
        const box = name.getBoundingClientRect();
        const x = e.clientX - box.left;
        const y = e.clientY - box.top;
        if (x < -R || y < -R || x > box.width + R || y > box.height + R) {
          lastPt = null;
          return;
        }
        const vx = lastPt ? x - lastPt.x : 0;
        const vy = lastPt ? y - lastPt.y : 0;
        if (lastPt && Math.hypot(vx, vy) < 4) return;
        lastPt = { x, y };
        brush(x, y, vx, vy);
      },
      { passive: true }
    );

    // ?demo=1 sweeps a fake pointer through the line, so a still can show the sand
    if (new URLSearchParams(location.search).get("demo") === "1") {
      let t = 0;
      window.setInterval(() => {
        const box = name.getBoundingClientRect();
        t = (t + 0.03) % 1;
        const x = box.left + box.width * (0.06 + 0.88 * t);
        const y = box.top + box.height * (0.5 + 0.3 * Math.sin(t * 14));
        document.dispatchEvent(new PointerEvent("pointermove", { clientX: x, clientY: y, bubbles: true }));
      }, 28);
    }
  }

  const layoutAll = () => {
    fitName();
    if (sandLayout) sandLayout();
    placeOrb();
  };
  if (name) {
    window.addEventListener("resize", layoutAll);
    window.addEventListener("load", layoutAll);
    if (document.fonts) document.fonts.ready.then(layoutAll);
    layoutAll();
  }

  /* ---------- brain leans toward the pointer ---------- */
  if (orb && !reduced) {
    const MAX = 6;
    orb.addEventListener("pointermove", (e) => {
      const r = orb.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width;
      const py = (e.clientY - r.top) / r.height;
      orb.style.setProperty("--brain-tilt-y", ((px - 0.5) * MAX * 2).toFixed(2) + "deg");
      orb.style.setProperty("--brain-tilt-x", ((0.5 - py) * MAX * 2).toFixed(2) + "deg");
    });
    orb.addEventListener("pointerleave", () => {
      orb.style.setProperty("--brain-tilt-x", "0deg");
      orb.style.setProperty("--brain-tilt-y", "0deg");
    });
  }

  /* ---------- robot cursor ---------- */
  (() => {
    const BASE = "images/cursor/frames/robot-";
    const seq = (kind, n) => Array.from({ length: n }, (_, i) => `${BASE}${kind}-${String(i + 1).padStart(2, "0")}.png`);
    const sets = { idle: seq("idle", 10), run: seq("run", 8), aim: seq("aim", 4), attack: seq("attack", 8) };
    const timings = { idle: 120, run: 70, aim: 90, attack: 60 };
    const HOT = 4, RUN_DECAY = 140, ATTACK_MS = 320;
    const interactive = "a, button, [role='button'], input, select, textarea, summary, label";
    const setFrame = (src) => root.style.setProperty("--robot-cursor", `url("${src}") ${HOT} ${HOT}`);
    Object.values(sets).flat().forEach((src) => { new Image().src = src; });
    setFrame(sets.idle[0]);
    if (reduced) return;

    let state = "idle", index = 0, attackUntil = 0, lastMove = 0, lastX = null, lastY = null, over = false;
    const isOver = (t) => !!(t && typeof t.closest === "function" && t.closest(interactive));
    const choose = (now) => {
      if (now < attackUntil) return "attack";
      if (over) return "aim";
      if (now - lastMove <= RUN_DECAY) return "run";
      return "idle";
    };
    const tick = () => {
      const next = choose(performance.now());
      if (next !== state) { state = next; index = 0; }
      const frames = sets[state];
      setFrame(frames[index % frames.length]);
      index += 1;
      window.setTimeout(tick, timings[state]);
    };
    document.addEventListener("pointermove", (e) => {
      if (lastX !== null && Math.abs(e.clientX - lastX) + Math.abs(e.clientY - lastY) > 0) lastMove = performance.now();
      lastX = e.clientX;
      lastY = e.clientY;
      over = isOver(e.target);
    }, { passive: true });
    document.addEventListener("pointerover", (e) => { over = isOver(e.target); }, { passive: true });
    document.addEventListener("pointerout", (e) => { over = isOver(e.relatedTarget); }, { passive: true });
    document.addEventListener("pointerdown", () => { attackUntil = performance.now() + ATTACK_MS; });
    tick();
  })();

  /* ---------- click sparks ---------- */
  if (cfg.sparks !== undefined && !reduced) {
    const cv = document.createElement("canvas");
    cv.className = "spark-canvas";
    cv.setAttribute("aria-hidden", "true");
    body.appendChild(cv);
    const c = cv.getContext("2d");
    let ps = [], on = false, last = 0;
    const size = () => {
      const d = window.devicePixelRatio || 1;
      cv.width = Math.round(window.innerWidth * d);
      cv.height = Math.round(window.innerHeight * d);
      c.setTransform(d, 0, 0, d, 0, 0);
    };
    size();
    window.addEventListener("resize", size);
    const step = (now) => {
      const dt = Math.min((now - last) / 16.67, 3);
      last = now;
      c.clearRect(0, 0, window.innerWidth, window.innerHeight);
      ps = ps.filter((p) => now - p.t < p.life);
      for (const p of ps) {
        p.vy += 0.35 * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        c.fillStyle = p.c;
        c.fillRect(Math.round(p.x / 2) * 2, Math.round(p.y / 2) * 2, p.s, p.s);
      }
      if (ps.length) requestAnimationFrame(step);
      else on = false;
    };
    document.addEventListener("pointerdown", (e) => {
      const now = performance.now();
      const cols = (getComputedStyle(body).getPropertyValue("--sparks").trim() || "#d22a0b, #141414").split(",").map((s) => s.trim());
      for (let i = 0; i < 12; i++) {
        const a = Math.random() * Math.PI * 2;
        const v = 2 + Math.random() * 5;
        ps.push({ x: e.clientX, y: e.clientY, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 2, t: now, life: 380 + Math.random() * 260, s: Math.random() < 0.4 ? 6 : 4, c: cols[i % cols.length] });
      }
      if (!on) { on = true; last = now; requestAnimationFrame(step); }
    });
  }
})();
