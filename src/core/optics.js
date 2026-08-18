/**
 * Gölge-kutu optiği.
 *
 * Fiziksel kurulum (yandan görünüş, tüm ölçüler mm):
 *
 *      DUVAR |<---------------- H ---------------->| LED
 *            |                                     |
 *            |          |<-------- G ------------->|
 *            |          |                          |
 *            |        MASKE                      LED çipi
 *            |       (bizim bastığımız parça)
 *
 *   H = LED çipinin duvara olan mesafesi
 *   G = LED çipi ile maske yüzeyi arasındaki boşluk
 *   Maske duvardan (H - G) uzaklıkta, LED ile duvar arasında durur.
 *
 * LED'i nokta kaynak kabul edersek, maske düzlemindeki r yarıçapındaki bir
 * nokta duvara R yarıçapında düşer:
 *
 *      R / r = H / (H - t)   ,  t = maskenin duvara uzaklığı = H - G
 *   => R / r = H / G
 *
 * Yani büyütme oranı M = H / G. Maskedeki her şey duvarda M katı büyür.
 * Duvarda 500 mm istiyorsak ve M = 4 ise, maskeye 125 mm çizmemiz gerekir.
 */

/** Büyütme oranı M = H / G. */
export function magnification({ ledDistance, maskGap }) {
  const H = Number(ledDistance);
  const G = Number(maskGap);
  if (!(H > 0) || !(G > 0) || G >= H) return NaN;
  return H / G;
}

/** Duvardaki hedef ölçüden maske üzerindeki çizim ölçüsünü bulur. */
export function maskSizeForWallSize(wallSize, M) {
  return wallSize / M;
}

/** Maske üzerindeki bir ölçünün duvarda kaç mm olacağını verir. */
export function wallSizeForMaskSize(maskSize, M) {
  return maskSize * M;
}

/**
 * Yarı gölge (penumbra) genişliği.
 * LED gerçekte nokta değil, `ledSize` mm çapında bir yüzey. Duvardaki kenar
 * bulanıklığı yaklaşık olarak: ledSize * (M - 1).
 */
export function penumbraWidth(ledSize, M) {
  if (!Number.isFinite(M)) return 0;
  return Math.max(0, ledSize * (M - 1));
}

/**
 * Maskenin duvarda aydınlatabildiği azami yarıçap.
 * Işık maske kenarını yalayıp geçtiği için, maske yarıçapı rp olan bir levha
 * duvarda M*rp yarıçapında karanlık bir siluet bırakır; onun dışı aydınlıktır.
 */
export function silhouetteRadius(maskRadius, M) {
  return maskRadius * M;
}

/**
 * Tüm tasarımın optik özeti. UI bunu doğrudan gösterir.
 */
export function solve({ ledDistance, maskGap, targetWallWidth, targetWallHeight, ledSize = 6 }) {
  const M = magnification({ ledDistance, maskGap });
  const ok = Number.isFinite(M) && M > 1;
  return {
    magnification: M,
    valid: ok,
    maskWidth: ok ? maskSizeForWallSize(targetWallWidth, M) : NaN,
    maskHeight: ok ? maskSizeForWallSize(targetWallHeight, M) : NaN,
    maskDistanceFromWall: ok ? ledDistance - maskGap : NaN,
    penumbra: ok ? penumbraWidth(ledSize, M) : NaN,
  };
}

/**
 * Tasarımı kontrol edip kullanıcıya gösterilecek uyarıları üretir.
 * Sadece gerçek fiziksel/üretim sınırlarını raporlar; kozmetik yorum yapmaz.
 */
export function diagnostics({ M, maskWidth, maskHeight, plateWidth, plateHeight, penumbra,
                              targetWallWidth, bedSize = 220, minFeature = 1.2, bridgeWidth = 0 }) {
  const notes = [];

  if (!Number.isFinite(M) || M <= 1) {
    notes.push({ level: 'error', text:
      'Boşluk (G) LED mesafesinden (H) küçük olmalı. Aksi halde ışık duvara yansımaz.' });
    return notes;
  }

  if (M > 12) {
    notes.push({ level: 'warn', text:
      `Büyütme çok yüksek (${M.toFixed(1)}×). Maskedeki detaylar minicik kalır ve kenarlar bulanıklaşır. ` +
      'Boşluğu (G) artır ya da hedef boyutu küçült.' });
  }

  if (maskWidth > plateWidth || maskHeight > plateHeight) {
    notes.push({ level: 'error', text:
      `Çizim (${maskWidth.toFixed(0)}×${maskHeight.toFixed(0)} mm) levhaya ` +
      `(${plateWidth.toFixed(0)}×${plateHeight.toFixed(0)} mm) sığmıyor. Levhayı büyüt ya da ` +
      'hedef duvar boyutunu küçült.' });
  }

  if (penumbra > targetWallWidth * 0.05) {
    notes.push({ level: 'warn', text:
      `Kenar bulanıklığı ~${penumbra.toFixed(0)} mm. Daha keskin kenar için LED'i maskeye ` +
      'yaklaştırma; bunun yerine daha küçük/noktasal bir LED kullan.' });
  }

  if (bridgeWidth > 0 && bridgeWidth * M > targetWallWidth * 0.04) {
    notes.push({ level: 'warn', text:
      `Köprüler duvarda ~${(bridgeWidth * M).toFixed(0)} mm kalınlığında karanlık çizgi bırakır. ` +
      'Köprü kalınlığını azaltabilirsin.' });
  }

  if (Math.max(plateWidth, plateHeight) > bedSize) {
    notes.push({ level: 'warn', text:
      `Levha ${Math.max(plateWidth, plateHeight).toFixed(0)} mm; ${bedSize} mm'lik tablaya sığmaz. ` +
      'Çapraz yerleştirmen ya da parçalı basman gerekir.' });
  }

  return notes;
}

/** Küçük detay uyarısı: maskedeki en ince ayrıntı basılabilir mi? */
export function minFeatureOnMask(targetWallWidth, M, wallDetailFraction = 0.01) {
  return (targetWallWidth * wallDetailFraction) / M;
}

/**
 * "Gölgeyi tamamlama" geometrisi.
 *
 * SORUN: Levha, duvardaki yazının ortasını kapatır. Karşıdan bakan biri eksik
 * bir kelime görür. Levhanın üstündeki kesikler o eksiği tamamlamalı — küçük
 * bir kopyasını tekrar etmemeli.
 *
 * NEDEN TEK KATMAN YETMEZ: Göz duvardan D, levha zp uzakta olsun. Levhadaki r
 * yarıçaplı bir kesik gözde duvarın R_görünen = r·D/(D−zp) yarıçapına denk
 * düşer. Aynı kesiğin ışıkla düşürdüğü iz ise R_yansıyan = r·M. İkisi ancak
 *
 *      D/(D−zp) = M = H/G   ve   zp = H−G   ⟹   D = H
 *
 * olduğunda çakışır; yani sadece göz tam LED'in yerindeyken. Başka her yerde
 * kesik ile kendi yansıması ayrı yerlere düşer.
 *
 * ÇÖZÜM: İki ayrı katman.
 *   - MASKE katmanı  (arkada, LED'e G kadar yakın): çizimi 1/M ölçeğinde taşır,
 *     duvardaki keskin yazıyı o üretir.
 *   - YÜZ katmanı    (önde, görünen levha): çizimi görünür ölçekte taşır ve
 *     duvardaki yazının kapanan orta kısmını tamamlar.
 */

/**
 * Yüz levhasındaki çizimin, duvardaki yazıyla göz hizasında birleşmesi için
 * gereken ölçeği verir.
 *
 * @param {number} wallSize      duvardaki yazının ölçüsü (mm)
 * @param {number} viewDistance  bakış mesafesi D (mm, duvardan)
 * @param {number} faceDistance  yüz levhasının duvara uzaklığı zf (mm)
 */
export function completionSize(wallSize, viewDistance, faceDistance) {
  const D = Number(viewDistance);
  const zf = Number(faceDistance);
  if (!(D > zf) || !(zf >= 0)) return NaN;
  return wallSize * ((D - zf) / D);
}

/**
 * Yüz levhasının duvarda kapattığı dairenin yarıçapı (gözden bakışta).
 * Tamamlanması gereken bölge tam olarak budur.
 */
export function occludedRadius(faceRadius, viewDistance, faceDistance) {
  const D = Number(viewDistance);
  const zf = Number(faceDistance);
  if (!(D > zf)) return NaN;
  return faceRadius * (D / (D - zf));
}

/**
 * IŞIK MİKTARI
 *
 * LED'in ışık akışı Φ (lümen) biliniyorsa duvardaki gerçek aydınlığı (lüks)
 * hesaplayabiliriz. LED'ler yaklaşık LAMBERT yayıcıdır: I(θ) = I₀·cosθ ve
 * yarım küreye toplam akış Φ = π·I₀ olduğundan I₀ = Φ/π (kandela).
 *
 * Duvarda merkezden R uzaklıktaki nokta için (LED duvara dik bakıyor):
 *
 *      E(R) = I₀ · cosθ_yayım · cosθ_geliş / d²
 *           = (Φ/π) · H² / d⁴        ,  d = √(H² + R²)
 *
 * Merkez değeri: E(0) = Φ / (π·H²).
 *
 * NOT: Bu, maskeden geçen ışığın DÜŞTÜĞÜ yerdeki aydınlıktır. Maskenin
 * kapattığı yerler karanlıktır; sayı, aydınlık kalan kısımlar için geçerlidir.
 */

/** Duvardaki aydınlık (lüks). H ve R milimetre, flux lümen. */
export function illuminance(fluxLumens, ledDistance, radius) {
  const H = ledDistance / 1000;          // m
  const R = radius / 1000;               // m
  if (!(H > 0) || !(fluxLumens > 0)) return NaN;
  const d = Math.hypot(H, R);
  return (fluxLumens / Math.PI) * (H * H) / (d ** 4);
}

/** Aydınlık değerini gündelik dille anlatır. */
export function describeIlluminance(lux) {
  if (!Number.isFinite(lux)) return '';
  if (lux < 1) return 'karanlık odada bile zor seçilir';
  if (lux < 10) return 'karanlık odada belli belirsiz';
  if (lux < 50) return 'karanlık odada rahat okunur';
  if (lux < 200) return 'loş odada net';
  return 'aydınlık odada bile belli';
}

/**
 * Diyafram (küçük delik) takınca ne kazanıp ne kaybettiğimiz.
 *
 * Işık yüzeyini küçültmek duvardaki kenarları keskinleştirir (yarı gölge
 * s·(M−1) ile orantılı) ama geçen ışık alanla birlikte düşer. Takas budur.
 */
export function apertureTradeoff(sourceDiameter, apertureDiameter) {
  const a = Math.min(sourceDiameter, apertureDiameter);
  const transmission = (a / sourceDiameter) ** 2;
  return { effectiveSize: a, transmission };
}
