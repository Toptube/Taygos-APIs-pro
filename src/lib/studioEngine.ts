import { ArrayBufferTarget, Muxer } from 'mp4-muxer';
import type {
  BackgroundConfig,
  CanvasAspectPreset,
  DimensionOverlay,
  ImageExportFormat,
  LightingConfig,
  ShadowConfig,
  StoryboardLayout,
  StoryboardSlide,
  VideoExportFormat,
  VideoGenerationMode,
  VideoMotionStyle,
} from '../types/studio';

export function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (!src.startsWith('data:') && !src.startsWith('blob:')) {
      img.crossOrigin = 'anonymous';
    }
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Image load failed'));
    img.src = src;
  });
}

export function createFittedImageCanvas(
  img: HTMLImageElement,
  maxDim = 1400
): HTMLCanvasElement {
  const scale = Math.min(
    1,
    maxDim / Math.max(img.naturalWidth || 1, img.naturalHeight || 1)
  );
  const width = Math.max(1, Math.round((img.naturalWidth || 1024) * scale));
  const height = Math.max(1, Math.round((img.naturalHeight || 1024) * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.drawImage(img, 0, 0, width, height);
  }
  return canvas;
}

export function createFullOpaqueMask(
  width: number,
  height: number
): HTMLCanvasElement {
  const mask = document.createElement('canvas');
  mask.width = width;
  mask.height = height;
  const ctx = mask.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
  }
  return mask;
}

export function cloneCanvas(src: HTMLCanvasElement): HTMLCanvasElement {
  const copy = document.createElement('canvas');
  copy.width = src.width;
  copy.height = src.height;
  const ctx = copy.getContext('2d');
  if (ctx) {
    ctx.drawImage(src, 0, 0);
  }
  return copy;
}

export function getTargetCanvasDimensions(
  origW: number,
  origH: number,
  preset: CanvasAspectPreset
): { width: number; height: number } {
  switch (preset) {
    case '1:1':
      return { width: 1080, height: 1080 };
    case '4:3':
      return { width: 1200, height: 900 };
    case '3:4':
      return { width: 960, height: 1280 };
    case '4:5':
      return { width: 1080, height: 1350 };
    case '16:9':
      return { width: 1280, height: 720 };
    case '9:16':
      return { width: 810, height: 1440 };
    case 'original':
    default:
      return { width: Math.max(1, origW), height: Math.max(1, origH) };
  }
}

/**
 * Shared exact product draw rectangle inside the output canvas so pointer brush/wand
 * coordinates always invert cleanly back onto rawMaskCanvas pixel-for-pixel.
 */
export function computeProductDrawRect(
  canvasW: number,
  canvasH: number,
  prodW: number,
  prodH: number,
  bg: BackgroundConfig
): { drawX: number; drawY: number; drawW: number; drawH: number } {
  const baseScale =
    bg.fitMode === 'cover'
      ? Math.max(canvasW / Math.max(1, prodW), canvasH / Math.max(1, prodH))
      : Math.min(canvasW / Math.max(1, prodW), canvasH / Math.max(1, prodH));
  const finalScale = baseScale * (bg.productScale ?? 1);
  const drawW = prodW * finalScale;
  const drawH = prodH * finalScale;
  const drawX = (canvasW - drawW) / 2 + (bg.productOffsetX || 0) * canvasW;
  const drawY = (canvasH - drawH) / 2 + (bg.productOffsetY || 0) * canvasH;
  return { drawX, drawY, drawW, drawH };
}

/**
 * Extracts alpha mask from AI cutout result, or runs multi-seed edge-aware cutout on white studio results.
 */
export async function extractMaskFromCutoutResult(
  cutoutSrc: string,
  targetWidth: number,
  targetHeight: number
): Promise<HTMLCanvasElement> {
  const img = await loadImageElement(cutoutSrc);
  const tmp = document.createElement('canvas');
  tmp.width = targetWidth;
  tmp.height = targetHeight;
  const ctx = tmp.getContext('2d');
  if (!ctx) return createFullOpaqueMask(targetWidth, targetHeight);

  ctx.drawImage(img, 0, 0, targetWidth, targetHeight);
  const imgData = ctx.getImageData(0, 0, targetWidth, targetHeight);
  const d = imgData.data;

  let transparentCount = 0;
  const totalPixels = targetWidth * targetHeight;
  for (let i = 3; i < d.length; i += 16) {
    if (d[i] < 240) transparentCount++;
  }
  const hasRealAlpha = transparentCount > (totalPixels / 4) * 0.025;

  const mask = document.createElement('canvas');
  mask.width = targetWidth;
  mask.height = targetHeight;
  const mCtx = mask.getContext('2d');
  if (!mCtx) return mask;
  const maskData = mCtx.createImageData(targetWidth, targetHeight);
  const md = maskData.data;

  if (hasRealAlpha) {
    for (let i = 0; i < d.length; i += 4) {
      const a = d[i + 3];
      md[i] = 255;
      md[i + 1] = 255;
      md[i + 2] = 255;
      md[i + 3] = a;
    }
    mCtx.putImageData(maskData, 0, 0);
    return mask;
  }

  return performSmartLocalCutout(tmp, 42);
}

/**
 * Multi-seed border palette + Sobel edge-barrier flood fill + interior matching hole cleanup.
 * Handles lighting gradients, walls, wood tables, and protects bright cotton/macrame fibers.
 */
export function performSmartLocalCutout(
  sourceCanvas: HTMLCanvasElement,
  tolerance = 44
): HTMLCanvasElement {
  const w = sourceCanvas.width;
  const h = sourceCanvas.height;
  const sCtx = sourceCanvas.getContext('2d');
  if (!sCtx) return createFullOpaqueMask(w, h);
  const src = sCtx.getImageData(0, 0, w, h).data;

  // 1) Sample 36 perimeter points across all 4 edges & deduplicate into representative BG colors
  const rawSamples: Array<[number, number, number]> = [];
  const sampleAt = (x: number, y: number) => {
    const cx = Math.max(0, Math.min(w - 1, Math.round(x)));
    const cy = Math.max(0, Math.min(h - 1, Math.round(y)));
    const idx = (cy * w + cx) * 4;
    rawSamples.push([src[idx], src[idx + 1], src[idx + 2]]);
  };
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    sampleAt(t * (w - 1), 2);
    sampleAt(t * (w - 1), h - 3);
    if (i > 0 && i < 10) {
      sampleAt(2, t * (h - 1));
      sampleAt(w - 3, t * (h - 1));
    }
  }

  const palette: Array<[number, number, number]> = [];
  for (const s of rawSamples) {
    const nearExisting = palette.some(
      (p) => Math.hypot(p[0] - s[0], p[1] - s[1], p[2] - s[2]) < 22
    );
    if (!nearExisting && palette.length < 10) {
      palette.push(s);
    }
  }

  const minPaletteDist = (r: number, g: number, b: number): number => {
    let best = 999;
    for (let i = 0; i < palette.length; i++) {
      const p = palette[i];
      // Weighted perceptual color distance (emphasizes hue/chroma over minor lighting shifts)
      const dr = r - p[0];
      const dg = g - p[1];
      const db = b - p[2];
      const d = Math.sqrt(dr * dr * 0.3 + dg * dg * 0.59 + db * db * 0.11) * 1.65;
      if (d < best) best = d;
    }
    return best;
  };

  // 2) Compute Sobel luminance gradient edge map to stop flood-fill cleanly at product contours
  const total = w * h;
  const luma = new Float32Array(total);
  for (let i = 0; i < total; i++) {
    const k = i * 4;
    luma[i] = 0.299 * src[k] + 0.587 * src[k + 1] + 0.114 * src[k + 2];
  }
  const edgeMag = new Float32Array(total);
  for (let y = 1; y < h - 1; y++) {
    const row = y * w;
    for (let x = 1; x < w - 1; x++) {
      const idx = row + x;
      const gx =
        -luma[idx - w - 1] +
        luma[idx - w + 1] -
        2 * luma[idx - 1] +
        2 * luma[idx + 1] -
        luma[idx + w - 1] +
        luma[idx + w + 1];
      const gy =
        -luma[idx - w - 1] -
        2 * luma[idx - w] -
        luma[idx - w + 1] +
        luma[idx + w - 1] +
        2 * luma[idx + w] +
        luma[idx + w + 1];
      edgeMag[idx] = Math.hypot(gx, gy) * 0.25;
    }
  }

  const visited = new Uint8Array(total);
  const isBg = new Uint8Array(total);
  const queue = new Int32Array(total);
  let head = 0;
  let tail = 0;

  const maxBgDist = tolerance * 1.45;
  const maxStepDiff = Math.max(24, tolerance * 0.85);
  const edgeBarrier = Math.max(28, 72 - tolerance * 0.45);

  const trySeed = (x: number, y: number) => {
    const p = y * w + x;
    if (visited[p]) return;
    const p4 = p * 4;
    if (minPaletteDist(src[p4], src[p4 + 1], src[p4 + 2]) <= maxBgDist) {
      visited[p] = 1;
      isBg[p] = 1;
      queue[tail++] = p;
    }
  };

  for (let x = 0; x < w; x++) {
    trySeed(x, 0);
    trySeed(x, h - 1);
  }
  for (let y = 0; y < h; y++) {
    trySeed(0, y);
    trySeed(w - 1, y);
  }

  while (head < tail) {
    const cur = queue[head++];
    const cx = cur % w;
    const cy = (cur - cx) / w;
    const c4 = cur * 4;

    const neighbors = [
      cx > 0 ? cur - 1 : -1,
      cx < w - 1 ? cur + 1 : -1,
      cy > 0 ? cur - w : -1,
      cy < h - 1 ? cur + w : -1,
    ];

    for (const np of neighbors) {
      if (np < 0 || visited[np]) continue;
      visited[np] = 1;
      if (edgeMag[np] > edgeBarrier) continue;
      const n4 = np * 4;
      const stepDist = Math.hypot(
        src[n4] - src[c4],
        src[n4 + 1] - src[c4 + 1],
        src[n4 + 2] - src[c4 + 2]
      );
      const palDist = minPaletteDist(src[n4], src[n4 + 1], src[n4 + 2]);
      if (palDist <= maxBgDist && stepDist <= maxStepDiff) {
        isBg[np] = 1;
        queue[tail++] = np;
      }
    }
  }

  const mask = document.createElement('canvas');
  mask.width = w;
  mask.height = h;
  const mCtx = mask.getContext('2d');
  if (!mCtx) return mask;
  const out = mCtx.createImageData(w, h);
  const od = out.data;

  for (let p = 0; p < total; p++) {
    const o4 = p * 4;
    od[o4] = 255;
    od[o4 + 1] = 255;
    od[o4 + 2] = 255;
    if (isBg[p]) {
      od[o4 + 3] = 0;
    } else {
      const x = p % w;
      const y = (p - x) / w;
      const nearBg =
        (x > 0 && isBg[p - 1]) ||
        (x < w - 1 && isBg[p + 1]) ||
        (y > 0 && isBg[p - w]) ||
        (y < h - 1 && isBg[p + w]);
      od[o4 + 3] = nearBg ? 155 : 255;
    }
  }

  mCtx.putImageData(out, 0, 0);
  return mask;
}

/**
 * Magic Wand (العصا السحرية): click any region to remove or restore matching background color.
 * Supports both Contiguous (flood-fill region) and Global (all matching pixels, ideal for macrame openings).
 */
export function applyMagicWandToMask(params: {
  originalCanvas: HTMLCanvasElement;
  maskCanvas: HTMLCanvasElement;
  normX: number;
  normY: number;
  tolerance: number; // 5 to 120
  contiguous: boolean;
  mode: 'erase' | 'restore';
}): { matchedPixels: number } {
  const { originalCanvas, maskCanvas, normX, normY, tolerance, contiguous, mode } =
    params;
  const w = originalCanvas.width;
  const h = originalCanvas.height;
  const sx = Math.max(0, Math.min(w - 1, Math.round(normX * (w - 1))));
  const sy = Math.max(0, Math.min(h - 1, Math.round(normY * (h - 1))));

  const oCtx = originalCanvas.getContext('2d');
  const mCtx = maskCanvas.getContext('2d');
  if (!oCtx || !mCtx) return { matchedPixels: 0 };

  const origData = oCtx.getImageData(0, 0, w, h).data;
  const maskImg = mCtx.getImageData(0, 0, w, h);
  const md = maskImg.data;

  // Sample average 3x3 around clicked pixel for stability against film grain
  let rSum = 0;
  let gSum = 0;
  let bSum = 0;
  let count = 0;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const px = Math.max(0, Math.min(w - 1, sx + dx));
      const py = Math.max(0, Math.min(h - 1, sy + dy));
      const i = (py * w + px) * 4;
      rSum += origData[i];
      gSum += origData[i + 1];
      bSum += origData[i + 2];
      count++;
    }
  }
  const targetR = rSum / count;
  const targetG = gSum / count;
  const targetB = bSum / count;

  const colorDist = (p: number) => {
    const i = p * 4;
    const dr = origData[i] - targetR;
    const dg = origData[i + 1] - targetG;
    const db = origData[i + 2] - targetB;
    return Math.sqrt(dr * dr * 0.3 + dg * dg * 0.59 + db * db * 0.11) * 1.65;
  };

  const hardLimit = Math.max(6, tolerance);
  const softLimit = hardLimit * 1.35;
  let matched = 0;

  if (!contiguous) {
    for (let p = 0; p < w * h; p++) {
      const dist = colorDist(p);
      if (dist <= softLimit) {
        const strength =
          dist <= hardLimit ? 1 : 1 - (dist - hardLimit) / (softLimit - hardLimit);
        const idx = p * 4 + 3;
        if (mode === 'erase') {
          md[idx] = Math.min(md[idx], Math.round(255 * (1 - strength)));
        } else {
          md[idx] = Math.max(md[idx], Math.round(255 * strength));
        }
        matched++;
      }
    }
  } else {
    const total = w * h;
    const visited = new Uint8Array(total);
    const queue = new Int32Array(total);
    let head = 0;
    let tail = 0;
    const seed = sy * w + sx;
    visited[seed] = 1;
    queue[tail++] = seed;

    while (head < tail) {
      const cur = queue[head++];
      const dist = colorDist(cur);
      const strength =
        dist <= hardLimit
          ? 1
          : Math.max(0, 1 - (dist - hardLimit) / (softLimit - hardLimit));
      const idx = cur * 4 + 3;
      if (mode === 'erase') {
        md[idx] = Math.min(md[idx], Math.round(255 * (1 - strength)));
      } else {
        md[idx] = Math.max(md[idx], Math.round(255 * strength));
      }
      matched++;

      const cx = cur % w;
      const cy = (cur - cx) / w;
      const neighbors = [
        cx > 0 ? cur - 1 : -1,
        cx < w - 1 ? cur + 1 : -1,
        cy > 0 ? cur - w : -1,
        cy < h - 1 ? cur + w : -1,
      ];
      for (const np of neighbors) {
        if (np < 0 || visited[np]) continue;
        visited[np] = 1;
        if (colorDist(np) <= softLimit) {
          queue[tail++] = np;
        }
      }
    }
  }

  mCtx.putImageData(maskImg, 0, 0);
  return { matchedPixels: matched };
}

/**
 * Smooth continuous brush stroke interpolation from (x0, y0) to (x1, y1) with zero gaps.
 */
export function applyBrushStrokeLineToMask(
  maskCanvas: HTMLCanvasElement,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  radius: number,
  mode: 'erase' | 'restore',
  hardness = 0.78
): void {
  const ctx = maskCanvas.getContext('2d');
  if (!ctx) return;

  const dist = Math.hypot(x1 - x0, y1 - y0);
  const step = Math.max(1.5, radius * 0.25);
  const steps = Math.max(1, Math.ceil(dist / step));

  ctx.save();
  ctx.globalCompositeOperation = mode === 'erase' ? 'destination-out' : 'source-over';
  const innerRadius = Math.max(0, radius * hardness);

  for (let i = 0; i <= steps; i++) {
    const t = steps === 0 ? 0 : i / steps;
    const cx = x0 + (x1 - x0) * t;
    const cy = y0 + (y1 - y0) * t;
    const grad = ctx.createRadialGradient(cx, cy, innerRadius, cx, cy, radius);
    if (mode === 'erase') {
      grad.addColorStop(0, 'rgba(0,0,0,1)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
    } else {
      grad.addColorStop(0, 'rgba(255,255,255,1)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
    }
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

export function computeRefinedMask(
  rawMask: HTMLCanvasElement,
  expandContractPx: number,
  featherPx: number
): HTMLCanvasElement {
  const w = rawMask.width;
  const h = rawMask.height;
  if (expandContractPx === 0 && featherPx === 0) {
    return rawMask;
  }

  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const ctx = out.getContext('2d');
  if (!ctx) return rawMask;

  let workingCanvas = rawMask;
  if (expandContractPx !== 0) {
    const rCtx = rawMask.getContext('2d');
    if (rCtx) {
      const srcImg = rCtx.getImageData(0, 0, w, h);
      const sd = srcImg.data;
      const nextImg = rCtx.createImageData(w, h);
      const nd = nextImg.data;
      const radius = Math.min(8, Math.abs(Math.round(expandContractPx)));
      const isExpand = expandContractPx > 0;

      const tempAlpha = new Uint8Array(w * h);
      for (let y = 0; y < h; y++) {
        const rowOff = y * w;
        for (let x = 0; x < w; x++) {
          let extreme = isExpand ? 0 : 255;
          const xStart = Math.max(0, x - radius);
          const xEnd = Math.min(w - 1, x + radius);
          for (let kx = xStart; kx <= xEnd; kx++) {
            const a = sd[(rowOff + kx) * 4 + 3];
            extreme = isExpand ? (a > extreme ? a : extreme) : a < extreme ? a : extreme;
          }
          tempAlpha[rowOff + x] = extreme;
        }
      }
      for (let y = 0; y < h; y++) {
        const yStart = Math.max(0, y - radius);
        const yEnd = Math.min(h - 1, y + radius);
        for (let x = 0; x < w; x++) {
          let extreme = isExpand ? 0 : 255;
          for (let ky = yStart; ky <= yEnd; ky++) {
            const a = tempAlpha[ky * w + x];
            extreme = isExpand ? (a > extreme ? a : extreme) : a < extreme ? a : extreme;
          }
          const idx = (y * w + x) * 4;
          nd[idx] = 255;
          nd[idx + 1] = 255;
          nd[idx + 2] = 255;
          nd[idx + 3] = extreme;
        }
      }
      const morphed = document.createElement('canvas');
      morphed.width = w;
      morphed.height = h;
      const mCtx = morphed.getContext('2d');
      if (mCtx) {
        mCtx.putImageData(nextImg, 0, 0);
        workingCanvas = morphed;
      }
    }
  }

  if (featherPx > 0) {
    ctx.filter = `blur(${featherPx}px)`;
  }
  ctx.drawImage(workingCanvas, 0, 0);
  ctx.filter = 'none';
  return out;
}

export function buildFilteredProductCanvas(
  originalCanvas: HTMLCanvasElement,
  maskCanvas: HTMLCanvasElement,
  lighting: LightingConfig
): HTMLCanvasElement {
  const w = originalCanvas.width;
  const h = originalCanvas.height;
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const ctx = out.getContext('2d');
  if (!ctx) return out;

  const brightnessPct = Math.max(40, 100 + lighting.brightness);
  const contrastPct = Math.max(40, 100 + lighting.contrast);
  const satPct = Math.max(0, 100 + (lighting.saturation || 0));

  ctx.filter = `brightness(${brightnessPct}%) contrast(${contrastPct}%) saturate(${satPct}%)`;
  ctx.drawImage(originalCanvas, 0, 0);
  ctx.filter = 'none';

  const hasFilter = lighting.filterId && lighting.filterId !== 'none';
  const needsPixelPass =
    lighting.warmth !== 0 ||
    lighting.shadows !== 0 ||
    (lighting.highlights || 0) !== 0 ||
    lighting.clarity > 0 ||
    hasFilter;

  if (needsPixelPass) {
    const imgData = ctx.getImageData(0, 0, w, h);
    const d = imgData.data;
    const warm = lighting.warmth * 0.72;
    const shadowShift = lighting.shadows * 0.75;
    const highlightShift = (lighting.highlights || 0) * 0.65;
    const clarityBoost = lighting.clarity * 0.0032;
    const fMix = Math.max(0, Math.min(1, (lighting.filterIntensity ?? 85) / 100));
    const fId = lighting.filterId || 'none';

    for (let i = 0; i < d.length; i += 4) {
      let r = d[i];
      let g = d[i + 1];
      let b = d[i + 2];

      if (warm !== 0) {
        r = Math.min(255, Math.max(0, r + warm));
        g = Math.min(255, Math.max(0, g + warm * 0.28));
        b = Math.min(255, Math.max(0, b - warm * 0.85));
      }

      if (shadowShift !== 0) {
        const lum = 0.299 * r + 0.587 * g + 0.114 * b;
        const shadowWeight = Math.max(0, 1 - lum / 165);
        const delta = shadowShift * shadowWeight;
        r = Math.min(255, Math.max(0, r + delta));
        g = Math.min(255, Math.max(0, g + delta));
        b = Math.min(255, Math.max(0, b + delta));
      }

      if (highlightShift !== 0) {
        const lum = 0.299 * r + 0.587 * g + 0.114 * b;
        const hiWeight = Math.max(0, (lum - 140) / 115);
        const delta = highlightShift * hiWeight;
        r = Math.min(255, Math.max(0, r + delta));
        g = Math.min(255, Math.max(0, g + delta));
        b = Math.min(255, Math.max(0, b + delta));
      }

      if (clarityBoost > 0) {
        const lum = 0.299 * r + 0.587 * g + 0.114 * b;
        r = Math.min(255, Math.max(0, r + (r - lum) * clarityBoost * 1.9));
        g = Math.min(255, Math.max(0, g + (g - lum) * clarityBoost * 1.9));
        b = Math.min(255, Math.max(0, b + (b - lum) * clarityBoost * 1.9));
      }

      if (hasFilter && fMix > 0) {
        let fr = r;
        let fg = g;
        let fb = b;
        const lum = 0.299 * r + 0.587 * g + 0.114 * b;

        if (fId === 'studio_clean') {
          fr = r * 1.04 + 6;
          fg = g * 1.04 + 6;
          fb = b * 1.06 + 8;
        } else if (fId === 'warm_boho') {
          fr = r * 1.07 + 8;
          fg = g * 1.02 + 2;
          fb = b * 0.92;
        } else if (fId === 'crisp_knots') {
          fr = 128 + (r - 128) * 1.18 + (r - lum) * 0.15;
          fg = 128 + (g - 128) * 1.18 + (g - lum) * 0.15;
          fb = 128 + (b - 128) * 1.18 + (b - lum) * 0.15;
        } else if (fId === 'rustic_burlap') {
          fr = r * 0.94 + lum * 0.1 + 10;
          fg = g * 0.9 + lum * 0.08 + 4;
          fb = b * 0.8 - 4;
        } else if (fId === 'golden_hour') {
          fr = r * 1.12 + 12;
          fg = g * 1.03 + 4;
          fb = b * 0.84;
        } else if (fId === 'bw_classic') {
          const bw = 128 + (lum - 128) * 1.15;
          fr = bw;
          fg = bw;
          fb = bw;
        } else if (fId === 'soft_pastel') {
          fr = r * 0.92 + 24;
          fg = g * 0.93 + 22;
          fb = b * 0.95 + 24;
        }

        r = r * (1 - fMix) + Math.min(255, Math.max(0, fr)) * fMix;
        g = g * (1 - fMix) + Math.min(255, Math.max(0, fg)) * fMix;
        b = b * (1 - fMix) + Math.min(255, Math.max(0, fb)) * fMix;
      }

      d[i] = r;
      d[i + 1] = g;
      d[i + 2] = b;
    }
    ctx.putImageData(imgData, 0, 0);
  }

  ctx.globalCompositeOperation = 'destination-in';
  ctx.drawImage(maskCanvas, 0, 0, w, h);
  ctx.globalCompositeOperation = 'source-over';
  return out;
}

function getMaskContentBounds(mask: HTMLCanvasElement): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
} {
  const w = mask.width;
  const h = mask.height;
  const ctx = mask.getContext('2d');
  if (!ctx) return { minX: 0, minY: 0, maxX: w, maxY: h };
  const data = ctx.getImageData(0, 0, w, h).data;
  let minX = w;
  let minY = h;
  let maxX = 0;
  let maxY = 0;
  const step = Math.max(1, Math.floor(Math.min(w, h) / 160));
  for (let y = 0; y < h; y += step) {
    for (let x = 0; x < w; x += step) {
      if (data[(y * w + x) * 4 + 3] > 30) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (minX >= maxX || minY >= maxY) {
    return { minX: w * 0.15, minY: h * 0.1, maxX: w * 0.85, maxY: h * 0.9 };
  }
  return { minX, minY, maxX, maxY };
}

export function drawDimensionOverlaysOnCanvas(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  dimensions: DimensionOverlay[]
): void {
  for (const dim of dimensions) {
    if (!dim.visible) continue;
    const x1 = dim.x1 * width;
    const y1 = dim.y1 * height;
    const x2 = dim.x2 * width;
    const y2 = dim.y2 * height;
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.hypot(dx, dy);
    if (len < 6) continue;
    const angle = Math.atan2(dy, dx);

    ctx.save();
    ctx.strokeStyle = dim.color;
    ctx.fillStyle = dim.color;
    ctx.lineWidth = dim.thickness;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();

    if (dim.showExtensions) {
      const ext = 12 + dim.thickness * 1.5;
      const nx = -Math.sin(angle) * ext;
      const ny = Math.cos(angle) * ext;
      ctx.beginPath();
      ctx.moveTo(x1 - nx, y1 - ny);
      ctx.lineTo(x1 + nx, y1 + ny);
      ctx.moveTo(x2 - nx, y2 - ny);
      ctx.lineTo(x2 + nx, y2 + ny);
      ctx.stroke();
    }

    const headLen = 10 + dim.thickness * 2;
    const drawEndHead = (px: number, py: number, dir: number) => {
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(angle + (dir < 0 ? Math.PI : 0));
      if (dim.style === 'triangles') {
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(headLen, -headLen * 0.42);
        ctx.lineTo(headLen, headLen * 0.42);
        ctx.closePath();
        ctx.fill();
      } else if (dim.style === 'arrows') {
        ctx.beginPath();
        ctx.moveTo(headLen, -headLen * 0.42);
        ctx.lineTo(0, 0);
        ctx.lineTo(headLen, headLen * 0.42);
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.arc(0, 0, dim.thickness * 1.6, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    };

    drawEndHead(x1, y1, 1);
    drawEndHead(x2, y2, -1);

    const midX = (x1 + x2) / 2;
    const midY = (y1 + y2) / 2;
    const labelText = [dim.label.trim(), dim.valueText.trim()]
      .filter(Boolean)
      .join(': ');
    if (labelText) {
      ctx.font = `600 ${dim.fontSize}px "IBM Plex Sans Arabic", "Plus Jakarta Sans", sans-serif`;
      const metrics = ctx.measureText(labelText);
      const padX = 12;
      const boxW = metrics.width + padX * 2;
      const boxH = dim.fontSize + 12;

      ctx.save();
      ctx.translate(midX, midY);
      let textAngle = angle;
      if (textAngle > Math.PI / 2 || textAngle < -Math.PI / 2) {
        textAngle += Math.PI;
      }
      ctx.rotate(textAngle);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.94)';
      ctx.strokeStyle = dim.color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.roundRect(-boxW / 2, -boxH / 2, boxW, boxH, 8);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#171614';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(labelText, 0, 1);
      ctx.restore();
    }

    ctx.restore();
  }
}

export async function renderStudioComposite(params: {
  originalCanvas: HTMLCanvasElement;
  rawMaskCanvas: HTMLCanvasElement;
  edgeExpand: number;
  edgeFeather: number;
  lighting: LightingConfig;
  shadow: ShadowConfig;
  background: BackgroundConfig;
  dimensions?: DimensionOverlay[];
  bakeDimensions?: boolean;
}): Promise<HTMLCanvasElement> {
  const prodW = params.originalCanvas.width;
  const prodH = params.originalCanvas.height;
  const { width: w, height: h } = getTargetCanvasDimensions(
    prodW,
    prodH,
    params.background.aspectPreset || 'original'
  );

  const refinedMask = computeRefinedMask(
    params.rawMaskCanvas,
    params.edgeExpand,
    params.edgeFeather
  );
  const productCanvas = buildFilteredProductCanvas(
    params.originalCanvas,
    refinedMask,
    params.lighting
  );

  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const ctx = out.getContext('2d');
  if (!ctx) return out;

  const bg = params.background;
  if (bg.mode === 'white') {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
  } else if (bg.mode === 'solid') {
    ctx.fillStyle = bg.solidColor || '#F5EFE6';
    ctx.fillRect(0, 0, w, h);
  } else if (bg.mode === 'boho_gradient') {
    const grad = ctx.createLinearGradient(0, 0, w, h);
    grad.addColorStop(0, '#F6EFE4');
    grad.addColorStop(0.55, '#EADBC8');
    grad.addColorStop(1, '#DFC8AC');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
  } else if (bg.mode === 'scene_image' && bg.sceneImageUrl) {
    try {
      const sceneImg = await loadImageElement(bg.sceneImageUrl);
      const scale = Math.max(
        w / (sceneImg.naturalWidth || w),
        h / (sceneImg.naturalHeight || h)
      );
      const dw = (sceneImg.naturalWidth || w) * scale;
      const dh = (sceneImg.naturalHeight || h) * scale;
      ctx.drawImage(sceneImg, (w - dw) / 2, (h - dh) / 2, dw, dh);
    } catch {
      ctx.fillStyle = '#F3ECE2';
      ctx.fillRect(0, 0, w, h);
    }
  }

  const { drawX, drawY, drawW, drawH } = computeProductDrawRect(
    w,
    h,
    prodW,
    prodH,
    bg
  );

  if (params.shadow.enabled && bg.mode !== 'transparent') {
    const bounds = getMaskContentBounds(refinedMask);
    const prodCenterX = drawX + ((bounds.minX + bounds.maxX) / 2 / prodW) * drawW;
    const prodBottomY = drawY + (bounds.maxY / prodH) * drawH;
    const prodSpanW = ((bounds.maxX - bounds.minX) / prodW) * drawW;
    const rx = Math.max(24, (prodSpanW * params.shadow.spread) / 2);
    const ry = Math.max(8, rx * 0.16);

    ctx.save();
    ctx.filter = `blur(${params.shadow.blur}px)`;
    ctx.fillStyle = `rgba(28, 22, 16, ${params.shadow.opacity})`;
    ctx.beginPath();
    ctx.ellipse(
      prodCenterX,
      prodBottomY + params.shadow.offsetY,
      rx,
      ry,
      0,
      0,
      Math.PI * 2
    );
    ctx.fill();
    ctx.restore();
  }

  ctx.drawImage(productCanvas, drawX, drawY, drawW, drawH);

  if (params.bakeDimensions && params.dimensions && params.dimensions.length > 0) {
    drawDimensionOverlaysOnCanvas(ctx, w, h, params.dimensions);
  }

  return out;
}

/**
 * Generates a valid binary .ICO file (PNG-in-ICO container, 256x256 or custom size)
 * with full alpha transparency support.
 */
export async function buildIcoDataUrlFromCanvas(
  sourceCanvas: HTMLCanvasElement,
  iconSize = 256
): Promise<string> {
  const size = Math.max(16, Math.min(256, iconSize));
  const sq = document.createElement('canvas');
  sq.width = size;
  sq.height = size;
  const ctx = sq.getContext('2d');
  if (!ctx) return '';

  const scale = Math.min(size / sourceCanvas.width, size / sourceCanvas.height);
  const dw = sourceCanvas.width * scale;
  const dh = sourceCanvas.height * scale;
  ctx.drawImage(sourceCanvas, (size - dw) / 2, (size - dh) / 2, dw, dh);

  const pngBlob = await new Promise<Blob | null>((resolve) =>
    sq.toBlob((b) => resolve(b), 'image/png')
  );
  if (!pngBlob) return '';
  const pngBytes = new Uint8Array(await pngBlob.arrayBuffer());

  // 6-byte ICONDIR + 16-byte ICONDIRENTRY + PNG payload
  const out = new Uint8Array(22 + pngBytes.length);
  const view = new DataView(out.buffer);
  view.setUint16(0, 0, true); // reserved
  view.setUint16(2, 1, true); // type 1 = ICO
  view.setUint16(4, 1, true); // image count = 1
  out[6] = size >= 256 ? 0 : size; // width (0 means 256)
  out[7] = size >= 256 ? 0 : size; // height
  out[8] = 0; // palette colors
  out[9] = 0; // reserved
  view.setUint16(10, 1, true); // planes
  view.setUint16(12, 32, true); // bpp
  view.setUint32(14, pngBytes.length, true); // payload size
  view.setUint32(18, 22, true); // offset
  out.set(pngBytes, 22);

  const icoBlob = new Blob([out], { type: 'image/x-icon' });
  return await new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () =>
      resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.readAsDataURL(icoBlob);
  });
}

export async function exportCompositeInFormat(params: {
  canvas: HTMLCanvasElement;
  format: ImageExportFormat;
  targetSizePx?: number;
}): Promise<{ dataUrl: string; extension: string }> {
  const { canvas, format, targetSizePx } = params;
  let working = canvas;
  if (targetSizePx && targetSizePx > 0) {
    const scale = targetSizePx / Math.max(canvas.width, canvas.height);
    const scaled = document.createElement('canvas');
    scaled.width = Math.max(1, Math.round(canvas.width * scale));
    scaled.height = Math.max(1, Math.round(canvas.height * scale));
    scaled
      .getContext('2d')
      ?.drawImage(canvas, 0, 0, scaled.width, scaled.height);
    working = scaled;
  }

  if (format === 'ico') {
    const dataUrl = await buildIcoDataUrlFromCanvas(
      working,
      targetSizePx && targetSizePx <= 256 ? targetSizePx : 256
    );
    return { dataUrl, extension: 'ico' };
  }

  if (format === 'svg') {
    const pngData = working.toDataURL('image/png');
    const svg = `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${working.width}" height="${working.height}" viewBox="0 0 ${working.width} ${working.height}">\n  <image href="${pngData}" width="${working.width}" height="${working.height}" />\n</svg>`;
    const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
    const dataUrl = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () =>
        resolve(typeof reader.result === 'string' ? reader.result : '');
      reader.readAsDataURL(blob);
    });
    return { dataUrl, extension: 'svg' };
  }

  if (format === 'jpg') {
    const jpgCanvas = document.createElement('canvas');
    jpgCanvas.width = working.width;
    jpgCanvas.height = working.height;
    const jCtx = jpgCanvas.getContext('2d');
    if (jCtx) {
      jCtx.fillStyle = '#FFFFFF';
      jCtx.fillRect(0, 0, jpgCanvas.width, jpgCanvas.height);
      jCtx.drawImage(working, 0, 0);
    }
    return { dataUrl: jpgCanvas.toDataURL('image/jpeg', 0.94), extension: 'jpg' };
  }

  if (format === 'webp') {
    return { dataUrl: working.toDataURL('image/webp', 0.92), extension: 'webp' };
  }

  return { dataUrl: working.toDataURL('image/png'), extension: 'png' };
}

export async function renderStoryboardSheet(params: {
  title: string;
  brandSubtitle: string;
  slides: StoryboardSlide[];
  layout: StoryboardLayout;
}): Promise<string> {
  const { slides, layout, title, brandSubtitle } = params;
  const canvas = document.createElement('canvas');

  let cols = 2;
  let rows = 2;
  let width = 1600;
  let height = 1600;

  if (layout === 'catalog_3x2') {
    cols = 3;
    rows = 2;
    width = 1800;
    height = 1260;
  } else if (layout === 'reel_1x4') {
    cols = 1;
    rows = 4;
    width = 1080;
    height = 1920;
  }

  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  ctx.fillStyle = '#F7F4EE';
  ctx.fillRect(0, 0, width, height);

  const headerH = 140;
  const footerH = 74;
  const pad = 44;
  const gap = 28;

  ctx.fillStyle = '#0F5C54';
  ctx.fillRect(pad, 36, 8, 68);
  ctx.fillStyle = '#171614';
  ctx.font = '700 38px "IBM Plex Sans Arabic", "Plus Jakarta Sans", sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText(title || 'قصة المنتج — الشمس كرافت', width - pad - 20, 74);
  ctx.fillStyle = '#6B655D';
  ctx.font = '500 22px "IBM Plex Sans Arabic", "Plus Jakarta Sans", sans-serif';
  ctx.fillText(
    brandSubtitle || 'استوديو الشمساوية · صناعة يدوية مصرية أصيلة',
    width - pad - 20,
    110
  );

  const gridTop = headerH + 10;
  const gridH = height - gridTop - footerH;
  const gridW = width - pad * 2;
  const cellW = (gridW - gap * (cols - 1)) / cols;
  const cellH = (gridH - gap * (rows - 1)) / rows;
  const maxSlots = cols * rows;

  for (let i = 0; i < maxSlots; i++) {
    const slide = slides[i];
    const r = Math.floor(i / cols);
    const c = i % cols;
    const x = pad + c * (cellW + gap);
    const y = gridTop + r * (cellH + gap);

    ctx.fillStyle = '#FFFFFF';
    ctx.strokeStyle = '#E2DDD3';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(x, y, cellW, cellH, 16);
    ctx.fill();
    ctx.stroke();

    if (slide) {
      const capH = 92;
      const imgPad = 14;
      const imgBoxW = cellW - imgPad * 2;
      const imgBoxH = cellH - capH - imgPad;
      try {
        const img = await loadImageElement(slide.imageUrl);
        const scale = Math.min(
          imgBoxW / (img.naturalWidth || imgBoxW),
          imgBoxH / (img.naturalHeight || imgBoxH)
        );
        const dw = (img.naturalWidth || imgBoxW) * scale;
        const dh = (img.naturalHeight || imgBoxH) * scale;
        const dx = x + imgPad + (imgBoxW - dw) / 2;
        const dy = y + imgPad + (imgBoxH - dh) / 2;
        ctx.save();
        ctx.beginPath();
        ctx.roundRect(x + imgPad, y + imgPad, imgBoxW, imgBoxH, 10);
        ctx.clip();
        ctx.fillStyle = '#FAF8F4';
        ctx.fillRect(x + imgPad, y + imgPad, imgBoxW, imgBoxH);
        ctx.drawImage(img, dx, dy, dw, dh);
        ctx.restore();
      } catch {
        ctx.fillStyle = '#EFECE5';
        ctx.fillRect(x + imgPad, y + imgPad, imgBoxW, imgBoxH);
      }

      ctx.fillStyle = '#0F5C54';
      ctx.font = '700 20px "IBM Plex Sans Arabic", "Plus Jakarta Sans", sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(
        `${i + 1}. ${slide.title.slice(0, 42)}`,
        x + cellW - 20,
        y + cellH - 54
      );
      ctx.fillStyle = '#57524B';
      ctx.font = '400 18px "IBM Plex Sans Arabic", "Plus Jakarta Sans", sans-serif';
      ctx.fillText(slide.caption.slice(0, 58), x + cellW - 20, y + cellH - 22);
    }
  }

  ctx.fillStyle = '#78716C';
  ctx.font = '500 18px "IBM Plex Sans Arabic", "Plus Jakarta Sans", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(
    'Al-Shamsawya Studio · الشمس كرافت × Taygos APIs',
    width / 2,
    height - 28
  );

  return canvas.toDataURL('image/png');
}

function drawMotionVideoFrame(params: {
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  t: number;
  mode: VideoGenerationMode;
  prompt: string;
  motionStyle: VideoMotionStyle;
  startImg: HTMLImageElement | null;
  endImg: HTMLImageElement | null;
}) {
  const { ctx, width, height, t, mode, prompt, motionStyle, startImg, endImg } =
    params;
  const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;

  const drawCover = (
    img: HTMLImageElement,
    scaleZoom: number,
    panX: number,
    panY: number,
    alpha = 1
  ) => {
    ctx.save();
    ctx.globalAlpha = alpha;
    const baseScale = Math.max(
      width / (img.naturalWidth || width),
      height / (img.naturalHeight || height)
    );
    const finalScale = baseScale * scaleZoom;
    const dw = (img.naturalWidth || width) * finalScale;
    const dh = (img.naturalHeight || height) * finalScale;
    const dx = (width - dw) / 2 + panX;
    const dy = (height - dh) / 2 + panY;
    ctx.drawImage(img, dx, dy, dw, dh);
    ctx.restore();
  };

  const bgGrad = ctx.createLinearGradient(0, 0, width, height);
  bgGrad.addColorStop(0, '#F5EFE4');
  bgGrad.addColorStop(1, '#E3D3BE');
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, width, height);

  if (startImg && endImg && (mode === 'start-end' || mode === 'start-end-prompt')) {
    const z1 = 1 + ease * 0.08;
    const z2 = 1.08 - ease * 0.08;
    drawCover(startImg, z1, -ease * 20, 0, 1 - ease);
    drawCover(endImg, z2, (1 - ease) * 20, 0, ease);
  } else if (startImg) {
    let zoom = 1;
    let panX = 0;
    let panY = 0;
    if (motionStyle === 'gentle_zoom') {
      zoom = 1 + ease * 0.14;
    } else if (motionStyle === 'studio_pan') {
      zoom = 1.1;
      panX = (ease - 0.5) * 60;
    } else if (motionStyle === 'hand_showcase') {
      zoom = 1.06 + Math.sin(t * Math.PI) * 0.05;
      panY = Math.sin(t * Math.PI * 2) * 10;
    } else {
      zoom = 1 + ease * 0.1;
    }
    drawCover(startImg, zoom, panX, panY, 1);

    if (motionStyle === 'sunlight_sweep') {
      const sunX = -width * 0.3 + width * 1.6 * ease;
      const sunGrad = ctx.createLinearGradient(sunX - 180, 0, sunX + 180, height);
      sunGrad.addColorStop(0, 'rgba(255,244,214,0)');
      sunGrad.addColorStop(0.5, 'rgba(255,244,214,0.22)');
      sunGrad.addColorStop(1, 'rgba(255,244,214,0)');
      ctx.fillStyle = sunGrad;
      ctx.fillRect(0, 0, width, height);
    }
  } else {
    ctx.fillStyle = '#0F5C54';
    ctx.globalAlpha = 0.08 + Math.sin(t * Math.PI) * 0.08;
    ctx.beginPath();
    ctx.arc(width * 0.5, height * 0.45, Math.min(width, height) * 0.25 + ease * 60, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;

    ctx.fillStyle = '#171614';
    ctx.font = `700 ${Math.max(26, Math.round(width * 0.036))}px "IBM Plex Sans Arabic", "Plus Jakarta Sans", sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText('الشمس كرافت · استوديو الشمساوية', width / 2, height * 0.44);
  }

  const cleanPrompt = prompt.trim();
  if (cleanPrompt) {
    const scrimH = Math.round(height * 0.16);
    const scrim = ctx.createLinearGradient(0, height - scrimH, 0, height);
    scrim.addColorStop(0, 'rgba(23, 22, 20, 0)');
    scrim.addColorStop(1, 'rgba(23, 22, 20, 0.72)');
    ctx.fillStyle = scrim;
    ctx.fillRect(0, height - scrimH, width, scrimH);

    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.font = `600 ${Math.max(18, Math.round(width * 0.022))}px "IBM Plex Sans Arabic", "Plus Jakarta Sans", sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(cleanPrompt.slice(0, 72), width / 2, height - Math.round(scrimH * 0.3));
  }
}

/**
 * Generates HD/Full-HD video at exact target dimensions (720x720, 1080x1080, 1920x1080, 1080x1920, etc.)
 * Exports real H.264 MP4 via WebCodecs + mp4-muxer when supported, with automatic WebM MediaRecorder fallback.
 */
export async function renderLocalMotionVideo(params: {
  mode: VideoGenerationMode;
  prompt: string;
  startImageUrl?: string;
  endImageUrl?: string;
  width: number;
  height: number;
  durationSec: number;
  motionStyle: VideoMotionStyle;
  format: VideoExportFormat;
  onProgress?: (pct: number) => void;
}): Promise<{ dataUrl: string; formatUsed: VideoExportFormat }> {
  // H.264 requires even dimensions
  const width = params.width % 2 === 0 ? params.width : params.width + 1;
  const height = params.height % 2 === 0 ? params.height : params.height + 1;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D unavailable.');

  const startImg = params.startImageUrl
    ? await loadImageElement(params.startImageUrl).catch(() => null)
    : null;
  const endImg = params.endImageUrl
    ? await loadImageElement(params.endImageUrl).catch(() => null)
    : null;

  const fps = 30;
  const totalFrames = Math.max(60, Math.round(params.durationSec * fps));

  // Try genuine H.264 MP4 encoding via WebCodecs + mp4-muxer when format === 'mp4'
  if (params.format === 'mp4' && typeof VideoEncoder !== 'undefined') {
    try {
      const codecCandidates = ['avc1.4d002a', 'avc1.420028', 'avc1.42001f'];
      let chosenCodec: string | null = null;
      const bitrate = width * height >= 1080 * 1080 ? 6_000_000 : 3_800_000;
      for (const c of codecCandidates) {
        const support = await VideoEncoder.isConfigSupported({
          codec: c,
          width,
          height,
          bitrate,
          framerate: fps,
        });
        if (support.supported) {
          chosenCodec = c;
          break;
        }
      }

      if (chosenCodec) {
        const target = new ArrayBufferTarget();
        const muxer = new Muxer({
          target,
          video: { codec: 'avc', width, height },
          fastStart: 'in-memory',
        });

        const encoder = new VideoEncoder({
          output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
          error: (e) => {
            throw e;
          },
        });
        encoder.configure({
          codec: chosenCodec,
          width,
          height,
          bitrate,
          framerate: fps,
        });

        for (let frame = 0; frame < totalFrames; frame++) {
          const t = frame / Math.max(1, totalFrames - 1);
          drawMotionVideoFrame({
            ctx,
            width,
            height,
            t,
            mode: params.mode,
            prompt: params.prompt,
            motionStyle: params.motionStyle,
            startImg,
            endImg,
          });
          const timestampUs = Math.round((frame * 1_000_000) / fps);
          const vf = new VideoFrame(canvas, { timestamp: timestampUs });
          encoder.encode(vf, { keyFrame: frame % 30 === 0 });
          vf.close();

          if (params.onProgress) {
            params.onProgress(Math.min(99, Math.round(((frame + 1) / totalFrames) * 100)));
          }
          if (frame % 6 === 0) {
            await new Promise((r) => setTimeout(r, 0));
          }
        }

        await encoder.flush();
        encoder.close();
        muxer.finalize();
        if (params.onProgress) params.onProgress(100);

        const mp4Blob = new Blob([target.buffer], { type: 'video/mp4' });
        const dataUrl = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () =>
            resolve(
              typeof reader.result === 'string'
                ? reader.result
                : URL.createObjectURL(mp4Blob)
            );
          reader.readAsDataURL(mp4Blob);
        });
        return { dataUrl, formatUsed: 'mp4' };
      }
    } catch {
      // Fall back cleanly to MediaRecorder below
    }
  }

  // Fallback: MediaRecorder (supports video/mp4 on newer Chrome or video/webm everywhere)
  const stream = canvas.captureStream(fps);
  const mp4Mime = MediaRecorder.isTypeSupported('video/mp4;codecs=avc1')
    ? 'video/mp4;codecs=avc1'
    : MediaRecorder.isTypeSupported('video/mp4')
      ? 'video/mp4'
      : '';
  const webmMime = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
    ? 'video/webm;codecs=vp9'
    : 'video/webm';

  const chosenMime =
    params.format === 'mp4' && mp4Mime ? mp4Mime : webmMime;
  const formatUsed: VideoExportFormat = chosenMime.startsWith('video/mp4')
    ? 'mp4'
    : 'webm';

  const recorder = new MediaRecorder(stream, {
    mimeType: chosenMime,
    videoBitsPerSecond: width * height >= 1080 * 1080 ? 5_500_000 : 3_500_000,
  });

  const chunks: BlobPart[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  };

  const dataUrl = await new Promise<string>((resolve, reject) => {
    recorder.onerror = () => reject(new Error('Video recording failed.'));
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: chosenMime });
      const reader = new FileReader();
      reader.onloadend = () => {
        if (typeof reader.result === 'string') {
          resolve(reader.result);
        } else {
          resolve(URL.createObjectURL(blob));
        }
      };
      reader.readAsDataURL(blob);
    };

    recorder.start(100);
    let frame = 0;

    const renderNext = () => {
      const t = frame / Math.max(1, totalFrames - 1);
      drawMotionVideoFrame({
        ctx,
        width,
        height,
        t,
        mode: params.mode,
        prompt: params.prompt,
        motionStyle: params.motionStyle,
        startImg,
        endImg,
      });

      frame++;
      if (params.onProgress) {
        params.onProgress(Math.min(100, Math.round((frame / totalFrames) * 100)));
      }
      if (frame < totalFrames) {
        setTimeout(renderNext, Math.round(1000 / fps));
      } else {
        recorder.stop();
      }
    };
    renderNext();
  });

  return { dataUrl, formatUsed };
}
