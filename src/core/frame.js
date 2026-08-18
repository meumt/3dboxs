/**
 * Taşıyıcı iskelet: LED yuvası, kollar ve duvar ayakları.
 *
 * NEDEN BÖYLE:
 * Lamba 35 mm çapında ve sadece 10 mm boyunda bir puck. Levhanın ortasındaki
 * bir delikten geçemez; parçanın İÇİNE oturması gerekir. Ama LED ile maske
 * arasına hiçbir şey giremez — araya konan bir tüp ışık konisini kırpar ve
 * maskenin yalnızca ortası aydınlanır.
 *
 * Bu yüzden puck, ışık konisinin DIŞINDAN dolaşan kollarla taşınıyor:
 *
 *      DUVAR |                                    ___
 *            |   [maske]   [yüz]                 /   \  LED yuvası
 *            |      |        |        ___----''''     |
 *            |      |    ___---''''                   |
 *            |      +---''  kol (koninin dışında)     |
 *            |      |                            \___/
 *            |   ayak
 *            |   (duvara basar)
 *
 * Kol, yuvanın kenarından maskenin kenarına DÜZ gider. LED düzleminde ışık
 * konisi bir noktaya indiği için oradaki kol hiçbir şeyi kesmez; duvara doğru
 * koni açıldıkça kol da dışarı açıldığından hep koninin dışında kalır.
 * Kolların gölgesi yazının değil, çevresindeki hâlenin üzerine düşer.
 */
import { circleRing } from './polygons.js';

/**
 * İki nokta arasına kapalı bir kutu (prizma) üretir.
 * 8 köşe, 12 üçgen; kenarlar birebir eşleştiği için su geçirmezdir.
 *
 * @param {number[]} a        başlangıç merkezi [x, y, z]
 * @param {number[]} b        bitiş merkezi [x, y, z]
 * @param {number} width      kesit genişliği (mm)
 * @param {number} thickness  kesit kalınlığı (mm)
 * @param {number[]} out      hedef pozisyon dizisi
 */
export function beam(a, b, width, thickness, out) {
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
  const len = Math.hypot(dx, dy, dz);
  if (len < 1e-6) return out;
  const ux = dx / len, uy = dy / len, uz = dz / len;

  // Eksene dik iki birim vektör.
  let px = -uy, py = ux, pz = 0;
  let plen = Math.hypot(px, py, pz);
  if (plen < 1e-6) { px = 1; py = 0; pz = 0; plen = 1; }
  px /= plen; py /= plen; pz /= plen;

  const qx = uy * pz - uz * py;
  const qy = uz * px - ux * pz;
  const qz = ux * py - uy * px;

  const hw = width / 2, ht = thickness / 2;
  const corner = (base, sw, st) => [
    base[0] + px * sw * hw + qx * st * ht,
    base[1] + py * sw * hw + qy * st * ht,
    base[2] + pz * sw * hw + qz * st * ht,
  ];

  // a ve b uçlarındaki dörder köşe, aynı sırayla.
  const A = [corner(a, -1, -1), corner(a, 1, -1), corner(a, 1, 1), corner(a, -1, 1)];
  const B = [corner(b, -1, -1), corner(b, 1, -1), corner(b, 1, 1), corner(b, -1, 1)];

  const tri = (p, q, r) => out.push(p[0], p[1], p[2], q[0], q[1], q[2], r[0], r[1], r[2]);

  // Yan yüzeyler
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    tri(A[i], B[i], B[j]);
    tri(A[i], B[j], A[j]);
  }
  // Kapaklar. Yan yüzeyler A ucunda A[j]→A[i], B ucunda B[i]→B[j] yönünde
  // kenar bırakıyor; kapaklar bunların TERSİNİ üretmeli ki kenarlar eşleşsin.
  tri(A[0], A[1], A[2]);
  tri(A[0], A[2], A[3]);
  tri(B[0], B[2], B[1]);
  tri(B[0], B[3], B[2]);
  return out;
}

/**
 * LED yuvası: puck'ın oturduğu, duvara bakan tarafı açık kap.
 *
 * @param {object} opts
 * @param {number} opts.lampDiameter  puck çapı (mm)
 * @param {number} opts.lampDepth     puck yüksekliği (mm)
 * @param {number} opts.wallThickness yuva et kalınlığı (mm)
 * @param {number} opts.z0            LED yayan yüzeyin yerel z'si
 * @returns {{ ring: MultiPolygon, cap: MultiPolygon, outerRadius: number }}
 */
export function lampSocket({ lampDiameter, lampDepth, wallThickness, backPlate = true }) {
  const ri = lampDiameter / 2;
  const ro = ri + wallThickness;
  const ring = [[circleRing(ro, 0, 0, 96), circleRing(ri, 0, 0, 96).slice().reverse()]];
  const cap = backPlate ? [[circleRing(ro, 0, 0, 96)]] : [];
  return { ring, cap, outerRadius: ro };
}

/**
 * Yuvayı maskenin kenarına bağlayan kollar.
 *
 * @param {object} opts
 * @param {number} opts.count        kol sayısı
 * @param {number} opts.innerRadius  yuva dış yarıçapı
 * @param {number} opts.outerRadius  maskenin kenar yarıçapı
 * @param {number} opts.innerZ       yuva ucundaki z
 * @param {number} opts.outerZ       maske ucundaki z
 * @param {number} opts.width
 * @param {number} opts.thickness
 * @param {number[]} out
 */
export function supportArms({ count, innerRadius, outerRadius, innerZ, outerZ, width, thickness }, out) {
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2;
    const c = Math.cos(angle), s = Math.sin(angle);
    beam(
      [c * innerRadius, s * innerRadius, innerZ],
      [c * outerRadius, s * outerRadius, outerZ],
      width, thickness, out,
    );
  }
  return out;
}

/**
 * Duvar ayakları: maskeyi duvardan `height` kadar uzakta tutar.
 * Sürekli bir bordür yerine ayrık ayaklar kullanıyoruz; kapalı bir bordür
 * ışığın duvara yayılmasını tamamen keserdi.
 */
export function wallFeet({ count, radius, height, width, thickness, z0 }, out) {
  for (let i = 0; i < count; i++) {
    const angle = ((i + 0.5) / count) * Math.PI * 2;
    const c = Math.cos(angle), s = Math.sin(angle);
    beam(
      [c * radius, s * radius, z0],
      [c * radius, s * radius, z0 - height],
      width, thickness, out,
    );
  }
  return out;
}
