/**
 * Maske levhasının 2B kurgusu.
 *
 * Sıra:  levha dış hattı  −  sanat eseri (yazı/logo)  −  lamba deliği
 *        →  kopuk adaları köprüle  →  baskıya hazır tek parça
 */
import polygonClipping from 'polygon-clipping';
import {
  circleRing, roundedRectRing, arrowRing, fitInto, bounds, center, rotate, simplify,
} from './polygons.js';
import { bridgeIslands, countLooseParts } from './bridges.js';

const pc = polygonClipping.default ?? polygonClipping;

export const PLATE_SHAPES = {
  circle: 'Yuvarlak',
  square: 'Kare',
  rect: 'Dikdörtgen',
  arrow: 'Ok / yön levhası',
};

/**
 * Levhanın dış hattını üretir.
 * @returns {MultiPolygon}
 */
export function plateOutline({ shape, width, height, cornerRadius = 0, arrowTipRatio = 0.22, arrowPointLeft = true }) {
  switch (shape) {
    case 'circle':
      return [[circleRing(width / 2, 0, 0, 192)]];
    case 'square':
      return [[roundedRectRing(width, width, cornerRadius)]];
    case 'arrow':
      return [[arrowRing(width, height, arrowTipRatio, arrowPointLeft)]];
    case 'rect':
    default:
      return [[roundedRectRing(width, height, cornerRadius)]];
  }
}

/**
 * Levhayı kurar.
 *
 * @param {object} opts
 * @param {MultiPolygon} opts.artwork      ham sanat eseri (ölçeklenmemiş)
 * @param {number} opts.artworkWidth       maske üzerindeki hedef genişlik (mm)
 * @param {number} opts.artworkHeight      maske üzerindeki hedef yükseklik (mm)
 * @param {string} opts.shape              levha biçimi
 * @param {number} opts.plateWidth
 * @param {number} opts.plateHeight
 * @param {number} opts.cornerRadius
 * @param {number} opts.boreDiameter       lambanın geçtiği orta delik (0 = yok)
 * @param {number} opts.artworkRotation    derece
 * @param {boolean} opts.invert            negatif: çizim karanlık, çevresi ışıklı
 * @param {number} opts.frameWidth         negatif modda kenar çerçevesinin kalınlığı
 * @param {number} opts.bridgeWidth
 * @param {number} opts.bridgesPerIsland
 * @param {boolean} opts.autoBridge
 */
export function buildPlate({
  artwork,
  artworkWidth,
  artworkHeight,
  shape = 'circle',
  plateWidth = 160,
  plateHeight = 160,
  cornerRadius = 8,
  arrowTipRatio = 0.22,
  arrowPointLeft = true,
  boreDiameter = 0,
  artworkRotation = 0,
  invert = false,
  frameWidth = 8,
  bridgeWidth = 1.8,
  bridgesPerIsland = 2,
  autoBridge = true,
}) {
  const outline = plateOutline({
    shape, width: plateWidth, height: plateHeight, cornerRadius, arrowTipRatio, arrowPointLeft,
  });

  const report = { bridges: 0, dropped: 0, looseParts: 0, warnings: [] };

  let cut = outline;
  let placedArtwork = [];

  if (artwork && artwork.length && artworkWidth > 0 && artworkHeight > 0) {
    placedArtwork = fitInto(artwork, artworkWidth, artworkHeight, 'contain');
    if (artworkRotation) placedArtwork = center(rotate(placedArtwork, (artworkRotation * Math.PI) / 180));

    try {
      if (invert) {
        // Negatif: ışık çizimin ÇEVRESİNDEN geçsin, çizim karanlık kalsın.
        // Çizimin kendisi malzeme olur; onu ayakta tutacak bir çerçeve gerekir,
        // yoksa ortada havada duran parçalar kalırdı.
        const inner = plateOutline({
          shape,
          width: Math.max(1, plateWidth - frameWidth * 2),
          height: Math.max(1, plateHeight - frameWidth * 2),
          cornerRadius: Math.max(0, cornerRadius - frameWidth),
          arrowTipRatio,
          arrowPointLeft,
        });
        const frame = pc.difference(outline, inner);
        const artInside = pc.intersection(placedArtwork, inner);
        cut = pc.union(frame, artInside);
      } else {
        cut = pc.difference(cut, placedArtwork);
      }
    } catch (err) {
      report.warnings.push(`Çizim levhaya işlenemedi: ${err.message}`);
    }
  }

  if (boreDiameter > 0) {
    const bore = [[circleRing(boreDiameter / 2, 0, 0, 96)]];
    try {
      cut = pc.difference(cut, bore);
    } catch (err) {
      report.warnings.push(`Lamba deliği açılamadı: ${err.message}`);
    }
  }

  // Delik açtıktan sonra kopan göbekleri bağla.
  if (autoBridge) {
    const bridged = bridgeIslands(cut, { width: bridgeWidth, perIsland: bridgesPerIsland });
    cut = bridged.polygons;
    report.bridges = bridged.bridges;
    report.dropped = bridged.dropped;
  }

  // Boolean işlemlerinin bıraktığı eşdoğrusal ara noktaları temizle: bunlar
  // kapak üçgenlemesiyle yan duvarların uyuşmamasına (T-bağlantısı) yol açıyor.
  cut = simplify(cut);

  report.looseParts = countLooseParts(cut);
  if (report.looseParts > 0) {
    report.warnings.push(
      `${report.looseParts} parça hâlâ gövdeye bağlı değil. Köprü kalınlığını artır ` +
      'ya da harf aralığını/boyutunu değiştir.'
    );
  }

  return { polygons: cut, artwork: placedArtwork, outline, report, bounds: bounds(cut) };
}
