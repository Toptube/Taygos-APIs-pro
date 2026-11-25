import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Eraser,
  Eye,
  Hand,
  Maximize2,
  Minimize2,
  MousePointer2,
  Paintbrush,
  RotateCw,
  SplitSquareHorizontal,
  Wand2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { computeProductDrawRect } from '../../lib/studioEngine';
import type {
  BackgroundConfig,
  DimensionOverlay,
  RetouchBrushMode,
} from '../../types/studio';
import type { Language } from '../../types/taygos';

interface StudioCanvasProps {
  lang: Language;
  originalCanvas: HTMLCanvasElement | null;
  compositeCanvas: HTMLCanvasElement | null;
  dimensions: DimensionOverlay[];
  selectedDimId: string | null;
  brushMode: RetouchBrushMode;
  brushSize: number;
  background: BackgroundConfig;
  showBeforeAfter: boolean;
  isStageExpanded?: boolean;
  onToggleStageExpand?: () => void;
  onChangeBrushMode: (mode: RetouchBrushMode) => void;
  onToggleBeforeAfter: () => void;
  onSelectDimension: (id: string | null) => void;
  onUpdateDimension: (id: string, patch: Partial<DimensionOverlay>) => void;
  onUpdateBackgroundOffset: (offsetX: number, offsetY: number) => void;
  onUpdateProductScale: (scale: number) => void;
  onMagicWandClick: (maskNormX: number, maskNormY: number) => void;
  onBrushStrokeSegment: (
    x0MaskNorm: number,
    y0MaskNorm: number,
    x1MaskNorm: number,
    y1MaskNorm: number,
    isStrokeStart: boolean
  ) => void;
  onBrushEnd: () => void;
}

type DragTarget =
  | { type: 'p1'; id: string }
  | { type: 'p2'; id: string }
  | {
      type: 'move_dim';
      id: string;
      startNormX: number;
      startNormY: number;
      origX1: number;
      origY1: number;
      origX2: number;
      origY2: number;
    }
  | {
      type: 'move_product';
      startNormX: number;
      startNormY: number;
      origOffX: number;
      origOffY: number;
    };

export const StudioCanvas: React.FC<StudioCanvasProps> = ({
  lang,
  originalCanvas,
  compositeCanvas,
  dimensions,
  selectedDimId,
  brushMode,
  brushSize,
  background,
  showBeforeAfter,
  isStageExpanded = false,
  onToggleStageExpand,
  onChangeBrushMode,
  onToggleBeforeAfter,
  onSelectDimension,
  onUpdateDimension,
  onUpdateBackgroundOffset,
  onUpdateProductScale,
  onMagicWandClick,
  onBrushStrokeSegment,
  onBrushEnd,
}) => {
  const displayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const stageContainerRef = useRef<HTMLDivElement | null>(null);
  const [stageBox, setStageBox] = useState<{ w: number; h: number }>({
    w: 500,
    h: 500,
  });
  const [viewZoom, setViewZoom] = useState<number>(1);
  const [splitPct, setSplitPct] = useState<number>(50);
  const [cursorPos, setCursorPos] = useState<{ x: number; y: number } | null>(null);
  const [dragTarget, setDragTarget] = useState<DragTarget | null>(null);
  const [activeAngleDeg, setActiveAngleDeg] = useState<number | null>(null);
  const isBrushingRef = useRef(false);
  const lastMaskPointRef = useRef<{ mx: number; my: number } | null>(null);

  const canvasW = compositeCanvas?.width || originalCanvas?.width || 1000;
  const canvasH = compositeCanvas?.height || originalCanvas?.height || 1000;
  const prodW = originalCanvas?.width || canvasW;
  const prodH = originalCanvas?.height || canvasH;

  // Measure available stage space so canvas ALWAYS fits crisply inside without awkward clipping
  useEffect(() => {
    const el = stageContainerRef.current;
    if (!el) return;
    const measure = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        setStageBox({
          w: Math.max(120, rect.width - 20),
          h: Math.max(120, rect.height - 20),
        });
      }
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const fitScale = Math.min(stageBox.w / canvasW, stageBox.h / canvasH);
  const frameDisplayW = Math.max(120, Math.round(canvasW * fitScale * viewZoom));
  const frameDisplayH = Math.max(120, Math.round(canvasH * fitScale * viewZoom));

  // Render live display canvas + synchronous Before/After comparison overlay
  useEffect(() => {
    const out = displayCanvasRef.current;
    if (!out || !compositeCanvas) return;
    if (out.width !== compositeCanvas.width || out.height !== compositeCanvas.height) {
      out.width = compositeCanvas.width;
      out.height = compositeCanvas.height;
    }
    const ctx = out.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, out.width, out.height);
    ctx.drawImage(compositeCanvas, 0, 0);

    if (showBeforeAfter && originalCanvas) {
      const splitX = Math.round((splitPct / 100) * out.width);
      const { drawX, drawY, drawW, drawH } = computeProductDrawRect(
        out.width,
        out.height,
        originalCanvas.width,
        originalCanvas.height,
        background
      );
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, splitX, out.height);
      ctx.clip();
      ctx.fillStyle = '#EDE7DC';
      ctx.fillRect(0, 0, splitX, out.height);
      ctx.drawImage(originalCanvas, drawX, drawY, drawW, drawH);
      ctx.restore();

      ctx.save();
      ctx.strokeStyle = '#F59E0B';
      ctx.lineWidth = Math.max(2, out.width * 0.003);
      ctx.beginPath();
      ctx.moveTo(splitX, 0);
      ctx.lineTo(splitX, out.height);
      ctx.stroke();
      ctx.restore();
    }
  }, [compositeCanvas, originalCanvas, showBeforeAfter, splitPct, background]);

  const toCanvasNormalized = useCallback((clientX: number, clientY: number) => {
    const el = displayCanvasRef.current;
    if (!el) return { nx: 0.5, ny: 0.5 };
    const rect = el.getBoundingClientRect();
    const nx = Math.max(0, Math.min(1, (clientX - rect.left) / Math.max(1, rect.width)));
    const ny = Math.max(0, Math.min(1, (clientY - rect.top) / Math.max(1, rect.height)));
    return { nx, ny };
  }, []);

  const toMaskNormalized = useCallback(
    (clientX: number, clientY: number): { mx: number; my: number } | null => {
      const { nx, ny } = toCanvasNormalized(clientX, clientY);
      const canvasPxX = nx * canvasW;
      const canvasPxY = ny * canvasH;
      const { drawX, drawY, drawW, drawH } = computeProductDrawRect(
        canvasW,
        canvasH,
        prodW,
        prodH,
        background
      );
      const mx = (canvasPxX - drawX) / Math.max(1, drawW);
      const my = (canvasPxY - drawY) / Math.max(1, drawH);
      if (mx < 0 || mx > 1 || my < 0 || my > 1) return null;
      return { mx, my };
    },
    [toCanvasNormalized, canvasW, canvasH, prodW, prodH, background]
  );

  const handleCanvasPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (brushMode === 'wand') {
      const m = toMaskNormalized(e.clientX, e.clientY);
      if (m) onMagicWandClick(m.mx, m.my);
      return;
    }

    if (brushMode === 'erase' || brushMode === 'restore') {
      const m = toMaskNormalized(e.clientX, e.clientY);
      if (!m) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      isBrushingRef.current = true;
      lastMaskPointRef.current = m;
      onBrushStrokeSegment(m.mx, m.my, m.mx, m.my, true);
      return;
    }

    if (brushMode === 'move') {
      e.currentTarget.setPointerCapture(e.pointerId);
      const { nx, ny } = toCanvasNormalized(e.clientX, e.clientY);
      setDragTarget({
        type: 'move_product',
        startNormX: nx,
        startNormY: ny,
        origOffX: background.productOffsetX,
        origOffY: background.productOffsetY,
      });
    }
  };

  const handleCanvasPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const el = displayCanvasRef.current;
    if (el) {
      const rect = el.getBoundingClientRect();
      setCursorPos({
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      });
    }

    if (
      isBrushingRef.current &&
      (brushMode === 'erase' || brushMode === 'restore')
    ) {
      const m = toMaskNormalized(e.clientX, e.clientY);
      if (m) {
        const prev = lastMaskPointRef.current || m;
        onBrushStrokeSegment(prev.mx, prev.my, m.mx, m.my, false);
        lastMaskPointRef.current = m;
      }
      return;
    }

    if (dragTarget?.type === 'move_product') {
      const { nx, ny } = toCanvasNormalized(e.clientX, e.clientY);
      const nextX = Math.max(
        -0.65,
        Math.min(0.65, dragTarget.origOffX + (nx - dragTarget.startNormX))
      );
      const nextY = Math.max(
        -0.65,
        Math.min(0.65, dragTarget.origOffY + (ny - dragTarget.startNormY))
      );
      onUpdateBackgroundOffset(nextX, nextY);
    }
  };

  const handleCanvasPointerUp = () => {
    if (isBrushingRef.current) {
      isBrushingRef.current = false;
      lastMaskPointRef.current = null;
      onBrushEnd();
    }
    if (dragTarget?.type === 'move_product') {
      setDragTarget(null);
    }
  };

  useEffect(() => {
    if (!dragTarget || dragTarget.type === 'move_product') return;

    const handleWindowMove = (e: PointerEvent) => {
      const { nx, ny } = toCanvasNormalized(e.clientX, e.clientY);
      const dim = dimensions.find((d) => d.id === dragTarget.id);
      if (!dim) return;

      if (dragTarget.type === 'p1') {
        const angleDeg = Math.round(
          ((Math.atan2(dim.y2 - ny, dim.x2 - nx) * 180) / Math.PI + 360) % 360
        );
        setActiveAngleDeg(angleDeg);
        onUpdateDimension(dim.id, { x1: nx, y1: ny });
      } else if (dragTarget.type === 'p2') {
        const angleDeg = Math.round(
          ((Math.atan2(ny - dim.y1, nx - dim.x1) * 180) / Math.PI + 360) % 360
        );
        setActiveAngleDeg(angleDeg);
        onUpdateDimension(dim.id, { x2: nx, y2: ny });
      } else if (dragTarget.type === 'move_dim') {
        const dx = nx - dragTarget.startNormX;
        const dy = ny - dragTarget.startNormY;
        onUpdateDimension(dim.id, {
          x1: Math.max(0.02, Math.min(0.98, dragTarget.origX1 + dx)),
          y1: Math.max(0.02, Math.min(0.98, dragTarget.origY1 + dy)),
          x2: Math.max(0.02, Math.min(0.98, dragTarget.origX2 + dx)),
          y2: Math.max(0.02, Math.min(0.98, dragTarget.origY2 + dy)),
        });
      }
    };

    const handleWindowUp = () => {
      setDragTarget(null);
      setActiveAngleDeg(null);
    };

    window.addEventListener('pointermove', handleWindowMove);
    window.addEventListener('pointerup', handleWindowUp);
    return () => {
      window.removeEventListener('pointermove', handleWindowMove);
      window.removeEventListener('pointerup', handleWindowUp);
    };
  }, [dragTarget, dimensions, onUpdateDimension, toCanvasNormalized]);

  const { drawW } = computeProductDrawRect(canvasW, canvasH, prodW, prodH, background);
  const displayScale = frameDisplayW / Math.max(1, canvasW);
  const brushDisplayRadius = Math.max(
    4,
    brushSize * (drawW / Math.max(1, prodW)) * displayScale
  );

  const cursorModeOptions: Array<{
    id: RetouchBrushMode;
    labelAr: string;
    labelEn: string;
    icon: React.ComponentType<{ className?: string }>;
  }> = [
    { id: 'none', labelAr: 'تحديد', labelEn: 'Select', icon: MousePointer2 },
    { id: 'move', labelAr: 'تحريك', labelEn: 'Move', icon: Hand },
    { id: 'wand', labelAr: 'سحرية', labelEn: 'Wand', icon: Wand2 },
    { id: 'erase', labelAr: 'ممحاة', labelEn: 'Eraser', icon: Eraser },
    { id: 'restore', labelAr: 'استعادة', labelEn: 'Restore', icon: Paintbrush },
  ];

  return (
    <div className="flex flex-col h-full bg-[#EBE5D9] text-slate-900 overflow-hidden select-none">
      {/* Compact Top Viewport Strip */}
      <div className="bg-[#FAF8F4] border-b border-[#E0D9CA] px-2.5 sm:px-3 py-1.5 flex items-center justify-between gap-2 text-xs shrink-0">
        <div className="flex items-center gap-1.5 min-w-0">
          <button
            type="button"
            onClick={onToggleBeforeAfter}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors whitespace-nowrap ${
              showBeforeAfter
                ? 'bg-[#B47B2B] text-white'
                : 'bg-[#EFECE4] text-slate-800 hover:bg-[#E4DDD0]'
            }`}
          >
            <SplitSquareHorizontal className="w-3.5 h-3.5 shrink-0" />
            <span>{lang === 'ar' ? 'قبل / بعد' : 'Before / After'}</span>
          </button>

          {showBeforeAfter && (
            <div className="flex items-center gap-1.5 bg-[#EFECE4] rounded-md px-2 py-1">
              <Eye className="w-3 h-3 text-[#B47B2B] shrink-0" />
              <input
                type="range"
                min={5}
                max={95}
                value={splitPct}
                onChange={(e) => setSplitPct(Number(e.target.value))}
                className="w-14 sm:w-20 accent-[#B47B2B]"
              />
            </div>
          )}

          <span className="hidden md:inline font-mono text-[11px] text-slate-500 tabular-nums">
            {canvasW}×{canvasH}px
          </span>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {activeAngleDeg !== null && (
            <span className="inline-flex items-center gap-1 font-mono text-[11px] font-semibold text-amber-800 bg-amber-100 border border-amber-300 px-2 py-0.5 rounded">
              <RotateCw className="w-3 h-3" />
              {activeAngleDeg}°
            </span>
          )}

          {/* Product Zoom Quick Controls */}
          <div className="flex items-center bg-[#EFECE4] rounded-md overflow-hidden border border-[#DFD7C8]">
            <button
              type="button"
              onClick={() =>
                onUpdateProductScale(
                  Math.max(0.3, Number((background.productScale - 0.1).toFixed(2)))
                )
              }
              title={lang === 'ar' ? 'تصغير المنتج' : 'Scale Down'}
              className="p-1.5 hover:bg-[#E4DDD0] text-slate-800"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => onUpdateProductScale(1)}
              title={lang === 'ar' ? 'حجم طبيعي 100%' : 'Reset Scale (100%)'}
              className="px-1.5 sm:px-2 py-1 text-[11px] font-mono tabular-nums text-slate-900 hover:bg-[#E4DDD0] border-x border-[#DFD7C8]"
            >
              {Math.round(background.productScale * 100)}%
            </button>
            <button
              type="button"
              onClick={() =>
                onUpdateProductScale(
                  Math.min(2.4, Number((background.productScale + 0.1).toFixed(2)))
                )
              }
              title={lang === 'ar' ? 'تكبير المنتج' : 'Scale Up'}
              className="p-1.5 hover:bg-[#E4DDD0] text-slate-800"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
          </div>

          <select
            value={viewZoom}
            onChange={(e) => setViewZoom(Number(e.target.value))}
            aria-label={lang === 'ar' ? 'تكبير العرض' : 'View Zoom'}
            className="hidden sm:block bg-[#EFECE4] text-slate-800 text-[11px] font-mono px-2 py-1 rounded-md border border-[#DFD7C8] focus:outline-none"
          >
            <option value={0.85}>85%</option>
            <option value={1}>Fit</option>
            <option value={1.35}>135%</option>
            <option value={1.75}>175%</option>
          </select>

          {onToggleStageExpand && (
            <button
              type="button"
              onClick={onToggleStageExpand}
              title={
                isStageExpanded
                  ? lang === 'ar'
                    ? 'تصغير مساحة الصورة'
                    : 'Collapse Preview'
                  : lang === 'ar'
                    ? 'تكبير مساحة الصورة'
                    : 'Expand Preview'
              }
              className="lg:hidden p-1.5 rounded-md bg-[#EFECE4] text-slate-800 hover:bg-[#E4DDD0] border border-[#DFD7C8]"
            >
              {isStageExpanded ? (
                <Minimize2 className="w-3.5 h-3.5" />
              ) : (
                <Maximize2 className="w-3.5 h-3.5" />
              )}
            </button>
          )}
        </div>
      </div>

      {/* Main Centered Stage Frame (Warm Stone Backdrop, Zero Black Voids) */}
      <div
        ref={stageContainerRef}
        className="flex-1 min-h-0 overflow-auto flex items-center justify-center p-2 sm:p-4 relative bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.45)_0%,transparent_75%)]"
      >
        {!compositeCanvas ? (
          <div className="text-xs text-slate-500">
            {lang === 'ar' ? 'جارٍ تجهيز مساحة العمل...' : 'Loading canvas...'}
          </div>
        ) : (
          <div
            className="relative shadow-lg rounded-lg overflow-hidden border border-[#D8D0C0] shrink-0"
            style={{
              width: `${frameDisplayW}px`,
              height: `${frameDisplayH}px`,
              backgroundImage:
                'linear-gradient(45deg, #E2DDD2 25%, transparent 25%), linear-gradient(-45deg, #E2DDD2 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #E2DDD2 75%), linear-gradient(-45deg, transparent 75%, #E2DDD2 75%)',
              backgroundSize: '16px 16px',
              backgroundPosition: '0 0, 0 8px, 8px -8px, -8px 0px',
              backgroundColor: '#F5F2EB',
            }}
          >
            <canvas
              ref={displayCanvasRef}
              onPointerDown={handleCanvasPointerDown}
              onPointerMove={handleCanvasPointerMove}
              onPointerUp={handleCanvasPointerUp}
              onPointerLeave={() => {
                setCursorPos(null);
                handleCanvasPointerUp();
              }}
              className={`w-full h-full block touch-none ${
                brushMode === 'erase' || brushMode === 'restore'
                  ? 'cursor-none'
                  : brushMode === 'wand'
                    ? 'cursor-crosshair'
                    : brushMode === 'move'
                      ? 'cursor-grab active:cursor-grabbing'
                      : 'cursor-default'
              }`}
            />

            {/* Precision Brush Ring */}
            {(brushMode === 'erase' || brushMode === 'restore') && cursorPos && (
              <div
                className="pointer-events-none absolute rounded-full border-2 shadow-sm"
                style={{
                  width: brushDisplayRadius * 2,
                  height: brushDisplayRadius * 2,
                  left: cursorPos.x - brushDisplayRadius,
                  top: cursorPos.y - brushDisplayRadius,
                  borderColor: brushMode === 'erase' ? '#EF4444' : '#10B981',
                  backgroundColor:
                    brushMode === 'erase'
                      ? 'rgba(239, 68, 68, 0.14)'
                      : 'rgba(16, 185, 129, 0.14)',
                }}
              />
            )}

            {/* 360 SVG Dimension Overlays */}
            {brushMode !== 'erase' &&
              brushMode !== 'restore' &&
              brushMode !== 'wand' &&
              dimensions.some((d) => d.visible) && (
                <svg
                  viewBox={`0 0 ${canvasW} ${canvasH}`}
                  className="absolute inset-0 w-full h-full pointer-events-none"
                >
                  {dimensions
                    .filter((d) => d.visible)
                    .map((dim) => {
                      const x1 = dim.x1 * canvasW;
                      const y1 = dim.y1 * canvasH;
                      const x2 = dim.x2 * canvasW;
                      const y2 = dim.y2 * canvasH;
                      const dx = x2 - x1;
                      const dy = y2 - y1;
                      const angleRad = Math.atan2(dy, dx);
                      const angleDeg = (angleRad * 180) / Math.PI;
                      const midX = (x1 + x2) / 2;
                      const midY = (y1 + y2) / 2;
                      const ext = 12 + dim.thickness * 1.5;
                      const nx = -Math.sin(angleRad) * ext;
                      const ny = Math.cos(angleRad) * ext;
                      const headLen = 10 + dim.thickness * 2;
                      const isSelected = selectedDimId === dim.id;
                      const fullText = [dim.label.trim(), dim.valueText.trim()]
                        .filter(Boolean)
                        .join(': ');
                      let textDeg = angleDeg;
                      if (textDeg > 90 || textDeg < -90) textDeg += 180;
                      const approxW = Math.max(
                        76,
                        fullText.length * (dim.fontSize * 0.62) + 26
                      );
                      const boxH = dim.fontSize + 14;

                      return (
                        <g key={dim.id} className="pointer-events-auto">
                          {dim.showExtensions && (
                            <g
                              stroke={dim.color}
                              strokeWidth={dim.thickness}
                              strokeLinecap="round"
                            >
                              <line x1={x1 - nx} y1={y1 - ny} x2={x1 + nx} y2={y1 + ny} />
                              <line x1={x2 - nx} y1={y2 - ny} x2={x2 + nx} y2={y2 + ny} />
                            </g>
                          )}

                          <line
                            x1={x1}
                            y1={y1}
                            x2={x2}
                            y2={y2}
                            stroke={dim.color}
                            strokeWidth={dim.thickness}
                            strokeLinecap="round"
                            className="cursor-move"
                            onPointerDown={(e) => {
                              e.stopPropagation();
                              onSelectDimension(dim.id);
                              const { nx: sx, ny: sy } = toCanvasNormalized(
                                e.clientX,
                                e.clientY
                              );
                              setDragTarget({
                                type: 'move_dim',
                                id: dim.id,
                                startNormX: sx,
                                startNormY: sy,
                                origX1: dim.x1,
                                origY1: dim.y1,
                                origX2: dim.x2,
                                origY2: dim.y2,
                              });
                            }}
                          />

                          <g transform={`translate(${x1}, ${y1}) rotate(${angleDeg})`}>
                            {dim.style === 'triangles' ? (
                              <polygon
                                points={`0,0 ${headLen},${-headLen * 0.42} ${headLen},${headLen * 0.42}`}
                                fill={dim.color}
                              />
                            ) : dim.style === 'arrows' ? (
                              <polyline
                                points={`${headLen},${-headLen * 0.42} 0,0 ${headLen},${headLen * 0.42}`}
                                fill="none"
                                stroke={dim.color}
                                strokeWidth={dim.thickness}
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                            ) : (
                              <circle r={dim.thickness * 1.6} fill={dim.color} />
                            )}
                          </g>

                          <g transform={`translate(${x2}, ${y2}) rotate(${angleDeg + 180})`}>
                            {dim.style === 'triangles' ? (
                              <polygon
                                points={`0,0 ${headLen},${-headLen * 0.42} ${headLen},${headLen * 0.42}`}
                                fill={dim.color}
                              />
                            ) : dim.style === 'arrows' ? (
                              <polyline
                                points={`${headLen},${-headLen * 0.42} 0,0 ${headLen},${headLen * 0.42}`}
                                fill="none"
                                stroke={dim.color}
                                strokeWidth={dim.thickness}
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                            ) : (
                              <circle r={dim.thickness * 1.6} fill={dim.color} />
                            )}
                          </g>

                          {fullText && (
                            <g
                              transform={`translate(${midX}, ${midY}) rotate(${textDeg})`}
                              className="cursor-move"
                              onPointerDown={(e) => {
                                e.stopPropagation();
                                onSelectDimension(dim.id);
                                const { nx: sx, ny: sy } = toCanvasNormalized(
                                  e.clientX,
                                  e.clientY
                                );
                                setDragTarget({
                                  type: 'move_dim',
                                  id: dim.id,
                                  startNormX: sx,
                                  startNormY: sy,
                                  origX1: dim.x1,
                                  origY1: dim.y1,
                                  origX2: dim.x2,
                                  origY2: dim.y2,
                                });
                              }}
                            >
                              <rect
                                x={-approxW / 2}
                                y={-boxH / 2}
                                width={approxW}
                                height={boxH}
                                rx={8}
                                fill="rgba(255,255,255,0.95)"
                                stroke={isSelected ? '#B47B2B' : dim.color}
                                strokeWidth={isSelected ? 2.5 : 1.5}
                              />
                              <text
                                x={0}
                                y={1}
                                textAnchor="middle"
                                dominantBaseline="middle"
                                fill="#171614"
                                fontSize={dim.fontSize}
                                fontWeight="600"
                                fontFamily='"IBM Plex Sans Arabic", "Plus Jakarta Sans", sans-serif'
                              >
                                {fullText}
                              </text>
                            </g>
                          )}

                          <circle
                            cx={x1}
                            cy={y1}
                            r={isSelected ? 12 : 9}
                            fill={isSelected ? '#B47B2B' : '#FFFFFF'}
                            stroke="#0F5C54"
                            strokeWidth={2.5}
                            className="cursor-grab active:cursor-grabbing"
                            onPointerDown={(e) => {
                              e.stopPropagation();
                              onSelectDimension(dim.id);
                              setDragTarget({ type: 'p1', id: dim.id });
                            }}
                          />
                          <circle
                            cx={x2}
                            cy={y2}
                            r={isSelected ? 12 : 9}
                            fill={isSelected ? '#B47B2B' : '#FFFFFF'}
                            stroke="#0F5C54"
                            strokeWidth={2.5}
                            className="cursor-grab active:cursor-grabbing"
                            onPointerDown={(e) => {
                              e.stopPropagation();
                              onSelectDimension(dim.id);
                              setDragTarget({ type: 'p2', id: dim.id });
                            }}
                          />
                        </g>
                      );
                    })}
                </svg>
              )}
          </div>
        )}
      </div>

      {/* Zero-Clipping 5-Column Grid Mode Strip */}
      <div className="bg-[#FAF8F4] border-t border-[#E0D9CA] px-2 py-1.5 grid grid-cols-5 sm:flex sm:items-center sm:justify-center gap-1.5 shrink-0">
        {cursorModeOptions.map((opt) => {
          const Icon = opt.icon;
          const active = brushMode === opt.id;
          return (
            <button
              key={opt.id}
              type="button"
              onClick={() => onChangeBrushMode(opt.id)}
              className={`flex flex-col sm:flex-row items-center justify-center gap-0.5 sm:gap-1.5 px-1 sm:px-3 py-1.5 rounded-lg text-[10px] sm:text-xs font-medium transition-colors whitespace-nowrap ${
                active
                  ? opt.id === 'erase'
                    ? 'bg-red-600 text-white'
                    : opt.id === 'wand'
                      ? 'bg-[#B47B2B] text-white'
                      : 'bg-[#0F5C54] text-white'
                  : 'bg-[#EFECE4] text-slate-700 hover:bg-[#E4DDD0]'
              }`}
            >
              <Icon className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">{lang === 'ar' ? opt.labelAr : opt.labelEn}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
};
