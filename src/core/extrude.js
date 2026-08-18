/**
 * 2B MultiPolygon → 3B katı.
 *
 * Üst kapak, alt kapak ve yan duvarlar üretilir. Kapaklar earcut ile üçgenlenir;
 * yan duvarlar halka yönüne göre dışa bakacak şekilde kurulur (polygon-clipping
 * dış halkaları CCW, delikleri CW verir; yine de işaretli alandan doğruluyoruz).
 */
import earcut from 'earcut';
import * as THREE from 'three';

/** Bu ikili alanın altındaki üçgenler yozlaşmış sayılır (mm²·2). */
const DEGENERATE_AREA = 1e-9;


/**
 * Katıyı düz bir pozisyon dizisine yazar (üçgen başına 9 sayı).
 * Birden çok parçayı aynı diziye yazıp tek geometri hâline getirebilmek için ayrık.
 *
 * @param {MultiPolygon} mp
 * @param {number[]} out          hedef dizi (yerinde büyür)
 * @param {object} opts
 * @param {number} opts.thickness z kalınlığı (mm)
 * @param {number} opts.z0        alt yüzeyin z'si
 */
export function extrudeToPositions(mp, out, { thickness = 3, z0 = 0 } = {}) {
  const z1 = z0 + thickness;

  const tri = (ax, ay, az, bx, by, bz, cx, cy, cz) => {
    out.push(ax, ay, az, bx, by, bz, cx, cy, cz);
  };

  for (const poly of mp) {
    if (!poly?.length) continue;

    // --- Kapaklar ---
    const flat = [];
    const holeIndices = [];
    poly.forEach((ring, ringIndex) => {
      const pts = ring.slice(0, -1);            // kapanış noktasını at
      if (pts.length < 3) return;
      if (ringIndex > 0) holeIndices.push(flat.length / 2);
      for (const [x, y] of pts) flat.push(x, y);
    });

    if (flat.length >= 6) {
      const tris = earcut(flat, holeIndices.length ? holeIndices : null, 2);
      for (let i = 0; i < tris.length; i += 3) {
        const i0 = tris[i] * 2, i1 = tris[i + 1] * 2, i2 = tris[i + 2] * 2;
        const x0 = flat[i0], y0 = flat[i0 + 1];
        const x1 = flat[i1], y1 = flat[i1 + 1];
        const x2 = flat[i2], y2 = flat[i2 + 1];

        // earcut delikleri "köprüleyerek" eliyor. O köprü bir halka kenarıyla
        // tam eşdoğrusal düşerse sıfır alanlı üçgenler çıkıyor: hacme hiçbir şey
        // katmıyorlar ama kenar eşleşmesini bozup modeli "su geçirmez değil"
        // gösteriyorlar. Attığımızda kalan kenarlar birebir eşleşiyor.
        const area2 = Math.abs((x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0));
        if (area2 < DEGENERATE_AREA) continue;

        tri(x0, y0, z1, x1, y1, z1, x2, y2, z1);   // üst (+z)
        tri(x0, y0, z0, x2, y2, z0, x1, y1, z0);   // alt (−z), ters sarım
      }
    }

    // --- Yan duvarlar ---
    // Halkanın sarım yönü hangi tarafın malzeme olduğunu zaten kodluyor:
    // gidiş yönünün SAĞI daima malzemenin dışıdır (dış halkada dışarısı,
    // delik halkasında boşluk). Bu yüzden tek bir sarım kuralı ikisine de yeter.
    for (const ring of poly) {
      const pts = ring.slice(0, -1);
      const n = pts.length;
      if (n < 3) continue;
      for (let i = 0; i < n; i++) {
        const [ax, ay] = pts[i];
        const [bx, by] = pts[(i + 1) % n];
        tri(ax, ay, z0, bx, by, z0, bx, by, z1);
        tri(ax, ay, z0, bx, by, z1, ax, ay, z1);
      }
    }
  }
  return out;
}

/** Pozisyon dizisinden geometri kurar. */
export function geometryFromPositions(positions) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

/** Tek MultiPolygon için kısayol. */
export function extrudeMultiPolygon(mp, opts = {}) {
  return geometryFromPositions(extrudeToPositions(mp, [], opts));
}

/** Katı hacmi (mm³) — işaretli tetrahedron toplamı. */
export function meshVolume(geometry) {
  const pos = geometry.getAttribute('position');
  let vol = 0;
  for (let i = 0; i < pos.count; i += 3) {
    const ax = pos.getX(i),     ay = pos.getY(i),     az = pos.getZ(i);
    const bx = pos.getX(i + 1), by = pos.getY(i + 1), bz = pos.getZ(i + 1);
    const cx = pos.getX(i + 2), cy = pos.getY(i + 2), cz = pos.getZ(i + 2);
    vol += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
  }
  return Math.abs(vol);
}
