/**
 * Duvardaki ışık deseninin hesaplanması.
 *
 * LED'i nokta kaynak sayarsak duvardaki desen, maskenin M katı büyütülmüş
 * hâlinden ibarettir. Bu yüzden gölge haritası (shadow map) yerine maskeyi
 * doğrudan M ile ölçekleyip rasterize ediyoruz: sonuç piksel piksel doğru,
 * hızlı ve gölge haritası artefaktı içermiyor.
 *
 * Parlaklık düşüşü de analitik: R yarıçapındaki duvar noktası için
 *   E(R) / E(0) = (H / sqrt(H² + R²))³
 * (ters kare yasası × kosinüs eğim düzeltmesi).
 *
 * NOT: Ekrana basarken bu ham orana bir POZLAMA eğrisi uyguluyoruz. Gerçek
 * düşüş o kadar serttir ki (merkezden 25 cm ötede ~100 kat) düz basıldığında
 * kenarlar simsiyah görünür — oysa göz ve fotoğraf makinesi bunu sıkıştırır.
 * Eğri yalnızca ÖNİZLEMEYİ etkiler; paneldeki ölçüler ham fizikten gelir.
 */

/** Duvardaki bağıl aydınlık (merkez = 1). */
export function relativeIrradiance(R, H) {
  const d = Math.hypot(H, R);
  return (H / d) ** 3;
}

/** mm → piksel dönüştürücü kurar. */
function makeMapper(size, spanMm) {
  const s = size / spanMm;
  return {
    s,
    x: (mm) => size / 2 + mm * s,
    y: (mm) => size / 2 - mm * s,
  };
}

/** MultiPolygon'u 2B bağlama çizer (delikler even-odd ile). */
function tracePolygons(ctx, mp, map, scaleFactor) {
  ctx.beginPath();
  for (const poly of mp) {
    for (const ring of poly) {
      ring.forEach(([x, y], i) => {
        const px = map.x(x * scaleFactor);
        const py = map.y(y * scaleFactor);
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      });
      ctx.closePath();
    }
  }
}

/**
 * Tek bir katmanın geçirgenlik haritasını çizer.
 * Opak (alfa=1) = ışık geçiyor, saydam = malzeme engelliyor.
 */
function layerTransmission(layer, map, size) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, size, size);
  ctx.globalCompositeOperation = 'destination-out';
  tracePolygons(ctx, layer.polygons, map, layer.magnification);
  ctx.fill('evenodd');
  ctx.globalCompositeOperation = 'source-over';

  // Yarı gölge: LED nokta değil, o yüzden kenarlar yumuşar. Gauss bulanıklığının
  // görünür yayılımı ~3σ olduğundan `penumbra` genişliğinde bir geçiş için
  // σ ≈ penumbra/4 alıyoruz.
  const blurPx = Math.max(0, ((layer.penumbra ?? 0) * map.s) / 4);
  if (blurPx <= 0.3) return canvas;

  const blurred = document.createElement('canvas');
  blurred.width = blurred.height = size;
  const bctx = blurred.getContext('2d');
  bctx.filter = `blur(${blurPx.toFixed(2)}px)`;
  bctx.drawImage(canvas, 0, 0);
  bctx.filter = 'none';
  return blurred;
}

/**
 * Duvar dokusunu üretir.
 *
 * Işık yolunda birden çok katman var (maske + yüz levhası). Nokta kaynakta bir
 * duvar noktası, ancak ışın HER katmanın açıklığından geçiyorsa aydınlanır;
 * yani toplam geçirgenlik katmanların çarpımıdır. Her katman kendi büyütmesiyle
 * (M = H/G) ölçeklenip çarpılıyor.
 *
 * @param {Array<{polygons: MultiPolygon, magnification: number, penumbra: number}>} layers
 * @param {object} opts
 * @param {number} opts.ledDistance H (mm)
 * @param {number} opts.spanMm      dokunun kapsadığı duvar genişliği (mm)
 * @param {number} opts.size        doku çözünürlüğü (px)
 * @param {string} opts.lightColor
 * @param {string} opts.wallColor
 * @param {number} opts.intensity
 * @param {number} opts.exposure    önizleme pozlama eğrisi (1 = ham fizik)
 * @returns {HTMLCanvasElement}
 */
export function renderWallTexture(layers, {
  ledDistance,
  spanMm = 1200,
  size = 2048,
  lightColor = '#ffd9a0',
  wallColor = '#2a2f3a',
  intensity = 1,
  exposure = 0.42,
} = {}) {
  const map = makeMapper(size, spanMm);
  const active = (Array.isArray(layers) ? layers : [layers]).filter(
    (l) => l?.polygons?.length && Number.isFinite(l.magnification) && l.magnification > 0,
  );

  // 1-2) Katmanların geçirgenliklerini çarp.
  const blurred = document.createElement('canvas');
  blurred.width = blurred.height = size;
  const cctx = blurred.getContext('2d');
  cctx.fillStyle = '#ffffff';
  cctx.fillRect(0, 0, size, size);
  for (const layer of active) {
    // 'destination-in' hedef alfayı kaynak alfayla ÇARPAR.
    cctx.globalCompositeOperation = 'destination-in';
    cctx.drawImage(layerTransmission(layer, map, size), 0, 0);
  }
  cctx.globalCompositeOperation = 'source-over';

  // 3) Işık katmanı = geçirgenlik × parlaklık düşüşü × renk
  const lit = document.createElement('canvas');
  lit.width = lit.height = size;
  const lctx = lit.getContext('2d');
  lctx.drawImage(blurred, 0, 0);
  lctx.globalCompositeOperation = 'source-in';

  const maxR = spanMm / 2;
  const gradient = lctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  const stops = 16;
  for (let i = 0; i <= stops; i++) {
    const t = i / stops;
    const raw = relativeIrradiance(t * maxR, ledDistance);
    const alpha = Math.min(1, Math.pow(raw, exposure) * intensity);
    gradient.addColorStop(t, withAlpha(lightColor, alpha));
  }
  lctx.fillStyle = gradient;
  lctx.fillRect(0, 0, size, size);

  // 4) Duvar rengi + toplamsal ışık
  const out = document.createElement('canvas');
  out.width = out.height = size;
  const octx = out.getContext('2d');
  octx.fillStyle = wallColor;
  octx.fillRect(0, 0, size, size);
  octx.globalCompositeOperation = 'lighter';
  octx.drawImage(lit, 0, 0);
  octx.globalCompositeOperation = 'source-over';

  return out;
}

/** '#rrggbb' + alfa → 'rgba(...)'. */
function withAlpha(hex, alpha) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return `rgba(${r},${g},${b},${alpha.toFixed(4)})`;
}
