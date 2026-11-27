/* The robot, Nov 22 2026 (Nyk's idea).
   The old robot cursor lives on the home page as a small character. A small language model
   downloads into the visitor's browser and runs there (WebLLM on WebGPU: no server, no API,
   nothing sent anywhere). From then on the model decides what the robot does. Each turn the
   page asks it two things (the words are in prompt.js): where to go and what to do there,
   and, once it has walked there, what to say, with the words written at that place in front
   of it. Each answer is held to a fixed shape, so a move is always one of the allowed ones:

     look   stand there               (faces the visitor)
     point  aim at the place          (turns to it; the place is ringed for a moment)
     zap    fire sparks at the place  (turns to it, squashes and flashes; sparks; the brain
                                       flicks to its letter)

   Its body (Nyk's choice, Nov 26 2026) is the bipedal robot from /Users/nyk/gemini/brain-cursor
   (robot_slices.png, classic palette: 27 slices of 24 x 22 pixels), drawn as a sprite stack by
   the brain cursor's engine, so it turns to where it walks and to what it points at.
   ?body=head brings back the LLM bot head it had before (llm_slices.png).

   It only goes to places the visitor can see, never follows a link, and visitors cannot
   type to it. Every word sent to the model is in prompt.js (approved by Nyk; change only
   with approval). The model and its size are Nyk's choice.

   Starting (Nyk's choice, Nov 22 2026): the model loads by itself a moment after the page
   has loaded, unless the browser reports data saver or a slow connection (only Chrome
   reports these), or this visitor stopped the robot last time. The label shows the size and
   the progress, and a click stops the download. Where it does not start by itself, a click
   starts it. A click on the awake robot puts it to sleep, as do a few minutes with no sign
   of the visitor. A visitor's stop is remembered in their browser until they click it awake.

   One reflex is not the model's: if a scroll leaves the robot off screen, it runs to the
   visitor's pointer before its next turn.

   window.robot.log holds its recent turns (what it was told, its raw answer, what it did).
   For tests only: a page may set window.__robotTestEngine = { decide(system, user, schema) }
   before the robot is woken; its speech is then marked as a stand-in, never as the model.
   A test may also set window.__robotPrompt to another wording (same exports as prompt.js),
   window.__robotModel to another WebLLM build, and change window.robot.sampling and
   window.robot.pace. */
import * as SITE_PROMPT from "./prompt.js";
import { loadSliceSheet, SpriteStackRenderer, computeStackBounds, turnFromVelocity, lerpAngle } from "../brain-cursor/sprite-stack.js";

// Nyk's pick, Nov 22 2026, after trying it in their own browser ("i like qwen"). Before that
// the robot ran on SmolLM2-360M-Instruct-q4f16_1-MLC (207 MB), which mostly said the page's
// text back; redesign/LOG.md has the runs of both and of Qwen3.5 0.8B.
const MODEL_ID = "Qwen3-0.6B-q4f16_1-MLC";
const MODEL_SIZE = "352 MB";                               // its download, shown on the label
// the name in the "Powered by" note under each line (Nykko's wording and look, Nov 26 2026)
const MODEL_NAMES = {
  "Qwen3-0.6B-q4f16_1-MLC": "Qwen3 0.6B",
  "Qwen3.5-0.8B-q4f16_1-MLC": "Qwen3.5 0.8B",
  "SmolLM2-360M-Instruct-q4f16_1-MLC": "SmolLM2 360M",
};
const WEBLLM = "https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@0.2.89/lib/index.js";
// the body: sheet, slice count and outline, as in each sheet's own settings
// (both from /Users/nyk/gemini/brain-cursor; the bipedal robot since Nov 26 2026, ?body=head for the old head)
const BODIES = {
  biped: { sheet: "./robot_slices.png", slices: 27, outline: "#16182a" },
  head: { sheet: "./llm_slices.png", slices: 20, outline: "#1a1426" },
};
const BODY = BODIES[new URLSearchParams(window.location.search).get("body")] || BODIES.biped;
const SHEET = new URL(BODY.sheet, import.meta.url).href;
const SLICES = BODY.slices;
// pixel scale, camera tilt, lift per slice and outline
const STACK = { scale: 2, squash: 0.75, spacing: 1.0, outline: BODY.outline, shadow: true };
const ZAP_MS = 480;            // how long a zap's squash and flash last
// rest between turns in ms, a multiplier on walking speed, and the reading time allowed per
// word of its line in ms (a long line stays up longer); tests hurry all three
const PACE = { pause: 3200, walk: 1, read: 260 };
const IDLE_SLEEP = 150000;     // back to sleep after this long with no sign of the visitor
const SPARKS = ["#e78fbf", "#d22a0b", "#141414"];
const REMEMBER = "robot-model-loaded";
const STOPPED = "robot-stopped";       // "1" in the visitor's browser after they stop the robot by a click, "0" after they wake it
const AUTO_DELAY = 1500;              // ms after the page has loaded before the model starts by itself
const LOG_MAX = 400;           // turns kept in window.robot.log
const SAMPLING = { temperature: 0.7, top_p: 0.9 };   // also at window.robot.sampling, so a test can try others

const squash = (s) => String(s || "").replace(/\s+/g, " ").trim();
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export async function loadModel(onProgress = () => {}, modelId = MODEL_ID, signal = null) {
  let worker = null, engine = null;
  // a stop (the visitor's click while it loads) ends the worker, and with it the download;
  // what was already fetched stays in the browser's cache for the next time
  const stopped = new Promise((_, reject) => {
    if (signal) signal.addEventListener("abort", () => { if (worker) worker.terminate(); reject(new Error("stopped")); }, { once: true });
  });
  stopped.catch(() => {});
  if (signal && signal.aborted) throw new Error("stopped");
  const webllm = await Promise.race([import(WEBLLM), stopped]);
  const start = async (progress) => {
    if (worker) worker.terminate();
    worker = new Worker(new URL("./worker.js", import.meta.url), { type: "module" });
    engine = await Promise.race([webllm.CreateWebWorkerMLCEngine(worker, modelId, {
      initProgressCallback: (r) => progress(r.progress || 0),
    }), stopped]);
  };
  await start(onProgress);
  const ask = async (system, user, schema, extra) => {
    const r = await engine.chat.completions.create({
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
      temperature: SAMPLING.temperature, top_p: SAMPLING.top_p, max_tokens: 80,
      ...(extra || {}),       // a wording may set sampling numbers for one of its questions
      response_format: { type: "json_object", schema: JSON.stringify(schema) },
    });
    return r.choices[0].message.content || "";
  };
  return {
    standIn: false,
    restarts: 0,
    async decide(system, user, schema, extra) {
      try { return await ask(system, user, schema, extra); }
      catch (e) {
        // WebLLM 0.2.89 gives out after it has built some 85 different answer shapes
        // ("GrammarMatcherInitError ... Aborted()", seen Nov 22 2026). The shapes are kept few
        // (schemaFor sorts its lists); if it happens anyway, start the worker afresh (the
        // model is already in the browser's cache, about a second) and ask once more.
        if (!/GrammarMatcherInit/.test(String(e))) throw e;     // it arrives from the worker as plain text
        this.restarts += 1;
        await start(() => {});
        return ask(system, user, schema, extra);
      }
    },
  };
}

export async function createRobot({ force = false, auto = true } = {}) {
  // offered only where the model can run: WebGPU with 16-bit shader floats
  if (!force) {
    if (!navigator.gpu) return null;
    let adapter = null;
    try { adapter = await navigator.gpu.requestAdapter(); } catch (e) { /* no WebGPU after all */ }
    if (!adapter || !adapter.features.has("shader-f16")) return null;
  }
  const content = document.querySelector("main");
  const homeEl = document.querySelector(".ticker");
  if (!content || !homeEl) return null;

  const css = document.createElement("link");
  css.rel = "stylesheet";
  css.href = new URL("./robot.css", import.meta.url).href;
  await new Promise((done) => { css.onload = done; css.onerror = done; document.head.appendChild(css); });
  let sheet = null;
  try { sheet = await loadSliceSheet(SHEET, SLICES); } catch (e) { console.error("robot:", e); return null; }

  /* ---------- body ---------- */
  const root = document.createElement("div");
  root.className = "robot";
  const bodyEl = document.createElement("button");
  bodyEl.type = "button";
  bodyEl.className = "robot-body";
  bodyEl.setAttribute("aria-label", "Robot run by a small language model. Click to wake it or put it to sleep.");
  const sprite = document.createElement("canvas");     // what is seen; the button is where a click lands
  sprite.className = "robot-sprite";
  const labelEl = document.createElement("span");
  labelEl.className = "robot-label";
  const sayEl = document.createElement("div");
  sayEl.className = "robot-say";
  sayEl.hidden = true;
  sayEl.setAttribute("aria-live", "polite");
  const sayText = document.createElement("p");
  const sayNote = document.createElement("small");
  const noteMove = document.createElement("span");     // what it is doing, on the left
  const noteBy = document.createElement("span");       // "Powered by" the model, on the right
  sayNote.append(noteMove, noteBy);
  sayEl.append(sayText, sayNote);
  root.append(sprite, bodyEl, labelEl, sayEl);
  document.body.appendChild(root);

  const pos = { x: 0, y: 0 };          // its feet, in page coordinates
  let facing = 1, anim = "idle", lastFit = 0;

  const fit = () => {
    // keep the label or the speech on screen and inside the page's own column
    const box = sayEl.hidden ? labelEl : sayEl;
    if (box.hidden) return;
    root.style.setProperty("--dx", "0px");
    root.classList.remove("below");
    let r = box.getBoundingClientRect();
    if (box === sayEl && r.top < 6) { root.classList.add("below"); r = box.getBoundingClientRect(); }
    const c = content.getBoundingClientRect();
    const lo = Math.max(8, c.left + 8), hi = Math.min(window.innerWidth - 8, c.right - 8);
    const dx = r.left < lo ? lo - r.left : r.right > hi ? hi - r.right : 0;
    root.style.setProperty("--dx", dx.toFixed(1) + "px");
  };
  const place = () => {
    root.style.transform = `translate(${pos.x.toFixed(1)}px, ${pos.y.toFixed(1)}px)`;
    const now = performance.now();
    if (now - lastFit > 100) { lastFit = now; fit(); }
  };
  const face = (dir) => { facing = dir; root.classList.toggle("left", dir < 0); };
  const setAnim = (a) => { anim = a; };

  /* ---------- its body: the bipedal robot, drawn as a sprite stack about 30 times a second ---------- */
  // It faces the way it walks (with a small hop), turns to what it points at or zaps (a zap
  // squashes it and flashes it white), and otherwise faces the visitor, looking about a little.
  const renderer = new SpriteStackRenderer();
  const S = STACK.scale;
  const bounds = computeStackBounds(sheet, Math.max(STACK.spacing, 2.5), Math.max(STACK.squash, 1));
  sprite.width = bounds.width * S;
  sprite.height = bounds.height * S;
  const ink = sprite.getContext("2d");
  const foot = Math.round((sheet.sliceHeight / 2) * STACK.squash) * S;   // so its base stands on its feet
  sprite.style.left = `${-bounds.anchorX * S}px`;
  sprite.style.top = `${-bounds.anchorY * S - foot}px`;
  let turn = 0, heading = 0, aimAt = null, zapAt = -1e9, drawnAt = 0;
  const forward = () => ({ x: -Math.sin(turn), y: Math.cos(turn) });    // the way its screen faces
  const draw = (now) => {
    window.requestAnimationFrame(draw);
    if (now - drawnAt < 32) return;
    drawnAt = now;
    const want = anim === "run" ? heading
      : aimAt ? turnFromVelocity(aimAt.x - pos.x, aimAt.y - pos.y)
      : Math.sin(now / 1400) * 0.35;
    turn = lerpAngle(turn, want, anim === "run" ? 0.3 : 0.16);
    const z = (now - zapAt) / ZAP_MS;
    const zapping = z >= 0 && z < 1;
    const hop = anim === "run" ? Math.round(Math.abs(Math.sin(now / 95)) * 3) * S : 0;
    ink.clearRect(0, 0, sprite.width, sprite.height);
    renderer.draw(ink, sheet, { x: bounds.anchorX * S, y: bounds.anchorY * S - hop }, turn, {
      ...STACK,
      squash: zapping ? STACK.squash * (1 - 0.3 * Math.sin(z * Math.PI)) : STACK.squash,
      flash: zapping ? 0.7 * (1 - z) : 0,
    });
  };
  window.requestAnimationFrame(draw);

  const setLabel = (text) => {
    labelEl.hidden = !text;
    labelEl.textContent = text || "";
    if (text) sayEl.hidden = true;
    fit();
  };
  const showSay = (text, move) => {
    labelEl.hidden = true;
    sayText.textContent = text;
    sayText.hidden = !text;
    noteMove.textContent = move || "";
    noteBy.textContent = !engine ? ""
      : engine.standIn ? "test stand-in, not the model"
      : `Powered by ${MODEL_NAMES[modelInUse()] || modelInUse()}`;
    sayNote.hidden = !noteMove.textContent && !noteBy.textContent;
    sayEl.hidden = !text && sayNote.hidden;
    // a longer line gets a wider box
    sayEl.classList.toggle("long", !!text && text.length > 70 && text.length <= 170);
    sayEl.classList.toggle("longer", !!text && text.length > 170);
    fit();
  };

  /* ---------- waits that a scroll or a click can cut short ---------- */
  let cut = null;
  const pause = (ms) => new Promise((done) => {
    const end = () => { window.clearTimeout(t); if (cut === end) cut = null; done(); };
    const t = window.setTimeout(end, ms);
    cut = end;
  });

  /* ---------- moving ---------- */
  let token = 0;                       // changes whenever the robot is woken or put to sleep
  let shiftY = 0;                      // how far the page has moved under it (the name intro, below)
  const walkTo = (tx, ty0, mine) => new Promise((done) => {
    const s0 = shiftY;
    let ty = ty0;
    const total = Math.hypot(tx - pos.x, ty - pos.y);
    if (total < 6) { done(); return; }
    const speed = Math.max(300, total / 2.4) * PACE.walk;
    if (Math.abs(tx - pos.x) > 4) face(tx > pos.x ? 1 : -1);
    heading = turnFromVelocity(tx - pos.x, ty - pos.y);
    setAnim("run");
    let last = performance.now();
    const step = (now) => {
      if (token !== mine) { done(); return; }
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      ty = ty0 + shiftY - s0;            // the spot moves with the page
      const dx = tx - pos.x, dy = ty - pos.y, d = Math.hypot(dx, dy), s = speed * dt;
      if (d <= s) {
        pos.x = tx; pos.y = ty;
        place(); setAnim("idle"); fit(); done();
        return;
      }
      pos.x += (dx / d) * s; pos.y += (dy / d) * s;
      place();
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
  const sparks = (x, y) => {
    for (let i = 0; i < 14; i++) {
      const s = document.createElement("i");
      const size = Math.random() < 0.4 ? 6 : 4;
      s.className = "robot-spark";
      s.style.width = s.style.height = size + "px";
      s.style.background = SPARKS[i % SPARKS.length];
      document.body.appendChild(s);
      const a = Math.random() * Math.PI * 2, v = 30 + Math.random() * 70;
      const dx = Math.cos(a) * v, dy = Math.sin(a) * v - 20;
      const fly = s.animate([
        { transform: `translate(${x}px, ${y}px)`, opacity: 1 },
        { transform: `translate(${x + dx * 0.7}px, ${y + dy * 0.7}px)`, opacity: 1, offset: 0.6 },
        { transform: `translate(${x + dx}px, ${y + dy + 26}px)`, opacity: 0 },
      ], { duration: 420 + Math.random() * 260, easing: "ease-out", fill: "forwards" });
      fly.onfinish = () => s.remove();
    }
  };

  /* ---------- the places it knows ---------- */
  const q = (sel) => document.querySelector(sel);
  const ledgers = Array.from(document.querySelectorAll(".ledger"));
  const plain = ledgers.filter((l) => !l.classList.contains("poster"));
  const words = (el) => squash(el.textContent);
  const linkNames = (el, attr) => Array.from(el.querySelectorAll("a"))
    .map((a) => (attr ? a.getAttribute(attr) : squash(a.textContent))).filter(Boolean).join(", ");
  // el: where it stands and what is ringed; hit: what counts as that place under the pointer;
  // at: the spot it stands on, as shares of el's box; spread: how far that spot wanders sideways
  const PLACES = [
    { key: "name", el: q(".name-row h1"), hit: q(".name-row"), at: [0.5, 0.45], spread: 0.3, says: (el) => el.getAttribute("aria-label") || words(el) },
    { key: "brain", el: q(".brain-orb"), at: [0.02, 0.96], spread: 0, says: (el) => words(el.querySelector(".brain-tooltip") || el) },
    { key: "focus", el: q(".ticker"), at: [0.5, 0], spread: 0.32, says: words },
    { key: "bio", el: q(".bio"), at: [0.4, 0], spread: 0.3, says: words },
    { key: "photo", el: q(".face img"), hit: q(".face"), at: [0.5, 0], spread: 0.25, says: (el) => el.alt },
    { key: "papers", el: plain[0], at: [0.55, 0], spread: 0.3, says: words },
    { key: "poster", el: ledgers.find((l) => l.classList.contains("poster")), at: [0.4, 0], spread: 0.2, says: words },
    { key: "projects", el: plain.length > 1 ? plain[plain.length - 1] : null, at: [0.55, 0], spread: 0.3, says: words },
    { key: "links", el: q(".rail-r"), at: [-0.75, 0.5], spread: 0, says: (el) => linkNames(el, "aria-label") },
    { key: "menu", el: q(".rail-l"), at: [1.75, 0.3], spread: 0, says: (el) => linkNames(el) },
  ].filter((p) => p.el);
  const placeByKey = (key) => PLACES.find((p) => p.key === key);

  const pointer = { x: 0, y: 0, inside: false };
  let lastSeen = performance.now();
  const sawVisitor = () => { lastSeen = performance.now(); };
  const trackPointer = (e) => { pointer.x = e.clientX; pointer.y = e.clientY; pointer.inside = true; sawVisitor(); };
  document.addEventListener("pointermove", trackPointer, { passive: true });
  document.addEventListener("pointerdown", trackPointer, { passive: true });
  document.documentElement.addEventListener("pointerleave", () => { pointer.inside = false; });
  document.addEventListener("keydown", sawVisitor, { passive: true });

  const seen = (el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.bottom > 60 && r.top < window.innerHeight - 60 && r.right > 30 && r.left < window.innerWidth - 30;
  };
  const inView = () => {
    const x = pos.x - window.scrollX, y = pos.y - window.scrollY;
    return x > 0 && x < window.innerWidth && y > 40 && y < window.innerHeight + 20;
  };
  const underPointer = () => {
    if (!pointer.inside) return "off the page";
    const el = document.elementFromPoint(pointer.x, pointer.y);
    if (!el) return "empty space";
    if (root.contains(el)) return "you";
    const p = PLACES.find((pl) => (pl.hit || pl.el).contains(el));
    return p ? p.key : "empty space";
  };
  // the spot to stand on, kept where the visitor can see it; page coordinates
  const spotFor = (key) => {
    let x, y;
    if (key === "visitor") {
      x = pointer.x + (pointer.x > 110 ? -46 : 46);
      y = pointer.y + 30;
    } else {
      const p = placeByKey(key);
      const r = p.el.getBoundingClientRect();
      x = r.left + r.width * (p.at[0] + (Math.random() * 2 - 1) * p.spread);
      y = r.top + r.height * p.at[1];
    }
    return {
      x: clamp(x, 40, window.innerWidth - 40) + window.scrollX,
      y: clamp(y, 72, window.innerHeight - 6) + window.scrollY,
    };
  };
  const centreOf = (key) => {
    if (key === "visitor") return { x: pointer.x + window.scrollX, y: pointer.y + window.scrollY };
    const r = placeByKey(key).el.getBoundingClientRect();
    return { x: r.left + r.width / 2 + window.scrollX, y: r.top + r.height / 2 + window.scrollY };
  };
  const home = () => {
    const r = homeEl.getBoundingClientRect();
    return { x: r.right - 58 + window.scrollX, y: r.top + 2 + window.scrollY };
  };

  /* ---------- one turn: tell the model, read its answer, do it ---------- */
  let at = "focus";                    // it sleeps standing on the Current Focus bar
  const moves = [];
  const log = [];
  let engine = null, state = "asleep";
  const prompt = () => window.__robotPrompt || SITE_PROMPT;
  const modelInUse = () => window.__robotModel || MODEL_ID;     // a test may name another WebLLM build
  const moveName = (a) => (a.do === "rest" ? "rest" : `${a.do} ${a.where}`);   // a rest has no place

  const observe = () => {
    const onScreen = PLACES.filter((p) => seen(p.el)).map((p) => p.key);
    if (pointer.inside) onScreen.push("visitor");
    return { at, says: wordsAt(at), onScreen, pointer: underPointer(), moves: moves.slice() };
  };
  // The answer is held to the same choices the words of the turn list. The lists are sorted
  // here (their order means nothing to the shape) so that few different shapes are ever built.
  const sorted = (list) => (PACE.rawShapes ? list : list.slice().sort());
  const schemaFor = (dos, places, withSay) => {
    const parts = { do: { type: "string", enum: sorted(dos) }, where: { type: "string", enum: sorted(places) } };
    if (withSay) parts.say = { type: "string" };
    // the parts come in the order the wording names them (a wording may give its own ORDER)
    const order = (prompt().ORDER || ["do", "where", "say"]).filter((k) => parts[k]);
    const properties = {};
    order.forEach((k) => { properties[k] = parts[k]; });
    return { type: "object", properties, required: order };
  };
  const SAY_SHAPE = { type: "object", properties: { say: { type: "string" } }, required: ["say"] };
  const part = (raw, k) => {
    // for an answer cut off before its closing brace: take what is there
    const m = raw.match(new RegExp(`"${k}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)`));
    return m ? m[1] : "";
  };
  const tidy = (line) => {
    // its line is shown whole (Nyk, Nov 22 2026: no cutting it short); only a stray control
    // mark and anything after it is left off
    return squash(String(line || "").split("<|")[0]);
  };
  const read = (raw, dos, places) => {
    let o = null;
    try { o = JSON.parse(raw); } catch (e) { o = { do: part(raw, "do"), where: part(raw, "where"), say: part(raw, "say") }; }
    if (!o || !dos.includes(o.do) || !places.includes(o.where)) return null;
    return { do: o.do, where: o.where, say: tidy(o.say) };
  };
  const readSay = (raw) => {
    try { return tidy(JSON.parse(raw).say); } catch (e) {
      // the answer ran into the length limit before it closed: show what there is, with a mark
      const t = tidy(part(raw, "say").replace(/\\n/g, " ").replace(/\\(["\\/])/g, "$1"));
      return t ? t + "…" : t;
    }
  };
  const wordsAt = (key) => {
    const here = placeByKey(key);
    let says = here ? squash(here.says(here.el)).replace(/"/g, "'") : "";
    if (says.length > 120) says = says.slice(0, 117).trimEnd() + "...";
    return says;
  };
  // A wording may ask for the line in a second question, put once the robot has arrived
  // (its speak() gives the words); otherwise the line comes with the move.
  const act = async (a, mine, entry) => {
    const P = prompt();
    const note = moveName(a);
    showSay(P.speak ? "" : a.say, note);
    if (a.do === "rest") return;
    const spot = spotFor(a.where);
    await walkTo(spot.x, spot.y, mine);
    if (token !== mine) return;
    at = a.where;
    const c = centreOf(a.where);
    if (Math.abs(c.x - pos.x) > 8) face(c.x > pos.x ? 1 : -1);
    if (P.speak) {
      const s = P.speak({ at, says: wordsAt(at), did: moveName(a), do: a.do, pointer: underPointer() });
      const t0 = performance.now();
      let raw = "";
      try { raw = await engine.decide(s.system, s.user, SAY_SHAPE, s.sampling); }
      catch (e) { console.error("robot:", e); entry.sayError = String(e); }
      if (token !== mine) return;
      a.say = readSay(raw);
      Object.assign(entry, { sayPrompt: s.user, sayRaw: raw, sayMs: Math.round(performance.now() - t0) });
      showSay(a.say, note);
    }
    if (a.do === "point") {
      const el = a.where === "visitor" ? null : placeByKey(a.where).el;
      setAnim("aim");
      aimAt = c;
      if (el) el.classList.add("robot-pointed");
      await pause(1600);
      if (el) el.classList.remove("robot-pointed");
      aimAt = null;
      setAnim("idle");
    } else if (a.do === "zap") {
      setAnim("attack");
      aimAt = c;
      await pause(350);                    // turns to it first
      zapAt = performance.now();
      await pause(ZAP_MS);
      aimAt = null;
      setAnim("idle");
      if (token !== mine) return;
      const f = forward();
      sparks(pos.x + f.x * 30, pos.y - 34 + f.y * 14);
      if (a.where === "brain") sparks(c.x, c.y);
      document.dispatchEvent(new CustomEvent("robot:zap", { detail: { where: a.where } }));
    }
  };

  const doze = (label) => {
    state = "asleep";
    token += 1;
    if (cut) cut();
    document.querySelectorAll(".robot-pointed").forEach((el) => el.classList.remove("robot-pointed"));
    aimAt = null;
    setLabel(label || "CLICK TO WAKE");
    const h = home();
    at = "focus";
    walkTo(h.x, h.y, token).then(() => { face(1); fit(); });
  };
  const run = async (mine) => {
    let misses = 0;
    while (state === "awake" && token === mine) {
      if (document.hidden) { await pause(1000); continue; }
      if (performance.now() - lastSeen > IDLE_SLEEP) { doze(); return; }
      if (!inView() && pointer.inside) {
        // left behind by a scroll: run to the visitor (the one move that is not the model's)
        const spot = spotFor("visitor");
        await walkTo(spot.x, spot.y, mine);
        if (token !== mine) return;
        at = "visitor";
      }
      const { user, dos, places } = prompt().frame(observe());
      if (!places.length) { await pause(1500); continue; }     // nowhere to pick: wait for the page to change
      const t0 = performance.now();
      let raw = "";
      try { raw = await engine.decide(prompt().SYSTEM, user, schemaFor(dos, places, !prompt().speak)); }
      catch (e) {
        // one failed answer is a miss, like an unreadable one; three in a row and it goes back to sleep
        console.error("robot:", e);
        if (state !== "awake" || token !== mine) return;
        log.push({ prompt: user, dos, places, raw: "", action: null, ms: Math.round(performance.now() - t0), error: String(e) });
        if (log.length > LOG_MAX) log.shift();
        misses += 1;
        if (misses >= 3) { doze(); return; }
        await pause(1200);
        continue;
      }
      if (state !== "awake" || token !== mine) return;
      const action = read(raw, dos, places);
      const entry = { prompt: user, dos, places, raw, action, ms: Math.round(performance.now() - t0) };
      log.push(entry);
      if (log.length > LOG_MAX) log.shift();
      if (!action) {
        misses += 1;
        if (misses >= 3) { doze(); return; }
        await pause(1200);
        continue;
      }
      misses = 0;
      moves.push(moveName(action));
      if (moves.length > 12) moves.shift();
      await act(action, mine, entry);
      if (token !== mine) return;
      const words = action.say ? action.say.split(" ").length : 0;
      await pause(Math.max(PACE.pause, words * PACE.read));     // time to read what it said
    }
  };
  const stored = (key) => { try { return window.localStorage.getItem(key); } catch (e) { return null; } };
  const store = (key, value) => { try { window.localStorage.setItem(key, value); } catch (e) { /* storage off: nothing is remembered */ } };
  let cached = stored(REMEMBER) === MODEL_ID;      // this browser has loaded the model before
  const sleepLabel = () => (cached ? "CLICK TO WAKE" : `CLICK TO WAKE · ${MODEL_SIZE}`);
  let loadStop = null;                             // set while the model is loading
  const wake = async () => {
    if (state !== "asleep") return;
    state = "loading";
    sawVisitor();
    try {
      if (!engine) {
        if (window.__robotTestEngine) engine = Object.assign({ standIn: true }, window.__robotTestEngine);
        else {
          loadStop = new AbortController();
          const size = cached ? "" : ` ${MODEL_SIZE} ·`;
          const show = (p) => { if (state === "loading") setLabel(`LOADING${size} ${Math.round(p * 100)}% · CLICK TO STOP`); };
          show(0);
          engine = await loadModel(show, modelInUse(), loadStop.signal);
          loadStop = null;
          cached = modelInUse() === MODEL_ID;
          if (cached) store(REMEMBER, MODEL_ID);
        }
      }
    } catch (e) {
      const stoppedByVisitor = !!(loadStop && loadStop.signal.aborted);
      loadStop = null;
      state = "asleep";
      if (stoppedByVisitor) { setLabel(sleepLabel()); return; }
      console.error("robot:", e);
      setLabel("COULD NOT START");
      return;
    }
    state = "awake";
    token += 1;
    const mine = token;
    showSay(prompt().FIRST_LINE, "");
    await pause(Math.min(3600, PACE.pause + 400));
    if (token === mine) run(mine);
  };
  // a click wakes it, stops a download under way, or puts it to sleep; a stop is remembered,
  // so it does not start by itself again in this browser until the visitor wakes it
  bodyEl.addEventListener("click", () => {
    if (state === "asleep") { store(STOPPED, "0"); wake(); }
    else if (state === "loading" && loadStop) { store(STOPPED, "1"); loadStop.abort(); }
    else if (state === "awake") { store(STOPPED, "1"); doze(); }
  });

  /* ---------- keeping its place as the page changes ---------- */
  const settle = () => {
    if (state === "awake") { fit(); return; }
    const h = home();
    pos.x = h.x; pos.y = h.y;
    place();
    fit();
  };
  let scrollTimer = 0;
  window.addEventListener("scroll", () => {
    sawVisitor();
    window.clearTimeout(scrollTimer);
    scrollTimer = window.setTimeout(() => {
      fit();
      if (state === "awake" && !inView() && cut) cut();
    }, 250);
  }, { passive: true });
  // the home page's name intro (site.js) ends by taking out the space the giant name held and
  // scrolling up by as much, so everything on the page moves up by that in page coordinates
  document.addEventListener("intro:done", (e) => {
    const dy = (e.detail && e.detail.dy) || 0;
    if (!dy) return;
    shiftY += dy;
    pos.y += dy;
    if (aimAt) aimAt = { x: aimAt.x, y: aimAt.y + dy };
    place();
    settle();
  });
  window.addEventListener("resize", settle);
  window.addEventListener("load", settle);
  if (document.fonts) document.fonts.ready.then(settle);
  if (window.ResizeObserver) new ResizeObserver(settle).observe(content);

  setLabel(sleepLabel());
  settle();

  /* ---------- starting by itself ---------- */
  const connectionAllows = () => {
    const c = navigator.connection;
    if (!c) return true;                                   // Safari and Firefox do not say
    if (c.saveData) return false;
    // Chrome sorts connections into slow-2g, 2g, 3g and 4g; only its top class starts by
    // itself. Its speed number (downlink) is not used: it read 1.75 Mbps here on a line
    // that fetched 207 MB in 9 seconds.
    return !(c.effectiveType && c.effectiveType !== "4g");
  };
  const willStart = auto && stored(STOPPED) !== "1" && connectionAllows();
  if (willStart) {
    const begin = () => {
      if (state !== "asleep") return;
      // not for a tab nobody is looking at
      if (document.hidden) { document.addEventListener("visibilitychange", begin, { once: true }); return; }
      wake();
    };
    const soon = () => window.setTimeout(begin, AUTO_DELAY);
    if (document.readyState === "complete") soon(); else window.addEventListener("load", soon, { once: true });
  }

  const api = {
    log, wake, doze, state: () => state, model: MODEL_ID, modelInUse, sampling: SAMPLING, pace: PACE, prompt,
    willStart,                                             // whether it starts by itself on this visit
    restarts: () => (engine && engine.restarts) || 0,
    places: () => PLACES.map((p) => ({ key: p.key, says: wordsAt(p.key) })),   // for tests of the wording
  };
  window.robot = api;
  return api;
}
