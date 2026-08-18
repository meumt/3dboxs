/**
 * Tasarımı uçtan uca kurar: ayarlar → 2B katmanlar → 3B katı + rapor.
 *
 * İKİ KATMAN VAR (nedeni için bkz. optics.js → completionSize):
 *
 *   DUVAR |<--------------- H ---------------->| LED
 *         |                                     |
 *         |        MASKE        YÜZ             |
 *         |          |           |              |
 *         |<-- H−G ->|           |              |
 *         |<------- zf --------->|              |
 *
 *   MASKE : LED'e G kadar yakın. Çizimi 1/M ölçeğinde taşır; duvardaki keskin
 *           yazıyı bu üretir. Küçüktür ve önden pek görünmez.
 *   YÜZ   : Görünen levha (yuvarlak/kare/dikdörtgen/ok). Çizimi GÖRÜNÜR ölçekte
 *           taşır. Duvardaki yazının, kendi gövdesinin kapattığı orta kısmını
 *           tamamlar — küçük bir kopyasını tekrar etmez.
 *
 * Model yerel koordinatları (mm): z = 0 maskenin duvara bakan yüzü, +z LED'e doğru.
 *   z ∈ [0, Tm]                        maske levhası
 *   z ∈ [faceOffset, faceOffset + Tf]  yüz levhası
 *   z ∈ [Tm, G]                        boyun (lambaya geçen, iki levhayı birleştiren tüp)
 */
import { textToPolygons } from './text.js';
import { buildPlate } from './plate.js';
import { annulus, rimRing } from './housing.js';
import { extrudeToPositions, geometryFromPositions, meshVolume } from './extrude.js';
import { sealOpenEdges } from './seal.js';
import { bounds, multiPolygonArea } from './polygons.js';
import { solve, diagnostics, completionSize, occludedRadius, magnification } from './optics.js';

/** Filament yoğunlukları (g/cm³). */
export const MATERIAL_DENSITY = { PLA: 1.24, PETG: 1.27, ABS: 1.04, ASA: 1.07 };

/**
 * @param {object} design           bkz. src/core/state.js
 * @param {object} resources
 * @param {opentype.Font} resources.font        yazı kaynağı için
 * @param {MultiPolygon} resources.svgPolygons  SVG kaynağı için
 */
export function buildModel(design, { font, svgPolygons } = {}) {
  const warnings = [];
  const errors = [];

  // 1) Optik.
  const optics = solve({
    ledDistance: design.ledDistance,
    maskGap: design.maskGap,
    targetWallWidth: design.targetWallWidth,
    targetWallHeight: design.targetWallHeight,
    ledSize: design.ledSize,
  });

  if (!optics.valid) {
    return {
      ok: false, optics, errors: ['LED mesafesi (H) boşluktan (G) büyük olmalı.'],
      warnings, geometry: null, plate: null, face: null, stats: null, diagnostics: [],
    };
  }

  const M = optics.magnification;

  // 2) Çizimi üret.
  let artwork = [];
  try {
    if (design.source === 'svg') {
      if (!svgPolygons?.length) errors.push('Henüz bir SVG yüklenmedi.');
      artwork = svgPolygons ?? [];
    } else if (!font) {
      errors.push('Font yüklenmedi.');
    } else if (!design.text.trim()) {
      errors.push('Yazı boş.');
    } else {
      artwork = textToPolygons(font, design.text, {
        fontSize: 100,
        letterSpacing: design.letterSpacing,
        lineHeight: design.lineHeight,
        align: design.align,
        curveSteps: 14,
      });
      if (!artwork.length) errors.push('Bu yazı poligona çevrilemedi.');
    }
  } catch (err) {
    errors.push(`Çizim üretilemedi: ${err.message}`);
  }

  if (errors.length) {
    return { ok: false, optics, errors, warnings, geometry: null, plate: null, face: null,
             stats: null, diagnostics: [] };
  }

  // 3) Maske üzerindeki çizim ölçüsü (en-boy kilidi ile).
  const artBounds = bounds(artwork);
  const aspect = artBounds && artBounds.height > 0 ? artBounds.width / artBounds.height : 1;

  let maskArtW = optics.maskWidth;
  let maskArtH = optics.maskHeight;
  if (design.lockAspect) {
    if (maskArtW / maskArtH > aspect) maskArtW = maskArtH * aspect;
    else maskArtH = maskArtW / aspect;
  }

  // Duvarda gerçekte çıkacak ölçü.
  const wallW = maskArtW * M;
  const wallH = maskArtH * M;

  // 4) MASKE katmanı — çizimine göre otomatik boyutlanır.
  const maskMargin = design.maskMargin;
  const minMaskPlate = design.boreDiameter + design.collarThickness * 4 + 4;
  let maskPlateW = Math.max(maskArtW + maskMargin * 2, minMaskPlate);
  let maskPlateH = Math.max(maskArtH + maskMargin * 2, minMaskPlate);
  if (design.maskShape === 'circle') {
    maskPlateW = maskPlateH = Math.max(Math.hypot(maskArtW, maskArtH) + maskMargin * 2, minMaskPlate);
  }

  const mask = buildPlate({
    artwork,
    artworkWidth: maskArtW,
    artworkHeight: maskArtH,
    shape: design.maskShape,
    plateWidth: maskPlateW,
    plateHeight: maskPlateH,
    cornerRadius: 4,
    boreDiameter: design.boreDiameter,
    artworkRotation: design.artworkRotation,
    invert: design.invert,
    frameWidth: design.frameWidth,
    bridgeWidth: design.bridgeWidth,
    bridgesPerIsland: design.bridgesPerIsland,
    autoBridge: design.autoBridge,
  });
  warnings.push(...mask.report.warnings.map((w) => `Maske: ${w}`));

  // 5) YÜZ katmanı — görünen levha; duvardaki yazının kapanan kısmını tamamlar.
  const faceOffset = Math.min(design.faceOffset, design.maskGap - design.plateThickness - 0.5);
  const faceDistanceFromWall = (design.ledDistance - design.maskGap) + faceOffset;

  let face = null;
  let completionW = NaN;
  let completionH = NaN;
  let occludedDiameter = NaN;

  if (design.completeShadow) {
    completionW = completionSize(wallW, design.viewDistance, faceDistanceFromWall);
    completionH = completionSize(wallH, design.viewDistance, faceDistanceFromWall);
    occludedDiameter = 2 * occludedRadius(
      Math.max(design.plateWidth, design.plateHeight) / 2,
      design.viewDistance,
      faceDistanceFromWall,
    );

    face = buildPlate({
      artwork,
      // Çizim levhadan çok daha büyük; difference zaten levha sınırında kırpar.
      // Görünen şey, koca yazının tam da levhanın kapattığı orta parçasıdır.
      artworkWidth: completionW,
      artworkHeight: completionH,
      shape: design.plateShape,
      plateWidth: design.plateWidth,
      plateHeight: design.plateShape === 'circle' || design.plateShape === 'square'
        ? design.plateWidth : design.plateHeight,
      cornerRadius: design.cornerRadius,
      arrowTipRatio: design.arrowTipRatio,
      arrowPointLeft: design.arrowPointLeft,
      boreDiameter: design.boreDiameter,
      artworkRotation: design.artworkRotation,
      invert: design.invert,
      frameWidth: design.frameWidth,
      bridgeWidth: design.bridgeWidth,
      bridgesPerIsland: design.bridgesPerIsland,
      autoBridge: design.autoBridge,
    });
    warnings.push(...face.report.warnings.map((w) => `Yüz levhası: ${w}`));
  }

  // 6) 3B katı.
  const positions = [];
  extrudeToPositions(mask.polygons, positions, { thickness: design.plateThickness, z0: 0 });

  if (face) {
    extrudeToPositions(face.polygons, positions, { thickness: design.plateThickness, z0: faceOffset });
  }

  // Boyun: maskenin üstünden LED düzlemine kadar; yüz levhasını da deler geçer,
  // böylece iki levha tek parça olur.
  const collarHeight = design.autoCollarHeight
    ? Math.max(1, design.maskGap - design.plateThickness)
    : design.collarHeight;

  if (design.collarEnabled && design.boreDiameter > 0 && collarHeight > 0) {
    extrudeToPositions(
      annulus(design.boreDiameter, design.collarThickness),
      positions,
      { thickness: collarHeight, z0: design.plateThickness },
    );
  }

  if (design.rimEnabled && design.rimHeight > 0) {
    const rim = rimRing({
      shape: design.plateShape,
      width: design.plateWidth,
      height: design.plateShape === 'circle' || design.plateShape === 'square'
        ? design.plateWidth : design.plateHeight,
      cornerRadius: design.cornerRadius,
      arrowTipRatio: design.arrowTipRatio,
      arrowPointLeft: design.arrowPointLeft,
      thickness: design.rimThickness,
    });
    if (rim.length) {
      extrudeToPositions(rim, positions, { thickness: design.rimHeight, z0: faceOffset - design.rimHeight });
    }
  }

  const seal = sealOpenEdges(positions);
  if (seal.remaining > 0) {
    warnings.push(
      `Katıda ${seal.remaining} açık kenar kaldı; dilimleyici onarım isteyebilir. ` +
      'Köprü kalınlığını biraz değiştirmek genelde çözer.'
    );
  }

  const geometry = geometryFromPositions(positions);

  // 6b) Işıklı boşluk yüzeyi.
  // Yüz levhası ile maske arasındaki hacim, LED tarafından aydınlatılan kapalı
  // bir boşluktur. Önden bakınca yüz levhasındaki kesiklerden bu aydınlık boşluk
  // görünür — yani tamamlama parçaları PARLAR, arkadaki karanlık duvar değil.
  // Önizlemede bunu, yüz levhasının hemen arkasına koyduğumuz ışıklı bir yüzeyle
  // temsil ediyoruz.
  let glowGeometry = null;
  if (face) {
    const glowPositions = [];
    extrudeToPositions(face.outline, glowPositions, { thickness: 0.4, z0: faceOffset - 0.6 });
    glowGeometry = geometryFromPositions(glowPositions);
  }

  // 7) Rapor.
  const volume = meshVolume(geometry);
  const density = MATERIAL_DENSITY[design.material] ?? MATERIAL_DENSITY.PLA;
  const faceMagnification = magnification({
    ledDistance: design.ledDistance,
    maskGap: design.ledDistance - faceDistanceFromWall,
  });

  const stats = {
    magnification: M,
    faceMagnification,
    maskPlateWidth: maskPlateW,
    maskPlateHeight: maskPlateH,
    artworkWidth: maskArtW,
    artworkHeight: maskArtH,
    plateWidth: design.plateWidth,
    plateHeight: design.plateShape === 'circle' || design.plateShape === 'square'
      ? design.plateWidth : design.plateHeight,
    completionWidth: completionW,
    completionHeight: completionH,
    occludedDiameter,
    faceDistanceFromWall,
    faceOffset,
    collarHeight,
    wallWidth: wallW,
    wallHeight: wallH,
    silhouetteWidth: Math.max(maskPlateW * M, design.plateWidth * (faceMagnification || 1)),
    penumbra: optics.penumbra,
    solidArea: multiPolygonArea(mask.polygons) + (face ? multiPolygonArea(face.polygons) : 0),
    volumeCm3: volume / 1000,
    massGrams: (volume / 1000) * density,
    triangles: positions.length / 9,
    sealedTriangles: seal.sealed,
    openEdges: seal.remaining,
    bridges: mask.report.bridges + (face?.report.bridges ?? 0),
    looseParts: mask.report.looseParts + (face?.report.looseParts ?? 0),
    totalDepth: (design.collarEnabled ? collarHeight + design.plateThickness : faceOffset + design.plateThickness),
  };

  const notes = diagnostics({
    M,
    maskWidth: maskArtW,
    maskHeight: maskArtH,
    plateWidth: maskPlateW,
    plateHeight: maskPlateH,
    penumbra: optics.penumbra,
    targetWallWidth: design.targetWallWidth,
    bedSize: design.bedSize,
    bridgeWidth: design.autoBridge ? design.bridgeWidth : 0,
  });

  if (design.completeShadow && face) {
    notes.push({
      level: 'info',
      text:
        `Yüz levhası duvardaki yazının ${occludedDiameter.toFixed(0)} mm'lik orta kısmını kapatıyor; ` +
        `üzerine ${completionW.toFixed(0)} mm ölçekli çizimin tam o parçası kesildi. ` +
        `${design.viewDistance / 10} cm mesafeden bakınca yazı bütün görünür.`,
    });
  }

  return { ok: true, optics, geometry, glowGeometry, plate: mask, mask, face, stats, warnings, errors: [], diagnostics: notes };
}
