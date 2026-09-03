// PDF'ten koordinatlı kelime çıkarma — tamamen tarayıcıda.
//
// İki yol var, ikisi de aynı biçimde sonuç döner:
//   1) metin katmanı  — PDF dijital üretilmişse (hızlı ve kusursuz)
//   2) OCR            — sayfa görüntüye çevrilip tesseract.js'e verilir (taranmış PDF)
//
// Dönen yapı:
//   { kaynak: 'metin' | 'ocr', sayfalar: [ { no, genislik, yukseklik, kelimeler } ] }
//   kelime: { metin, x0, x1, y, h }     // y yukarıdan aşağı, birim: PDF punto (pt)

window.TT = window.TT || {};

TT.pdf = (() => {
  'use strict';

  /** base64 metni Uint8Array'e çevirir (file:// üzerinde fetch yok, her şey gömülü). */
  function b64Ikili(b64) {
    const ham = atob(b64);
    const bayt = new Uint8Array(ham.length);
    for (let i = 0; i < ham.length; i++) bayt[i] = ham.charCodeAt(i);
    return bayt;
  }

  let pdfIscisi = null;

  /**
   * pdf.js worker'ını kurar.
   *
   * İki ayrıntı file:// yüzünden:
   *  - Worker kaynağı yan dosyadan yüklenemiyor, blob'a sarıyoruz. Ama pdf.js
   *    "farklı köken" gördüğü blob adresini importScripts ile sarmalamaya
   *    çalışıp başarısız oluyor; o yüzden Worker'ı kendimiz açıp hazır port
   *    olarak veriyoruz.
   *  - Gömülü fontu çözemediği PDF'lerde pdf.js yedek fontları ağdan istiyor.
   *    Onları da worker'ın içine gömüp küçük bir fetch vekiliyle karşılıyoruz;
   *    yoksa Türkçe harfler boş kutu olarak çiziliyor ve OCR bozuluyor.
   */
  function iscialal() {
    if (pdfIscisi) return pdfIscisi;

    const fontVekili = `
      (() => {
        const fontlar = self.__PDF_FONTLAR;
        delete self.__PDF_FONTLAR;
        const ikili = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        const asilFetch = self.fetch ? self.fetch.bind(self) : null;
        self.fetch = (istek, secenekler) => {
          const url = String(istek && istek.url ? istek.url : istek);
          const ad = Object.keys(fontlar).find((a) => url.endsWith(a));
          if (!ad) {
            return asilFetch
              ? asilFetch(istek, secenekler)
              : Promise.reject(new Error('Ağ erişimi yok: ' + url));
          }
          return Promise.resolve(
            new Response(ikili(fontlar[ad]), {
              status: 200,
              headers: { 'content-type': 'application/octet-stream' },
            })
          );
        };
      })();
    `;

    const url = URL.createObjectURL(
      new Blob(
        [
          `self.__PDF_FONTLAR=${JSON.stringify(window.PDF_STANDART_FONTLAR || {})};\n`,
          fontVekili,
          '\n;',
          b64Ikili(window.PDF_WORKER_B64),
        ],
        { type: 'text/javascript' }
      )
    );
    pdfjsLib.GlobalWorkerOptions.workerSrc = url;
    pdfIscisi = pdfjsLib.PDFWorker.fromPort({ port: new Worker(url) });
    return pdfIscisi;
  }

  async function belgeAc(veri) {
    return pdfjsLib.getDocument({
      data: new Uint8Array(veri),
      worker: iscialal(),
      // Yedek fontlar worker'ın içindeki vekilden gelsin.
      standardFontDataUrl: 'pdfjs-standart-fontlar/',
      useWorkerFetch: true,
      useSystemFonts: false,
    }).promise;
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

  /** pdf.js metin parçalarını kelimelere çevirir; kırık glifler önce birleştirilir. */
  function parcalardanKelimeler(items, sayfaYuksekligi) {
    const parcalar = [];
    for (const it of items) {
      if (!it.str || !it.str.trim()) continue;
      const [a, , , d, e, f] = it.transform;
      const h = Math.abs(d) || Math.abs(a) || 9;
      parcalar.push({
        metin: it.str,
        x0: e,
        x1: e + (it.width || 0),
        y: sayfaYuksekligi - f, // pdf.js alttan ölçer, biz üstten istiyoruz
        h,
      });
    }

    // Aynı satırdaki bitişik parçaları birleştir: "SAP Malzeme Tan" + "ı" + "m" + "ı"
    parcalar.sort((p, q) => (Math.abs(p.y - q.y) > 2 ? p.y - q.y : p.x0 - q.x0));
    const birlesik = [];
    for (const p of parcalar) {
      const onceki = birlesik[birlesik.length - 1];
      const bitisik =
        onceki &&
        Math.abs(onceki.y - p.y) <= 2 &&
        p.x0 - onceki.x1 < Math.max(1.2, p.h * 0.16) &&
        p.x0 >= onceki.x0;
      if (bitisik) {
        onceki.metin += p.metin;
        onceki.x1 = Math.max(onceki.x1, p.x1);
        onceki.h = Math.max(onceki.h, p.h);
      } else {
        birlesik.push({ ...p });
      }
    }

    const kelimeler = [];
    for (const p of birlesik) parcayiKelimelereBol(p.metin, p.x0, p.x1, p.y, p.h, kelimeler);
    return kelimeler;
  }

  /** PDF'in metin katmanını okur. Taranmış PDF'te boş/az sonuç döner. */
  async function metinKatmani(veri) {
    const belge = await belgeAc(veri);
    const sayfalar = [];
    try {
      for (let n = 1; n <= belge.numPages; n++) {
        const sayfa = await belge.getPage(n);
        const gorunum = sayfa.getViewport({ scale: 1 });
        const icerik = await sayfa.getTextContent();
        sayfalar.push({
          no: n,
          genislik: gorunum.width,
          yukseklik: gorunum.height,
          kelimeler: parcalardanKelimeler(icerik.items, gorunum.height),
        });
        sayfa.cleanup();
      }
    } finally {
      await belge.destroy();
    }
    return sayfalar;
  }

  /** Sayfayı tuvale çizip PNG blob'u döner (OCR girdisi ve önizleme için). */
  async function sayfaGoruntusu(veri, sayfaNo = 1, olcek = 2) {
    const belge = await belgeAc(veri);
    try {
      const sayfa = await belge.getPage(sayfaNo);
      const gorunum = sayfa.getViewport({ scale: olcek });
      const tuval = document.createElement('canvas');
      tuval.width = Math.ceil(gorunum.width);
      tuval.height = Math.ceil(gorunum.height);
      const ctx = tuval.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, tuval.width, tuval.height);
      await sayfa.render({ canvasContext: ctx, viewport: gorunum }).promise;
      return tuval;
    } finally {
      await belge.destroy();
    }
  }

  // ——— OCR ————————————————————————————————————————————————————————

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

  const OCR_DOSYALARI = [
    'js/kutuphane/ocr/tesseract.js',
    'js/kutuphane/ocr/tesseract-worker.b64.js',
    'js/kutuphane/ocr/tesseract-core.b64.js',
    'js/kutuphane/ocr/tur.traineddata.b64.js',
    'js/kutuphane/ocr/eng.traineddata.b64.js',
  ];

  let ocrYuklendi = null;

  /** OCR paketlerini klasörden yükler. fetch yasak olduğu için <script> etiketiyle. */
  function ocrYukle(bildir) {
    if (ocrYuklendi) return ocrYuklendi;
    ocrYuklendi = (async () => {
      for (const [i, yol] of OCR_DOSYALARI.entries()) {
        bildir?.(`OCR dosyaları yükleniyor (${i + 1}/${OCR_DOSYALARI.length})…`);
        await new Promise((tamam, hata) => {
          const s = document.createElement('script');
          s.src = yol;
          s.onload = tamam;
          s.onerror = () =>
            hata(new Error(`OCR dosyası bulunamadı: ${yol} — kurulum için README'ye bakın.`));
          document.head.append(s);
        });
      }
      if (typeof Tesseract === 'undefined') throw new Error('tesseract.js yüklenemedi.');
    })().catch((e) => {
      ocrYuklendi = null;
      throw e;
    });
    return ocrYuklendi;
  }

  /** OCR dosyaları yüklendi mi? */
  const ocrKuruluMu = () => typeof Tesseract !== 'undefined';

  /**
   * tesseract.js normalde worker'ını, WASM çekirdeğini ve dil dosyalarını ağdan
   * indirir; file:// üzerinde bu mümkün değil. Bunun yerine worker'ı kendimiz
   * kuruyoruz: tek bir blob içine sırayla
   *   1) WASM çekirdeği  — worker, TesseractCore zaten tanımlıysa indirmeyi atlıyor
   *   2) dil dosyaları + küçük bir fetch vekili — traineddata isteği bellekten karşılanıyor
   *   3) tesseract'ın kendi worker kodu
   * konuyor. Böylece tek bir ağ isteği bile çıkmıyor.
   */
  function isciSecenekleri() {
    const vekil = `
      self.TesseractCore = self.TesseractCore || TesseractCore;
      (() => {
        const gomulu = { 'tur.traineddata': self.__TT_TUR, 'eng.traineddata': self.__TT_ENG };
        delete self.__TT_TUR; delete self.__TT_ENG;
        const asilFetch = self.fetch ? self.fetch.bind(self) : null;
        self.fetch = (istek, secenekler) => {
          const url = String(istek && istek.url ? istek.url : istek);
          const ad = Object.keys(gomulu).find((a) => url.includes(a));
          if (!ad) {
            return asilFetch
              ? asilFetch(istek, secenekler)
              : Promise.reject(new Error('Ağ erişimi yok: ' + url));
          }
          return Promise.resolve(
            new Response(gomulu[ad], {
              status: 200,
              headers: { 'content-type': 'application/octet-stream' },
            })
          );
        };
      })();
    `;

    const parcalar = [
      b64Ikili(window.TESSERACT_CORE_B64),
      `\n;self.__TT_TUR=Uint8Array.from(atob(${JSON.stringify(window.TESSERACT_TUR_B64)}), (c) => c.charCodeAt(0));\n`,
      `;self.__TT_ENG=Uint8Array.from(atob(${JSON.stringify(window.TESSERACT_ENG_B64)}), (c) => c.charCodeAt(0));\n`,
      vekil,
      '\n;',
      b64Ikili(window.TESSERACT_WORKER_B64),
    ];
    return {
      workerPath: URL.createObjectURL(new Blob(parcalar, { type: 'text/javascript' })),
      workerBlobURL: false,
      corePath: '',      // çekirdek zaten worker'ın içinde
      langPath: '.',     // istek vekile düşüyor, adres önemsiz
      cacheMethod: 'none',
    };
  }

  /** Taranmış PDF: sayfaları görüntüye çevirip tesseract.js ile okur. */
  async function ocrIleOku(veri, { diller = 'tur+eng', olcek = 4, psm = '4', bildir } = {}) {
    await ocrYukle(bildir);
    const belge = await belgeAc(veri);
    const sayfalar = [];
    let isci = null;
    try {
      bildir?.('OCR motoru hazırlanıyor…');
      isci = await Tesseract.createWorker(diller, 1, isciSecenekleri());
      // psm 4 = "tek sütun, değişken punto": çizgili form tablolarında en iyisi.
      await isci.setParameters({ tessedit_pageseg_mode: psm, preserve_interword_spaces: '1' });

      for (let n = 1; n <= belge.numPages; n++) {
        bildir?.(`OCR: sayfa ${n}/${belge.numPages}`);
        const sayfa = await belge.getPage(n);
        const gorunum = sayfa.getViewport({ scale: olcek });
        const tuval = document.createElement('canvas');
        tuval.width = Math.ceil(gorunum.width);
        tuval.height = Math.ceil(gorunum.height);
        const ctx = tuval.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, tuval.width, tuval.height);
        await sayfa.render({ canvasContext: ctx, viewport: gorunum }).promise;

        const { data } = await isci.recognize(tuval, {}, { blocks: true, text: false });

        const kelimeler = [];
        for (const k of ocrKelimeleriniTopla(data)) {
          const metin = (k.text ?? '').trim();
          if (!metin || CIZGI_ARTIGI.test(metin)) continue;
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
        const sayfaGorunum = sayfa.getViewport({ scale: 1 });
        sayfalar.push({
          no: n,
          genislik: sayfaGorunum.width,
          yukseklik: sayfaGorunum.height,
          kelimeler,
        });
        sayfa.cleanup();
      }
    } finally {
      if (isci) await isci.terminate();
      await belge.destroy();
    }
    return sayfalar;
  }

  /**
   * Önce metin katmanını dener, yeterli metin yoksa OCR'a düşer.
   * @returns {{ kaynak:'metin'|'ocr', sayfalar:Array, uyari?:string }}
   */
  async function pdfOku(veri, secenekler = {}) {
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

  return { pdfOku, metinKatmani, ocrIleOku, sayfaGoruntusu, ocrKuruluMu, b64Ikili };
})();
