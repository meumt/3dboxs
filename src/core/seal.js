/**
 * Açık kalan kenarları dikerek katıyı su geçirmez hâle getirir.
 *
 * NEDEN GEREKLİ
 * earcut, delikleri dış hatta "köprü" atarak eler. Yazıdaki harfler ortak taban
 * çizgisinde durduğu için farklı harflerin kenarları birebir eşdoğrusal olur;
 * köprü de o doğruya denk geldiğinde earcut'ın ürettiği kapak sınırı, halka
 * kenarlarıyla NET olarak aynı alanı kapsayan ama kenar kenar örtüşmeyen bir
 * hâl alır. Kapak ile yan duvarlar o noktada birbirine dikilmez.
 *
 * ÇÖZÜM
 * Yüzeydeki her kenar, biri bir yönde biri ters yönde olmak üzere tam iki kez
 * geçilmelidir. Dengesiz kalan yönlü kenarları topluyoruz; bunlar daima kapalı
 * çevrimler oluşturur (net alan doğru olduğu için). Her çevrimi yelpaze
 * üçgenlemesiyle kapatınca açık kenar kalmıyor. Yukarıdaki eşdoğrusal durumda
 * eklenen üçgenlerin alanı sıfırdır: topoloji kapanır, ölçü değişmez.
 */

const QUANT = 1e4;   // 0.1 µm çözünürlükte köşe eşleme

const keyOf = (x, y, z) =>
  `${Math.round(x * QUANT)},${Math.round(y * QUANT)},${Math.round(z * QUANT)}`;

/**
 * Yüzeydeki dengesiz yönlü kenarları bulur.
 * @returns {{ needed: Array<[string,string]>, coords: Map<string, number[]> }}
 */
function findOpenEdges(positions) {
  const counts = new Map();
  const coords = new Map();
  const triCount = positions.length / 9;

  for (let t = 0; t < triCount; t++) {
    const o = t * 9;
    const k = [];
    for (let v = 0; v < 3; v++) {
      const x = positions[o + v * 3], y = positions[o + v * 3 + 1], z = positions[o + v * 3 + 2];
      const kk = keyOf(x, y, z);
      if (!coords.has(kk)) coords.set(kk, [x, y, z]);
      k.push(kk);
    }
    if (k[0] === k[1] || k[1] === k[2] || k[0] === k[2]) continue;
    for (let i = 0; i < 3; i++) {
      const e = `${k[i]}|${k[(i + 1) % 3]}`;
      counts.set(e, (counts.get(e) ?? 0) + 1);
    }
  }

  // A→B yönü B→A'dan fazlaysa, aradaki fark kadar B→A kenarına ihtiyaç var.
  const needed = [];
  for (const [e, count] of counts) {
    const [a, b] = e.split('|');
    const reverse = counts.get(`${b}|${a}`) ?? 0;
    const deficit = count - reverse;
    for (let i = 0; i < deficit; i++) needed.push([b, a]);
  }
  return { needed, coords };
}

/** Yönlü kenarları uç uca ekleyerek kapalı çevrimler kurar. */
function buildLoops(needed) {
  const outgoing = new Map();
  for (const [a, b] of needed) {
    if (!outgoing.has(a)) outgoing.set(a, []);
    outgoing.get(a).push(b);
  }

  const loops = [];
  for (const [start, targets] of outgoing) {
    while (targets.length) {
      const loop = [start];
      let current = targets.pop();
      let guard = 0;
      while (current !== start && guard++ < 10_000) {
        loop.push(current);
        const next = outgoing.get(current);
        if (!next?.length) break;          // açık zincir — kapatılamaz
        current = next.pop();
      }
      if (current === start && loop.length >= 3) loops.push(loop);
    }
  }
  return loops;
}

/**
 * Katıdaki açık kenarları kapatır.
 *
 * @param {number[]} positions  üçgen listesi (yerinde büyütülür)
 * @returns {{ sealed: number, remaining: number }}
 */
export function sealOpenEdges(positions) {
  const { needed, coords } = findOpenEdges(positions);
  if (!needed.length) return { sealed: 0, remaining: 0 };

  const loops = buildLoops(needed);
  let sealed = 0;

  for (const loop of loops) {
    const [ax, ay, az] = coords.get(loop[0]);
    for (let i = 1; i < loop.length - 1; i++) {
      const [bx, by, bz] = coords.get(loop[i]);
      const [cx, cy, cz] = coords.get(loop[i + 1]);
      positions.push(ax, ay, az, bx, by, bz, cx, cy, cz);
      sealed++;
    }
  }

  const remaining = findOpenEdges(positions).needed.length;
  return { sealed, remaining };
}

/** Denetim: eşleşmeyen yönlü kenar sayısı (0 = su geçirmez). */
export function countOpenEdges(positions) {
  return findOpenEdges(positions).needed.length;
}
