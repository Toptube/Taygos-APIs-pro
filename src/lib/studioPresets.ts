import macrameSampleImg from '../assets/images/sample_macrame_hanging_1795643582536.jpg';
import burlapBagSampleImg from '../assets/images/sample_burlap_bag_1795643582550.jpg';
import wovenMirrorSampleImg from '../assets/images/sample_woven_mirror_1795643582973.jpg';
import type {
  BackgroundConfig,
  CanvasAspectPreset,
  LightingConfig,
  PhotoFilterId,
  ShadowConfig,
  StudioProjectRecord,
  VideoMotionStyle,
  VideoPlatformPreset,
} from '../types/studio';

export const SHAMSAWYA_LOGO_URL = '/assets/aistudio/brand_icon_dark_e73bb75b.png';

export interface StudioSampleProduct {
  id: string;
  titleAr: string;
  titleEn: string;
  craftType: StudioProjectRecord['craftType'];
  imageUrl: string;
  defaultPrompt: string;
}

export const STUDIO_SAMPLE_PRODUCTS: StudioSampleProduct[] = [
  {
    id: 'sample_macrame_hanging',
    titleAr: 'معلقة مكرمية بخرز خشبي',
    titleEn: 'Macrame Wall Hanging',
    craftType: 'macrame',
    imageUrl: macrameSampleImg,
    defaultPrompt:
      'Handmade natural cotton macrame wall hanging craft with wooden beads displayed on a clean warm Egyptian plaster wall bathed in soft golden afternoon sunlight, architectural bohemian interior photography, zero distortion.',
  },
  {
    id: 'sample_burlap_bag',
    titleAr: 'شنطة خيش ومكرمية',
    titleEn: 'Burlap & Macrame Tote',
    craftType: 'bags',
    imageUrl: burlapBagSampleImg,
    defaultPrompt:
      'Artisan handmade woven burlap and cotton macrame tote bag styled on a warm natural wood table beside dried pampas grass in an Egyptian sunlit boutique studio, ultra crisp fabric texture.',
  },
  {
    id: 'sample_woven_mirror',
    titleAr: 'مرآة مكرمية بوهو',
    titleEn: 'Boho Macrame Mirror',
    craftType: 'decor',
    imageUrl: wovenMirrorSampleImg,
    defaultPrompt:
      'Round bohemian macrame wall mirror hanging in a warm modern Egyptian living space with travertine shelf, ceramic vase, and soft natural shadows, editorial interior catalog shot.',
  },
];

export const CANVAS_ASPECT_PRESETS: Array<{
  id: CanvasAspectPreset;
  labelAr: string;
  labelEn: string;
  sub: string;
}> = [
  { id: 'original', labelAr: 'الأصلي', labelEn: 'Original', sub: 'Auto' },
  { id: '1:1', labelAr: 'مربع 1:1', labelEn: 'Square 1:1', sub: '1080×1080' },
  { id: '4:3', labelAr: 'أفقي 4:3', labelEn: 'Classic 4:3', sub: '1200×900' },
  { id: '3:4', labelAr: 'بورتريه 3:4', labelEn: 'Portrait 3:4', sub: '960×1280' },
  { id: '4:5', labelAr: 'إنستجرام 4:5', labelEn: 'Feed 4:5', sub: '1080×1350' },
  { id: '16:9', labelAr: 'يوتيوب 16:9', labelEn: 'Wide 16:9', sub: '1280×720' },
  { id: '9:16', labelAr: 'ستوري 9:16', labelEn: 'Vertical 9:16', sub: '810×1440' },
];

export const PHOTO_FILTER_PRESETS: Array<{
  id: PhotoFilterId;
  labelAr: string;
  labelEn: string;
  swatch: string;
}> = [
  { id: 'none', labelAr: 'بدون فلتر', labelEn: 'Original', swatch: '#E2DDD3' },
  { id: 'studio_clean', labelAr: 'استوديو ناصع', labelEn: 'Studio Crisp', swatch: '#F8FAFC' },
  { id: 'warm_boho', labelAr: 'بوهيمي دافئ', labelEn: 'Warm Boho', swatch: '#EADBC8' },
  { id: 'crisp_knots', labelAr: 'وضوح العقد', labelEn: 'Crisp Texture', swatch: '#CBD5E1' },
  { id: 'rustic_burlap', labelAr: 'خيش ريفي', labelEn: 'Rustic Jute', swatch: '#C9B18C' },
  { id: 'golden_hour', labelAr: 'ساعة ذهبية', labelEn: 'Golden Hour', swatch: '#F59E0B' },
  { id: 'bw_classic', labelAr: 'أبيض وأسود', labelEn: 'Classic B&W', swatch: '#334155' },
  { id: 'soft_pastel', labelAr: 'باستيل ناعم', labelEn: 'Soft Airy', swatch: '#F5E8E4' },
];

export const VIDEO_PLATFORM_PRESETS: VideoPlatformPreset[] = [
  {
    id: 'yt_fhd',
    platform: 'YouTube',
    labelAr: 'يوتيوب عادي (Full HD)',
    labelEn: 'YouTube Standard (1080p)',
    aspectRatio: '16:9',
    width: 1920,
    height: 1080,
    qualityTag: '1920×1080',
  },
  {
    id: 'yt_hd',
    platform: 'YouTube',
    labelAr: 'يوتيوب عادي (HD 720p)',
    labelEn: 'YouTube Standard (720p)',
    aspectRatio: '16:9',
    width: 1280,
    height: 720,
    qualityTag: '1280×720',
  },
  {
    id: 'yt_shorts_fhd',
    platform: 'YouTube Shorts',
    labelAr: 'يوتيوب شورتس / ستوري (Full HD)',
    labelEn: 'YouTube Shorts / Story (1080p)',
    aspectRatio: '9:16',
    width: 1080,
    height: 1920,
    qualityTag: '1080×1920',
  },
  {
    id: 'tiktok_reels_fhd',
    platform: 'TikTok & Reels',
    labelAr: 'تيك توك / إنستجرام ريلز (Full HD)',
    labelEn: 'TikTok & IG Reels (1080p)',
    aspectRatio: '9:16',
    width: 1080,
    height: 1920,
    qualityTag: '1080×1920',
  },
  {
    id: 'tiktok_reels_hd',
    platform: 'TikTok & Reels',
    labelAr: 'تيك توك / ريلز (HD 720p سريع)',
    labelEn: 'TikTok & Reels (720p Fast)',
    aspectRatio: '9:16',
    width: 720,
    height: 1280,
    qualityTag: '720×1280',
  },
  {
    id: 'ig_sq_1080',
    platform: 'Instagram / Store',
    labelAr: 'إنستجرام وفيسبوك مربع (1080×1080)',
    labelEn: 'Instagram Square (1080×1080)',
    aspectRatio: '1:1',
    width: 1080,
    height: 1080,
    qualityTag: '1080×1080',
  },
  {
    id: 'ig_sq_720',
    platform: 'Instagram / Store',
    labelAr: 'متاجر وفيسبوك مربع (720×720)',
    labelEn: 'Store Square (720×720)',
    aspectRatio: '1:1',
    width: 720,
    height: 720,
    qualityTag: '720×720',
  },
  {
    id: 'ig_fb_portrait',
    platform: 'Facebook & IG Feed',
    labelAr: 'بوست إنستجرام وفيسبوك (4:5)',
    labelEn: 'IG & FB Feed Portrait (4:5)',
    aspectRatio: '4:5',
    width: 1080,
    height: 1350,
    qualityTag: '1080×1350',
  },
  {
    id: 'fb_classic_43',
    platform: 'Facebook Classic',
    labelAr: 'كتالوج وفيسبوك كلاسيك (4:3)',
    labelEn: 'Facebook Classic (4:3)',
    aspectRatio: '4:3',
    width: 1200,
    height: 900,
    qualityTag: '1200×900',
  },
];

export const ECOMMERCE_BG_SWATCHES: Array<{
  id: string;
  labelAr: string;
  labelEn: string;
  color: string;
}> = [
  { id: 'white', labelAr: 'أبيض متاجر نقي', labelEn: 'Pure White', color: '#FFFFFF' },
  { id: 'linen', labelAr: 'كتان دافئ', labelEn: 'Warm Linen', color: '#F5EFE6' },
  { id: 'sand', labelAr: 'رملي مصري', labelEn: 'Egyptian Sand', color: '#EADBC8' },
  { id: 'sage', labelAr: 'أخضر مريمية', labelEn: 'Soft Sage', color: '#E5ECE7' },
  { id: 'terracotta', labelAr: 'طيني فاتح', labelEn: 'Light Clay', color: '#EFE1D6' },
  { id: 'charcoal', labelAr: 'فحمي فاخر', labelEn: 'Charcoal', color: '#24211E' },
];

export interface StudioScenePreset {
  id: string;
  titleAr: string;
  titleEn: string;
  descAr: string;
  descEn: string;
  prompt: string;
}

export const STUDIO_SCENE_PRESETS: StudioScenePreset[] = [
  {
    id: 'scene_clean_pedestal',
    titleAr: 'منصة استوديو رخام وترافرتين',
    titleEn: 'Travertine Studio Pedestal',
    descAr: 'خلفية نظيفة للتسوق الإلكتروني مع ظل ناعم',
    descEn: 'Clean e-commerce stage with soft contact shadow',
    prompt:
      'Minimalist commercial studio backdrop featuring a smooth natural travertine stone pedestal, warm cream plaster wall behind, soft diffused directional daylight, clean space in center for handmade craft product placement, ultra realistic.',
  },
  {
    id: 'scene_boho_salon',
    titleAr: 'صالون بوهيمي مصري مشمس',
    titleEn: 'Sunlit Egyptian Boho Living',
    descAr: 'أجواء دافئة بالخشب والخزف ونباتات الظل',
    descEn: 'Warm limewash, reed textures, pottery, and sunbeams',
    prompt:
      'Warm Egyptian bohemian living room backdrop with textured off-white limewash wall, handmade reed accents, terracotta pottery vase, and gentle golden window sunbeams, shallow depth of field background.',
  },
  {
    id: 'scene_sunlit_balcony',
    titleAr: 'بلكونة شمسية وإضاءة ذهبية',
    titleEn: 'Golden Terrace Corner',
    descAr: 'شمس العصر المصرية مع ملمس خشب وكتان',
    descEn: 'Afternoon Egyptian sunlight with wood and linen',
    prompt:
      'Sunlit Egyptian terrace corner backdrop with warm natural wood backdrop, draped unbleached linen fabric, olive branch shadows dancing on limestone wall, calm golden hour ambiance.',
  },
  {
    id: 'scene_artisan_workshop',
    titleAr: 'ورشة الحرفي — الشمس كرافت',
    titleEn: 'Artisan Craft Workshop',
    descAr: 'طاولة خشب طبيعي وبكرات خيوط القطن',
    descEn: 'Natural wood bench with cotton cord & jute spools',
    prompt:
      'Authentic artisan craft workshop wooden table background, spools of raw cotton cord and natural jute twine neatly tucked at edges, warm overhead studio lamp, clean open center area.',
  },
  {
    id: 'scene_hand_model_bag',
    titleAr: 'موديل يد يحمل القطعة',
    titleEn: 'Hand Model Showcase',
    descAr: 'عرض واقعي للشنط والإكسسوارات والمكرمية',
    descEn: 'Lifestyle hand model holding handmade item',
    prompt:
      'Close-up editorial lifestyle photography setting of an artisan woman dressed in neutral cream linen holding up a handmade macrame or burlap craft item in natural warm sunlight, blurred cozy boutique interior behind.',
  },
];

export const VIDEO_MOTION_OPTIONS: Array<{
  id: VideoMotionStyle;
  labelAr: string;
  labelEn: string;
  promptHint: string;
}> = [
  {
    id: 'gentle_zoom',
    labelAr: 'تقريب سينمائي هادئ (Slow Zoom)',
    labelEn: 'Gentle Cinematic Zoom',
    promptHint: 'slow steady push-in camera motion highlighting fine cotton knots and fiber weave',
  },
  {
    id: 'studio_pan',
    labelAr: 'انسياب جانبي استوديو (Studio Pan)',
    labelEn: 'Smooth Studio Pan',
    promptHint: 'smooth horizontal slider pan across the handmade product under soft studio lights',
  },
  {
    id: 'sunlight_sweep',
    labelAr: 'مرور إضاءة شمس دافئة (Sunlight Sweep)',
    labelEn: 'Warm Sunlight Sweep',
    promptHint: 'natural warm afternoon sunlight gently sweeping across the textured craft surface',
  },
  {
    id: 'hand_showcase',
    labelAr: 'استعراض يدوي تفصيلي (Artisan Tilt)',
    labelEn: 'Artisan Handheld Tilt',
    promptHint: 'gentle organic handheld tilt revealing fringe, wooden beads, and natural burlap weave',
  },
  {
    id: 'smooth_morph',
    labelAr: 'انتقال ناعم بين اللقطتين (Start -> End)',
    labelEn: 'Smooth Frame Transition',
    promptHint: 'seamless cinematic transformation connecting the start frame to the end frame while keeping product shape faithful',
  },
];

export const DEFAULT_LIGHTING: LightingConfig = {
  brightness: 0,
  contrast: 0,
  saturation: 0,
  warmth: 0,
  shadows: 0,
  highlights: 0,
  clarity: 15,
  filterId: 'none',
  filterIntensity: 80,
};

export const DEFAULT_SHADOW: ShadowConfig = {
  enabled: true,
  opacity: 0.25,
  blur: 22,
  offsetY: 16,
  spread: 0.72,
};

export const DEFAULT_BACKGROUND: BackgroundConfig = {
  mode: 'white',
  solidColor: '#FFFFFF',
  sceneImageUrl: '',
  aspectPreset: 'original',
  fitMode: 'contain',
  productScale: 1,
  productOffsetX: 0,
  productOffsetY: 0,
};
