import type { FailoverAttempt } from './taygos';

export type StudioToolTab =
  | 'cutout'
  | 'crop'
  | 'lighting'
  | 'scenes'
  | 'dimensions'
  | 'storyboard'
  | 'video'
  | 'projects';

export type RetouchBrushMode = 'none' | 'move' | 'wand' | 'erase' | 'restore';

export type CanvasAspectPreset =
  | 'original'
  | '1:1'
  | '4:3'
  | '3:4'
  | '4:5'
  | '16:9'
  | '9:16';

export type PhotoFilterId =
  | 'none'
  | 'studio_clean'
  | 'warm_boho'
  | 'crisp_knots'
  | 'rustic_burlap'
  | 'golden_hour'
  | 'bw_classic'
  | 'soft_pastel';

export type BackgroundMode =
  | 'transparent'
  | 'white'
  | 'solid'
  | 'boho_gradient'
  | 'scene_image';

export interface LightingConfig {
  brightness: number; // -50 to +50
  contrast: number; // -50 to +50
  saturation: number; // -60 to +60
  warmth: number; // -50 to +50
  shadows: number; // -40 to +50
  highlights: number; // -40 to +40
  clarity: number; // 0 to 100
  filterId: PhotoFilterId;
  filterIntensity: number; // 0 to 100
}

export interface ShadowConfig {
  enabled: boolean;
  opacity: number; // 0 to 0.85
  blur: number; // 4 to 60
  offsetY: number; // -20 to 60
  spread: number; // 0.35 to 1.25
}

export interface BackgroundConfig {
  mode: BackgroundMode;
  solidColor: string;
  sceneImageUrl: string;
  aspectPreset: CanvasAspectPreset;
  fitMode: 'contain' | 'cover';
  productScale: number; // 0.3 to 2.4
  productOffsetX: number; // normalized -0.6 to 0.6
  productOffsetY: number; // normalized -0.6 to 0.6
}

export type ImageExportFormat = 'png' | 'jpg' | 'webp' | 'svg' | 'ico';

export type DimensionStyle = 'arrows' | 'triangles' | 'ticks';

export interface DimensionOverlay {
  id: string;
  label: string;
  valueText: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: string;
  style: DimensionStyle;
  thickness: number;
  fontSize: number;
  showExtensions: boolean;
  visible: boolean;
}

export interface StoryboardSlide {
  id: string;
  title: string;
  caption: string;
  imageUrl: string;
}

export type StoryboardLayout = 'grid_2x2' | 'catalog_3x2' | 'reel_1x4';

export type VideoGenerationMode =
  | 'text-to-video'
  | 'image-to-video'
  | 'image-prompt'
  | 'start-end'
  | 'start-end-prompt';

export type VideoAspectRatio = '16:9' | '9:16' | '1:1' | '4:5' | '4:3';

export type VideoExportFormat = 'mp4' | 'webm';

export interface VideoPlatformPreset {
  id: string;
  platform: string;
  labelAr: string;
  labelEn: string;
  aspectRatio: VideoAspectRatio;
  width: number;
  height: number;
  qualityTag: string;
}

export type VideoMotionStyle =
  | 'gentle_zoom'
  | 'studio_pan'
  | 'sunlight_sweep'
  | 'hand_showcase'
  | 'smooth_morph';

export interface StudioAssetItem {
  id: string;
  kind: 'image' | 'cutout' | 'scene' | 'storyboard' | 'video';
  title: string;
  dataUrl: string;
  mimeType: string;
  createdAt: string;
  providerUsed?: string;
}

export interface StudioProjectRecord {
  id: string;
  title: string;
  craftType: 'macrame' | 'burlap' | 'bags' | 'decor' | 'custom';
  thumbnailDataUrl: string;
  originalDataUrl: string;
  maskDataUrl: string | null;
  activePrompt: string;
  lighting: LightingConfig;
  shadow: ShadowConfig;
  background: BackgroundConfig;
  edgeExpand: number;
  edgeFeather: number;
  dimensions: DimensionOverlay[];
  storyboardSlides: StoryboardSlide[];
  assets: StudioAssetItem[];
  updatedAt: string;
}

export interface CascadeTraceLog {
  id: string;
  taskLabel: string;
  ok: boolean;
  providerName: string;
  modelName: string;
  latencyMs: number;
  failoverTriggered: boolean;
  attempts: FailoverAttempt[];
  message: string;
  timestamp: string;
}
