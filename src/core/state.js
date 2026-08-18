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
/**
 * Lamba hazır ayarları.
 *
 * lampDiameter : puck'ın çapı (mm) — yuva buna göre açılır
 * lampDepth    : puck'ın yüksekliği (mm) — yuva derinliği
 * luminousFlux : ışık akışı (lümen) — duvardaki aydınlık bundan hesaplanır
 * ledSize      : ışık VEREN yüzeyin çapı (mm) — kenar keskinliğini belirler
 *
 * NOT: H (LED'in duvara uzaklığı) buraya yazılmaz. Puck sadece 1 cm boyunda
 * olduğu için H'yi lamba değil, BİZİM tasarladığımız gövde belirliyor: ayakların
 * boyu ne kadarsa LED duvardan o kadar uzakta durur. H bir tasarım parametresi.
 */
export const LAMP_PRESETS = [
  {
    id: 'ikea-puck',
    name: 'IKEA yuvarlak LED — Ø35 × 10 mm, 65 lm',
    lampDiameter: 35,
    lampDepth: 10,
    luminousFlux: 65,
    ledSize: 28,
    note: 'Ölçüler senin verdiğin değerler. Yayan yüzey geniş (≈28 mm) olduğu için ' +
          'kenarlar yumuşak çıkar; keskinlik istiyorsan diyaframı aç.',
  },
  {
    id: 'ikea-puck-diffuserless',
    name: 'Aynı lamba, difüzörü sökülmüş',
    lampDiameter: 35,
    lampDepth: 10,
    luminousFlux: 55,
    ledSize: 8,
    note: 'Difüzörü çıkarınca yayan yüzey küçülür ve kenarlar belirgin keskinleşir. ' +
          'Bir miktar ışık kaybı olur.',
  },
  {
    id: 'pin',
    name: 'Noktasal LED (COB)',
    lampDiameter: 20,
    lampDepth: 8,
    luminousFlux: 100,
    ledSize: 2,
    note: 'En keskin gölge. Duvardaki yazı en net bununla çıkar.',
  },
  {
    id: 'puck-large',
    name: 'Büyük puck / spot (Ø55)',
    lampDiameter: 55,
    lampDepth: 15,
    luminousFlux: 200,
    ledSize: 40,
    note: 'Bol ışık ama çok yumuşak kenar. Düşük büyütmede kullan.',
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
    targetWallWidth: 300,           // mm
    targetWallHeight: 300,          // mm
    lockAspect: true,               // yazının en-boy oranını koru

    // --- lamba / optik ---
    lampPreset: preset.id,
    lampDiameter: preset.lampDiameter,
    lampDepth: preset.lampDepth,
    luminousFlux: preset.luminousFlux,
    ledSize: preset.ledSize,
    ledDistance: 80,                 // H — gövde derinliği, bizim seçimimiz
    maskGap: 40,                     // G → M = 2.0
    boreDiameter: 0,                 // maskenin ortasında delik yok (puck arkada)

    // --- diyafram ---
    apertureEnabled: false,
    apertureDiameter: 10,

    // --- gölgeyi tamamlama ---
    completeShadow: true,            // yüz levhası duvardaki eksik parçayı tamamlasın
    viewDistance: 2000,              // bakış mesafesi D (mm, duvardan)
    faceOffset: 9,                   // maske ile yüz levhası arası (mm)

    // --- yüz levhası (görünen parça) ---
    plateShape: 'circle',            // circle | square | rect | arrow
    plateWidth: 220,
    plateHeight: 220,

    // --- maske levhası (arkada, yansıtmayı üreten) ---
    maskShape: 'circle',
    maskMargin: 10,
    plateThickness: 2.4,
    cornerRadius: 10,
    arrowTipRatio: 0.22,
    arrowPointLeft: true,

    // --- iskelet ---
    socketThickness: 2.4,
    socketBackPlate: true,
    armCount: 3,
    armWidth: 7,
    armThickness: 4,
    footCount: 3,
    footWidth: 9,
    footThickness: 6,

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
    lampDiameter: p.lampDiameter,
    lampDepth: p.lampDepth,
    luminousFlux: p.luminousFlux,
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
