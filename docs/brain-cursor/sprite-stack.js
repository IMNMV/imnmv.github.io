/**
 * Sprite Stacking Engine (Zero-dependency ES Module, Browser + Node compatible)
 *
 * Implements pixel-exact 2.5D sprite stacking:
 *   transform(z) = translate(round(pos))
 *                * translate(0, -round(z * spacing))
 *                * scale(1, squash)
 *                * rotate(turn)
 *
 * Key properties:
 * - Nearest-neighbor sampling (plus optional RotSprite 8x Scale2x sampling)
 * - Single-pass 1px silhouette outline rendered ONCE on the finished stack buffer
 *   (avoids diagonal dark speckle caused by per-slice outlines)
 * - Ground-point Y sorting helper (sort whole stacks by pos.y, never slice-by-slice)
 * - Static stack baker for non-turning props
 */

export const DEFAULT_SQUASH = 0.75;
export const DEFAULT_SPACING = 1.0;

/**
 * Compute sprite-stack turn angle (radians) from a 2D velocity vector.
 * In the slice sheet, objects face down (+y), so moving along (vx, vy)
 * requires turning by atan2(vy, vx) - PI / 2.
 */
export function turnFromVelocity(vx, vy) {
  return Math.atan2(vy, vx) - Math.PI / 2;
}

/**
 * Shortest-arc angular interpolation (handles wrap-around cleanly across +-PI).
 */
export function lerpAngle(current, target, t) {
  let diff = ((target - current + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
  return current + diff * t;
}

/**
 * Sort whole stacked objects by their ground-contact point (pos.y),
 * never slice by slice.
 */
export function sortByGroundY(items) {
  return [...items].sort((a, b) => Math.round(a.pos.y) - Math.round(b.pos.y));
}

/**
 * Parse a '#rrggbb' or '#rrggbbaa' hex string or [r,g,b,a] tuple into [r,g,b,a].
 */
export function parseColorRGBA(color) {
  if (!color) return null;
  if (Array.isArray(color) || color instanceof Uint8ClampedArray) {
    return [color[0], color[1], color[2], color.length > 3 ? color[3] : 255];
  }
  if (typeof color === 'string') {
    const hex = color.replace(/^#/, '');
    if (hex.length === 6) {
      return [
        parseInt(hex.slice(0, 2), 16),
        parseInt(hex.slice(2, 4), 16),
        parseInt(hex.slice(4, 6), 16),
        255,
      ];
    }
    if (hex.length === 8) {
      return [
        parseInt(hex.slice(0, 2), 16),
        parseInt(hex.slice(2, 4), 16),
        parseInt(hex.slice(4, 6), 16),
        parseInt(hex.slice(6, 8), 16),
      ];
    }
  }
  return null;
}

/**
 * Single pass of the EPX / Scale2x pixel-art upscaling algorithm.
 * Preserves sharp flat fills and smooths 45-degree stair-steps without blurring.
 */
function scale2xPass(src, w, h) {
  const dw = w * 2;
  const dh = h * 2;
  const dst = new Uint8ClampedArray(dw * dh * 4);

  const eq = (aIdx, bIdx) =>
    src[aIdx] === src[bIdx] &&
    src[aIdx + 1] === src[bIdx + 1] &&
    src[aIdx + 2] === src[bIdx + 2] &&
    src[aIdx + 3] === src[bIdx + 3];

  const writePx = (dx, dy, srcIdx) => {
    const o = (dy * dw + dx) * 4;
    dst[o] = src[srcIdx];
    dst[o + 1] = src[srcIdx + 1];
    dst[o + 2] = src[srcIdx + 2];
    dst[o + 3] = src[srcIdx + 3];
  };

  for (let y = 0; y < h; y++) {
    const ym = y > 0 ? y - 1 : 0;
    const yp = y < h - 1 ? y + 1 : h - 1;
    for (let x = 0; x < w; x++) {
      const xm = x > 0 ? x - 1 : 0;
      const xp = x < w - 1 ? x + 1 : w - 1;

      const p = (y * w + x) * 4;
      const a = (ym * w + x) * 4; // up
      const b = (y * w + xp) * 4; // right
      const c = (y * w + xm) * 4; // left
      const d = (yp * w + x) * 4; // down

      let e0 = p;
      let e1 = p;
      let e2 = p;
      let e3 = p;

      if (!eq(c, b) && !eq(a, d)) {
        if (eq(c, a)) e0 = a;
        if (eq(a, b)) e1 = b;
        if (eq(d, c)) e2 = c;
        if (eq(b, d)) e3 = d;
      }

      const dx = x * 2;
      const dy = y * 2;
      writePx(dx, dy, e0);
      writePx(dx + 1, dy, e1);
      writePx(dx, dy + 1, e2);
      writePx(dx + 1, dy + 1, e3);
    }
  }
  return { data: dst, width: dw, height: dh };
}

/**
 * Precompute 8x Scale2x upscaled slices for RotSprite sampling.
 * Cached directly on the sheet object (`sheet._rotSprite8x`).
 */
export function ensureRotSpriteCache(sheet) {
  if (sheet._rotSprite8x) return sheet._rotSprite8x;
  const w = sheet.sliceWidth;
  const h = sheet.sliceHeight;
  const slices = new Array(sheet.count);

  for (let z = 0; z < sheet.count; z++) {
    // Extract single slice into contiguous RGBA array
    const base = new Uint8ClampedArray(w * h * 4);
    for (let sy = 0; sy < h; sy++) {
      const rowSrc = (sy * sheet.width + z * w) * 4;
      const rowDst = sy * w * 4;
      base.set(sheet.data.subarray(rowSrc, rowSrc + w * 4), rowDst);
    }
    // 3 Scale2x passes: 1x -> 2x -> 4x -> 8x
    const s2 = scale2xPass(base, w, h);
    const s4 = scale2xPass(s2.data, s2.width, s2.height);
    const s8 = scale2xPass(s4.data, s4.width, s4.height);
    slices[z] = s8;
  }

  sheet._rotSprite8x = slices;
  return slices;
}

/**
 * Create a SliceSheet descriptor from raw RGBA pixel data.
 */
export function createSliceSheet(data, width, height, count) {
  if (width % count !== 0) {
    throw new Error(`Sheet width (${width}) must be divisible by slice count (${count})`);
  }
  return {
    data: data instanceof Uint8ClampedArray ? data : new Uint8ClampedArray(data),
    width,
    height,
    count,
    sliceWidth: width / count,
    sliceHeight: height,
    _rotSprite8x: null,
  };
}

/**
 * Load a PNG slice sheet URL in the browser and extract its raw RGBA pixel buffer.
 */
export async function loadSliceSheet(url, count) {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.decoding = 'async';

  await new Promise((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = (err) => reject(new Error(`Failed to load slice sheet: ${url} (${err?.type || err})`));
    img.src = url;
  });

  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, 0, 0);
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

  const sheet = createSliceSheet(imageData.data, canvas.width, canvas.height, count);
  sheet.image = img;
  return sheet;
}

/**
 * Compute required square-ish offscreen virtual-pixel buffer size for a stack
 * so rotated + lifted slices + 1px outline never clip.
 */
export function computeStackBounds(sheet, spacing = DEFAULT_SPACING, squash = DEFAULT_SQUASH) {
  const diag = Math.ceil(Math.hypot(sheet.sliceWidth, sheet.sliceHeight));
  const maxLift = Math.ceil(Math.max(0, sheet.count - 1) * Math.max(0, spacing));
  const pad = 4; // room for 1px outline + drop shadow
  const width = diag + pad * 2;
  const height = Math.ceil(diag * Math.max(1, squash)) + maxLift + pad * 2;
  const anchorX = Math.floor(width / 2);
  const anchorY = height - Math.floor(diag / 2) - pad;
  return { width, height, anchorX, anchorY };
}

/**
 * Core pixel-exact stack rasterizer into an RGBA Uint8ClampedArray buffer.
 *
 * Matches the spec transform per slice z in 0 .. count - 1:
 *   translate(round(pos)) * translate(0, -round(z * spacing)) * scale(1, squash) * rotate(turn)
 */
export function drawStackToBuffer(out, outW, outH, sheet, pos, turn, options = {}) {
  const squash = options.squash ?? DEFAULT_SQUASH;
  const spacing = options.spacing ?? DEFAULT_SPACING;
  const sampling = options.sampling ?? 'nearest'; // 'nearest' | 'rotsprite'
  const outlineRGBA = parseColorRGBA(options.outline ?? null);
  const shadow = options.shadow ?? false;
  const shadowColor = parseColorRGBA(options.shadowColor ?? [18, 8, 28, 92]);
  const flash = Math.max(0, Math.min(1, options.flash ?? 0));

  if (squash <= 0.01) return out;

  const gx = Math.round(pos.x);
  const gy = Math.round(pos.y);
  const w = sheet.sliceWidth;
  const h = sheet.sliceHeight;
  const halfW = Math.floor(w / 2);
  const halfH = Math.floor(h / 2);
  const cosT = Math.cos(turn);
  const sinT = Math.sin(turn);
  const sheetW = sheet.width;
  const srcData = sheet.data;

  // Optional ground drop shadow underneath the stack (squashed by camera angle)
  if (shadow && shadowColor) {
    const radX = Math.max(4, w * 0.44);
    const radY = Math.max(3, Math.min(w, h) * 0.42 * squash);
    const syMin = Math.max(0, Math.floor(gy - radY - 1));
    const syMax = Math.min(outH - 1, Math.ceil(gy + radY + 1));
    const sxMin = Math.max(0, Math.floor(gx - radX - 1));
    const sxMax = Math.min(outW - 1, Math.ceil(gx + radX + 1));
    const [sr, sg, sb, sa] = shadowColor;

    for (let py = syMin; py <= syMax; py++) {
      const dy = (py + 0.5 - (gy + 1)) / radY;
      for (let px = sxMin; px <= sxMax; px++) {
        const dx = (px + 0.5 - gx) / radX;
        if (dx * dx + dy * dy <= 1.0) {
          const idx = (py * outW + px) * 4;
          out[idx] = sr;
          out[idx + 1] = sg;
          out[idx + 2] = sb;
          out[idx + 3] = sa;
        }
      }
    }
  }

  // Tight bounding box half-extents of a rotated + vertically squashed slice
  const absCos = Math.abs(cosT);
  const absSin = Math.abs(sinT);
  const maxHalfX = Math.ceil((w * absCos + h * absSin) * 0.5) + 1;
  const maxHalfY = Math.ceil((w * absSin + h * absCos) * 0.5 * squash) + 1;

  // Track opaque body mask separately so outline wraps ONLY the stack body (not drop shadow!)
  const bodyMask = outlineRGBA ? new Uint8Array(outW * outH) : null;
  const rotCache = sampling === 'rotsprite' ? ensureRotSpriteCache(sheet) : null;
  const invSquash = 1.0 / squash;

  for (let z = 0; z < sheet.count; z++) {
    const lift = Math.round(z * spacing);
    const centerY = gy - lift;

    const minX = Math.max(0, gx - maxHalfX);
    const maxX = Math.min(outW - 1, gx + maxHalfX);
    const minY = Math.max(0, centerY - maxHalfY);
    const maxY = Math.min(outH - 1, centerY + maxHalfY);

    if (rotCache) {
      const s8 = rotCache[z];
      const s8Data = s8.data;
      const s8W = s8.width;
      const s8H = s8.height;

      for (let py = minY; py <= maxY; py++) {
        const ry = (py + 0.5 - centerY) * invSquash;
        const rySin = ry * sinT;
        const ryCos = ry * cosT;
        const rowOffset = py * outW;

        for (let px = minX; px <= maxX; px++) {
          const rx = px + 0.5 - gx;
          const ux = rx * cosT + rySin;
          const uy = -rx * sinT + ryCos;

          // Sample rotated center pixel inside the 8x Scale2x upscaled slice
          const sx8 = Math.floor((ux + halfW) * 8);
          const sy8 = Math.floor((uy + halfH) * 8);

          if (sx8 >= 0 && sx8 < s8W && sy8 >= 0 && sy8 < s8H) {
            const sIdx = (sy8 * s8W + sx8) * 4;
            if (s8Data[sIdx + 3] > 0) {
              const pIdx = rowOffset + px;
              const dIdx = pIdx * 4;
              out[dIdx] = s8Data[sIdx];
              out[dIdx + 1] = s8Data[sIdx + 1];
              out[dIdx + 2] = s8Data[sIdx + 2];
              out[dIdx + 3] = s8Data[sIdx + 3];
              if (bodyMask) bodyMask[pIdx] = 1;
            }
          }
        }
      }
    } else {
      const sliceOffsetX = z * w;

      for (let py = minY; py <= maxY; py++) {
        const ry = (py + 0.5 - centerY) * invSquash;
        const rySin = ry * sinT;
        const ryCos = ry * cosT;
        const rowOffset = py * outW;

        for (let px = minX; px <= maxX; px++) {
          const rx = px + 0.5 - gx;
          const ux = rx * cosT + rySin;
          const uy = -rx * sinT + ryCos;

          const sx = Math.floor(ux + halfW);
          const sy = Math.floor(uy + halfH);

          if (sx >= 0 && sx < w && sy >= 0 && sy < h) {
            const sIdx = (sy * sheetW + sliceOffsetX + sx) * 4;
            if (srcData[sIdx + 3] > 0) {
              const pIdx = rowOffset + px;
              const dIdx = pIdx * 4;
              out[dIdx] = srcData[sIdx];
              out[dIdx + 1] = srcData[sIdx + 1];
              out[dIdx + 2] = srcData[sIdx + 2];
              out[dIdx + 3] = srcData[sIdx + 3];
              if (bodyMask) bodyMask[pIdx] = 1;
            }
          }
        }
      }
    }
  }

  // Optional brief white synaptic flash on click (applied to body pixels only)
  if (flash > 0.01) {
    const f = flash;
    const invF = 1 - f;
    for (let i = 0; i < outW * outH; i++) {
      const isBody = bodyMask ? bodyMask[i] === 1 : out[i * 4 + 3] === 255;
      if (isBody) {
        const dIdx = i * 4;
        out[dIdx] = Math.round(out[dIdx] * invF + 255 * f);
        out[dIdx + 1] = Math.round(out[dIdx + 1] * invF + 240 * f);
        out[dIdx + 2] = Math.round(out[dIdx + 2] * invF + 255 * f);
      }
    }
  }

  // Single-pass 1px 4-connected silhouette outline around the finished stack
  if (outlineRGBA && bodyMask) {
    const [or, og, ob, oa] = outlineRGBA;
    for (let py = 0; py < outH; py++) {
      const row = py * outW;
      for (let px = 0; px < outW; px++) {
        const idx = row + px;
        if (bodyMask[idx] === 1) continue;
        const hit =
          (px > 0 && bodyMask[idx - 1] === 1) ||
          (px < outW - 1 && bodyMask[idx + 1] === 1) ||
          (py > 0 && bodyMask[idx - outW] === 1) ||
          (py < outH - 1 && bodyMask[idx + outW] === 1);
        if (hit) {
          const dIdx = idx * 4;
          out[dIdx] = or;
          out[dIdx + 1] = og;
          out[dIdx + 2] = ob;
          out[dIdx + 3] = oa;
        }
      }
    }
  }

  return out;
}

/**
 * Browser Canvas 2D renderer with a reusable offscreen virtual-pixel scratch buffer.
 * Draws crisp nearest-neighbor stacks at any integer pixel scale.
 */
export class SpriteStackRenderer {
  constructor() {
    this._canvas = null;
    this._ctx = null;
    this._imageData = null;
    this._w = 0;
    this._h = 0;
  }

  _ensureBuffer(w, h) {
    if (!this._canvas) {
      this._canvas = document.createElement('canvas');
      this._ctx = this._canvas.getContext('2d', { willReadFrequently: true });
    }
    if (this._w !== w || this._h !== h) {
      this._w = w;
      this._h = h;
      this._canvas.width = w;
      this._canvas.height = h;
      this._imageData = this._ctx.createImageData(w, h);
    } else {
      this._imageData.data.fill(0);
    }
    return this._imageData;
  }

  /**
   * Draw a sprite-stacked object onto a destination Canvas 2D context.
   *
   * @param {CanvasRenderingContext2D} ctx Destination context
   * @param {object} sheet SliceSheet returned by loadSliceSheet()
   * @param {{x: number, y: number}} pos Ground-contact point in destination canvas pixels
   * @param {number} turn Rotation angle in radians
   * @param {object} [options] { squash, spacing, scale, sampling, outline, shadow, flash }
   */
  draw(ctx, sheet, pos, turn, options = {}) {
    const squash = options.squash ?? DEFAULT_SQUASH;
    const spacing = options.spacing ?? DEFAULT_SPACING;
    const scale = Math.max(1, Math.round(options.scale ?? 2));

    const bounds = computeStackBounds(sheet, Math.max(spacing, 2.5), Math.max(squash, 1.0));
    const imgData = this._ensureBuffer(bounds.width, bounds.height);

    drawStackToBuffer(
      imgData.data,
      bounds.width,
      bounds.height,
      sheet,
      { x: bounds.anchorX, y: bounds.anchorY },
      turn,
      {
        squash,
        spacing,
        sampling: options.sampling ?? 'nearest',
        outline: options.outline ?? null,
        shadow: options.shadow ?? false,
        shadowColor: options.shadowColor,
        flash: options.flash ?? 0,
      }
    );

    this._ctx.putImageData(imgData, 0, 0);

    // Whole-pixel destination position (prevents sub-pixel shimmer)
    const destX = Math.round(pos.x) - bounds.anchorX * scale;
    const destY = Math.round(pos.y) - bounds.anchorY * scale;

    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(
      this._canvas,
      0,
      0,
      bounds.width,
      bounds.height,
      destX,
      destY,
      bounds.width * scale,
      bounds.height * scale
    );
    ctx.restore();
  }
}

/**
 * Pre-bake a static (non-turning) sprite stack into a plain canvas sprite at load time.
 * Avoids paying per-slice draw cost every frame for static props/buildings.
 */
export function bakeStaticStack(sheet, turn = 0, options = {}) {
  const squash = options.squash ?? DEFAULT_SQUASH;
  const spacing = options.spacing ?? DEFAULT_SPACING;
  const bounds = computeStackBounds(sheet, spacing, squash);

  const canvas = document.createElement('canvas');
  canvas.width = bounds.width;
  canvas.height = bounds.height;
  const ctx = canvas.getContext('2d');
  const imgData = ctx.createImageData(bounds.width, bounds.height);

  drawStackToBuffer(
    imgData.data,
    bounds.width,
    bounds.height,
    sheet,
    { x: bounds.anchorX, y: bounds.anchorY },
    turn,
    options
  );
  ctx.putImageData(imgData, 0, 0);

  return {
    canvas,
    width: bounds.width,
    height: bounds.height,
    anchorX: bounds.anchorX,
    anchorY: bounds.anchorY,
  };
}
