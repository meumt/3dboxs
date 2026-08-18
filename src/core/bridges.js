/**
 * Şablon köprüleri.
 *
 * Levhadan yazıyı çıkardığımızda "O", "A", "8" gibi harflerin göbeği levhaya
 * hiçbir yerden bağlanmayan ayrı bir ada olarak kalır — baskıda yere düşer.
 * Burada o adaları bulup ince köprülerle ana gövdeye bağlıyoruz.
 *
 * Köprüler duvara da yansır (harfin içinden geçen ince karanlık çizgi olarak);
 * bu klasik şablon görüntüsüdür ve kaçınılmazdır. Kalınlığı kullanıcı ayarlar.
 */
import polygonClipping from 'polygon-clipping';
import { signedArea, resampleRing } from './polygons.js';

const pc = polygonClipping.default ?? polygonClipping;

/** Bir poligonun dış halkasının mutlak alanı. */
function polygonArea(poly) {
  return Math.abs(signedArea(poly[0]));
}

/** İki nokta kümesi arasındaki en yakın nokta çiftlerini bulur. */
function nearestPairs(islandPoints, bodyPoints, count) {
  const candidates = [];
  for (const a of islandPoints) {
    let best = null;
    for (const b of bodyPoints) {
      const dx = a[0] - b[0], dy = a[1] - b[1];
      const d2 = dx * dx + dy * dy;
      if (!best || d2 < best.d2) best = { a, b, d2 };
    }
    if (best) candidates.push(best);
  }
  candidates.sort((p, q) => p.d2 - q.d2);

  // Köprüleri adanın çevresine yayabilmek için açısal olarak ayrık olanları seç.
  const cx = islandPoints.reduce((s, p) => s + p[0], 0) / islandPoints.length;
  const cy = islandPoints.reduce((s, p) => s + p[1], 0) / islandPoints.length;
  const chosen = [];
  const minAngle = count > 1 ? Math.PI / 3 : 0;

  for (const c of candidates) {
    const angle = Math.atan2(c.a[1] - cy, c.a[0] - cx);
    const clash = chosen.some((p) => {
      let d = Math.abs(p.angle - angle);
      if (d > Math.PI) d = Math.PI * 2 - d;
      return d < minAngle;
    });
    if (!clash) {
      chosen.push({ ...c, angle });
      if (chosen.length >= count) break;
    }
  }
  // Açısal koşul yüzünden yeterli sayıya ulaşamadıysak en yakınlarla tamamla.
  for (const c of candidates) {
    if (chosen.length >= count) break;
    if (!chosen.includes(c)) chosen.push({ ...c, angle: 0 });
  }
  return chosen;
}

/** A ve B noktalarını birleştiren, `width` kalınlığında dikdörtgen köprü. */
function bridgeQuad(a, b, width, overshoot) {
  let dx = b[0] - a[0], dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return null;
  dx /= len; dy /= len;
  const px = -dy, py = dx;              // dikey birim vektör
  const hw = width / 2;
  const ax = a[0] - dx * overshoot, ay = a[1] - dy * overshoot;
  const bx = b[0] + dx * overshoot, by = b[1] + dy * overshoot;
  const ring = [
    [ax + px * hw, ay + py * hw],
    [bx + px * hw, by + py * hw],
    [bx - px * hw, by - py * hw],
    [ax - px * hw, ay - py * hw],
  ];
  ring.push([...ring[0]]);
  return [[ring]];
}

/**
 * Kopuk adaları ana gövdeye köprülerle bağlar.
 *
 * @param {MultiPolygon} mp             boolean sonrası levha
 * @param {object} opts
 * @param {number} opts.width           köprü kalınlığı (mm)
 * @param {number} opts.perIsland       ada başına köprü sayısı
 * @param {number} opts.minIslandArea   bundan küçük adalar tamamen silinir (mm²)
 * @param {number} opts.maxIterations   güvenlik sınırı
 * @returns {{ polygons: MultiPolygon, bridges: number, dropped: number }}
 */
export function bridgeIslands(mp, {
  width = 1.8,
  perIsland = 2,
  minIslandArea = 1.0,
  maxIterations = 60,
} = {}) {
  if (!Array.isArray(mp) || mp.length <= 1) {
    return { polygons: mp ?? [], bridges: 0, dropped: 0 };
  }

  let current = mp;
  let bridgeCount = 0;
  let dropped = 0;

  // Çok küçük kırıntıları at (baskıda zaten tutunamazlar).
  const filtered = current.filter((poly) => {
    if (polygonArea(poly) < minIslandArea) { dropped++; return false; }
    return true;
  });
  current = filtered.length ? filtered : current;

  for (let iter = 0; iter < maxIterations && current.length > 1; iter++) {
    // En büyük poligon ana gövdedir; kalanlar ada.
    let mainIndex = 0;
    let mainArea = -Infinity;
    current.forEach((poly, i) => {
      const a = polygonArea(poly);
      if (a > mainArea) { mainArea = a; mainIndex = i; }
    });

    const main = current[mainIndex];
    const islands = current.filter((_, i) => i !== mainIndex);

    // Ana gövdenin tüm kenarları (dış hat + delik hatları) hedef olabilir.
    const bodyPoints = [];
    for (const ring of main) bodyPoints.push(...resampleRing(ring, 500));

    const quads = [];
    for (const island of islands) {
      const islandPoints = resampleRing(island[0], 220);
      if (!islandPoints.length) continue;
      const pairs = nearestPairs(islandPoints, bodyPoints, Math.max(1, perIsland));
      for (const { a, b } of pairs) {
        const q = bridgeQuad(a, b, width, width * 0.75);
        if (q) { quads.push(q); bridgeCount++; }
      }
    }

    if (!quads.length) break;

    let next = current;
    for (const q of quads) {
      try {
        next = pc.union(next, q);
      } catch {
        // Bu köprü birleşmediyse diğerleriyle devam et.
      }
    }

    if (next.length >= current.length) {
      // İlerleme yok — sonsuz döngüye girmeden çık.
      current = next;
      break;
    }
    current = next;
  }

  return { polygons: current, bridges: bridgeCount, dropped };
}

/** Kaç kopuk parça var? (üretilebilirlik kontrolü) */
export function countLooseParts(mp) {
  return Array.isArray(mp) ? Math.max(0, mp.length - 1) : 0;
}
