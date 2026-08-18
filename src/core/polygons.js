/**
 * Poligon yardımcıları.
 *
 * Tüm modüller boyunca `polygon-clipping` veri biçimini kullanıyoruz:
 *   Ring        = [[x, y], ...]        (kapalı; ilk nokta == son nokta)
 *   Polygon     = [outerRing, ...holeRings]
 *   MultiPolygon= [Polygon, ...]
 *
 * Birim her yerde milimetredir ve y ekseni yukarı bakar.
 */

/** Bir halkanın işaretli alanı. Pozitif = CCW (dış), negatif = CW (delik). */
export function signedArea(ring) {
  let a = 0;
  for (let i = 0, n = ring.length - 1; i < n; i++) {
    const [x0, y0] = ring[i];
    const [x1, y1] = ring[i + 1];
    a += x0 * y1 - x1 * y0;
  }
  return a / 2;
}

/** Delikler çıkarılmış toplam yüzey alanı (mm²). */
export function multiPolygonArea(mp) {
  let total = 0;
  for (const poly of mp) for (const ring of poly) total += signedArea(ring);
  return Math.abs(total);
}

/** Halkayı kapat (ilk noktayı sona ekle) ve ardışık tekrarları at. */
export function closeRing(points, epsilon = 1e-9) {
  const out = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (!last || Math.abs(last[0] - p[0]) > epsilon || Math.abs(last[1] - p[1]) > epsilon) {
      out.push([p[0], p[1]]);
    }
  }
  if (out.length < 3) return null;
  const first = out[0];
  const last = out[out.length - 1];
  if (Math.abs(first[0] - last[0]) > epsilon || Math.abs(first[1] - last[1]) > epsilon) {
    out.push([first[0], first[1]]);
  }
  return out.length >= 4 ? out : null;
}

/** MultiPolygon'un eksen hizalı sınır kutusu. Boşsa null. */
export function bounds(mp) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const poly of mp) {
    for (const [x, y] of poly[0] ?? []) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (!Number.isFinite(minX)) return null;
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY,
           cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 };
}

/** Her noktaya afin dönüşüm uygula. */
export function transform(mp, fn) {
  return mp.map((poly) => poly.map((ring) => ring.map(([x, y]) => fn(x, y))));
}

export function translate(mp, dx, dy) {
  return transform(mp, (x, y) => [x + dx, y + dy]);
}

export function scale(mp, sx, sy = sx) {
  return transform(mp, (x, y) => [x * sx, y * sy]);
}

export function rotate(mp, radians) {
  const c = Math.cos(radians), s = Math.sin(radians);
  return transform(mp, (x, y) => [x * c - y * s, x * s + y * c]);
}

/** Sınır kutusunun merkezini orijine taşı. */
export function center(mp) {
  const b = bounds(mp);
  if (!b) return mp;
  return translate(mp, -b.cx, -b.cy);
}

/**
 * En-boy oranını koruyarak `width` x `height` kutusuna sığdır ve orijine ortala.
 * `mode`: 'contain' (kutuya sığar) | 'width' (genişliğe kilitle) | 'height'.
 */
export function fitInto(mp, width, height, mode = 'contain') {
  const b = bounds(mp);
  if (!b || b.width <= 0 || b.height <= 0) return mp;
  let k;
  if (mode === 'width') k = width / b.width;
  else if (mode === 'height') k = height / b.height;
  else k = Math.min(width / b.width, height / b.height);
  return center(scale(center(mp), k));
}

/** N kenarlı çember halkası (CCW). */
export function circleRing(radius, cx = 0, cy = 0, segments = 128) {
  const pts = [];
  for (let i = 0; i < segments; i++) {
    const t = (i / segments) * Math.PI * 2;
    pts.push([cx + Math.cos(t) * radius, cy + Math.sin(t) * radius]);
  }
  pts.push([...pts[0]]);
  return pts;
}

/** Köşeleri yuvarlatılabilen dikdörtgen halkası (CCW). */
export function roundedRectRing(width, height, radius = 0, cx = 0, cy = 0, cornerSegments = 16) {
  const hw = width / 2, hh = height / 2;
  const r = Math.max(0, Math.min(radius, hw, hh));
  if (r <= 1e-6) {
    return [
      [cx - hw, cy - hh], [cx + hw, cy - hh], [cx + hw, cy + hh], [cx - hw, cy + hh], [cx - hw, cy - hh],
    ];
  }
  const pts = [];
  // Merkezleri saat yönünün tersine dolaş: sağ-alt, sağ-üst, sol-üst, sol-alt
  const corners = [
    [cx + hw - r, cy - hh + r, -Math.PI / 2],
    [cx + hw - r, cy + hh - r, 0],
    [cx - hw + r, cy + hh - r, Math.PI / 2],
    [cx - hw + r, cy - hh + r, Math.PI],
  ];
  for (const [ox, oy, start] of corners) {
    for (let i = 0; i <= cornerSegments; i++) {
      const t = start + (i / cornerSegments) * (Math.PI / 2);
      pts.push([ox + Math.cos(t) * r, oy + Math.sin(t) * r]);
    }
  }
  pts.push([...pts[0]]);
  return pts;
}

/** Görselerdeki yön levhası gibi tek taraflı ok/etiket halkası (CCW). */
export function arrowRing(width, height, tipRatio = 0.22, pointLeft = true, cx = 0, cy = 0) {
  const hw = width / 2, hh = height / 2;
  const tip = Math.max(1, Math.min(width * tipRatio, width * 0.45));
  const pts = pointLeft
    ? [[cx - hw, cy], [cx - hw + tip, cy + hh], [cx + hw, cy + hh], [cx + hw, cy - hh], [cx - hw + tip, cy - hh]]
    : [[cx + hw, cy], [cx + hw - tip, cy - hh], [cx - hw, cy - hh], [cx - hw, cy + hh], [cx + hw - tip, cy + hh]];
  pts.push([...pts[0]]);
  return pts;
}

/** Kabaca eşit aralıklı noktalarla halkayı yeniden örnekle (yakınlık aramaları için). */
export function resampleRing(ring, maxPoints = 400) {
  if (ring.length <= maxPoints) return ring.slice(0, -1);
  const step = ring.length / maxPoints;
  const out = [];
  for (let i = 0; i < maxPoints; i++) out.push(ring[Math.floor(i * step)]);
  return out;
}

/**
 * Eşdoğrusal ara noktaları atar.
 *
 * Boolean işlemlerinden sonra düz bir kenarın ortasında (örneğin bir köprünün
 * levha kenarına değdiği yerde) fazladan noktalar kalır. earcut bunları kapak
 * üçgenlemesinde eleyip yan duvarların kullandığı kenarlarla uyuşmaz hâle
 * geliyor; sonuç T-bağlantısı, yani dilimleyicinin şikâyet ettiği "su geçirmez
 * değil" durumu. Kaynağı burada temizliyoruz.
 *
 * Yön değiştiren (180° geri dönen) noktalar korunur; onlar gerçek köşedir.
 */
export function simplifyRing(ring, tolerance = 1e-4) {
  if (!ring || ring.length < 4) return ring;
  const pts = ring.slice(0, -1);
  const n = pts.length;
  if (n < 3) return ring;

  const keep = new Array(n).fill(true);
  let removed = 0;

  for (let i = 0; i < n; i++) {
    // Korunan bir önceki ve bir sonraki komşuyu bul.
    let prev = (i - 1 + n) % n;
    while (!keep[prev] && prev !== i) prev = (prev - 1 + n) % n;
    let next = (i + 1) % n;
    while (!keep[next] && next !== i) next = (next + 1) % n;
    if (prev === i || next === i) break;
    if (n - removed <= 3) break;

    const [ax, ay] = pts[prev], [bx, by] = pts[i], [cx, cy] = pts[next];
    const ux = bx - ax, uy = by - ay;
    const vx = cx - bx, vy = cy - by;
    const cross = ux * vy - uy * vx;
    const dot = ux * vx + uy * vy;
    const len = Math.hypot(cx - ax, cy - ay);
    // |cross| / |AC| = B'nin AC doğrusuna dik uzaklığı
    if (len > 1e-12 && Math.abs(cross) / len < tolerance && dot > 0) {
      keep[i] = false;
      removed++;
    }
  }

  if (!removed) return ring;
  const out = pts.filter((_, i) => keep[i]);
  if (out.length < 3) return ring;
  out.push([...out[0]]);
  return out;
}

/** simplifyRing'i tüm MultiPolygon'a uygular. */
export function simplify(mp, tolerance = 1e-4) {
  return mp
    .map((poly) => poly.map((ring) => simplifyRing(ring, tolerance)).filter((r) => r && r.length >= 4))
    .filter((poly) => poly.length > 0);
}
