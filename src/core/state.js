/**
 * Tasarım durumu, varsayılanlar ve hazır ayarlar.
 *
 * ÖNEMLİ: Lamba ölçüleri (H, gövde çapı) kendi lambandan ölçülmelidir.
 * Aşağıdaki değerler makul başlangıç noktalarıdır, kesin ürün verisi değildir.
 * H'yi yanlış girersen duvardaki boyut da yanlış çıkar.
 */

export const FONTS = [
  { name: 'DejaVu Sans Bold',  url: 'fonts/DejaVuSans-Bold.ttf' },
  { name: 'DejaVu Sans',       url: 'fonts/DejaVuSans.ttf' },
  { name: 'DejaVu Serif Bold', url: 'fonts/DejaVuSerif-Bold.ttf' },
  { name: 'DejaVu Mono Bold',  url: 'fonts/DejaVuSansMono-Bold.ttf' },
  { name: 'Liberation Sans Bold',  url: 'fonts/LiberationSans-Bold.ttf' },
  { name: 'Liberation Serif Bold', url: 'fonts/LiberationSerif-Bold.ttf' },
];

/**
 * Lamba hazır ayarları.
 * ledDistance : LED çipinin duvar yüzeyine uzaklığı (mm)
 * boreDiameter: maskenin geçeceği lamba gövdesinin çapı (mm)
 * ledSize     : ışık veren yüzeyin çapı (mm) — kenar keskinliğini belirler
 */
export const LAMP_PRESETS = [
  {
    id: 'ikea-wall',
    name: 'IKEA duvar LED apliği (ölç ve düzelt)',
    ledDistance: 55,
    boreDiameter: 40,
    ledSize: 3,
    note: 'Başlangıç değerleri. Lambanı duvara tak, LED yüzeyinin duvara uzaklığını ve gövde çapını cetvelle ölç.',
  },
  {
    id: 'puck',
    name: 'Puck / spot LED (yassı)',
    ledDistance: 35,
    boreDiameter: 55,
    ledSize: 10,
    note: 'Yassı yuvarlak spotlar için. Geniş ışık yüzeyi kenarları yumuşatır.',
  },
  {
    id: 'pin',
    name: 'Noktasal LED (COB, keskin)',
    ledDistance: 70,
    boreDiameter: 20,
    ledSize: 2,
    note: 'En keskin gölge. Duvardaki yazı en net bununla çıkar.',
  },
];

export function defaultDesign() {
  const preset = LAMP_PRESETS[0];
  return {
    // --- kaynak ---
    source: 'text',                 // 'text' | 'svg'
    text: 'NO\nWAY',
    fontUrl: FONTS[0].url,
    letterSpacing: 0.02,            // em oranı
    lineHeight: 1.05,
    align: 'center',
    artworkRotation: 0,
    invert: false,
    frameWidth: 8,
    svgLightHoles: true,

    // --- hedef (duvarda) ---
    targetWallWidth: 500,           // mm
    targetWallHeight: 500,          // mm
    lockAspect: true,               // yazının en-boy oranını koru

    // --- lamba / optik ---
    lampPreset: preset.id,
    ledDistance: preset.ledDistance, // H
    maskGap: 14,                     // G
    ledSize: preset.ledSize,
    boreDiameter: preset.boreDiameter,

    // --- gölgeyi tamamlama ---
    completeShadow: true,            // yüz levhası duvardaki eksik parçayı tamamlasın
    viewDistance: 2000,              // bakış mesafesi D (mm, duvardan)
    faceOffset: 9,                   // maske ile yüz levhası arası (mm)

    // --- yüz levhası (görünen parça) ---
    plateShape: 'circle',            // circle | square | rect | arrow
    plateWidth: 180,
    plateHeight: 180,

    // --- maske levhası (arkada, yansıtmayı üreten) ---
    maskShape: 'circle',
    maskMargin: 10,
    plateThickness: 2.4,
    cornerRadius: 10,
    arrowTipRatio: 0.22,
    arrowPointLeft: true,

    // --- bağlantı ---
    collarEnabled: true,
    autoCollarHeight: true,
    collarHeight: 12,
    collarThickness: 2.4,
    rimEnabled: false,
    rimHeight: 6,
    rimThickness: 2.4,

    // --- şablon köprüleri ---
    autoBridge: true,
    bridgeWidth: 1.8,
    bridgesPerIsland: 2,

    // --- üretim ---
    material: 'PLA',
    bedSize: 220,

    // --- görünüm ---
    lightColor: '#ffd9a0',
    wallColor: '#2a2f3a',
    intensity: 1.0,
    exposure: 0.42,
  };
}

export function applyLampPreset(design, presetId) {
  const p = LAMP_PRESETS.find((x) => x.id === presetId);
  if (!p) return design;
  return {
    ...design,
    lampPreset: p.id,
    ledDistance: p.ledDistance,
    boreDiameter: p.boreDiameter,
    ledSize: p.ledSize,
  };
}

const STORAGE_KEY = '3dboxs.design.v1';

export function saveDesign(design) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(design)); } catch { /* kota dolu olabilir */ }
}

export function loadDesign() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return { ...defaultDesign(), ...JSON.parse(raw) };
  } catch {
    return null;
  }
}
