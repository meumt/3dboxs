// PDF'ten koordinatlı kelime çıkarma.
//
// İki yol var, ikisi de aynı biçimde sonuç döner:
//   1) metin katmanı  — PDF dijital üretilmişse (hızlı ve kusursuz)
//   2) OCR            — sayfa görüntüye çevrilip tesseract.js'e verilir (taranmış PDF)
//
// Dönen yapı:
//   { kaynak: 'metin' | 'ocr', sayfalar: [ { no, genislik, yukseklik, kelimeler } ] }
//   kelime: { metin, x0, x1, y, h }     // y yukarıdan aşağı, birim: PDF punto (pt)

import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);

// tesseract.js dil dosyalarını (~10 MB) varsayılan olarak çalışma dizinine
// indiriyor; onları da diğer verilerle birlikte veri/ altında tutuyoruz.
const TESSDATA = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'veri', 'tessdata');

let mupdfModulu = null;
async function mupdf() {
  mupdfModulu ??= await import('mupdf');
  return mupdfModulu;
}

async function belgeAc(veri) {
  const m = await mupdf();
  return { m, belge: m.Document.openDocument(veri, 'application/pdf') };
}

/** Bir metin parçasını boşluklardan kelimelere böler, x aralığını harf sayısına göre paylaştırır. */
function parcayiKelimelereBol(metin, x0, x1, y, h, hedef) {
  const harfBasi = metin.length > 0 ? (x1 - x0) / metin.length : 0;
  let i = 0;
  for (const kelime of metin.split(/\s+/)) {
    if (kelime === '') continue;
    const bas = metin.indexOf(kelime, i);
    const son = bas + kelime.length;
    i = son;
    hedef.push({ metin: kelime, x0: x0 + bas * harfBasi, x1: x0 + son * harfBasi, y, h });
  }
}

/** PDF'in metin katmanını okur. Taranmış PDF'te boş/az sonuç döner. */
export async function metinKatmani(veri) {
  const { belge } = await belgeAc(veri);
  const sayfalar = [];
  try {
    for (let n = 0; n < belge.countPages(); n++) {
      const sayfa = belge.loadPage(n);
      const [, , genislik, yukseklik] = sayfa.getBounds();
      const yapi = JSON.parse(sayfa.toStructuredText('preserve-whitespace').asJSON());
      const kelimeler = [];
      for (const blok of yapi.blocks ?? []) {
        if (blok.type !== 'text') continue;
        for (const satir of blok.lines ?? []) {
          if (!satir.text || !satir.text.trim()) continue;
          const kutu = satir.bbox;
          parcayiKelimelereBol(
            satir.text,
            kutu.x,
            kutu.x + kutu.w,
            satir.y ?? kutu.y + kutu.h, // taban çizgisi satır kümelemesi için daha kararlı
            kutu.h,
            kelimeler
          );
        }
      }
      sayfalar.push({ no: n + 1, genislik, yukseklik, kelimeler });
    }
  } finally {
    belge.destroy?.();
  }
  return sayfalar;
}

/** OCR için gereken isteğe bağlı paket kurulu mu? */
export function ocrHazirMi() {
  try {
    require.resolve('tesseract.js');
    return true;
  } catch {
    return false;
  }
}

// OCR, tablo çizgilerini de kelime sanabiliyor; bunları eleriz.
const CIZGI_ARTIGI = /^[|¦_—–\-=~"'`.,]+$/;

/** tesseract.js sürümleri arasında kelime listesinin yeri değişiyor; hepsini dener. */
function ocrKelimeleriniTopla(veri) {
  if (Array.isArray(veri?.words) && veri.words.length) return veri.words;
  const cikti = [];
  for (const blok of veri?.blocks ?? []) {
    for (const paragraf of blok.paragraphs ?? []) {
      for (const satir of paragraf.lines ?? []) {
        for (const kelime of satir.words ?? []) cikti.push(kelime);
      }
    }
  }
  return cikti;
}

/** Taranmış PDF: sayfaları görüntüye çevirip tesseract.js ile okur. */
export async function ocrIleOku(
  veri,
  { diller = 'tur+eng', olcek = 4, psm = '4', dilKlasoru = TESSDATA, log } = {}
) {
  if (!ocrHazirMi()) {
    throw new Error(
      "PDF'te metin katmanı yok ve OCR paketi kurulu değil. Kurmak için: npm install tesseract.js"
    );
  }
  const { createWorker } = require('tesseract.js');
  const { m, belge } = await belgeAc(veri);

  mkdirSync(dilKlasoru, { recursive: true });
  // Dil dosyası yoksa ilk çalıştırmada bir kez indirilir, sonra buradan okunur.
  const isci = await createWorker(diller, undefined, { cachePath: dilKlasoru });
  // psm 4 = "tek sütun, değişken punto": çizgili form tablolarında en iyi sonucu veriyor.
  await isci.setParameters({ tessedit_pageseg_mode: psm, preserve_interword_spaces: '1' });
  const sayfalar = [];
  try {
    const adet = belge.countPages();
    for (let n = 0; n < adet; n++) {
      log?.(`OCR: sayfa ${n + 1}/${adet}`);
      const sayfa = belge.loadPage(n);
      const [, , genislik, yukseklik] = sayfa.getBounds();
      const resim = sayfa
        .toPixmap(m.Matrix.scale(olcek, olcek), m.ColorSpace.DeviceRGB, false, true)
        .asPNG();

      const { data } = await isci.recognize(Buffer.from(resim), {}, { blocks: true, text: false });

      const kelimeler = [];
      for (const k of ocrKelimeleriniTopla(data)) {
        const metin = (k.text ?? '').trim();
        if (!metin) continue;
        if (CIZGI_ARTIGI.test(metin)) continue; // tablo çizgilerinden gelen "|", "—" gibi parçalar
        const temiz = metin.replace(/^[|¦]+|[|¦]+$/g, '').trim(); // "|Tarih" → "Tarih"
        if (!temiz) continue;
        kelimeler.push({
          metin: temiz,
          x0: k.bbox.x0 / olcek,
          x1: k.bbox.x1 / olcek,
          y: (k.bbox.y0 + k.bbox.y1) / 2 / olcek, // OCR'da taban çizgisi yok, ortayı kullan
          h: (k.bbox.y1 - k.bbox.y0) / olcek,
          guven: k.confidence,
        });
      }
      sayfalar.push({ no: n + 1, genislik, yukseklik, kelimeler });
    }
  } finally {
    await isci.terminate();
    belge.destroy?.();
  }
  return sayfalar;
}

/** Sayfayı PNG'ye çevirir (arayüzdeki önizleme için). */
export async function sayfaGoruntusu(veri, sayfaNo = 1, olcek = 2) {
  const { m, belge } = await belgeAc(veri);
  try {
    const sayfa = belge.loadPage(Math.max(0, sayfaNo - 1));
    return Buffer.from(
      sayfa.toPixmap(m.Matrix.scale(olcek, olcek), m.ColorSpace.DeviceRGB, false, true).asPNG()
    );
  } finally {
    belge.destroy?.();
  }
}

/**
 * Önce metin katmanını dener, yeterli metin yoksa OCR'a düşer.
 * @returns {{ kaynak:'metin'|'ocr', sayfalar:Array, uyari?:string }}
 */
export async function pdfOku(veri, secenekler = {}) {
  let sayfalar = [];
  let metinHatasi = null;
  try {
    sayfalar = await metinKatmani(veri);
  } catch (e) {
    metinHatasi = e;
  }

  const harfSayisi = sayfalar.reduce(
    (t, s) => t + s.kelimeler.reduce((k, w) => k + w.metin.length, 0),
    0
  );
  const yeterli = harfSayisi >= 40 * Math.max(1, sayfalar.length);

  if (yeterli && !secenekler.ocrZorla) return { kaynak: 'metin', sayfalar };

  try {
    return { kaynak: 'ocr', sayfalar: await ocrIleOku(veri, secenekler) };
  } catch (e) {
    if (sayfalar.length) return { kaynak: 'metin', sayfalar, uyari: e.message };
    throw metinHatasi ?? e;
  }
}

/** Dil dosyalarını önden indirir — internetsiz makinede kullanmadan önce bir kez çalıştırın. */
export async function ocrDilleriniIndir(diller = 'tur+eng', dilKlasoru = TESSDATA) {
  if (!ocrHazirMi()) throw new Error('Önce: npm install tesseract.js');
  const { createWorker } = require('tesseract.js');
  mkdirSync(dilKlasoru, { recursive: true });
  const isci = await createWorker(diller, undefined, { cachePath: dilKlasoru });
  await isci.terminate();
  return dilKlasoru;
}
