/**
 * Yazıyı poligonlara çevirir.
 *
 * opentype.js'in `getPath(text, ...)` yolu bazı fontlarda (DejaVu dahil) OpenType
 * özellik tablolarında patlıyor. Bu yüzden dizgiyi glif glif kendimiz kuruyoruz:
 * charToGlyph + advanceWidth + kerning. Bu hem daha sağlam hem de harf aralığı
 * üzerinde tam kontrol veriyor.
 */
import opentype from 'opentype.js';
import polygonClipping from 'polygon-clipping';
import { closeRing } from './polygons.js';

const pc = polygonClipping.default ?? polygonClipping;

const fontCache = new Map();

/** Bir .ttf/.otf dosyasını yükleyip önbelleğe alır. */
export async function loadFont(url) {
  if (fontCache.has(url)) return fontCache.get(url);
  const promise = fetch(url)
    .then((r) => {
      if (!r.ok) throw new Error(`Font yüklenemedi: ${url} (${r.status})`);
      return r.arrayBuffer();
    })
    .then((buf) => opentype.parse(buf));
  fontCache.set(url, promise);
  return promise;
}

/** Kübik Bezier'i düz parçalara böler. */
function flattenCubic(out, x0, y0, x1, y1, x2, y2, x3, y3, steps) {
  for (let i = 1; i <= steps; i++) {
    const t = i / steps, mt = 1 - t;
    const a = mt * mt * mt, b = 3 * mt * mt * t, c = 3 * mt * t * t, d = t * t * t;
    out.push([a * x0 + b * x1 + c * x2 + d * x3, a * y0 + b * y1 + c * y2 + d * y3]);
  }
}

/** Kuadratik Bezier'i düz parçalara böler. */
function flattenQuadratic(out, x0, y0, x1, y1, x2, y2, steps) {
  for (let i = 1; i <= steps; i++) {
    const t = i / steps, mt = 1 - t;
    const a = mt * mt, b = 2 * mt * t, c = t * t;
    out.push([a * x0 + b * x1 + c * x2, a * y0 + b * y1 + c * y2]);
  }
}

/**
 * opentype Path komutlarını halkalara çevirir.
 * opentype y eksenini aşağı pozitif verir; matematiksel yöne çevirmek için negatifliyoruz.
 */
function pathToRings(path, curveSteps) {
  const rings = [];
  let current = null;
  let cx = 0, cy = 0;

  for (const cmd of path.commands) {
    switch (cmd.type) {
      case 'M':
        if (current) { const r = closeRing(current); if (r) rings.push(r); }
        current = [[cmd.x, -cmd.y]];
        cx = cmd.x; cy = -cmd.y;
        break;
      case 'L':
        if (current) current.push([cmd.x, -cmd.y]);
        cx = cmd.x; cy = -cmd.y;
        break;
      case 'C':
        if (current) flattenCubic(current, cx, cy, cmd.x1, -cmd.y1, cmd.x2, -cmd.y2, cmd.x, -cmd.y, curveSteps);
        cx = cmd.x; cy = -cmd.y;
        break;
      case 'Q':
        if (current) flattenQuadratic(current, cx, cy, cmd.x1, -cmd.y1, cmd.x, -cmd.y, curveSteps);
        cx = cmd.x; cy = -cmd.y;
        break;
      case 'Z':
        if (current) { const r = closeRing(current); if (r) rings.push(r); }
        current = null;
        break;
      default:
        break;
    }
  }
  if (current) { const r = closeRing(current); if (r) rings.push(r); }
  return rings;
}

/**
 * Çok satırlı yazıyı MultiPolygon olarak üretir.
 *
 * @param {opentype.Font} font
 * @param {string} text                 satır sonu için \n
 * @param {object} opts
 * @param {number} opts.fontSize        em yüksekliği (mm)
 * @param {number} opts.letterSpacing   em'in oranı olarak ek harf aralığı
 * @param {number} opts.lineHeight      satır yüksekliği çarpanı
 * @param {'left'|'center'|'right'} opts.align
 * @param {number} opts.curveSteps      eğri düzleştirme çözünürlüğü
 * @returns {import('./polygons.js').MultiPolygon}
 */
export function textToPolygons(font, text, {
  fontSize = 100,
  letterSpacing = 0,
  lineHeight = 1.15,
  align = 'center',
  curveSteps = 12,
} = {}) {
  const lines = String(text).split('\n');
  const upm = font.unitsPerEm || 1000;
  const scale = fontSize / upm;
  const spacing = letterSpacing * fontSize;

  // Her satırı önce yerel koordinatlarda kur, genişliğini ölç.
  const laid = lines.map((line) => {
    const glyphs = [];
    let x = 0;
    let prev = null;
    for (const ch of line) {
      const glyph = font.charToGlyph(ch);
      if (prev) {
        const kern = font.getKerningValue(prev, glyph) || 0;
        x += kern * scale;
      }
      glyphs.push({ glyph, x });
      x += (glyph.advanceWidth || 0) * scale + spacing;
      prev = glyph;
    }
    // Son harften sonra eklenen aralığı geri al
    const width = Math.max(0, x - (line.length ? spacing : 0));
    return { glyphs, width };
  });

  const maxWidth = Math.max(0, ...laid.map((l) => l.width));
  const lineStep = fontSize * lineHeight;

  const parts = [];
  laid.forEach((line, i) => {
    let offsetX = 0;
    if (align === 'center') offsetX = (maxWidth - line.width) / 2;
    else if (align === 'right') offsetX = maxWidth - line.width;
    const offsetY = -i * lineStep;

    for (const { glyph, x } of line.glyphs) {
      if (!glyph || glyph.advanceWidth === undefined) continue;
      // getPath(x, y, size): y aşağı pozitif olduğu için taban çizgisini 0 alıyoruz.
      const path = glyph.getPath(offsetX + x, 0, fontSize);
      const rings = pathToRings(path, curveSteps);
      if (!rings.length) continue;
      // Her glifi kendi içinde birleştir: dış hat + karşı boşluklar (delikler)
      // doğru şekilde çözülsün diye tek tek union'a veriyoruz.
      const glyphMp = ringsToMultiPolygon(rings);
      if (glyphMp.length) {
        parts.push(glyphMp.map((poly) => poly.map((ring) => ring.map(([px, py]) => [px, py + offsetY]))));
      }
    }
  });

  if (!parts.length) return [];
  return unionAll(parts);
}

/**
 * Bir glifin ham halkalarını (dış hat + karşı boşluk) doğru delik yapısına çevirir.
 * TrueType sarım kuralı yerine `xor` kullanıyoruz: iç içe halkalar otomatik olarak
 * delik hâline gelir, bu da even-odd davranışına denk düşer ve fontlarda güvenlidir.
 */
function ringsToMultiPolygon(rings) {
  if (!rings.length) return [];
  let acc = [[rings[0]]];
  for (let i = 1; i < rings.length; i++) {
    try {
      acc = pc.xor(acc, [[rings[i]]]);
    } catch {
      // Bozuk halkayı atla, kalanı kurtar.
    }
  }
  return acc;
}

/** Çok sayıda MultiPolygon'u ikili ağaç hâlinde birleştirir (derin özyineleme olmadan). */
export function unionAll(parts) {
  let level = parts.filter((p) => p && p.length);
  if (!level.length) return [];
  while (level.length > 1) {
    const next = [];
    for (let i = 0; i < level.length; i += 2) {
      if (i + 1 < level.length) {
        try {
          next.push(pc.union(level[i], level[i + 1]));
        } catch {
          next.push(level[i]);
          next.push(level[i + 1]);
        }
      } else {
        next.push(level[i]);
      }
    }
    if (next.length === level.length) break; // ilerleme yoksa sonsuz döngüye girme
    level = next;
  }
  return level[0] ?? [];
}
