/**
 * Drop-in Sprite-Stacked 3D Pixel-Art Brain Cursor for Websites & Clickers.
 *
 * Usage:
 *   import { createBrainCursor } from './src/brain-cursor.js';
 *   const cursor = await createBrainCursor({
 *     sheetUrl: './assets/brain_slices.png',
 *     count: 18,
 *   });
 */

import {
  DEFAULT_SPACING,
  DEFAULT_SQUASH,
  SpriteStackRenderer,
  lerpAngle,
  loadSliceSheet,
  turnFromVelocity,
} from './sprite-stack.js';

const CURSOR_STYLE_ID = 'brain-stack-cursor-hide-native';

export class BrainCursor {
  constructor(options = {}) {
    this.options = {
      sheetUrl: options.sheetUrl ?? './assets/brain_slices.png',
      count: options.count ?? 18,
      scale: options.scale ?? 2,
      squash: options.squash ?? DEFAULT_SQUASH,
      spacing: options.spacing ?? DEFAULT_SPACING,
      sampling: options.sampling ?? 'nearest', // 'nearest' | 'rotsprite'
      outline: options.outline !== undefined ? options.outline : '#2e1026',
      shadow: options.shadow ?? true,
      hideNativeCursor: options.hideNativeCursor ?? true,
      idleSpin: options.idleSpin ?? true,
      idleDelayMs: options.idleDelayMs ?? 450,
      idleSpinSpeed: options.idleSpinSpeed ?? 0.95, // rad/s
      turnMode: options.turnMode ?? 'velocity', // 'velocity' | 'spin' | 'manual'
      manualTurn: options.manualTurn ?? 0,
      clickSparks: options.clickSparks ?? true,
      sparkColors: options.sparkColors ?? ['#ff9ec4', '#ffe478', '#7ef2ff', '#ffffff'],
      zIndex: options.zIndex ?? 2147483647,
      enableDebugKey: options.enableDebugKey ?? true,
      onStateChange: options.onStateChange ?? null,
      // Added for nykkovitali.com: where the brain sits relative to the pointer
      // (0, 0 = on it), and whether a small square marks the exact point over links.
      offsetX: options.offsetX ?? 0,
      offsetY: options.offsetY ?? 0,
      hotspotMark: options.hotspotMark ?? true,
    };

    this.sheet = null;
    this.renderer = new SpriteStackRenderer();
    this.canvas = null;
    this.ctx = null;

    // Pointer & kinematics state (positions snapped to whole pixels on draw)
    this.visible = false;
    this.mouseX = -200;
    this.mouseY = -200;
    this.posX = -200;
    this.posY = -200;
    this.vx = 0;
    this.vy = 0;
    this.turn = 0;
    this.targetTurn = 0;
    this.lastMoveTime = performance.now();
    this.idleBlend = 0;
    this.hoveringInteractive = false;

    // Click squish/pop spring state
    this.pointerDown = false;
    this.squishOffset = 0;     // modifies spacing dynamically
    this.squishVel = 0;
    this.flash = 0;
    this.sparks = [];

    // Debug preset cycle index (for spec's debug key check)
    this._debugPresetIndex = 0;
    this._rafId = null;
    this._lastFrameTime = performance.now();
    this._destroyed = false;

    // Bound event handlers
    this._onPointerMove = this._onPointerMove.bind(this);
    this._onPointerDown = this._onPointerDown.bind(this);
    this._onPointerUp = this._onPointerUp.bind(this);
    this._onPointerLeave = this._onPointerLeave.bind(this);
    this._onResize = this._onResize.bind(this);
    this._onKeyDown = this._onKeyDown.bind(this);
    this._loop = this._loop.bind(this);
  }

  async init() {
    this.sheet = await loadSliceSheet(this.options.sheetUrl, this.options.count);
    this._mountCanvas();
    this._applyNativeCursorRule();
    this._bindEvents();
    this._lastFrameTime = performance.now();
    this._rafId = requestAnimationFrame(this._loop);
    return this;
  }

  async setSheet(sheetUrl, count = this.options.count, outline = this.options.outline) {
    this.options.sheetUrl = sheetUrl;
    this.options.count = count;
    if (outline !== undefined) this.options.outline = outline;
    this.sheet = await loadSliceSheet(sheetUrl, count);
    this._notifyState();
  }

  setOptions(patch) {
    Object.assign(this.options, patch);
    if ('hideNativeCursor' in patch) {
      this._applyNativeCursorRule();
    }
    this._notifyState();
  }

  getState() {
    return {
      ...this.options,
      turn: this.turn,
      turnDeg: Math.round(((this.turn * 180) / Math.PI + 360) % 360),
      posX: Math.round(this.posX),
      posY: Math.round(this.posY),
      sheetWidth: this.sheet?.width ?? 0,
      sheetHeight: this.sheet?.height ?? 0,
      sliceWidth: this.sheet?.sliceWidth ?? 0,
      sliceHeight: this.sheet?.sliceHeight ?? 0,
    };
  }

  /**
   * Cycles key verification presets (squash/spacing/turn) when Debug hotkey is pressed.
   */
  cycleDebugPreset() {
    const presets = [
      { label: 'Default (squash 0.75, spacing 1)', squash: 0.75, spacing: 1.0, turnMode: 'velocity' },
      { label: 'Straight Down (squash 1, turn 0)', squash: 1.0, spacing: 1.0, turnMode: 'manual', manualTurn: 0 },
      { label: '90° Side (squash 1, turn 90°)', squash: 1.0, spacing: 1.0, turnMode: 'manual', manualTurn: Math.PI / 2 },
      { label: 'Tall Stack (squash 0.75, spacing 2)', squash: 0.75, spacing: 2.0, turnMode: 'velocity' },
      { label: 'Flat Stack (squash 1, spacing 0)', squash: 1.0, spacing: 0.0, turnMode: 'manual', manualTurn: 0 },
    ];
    this._debugPresetIndex = (this._debugPresetIndex + 1) % presets.length;
    const preset = presets[this._debugPresetIndex];
    this.setOptions({
      squash: preset.squash,
      spacing: preset.spacing,
      turnMode: preset.turnMode,
      ...(preset.manualTurn !== undefined ? { manualTurn: preset.manualTurn } : {}),
    });
    return preset;
  }

  triggerClickPop(x = this.mouseX, y = this.mouseY) {
    this.squishVel = 5.5;
    this.flash = 0.65;
    if (this.options.clickSparks) {
      this._spawnSparks(x, y, 8);
    }
  }

  destroy() {
    this._destroyed = true;
    if (this._rafId) cancelAnimationFrame(this._rafId);
    window.removeEventListener('pointermove', this._onPointerMove);
    window.removeEventListener('pointerdown', this._onPointerDown);
    window.removeEventListener('pointerup', this._onPointerUp);
    document.removeEventListener('pointerleave', this._onPointerLeave);
    document.documentElement.removeEventListener('mouseleave', this._onPointerLeave);
    window.removeEventListener('resize', this._onResize);
    window.removeEventListener('keydown', this._onKeyDown);
    if (this.canvas && this.canvas.parentNode) {
      this.canvas.parentNode.removeChild(this.canvas);
    }
    const styleEl = document.getElementById(CURSOR_STYLE_ID);
    if (styleEl) styleEl.remove();
  }

  _mountCanvas() {
    const canvas = document.createElement('canvas');
    canvas.setAttribute('aria-hidden', 'true');
    canvas.dataset.brainCursor = 'true';
    Object.assign(canvas.style, {
      position: 'fixed',
      inset: '0',
      width: '100vw',
      height: '100vh',
      pointerEvents: 'none',
      zIndex: String(this.options.zIndex),
      imageRendering: 'pixelated',
    });
    document.body.appendChild(canvas);
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this._onResize();
  }

  _applyNativeCursorRule() {
    let styleEl = document.getElementById(CURSOR_STYLE_ID);
    if (this.options.hideNativeCursor && this.visible) {
      if (!styleEl) {
        styleEl = document.createElement('style');
        styleEl.id = CURSOR_STYLE_ID;
        styleEl.textContent = `
          html.brain-cursor-active,
          html.brain-cursor-active * {
            cursor: none !important;
          }
        `;
        document.head.appendChild(styleEl);
      }
      document.documentElement.classList.add('brain-cursor-active');
    } else {
      document.documentElement.classList.remove('brain-cursor-active');
    }
  }

  _bindEvents() {
    window.addEventListener('pointermove', this._onPointerMove, { passive: true });
    window.addEventListener('pointerdown', this._onPointerDown, { passive: true });
    window.addEventListener('pointerup', this._onPointerUp, { passive: true });
    document.addEventListener('pointerleave', this._onPointerLeave, { passive: true });
    // Added for nykkovitali.com: the document itself never gets pointerleave, so the
    // brain stayed behind at the edge when the mouse left the window.
    document.documentElement.addEventListener('mouseleave', this._onPointerLeave, { passive: true });
    window.addEventListener('resize', this._onResize, { passive: true });
    window.addEventListener('keydown', this._onKeyDown);
  }

  _onResize() {
    if (!this.canvas) return;
    // Keep 1:1 CSS pixel buffer so integer `scale` stays crisp and whole-pixel aligned
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;
  }

  _onPointerMove(e) {
    if (e.pointerType === 'touch') {
      this.visible = false;
      this._applyNativeCursorRule();
      return;
    }

    const nx = e.clientX;
    const ny = e.clientY;

    if (!this.visible) {
      this.visible = true;
      this.posX = nx;
      this.posY = ny;
      this._applyNativeCursorRule();
    }

    const dx = nx - this.mouseX;
    const dy = ny - this.mouseY;
    this.mouseX = nx;
    this.mouseY = ny;

    // Smooth velocity tracking for natural heading without micro-jitter
    this.vx = this.vx * 0.45 + dx * 0.55;
    this.vy = this.vy * 0.45 + dy * 0.55;

    const speed = Math.hypot(this.vx, this.vy);
    if (speed > 1.4) {
      this.targetTurn = turnFromVelocity(this.vx, this.vy);
      this.lastMoveTime = performance.now();
    }

    const el = e.target;
    this.hoveringInteractive = Boolean(
      el && typeof el.closest === 'function' && el.closest('button, a, input, select, [data-clickable]')
    );
  }

  _onPointerDown(e) {
    if (e.pointerType === 'touch') return;
    this.mouseX = e.clientX;
    this.mouseY = e.clientY;
    this.pointerDown = true;
    this.squishOffset = -0.45;
    this.squishVel = -2.2;
    this.flash = 0.55;
  }

  _onPointerUp(e) {
    if (e.pointerType === 'touch') return;
    this.pointerDown = false;
    this.triggerClickPop(e.clientX, e.clientY);
  }

  _onPointerLeave() {
    this.visible = false;
    this.pointerDown = false;
  }

  _onKeyDown(e) {
    if (!this.options.enableDebugKey) return;
    if (e.target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
    if (e.key === 'c' && e.shiftKey) {
      this.setOptions({ hideNativeCursor: !this.options.hideNativeCursor });
    }
  }

  _spawnSparks(x, y, count) {
    const colors = this.options.sparkColors;
    const scale = Math.max(1, Math.round(this.options.scale));
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.45;
      const speed = 70 + Math.random() * 115;
      this.sparks.push({
        x: Math.round(x),
        y: Math.round(y),
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 25,
        life: 0.28 + Math.random() * 0.16,
        maxLife: 0.42,
        size: scale * (Math.random() > 0.45 ? 2 : 1),
        color: colors[i % colors.length],
      });
    }
  }

  _notifyState() {
    if (typeof this.options.onStateChange === 'function') {
      this.options.onStateChange(this.getState());
    }
  }

  _loop(now) {
    if (this._destroyed) return;
    const dt = Math.min(0.05, Math.max(0.001, (now - this._lastFrameTime) / 1000));
    this._lastFrameTime = now;

    this._update(dt, now);
    this._render();
    this._rafId = requestAnimationFrame(this._loop);
  }

  _update(dt, now) {
    // Crisp snappy pointer follow (tight response so clicking feels instant)
    const follow = 1 - Math.exp(-38 * dt);
    this.posX += (this.mouseX - this.posX) * follow;
    this.posY += (this.mouseY - this.posY) * follow;

    // Velocity decay when cursor stops
    this.vx *= Math.exp(-14 * dt);
    this.vy *= Math.exp(-14 * dt);

    // Rotation update
    if (this.options.turnMode === 'manual') {
      this.turn = this.options.manualTurn;
    } else if (this.options.turnMode === 'spin') {
      this.turn += this.options.idleSpinSpeed * 1.4 * dt;
    } else {
      const idleElapsed = now - this.lastMoveTime;
      if (this.options.idleSpin && idleElapsed > this.options.idleDelayMs) {
        this.idleBlend = Math.min(1, this.idleBlend + dt * 2.5);
        this.turn += this.options.idleSpinSpeed * this.idleBlend * dt;
        this.targetTurn = this.turn;
      } else {
        this.idleBlend = Math.max(0, this.idleBlend - dt * 8);
        const turnAlpha = 1 - Math.exp(-16 * dt);
        this.turn = lerpAngle(this.turn, this.targetTurn, turnAlpha);
      }
    }

    // Damped spring physics for juicy click squish/pop
    const restOffset = this.pointerDown ? -0.42 : 0;
    const stiffness = this.pointerDown ? 260 : 320;
    const damping = this.pointerDown ? 18 : 14;
    const accel = (restOffset - this.squishOffset) * stiffness - this.squishVel * damping;
    this.squishVel += accel * dt;
    this.squishOffset += this.squishVel * dt;

    // Decay click flash
    this.flash = Math.max(0, this.flash - dt * 4.5);

    // Update pixel synapse sparks
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const s = this.sparks[i];
      s.life -= dt;
      if (s.life <= 0) {
        this.sparks.splice(i, 1);
        continue;
      }
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.vy += 260 * dt; // light gravity
    }
  }

  _render() {
    const ctx = this.ctx;
    if (!ctx || !this.sheet) return;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    // Draw click sparks (crisp whole-pixel squares)
    for (const s of this.sparks) {
      ctx.globalAlpha = Math.max(0, Math.min(1, s.life / s.maxLife));
      ctx.fillStyle = s.color;
      ctx.fillRect(Math.round(s.x), Math.round(s.y), s.size, s.size);
    }
    ctx.globalAlpha = 1;

    if (!this.visible) return;

    const scale = Math.max(1, Math.round(this.options.scale));
    const baseSpacing = this.options.spacing;
    const baseSquash = this.options.squash;

    // Apply click squish to effective spacing & subtle squash bounce
    // (When spacing is explicitly 0 in flat debug mode, keep it 0!)
    const effectiveSpacing =
      baseSpacing === 0
        ? 0
        : Math.max(0.2, baseSpacing * (1 + this.squishOffset * 0.85));
    const effectiveSquash = Math.max(
      0.45,
      Math.min(1.15, baseSquash * (1 - this.squishOffset * 0.14))
    );

    // Align visual mid-body near the exact click hotspot while keeping whole pixels
    const liftCenterOffset = Math.round(((this.sheet.count - 1) * effectiveSpacing * scale) * 0.32);
    const drawPos = {
      x: Math.round(this.posX) + Math.round(this.options.offsetX),
      y: Math.round(this.posY) + liftCenterOffset + Math.round(this.options.offsetY),
    };

    // Subtle crisp hotspot pixel cross when hovering clickable UI
    if (this.hoveringInteractive && this.options.hotspotMark) {
      const hx = Math.round(this.mouseX);
      const hy = Math.round(this.mouseY);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
      ctx.fillRect(hx - 1, hy - 1, 3, 3);
    }

    this.renderer.draw(ctx, this.sheet, drawPos, this.turn, {
      squash: effectiveSquash,
      spacing: effectiveSpacing,
      scale,
      sampling: this.options.sampling,
      outline: this.options.outline,
      shadow: this.options.shadow,
      flash: this.flash,
    });
  }
}

/**
 * Convenience helper: creates, loads, and starts a BrainCursor in one call.
 */
export async function createBrainCursor(options = {}) {
  const cursor = new BrainCursor(options);
  return cursor.init();
}
