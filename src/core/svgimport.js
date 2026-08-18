/**
 * SVG logoyu poligonlara çevirir.
 *
 * İKİ FARKLI "DELİK" GELENEĞİ VAR:
 *
 * 1. Tek yol + alt yollar: "O" harfinin göbeği aynı path'in alt yoludur ve
 *    fill-rule ile delik olur. SVGLoader bunu THREE.Shape.holes olarak verir.
 *
 * 2. Üste açık renk şekil çizmek: logo siyah bir gövde + üzerine beyaz daire
 *    olarak çizilmiştir. Geometrik olarak delik değildir, sadece üstünü boyar.
 *    Hepsini birleştirirsek delikler kaybolur ve maske dolu çıkar.
 *
 * Bu yüzden yolları belge sırasıyla BOYACI MODELİ gibi işliyoruz: koyu dolgular
 * malzemeye eklenir, açık dolgular malzemeden çıkarılır. Tek renkli çizimlerde
 * çıkarma yapılmaz (yoksa beyaz üzerine çizilmiş logo tamamen silinirdi).
 */
import { SVGLoader } from 'three/examples/jsm/loaders/SVGLoader.js';
import polygonClipping from 'polygon-clipping';
import { closeRing } from './polygons.js';
import { unionAll } from './text.js';

const pc = polygonClipping.default ?? polygonClipping;

/** CSS rengini 0..1 aralığında algılanan parlaklığa çevirir. */
function luminance(color) {
  if (!color || color === 'none') return null;
  let r, g, b;
  const hex = String(color).trim();

  if (hex.startsWith('#')) {
    const h = hex.slice(1);
    const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.slice(0, 6);
    const n = parseInt(full, 16);
    if (Number.isNaN(n)) return null;
    r = (n >> 16) & 255; g = (n >> 8) & 255; b = n & 255;
  } else {
    const m = hex.match(/rgba?\(([^)]+)\)/i);
    if (m) {
      const parts = m[1].split(',').map((v) => parseFloat(v));
      [r, g, b] = parts;
    } else {
      const named = { white: [255, 255, 255], black: [0, 0, 0], red: [255, 0, 0],
                      green: [0, 128, 0], blue: [0, 0, 255], yellow: [255, 255, 0],
                      gray: [128, 128, 128], grey: [128, 128, 128] };
      const v = named[hex.toLowerCase()];
      if (!v) return null;
      [r, g, b] = v;
    }
  }
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

/** Bir THREE.Shape'i (delikleriyle) MultiPolygon'a çevirir. */
function shapeToPolygon(shape, curveSegments) {
  const outer = closeRing(shape.getPoints(curveSegments).map((p) => [p.x, -p.y]));
  if (!outer) return null;
  const holes = [];
  for (const hole of shape.holes ?? []) {
    const h = closeRing(hole.getPoints(curveSegments).map((p) => [p.x, -p.y]));
    if (h) holes.push(h);
  }
  return [[outer, ...holes]];
}

/**
 * @param {string} svgText  ham SVG kaynağı
 * @param {object} opts
 * @param {number} opts.curveSegments        eğri başına örnek sayısı
 * @param {boolean} opts.lightFillsAreHoles  açık renkli dolguları delik say
 * @param {number} opts.lightThreshold       "açık" sayılma eşiği (0..1)
 * @returns {{ polygons: MultiPolygon, warnings: string[] }}
 */
export function svgToPolygons(svgText, {
  curveSegments = 16,
  lightFillsAreHoles = true,
  lightThreshold = 0.55,
} = {}) {
  const warnings = [];
  let data;
  try {
    data = new SVGLoader().parse(svgText);
  } catch (err) {
    throw new Error(`SVG okunamadı: ${err.message}`);
  }

  const paths = data.paths ?? [];
  if (!paths.length) throw new Error('SVG içinde çizim yolu bulunamadı.');

  // Belge sırasıyla dolu yolları topla.
  const layers = [];
  let strokeOnlyCount = 0;

  for (const path of paths) {
    const style = path.userData?.style ?? {};
    const fill = style.fill;
    if (fill === undefined || fill === 'none') { strokeOnlyCount++; continue; }

    let shapes;
    try {
      shapes = SVGLoader.createShapes(path);
    } catch {
      continue;
    }

    const parts = [];
    for (const shape of shapes) {
      const poly = shapeToPolygon(shape, curveSegments);
      if (poly) parts.push(poly);
    }
    if (!parts.length) continue;

    layers.push({ polygons: unionAll(parts), lum: luminance(fill) });
  }

  if (strokeOnlyCount > 0 && !layers.length) {
    throw new Error(
      'Bu SVG yalnızca çizgilerden (stroke) oluşuyor, dolu alan yok. ' +
      'Vektör programında konturları "outline/dolgu"ya çevirip tekrar dene.'
    );
  }
  if (strokeOnlyCount > 0) {
    warnings.push(`${strokeOnlyCount} adet yalnızca-kontur yol atlandı (sadece dolu alanlar kesiliyor).`);
  }
  if (!layers.length) throw new Error('SVG içinde dolu alan bulunamadı.');

  // Tek renkli çizimlerde boyacı modeli uygulamıyoruz: beyaz üzerine çizilmiş
  // bir logo tamamen silinirdi.
  const lums = layers.map((l) => l.lum).filter((v) => v !== null);
  const distinct = new Set(lums.map((v) => v.toFixed(3)));
  const usePainter = lightFillsAreHoles && distinct.size > 1;

  let polygons;
  if (!usePainter) {
    polygons = unionAll(layers.map((l) => l.polygons));
  } else {
    polygons = [];
    let subtracted = 0;
    for (const layer of layers) {
      const isHole = layer.lum !== null && layer.lum >= lightThreshold;
      try {
        polygons = isHole
          ? pc.difference(polygons.length ? polygons : [], layer.polygons)
          : pc.union(polygons.length ? polygons : [], layer.polygons);
        if (isHole) subtracted++;
      } catch {
        warnings.push('Bir katman işlenemedi, atlandı.');
      }
    }
    if (subtracted) {
      warnings.push(
        `${subtracted} açık renkli katman delik olarak işlendi. Yanlışsa "Açık renkleri delik say" ` +
        'kutusunu kapat.'
      );
    }
  }

  if (!polygons.length) {
    throw new Error(
      'SVG poligonlara çevrilemedi ya da tüm alanlar delik olarak işlendi. ' +
      '"Açık renkleri delik say" kutusunu kapatmayı dene.'
    );
  }

  return { polygons, warnings };
}
