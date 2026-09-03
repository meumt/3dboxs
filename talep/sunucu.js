// Talep Takip — lokal sunucu.
//
// Tek bir HTML sayfası (genel/index.html) sunar, PDF'leri ayrıştırır ve her
// şeyi bu klasördeki veri/ dizinine yazar. Dışarıya hiçbir bağlantı açılmaz.
//
//   npm start   →  http://localhost:7345

import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { pdfOku, ocrHazirMi, sayfaGoruntusu } from './lib/pdf-metin.js';
import { ayristir } from './lib/ayristir.js';
import { Depo } from './lib/db.js';

const KOK = path.dirname(fileURLToPath(import.meta.url));
const VERI = path.join(KOK, 'veri');
const PDF_KLASORU = path.join(VERI, 'pdfler');
const GECICI = path.join(VERI, 'gecici');
const VERITABANI = path.join(VERI, 'talepler.db');
const PORT = Number(process.env.PORT || 7345);
const EN_BUYUK_DOSYA = 40 * 1024 * 1024; // 40 MB

for (const k of [VERI, PDF_KLASORU, GECICI]) fs.mkdirSync(k, { recursive: true });
const depo = new Depo(VERITABANI);

// ——— yardımcılar —————————————————————————————————————————————————

function json(yanit, veri, kod = 200) {
  const govde = Buffer.from(JSON.stringify(veri), 'utf8');
  yanit.writeHead(kod, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': govde.length,
    'cache-control': 'no-store',
  });
  yanit.end(govde);
}

function hata(yanit, mesaj, kod = 400) {
  json(yanit, { hata: mesaj }, kod);
}

async function govdeyiOku(istek, enFazla = EN_BUYUK_DOSYA) {
  const parcalar = [];
  let boyut = 0;
  for await (const parca of istek) {
    boyut += parca.length;
    if (boyut > enFazla) {
      istek.destroy();
      throw new Error(`Dosya çok büyük (en fazla ${Math.round(enFazla / 1024 / 1024)} MB).`);
    }
    parcalar.push(parca);
  }
  return Buffer.concat(parcalar);
}

async function jsonOku(istek) {
  const govde = await govdeyiOku(istek, 8 * 1024 * 1024);
  if (!govde.length) return {};
  return JSON.parse(govde.toString('utf8'));
}

/** Dosya adını güvenli hâle getirir — dizin dışına çıkışı engeller. */
function guvenliAd(ad) {
  return (
    String(ad || 'talep.pdf')
      .replace(/[\\/]/g, '_')
      .replace(/[\u0000-\u001f\u007f]/g, '')
      .replace(/^\.+/, '')
      .slice(0, 120) || 'talep.pdf'
  );
}

/** Bir yolun gerçekten verilen kök klasörün içinde kaldığını doğrular. */
function icindeMi(mutlakYol, kok) {
  const c = path.resolve(mutlakYol);
  return c === kok || c.startsWith(kok + path.sep) ? c : null;
}

const ozetle = (tampon) => crypto.createHash('sha256').update(tampon).digest('hex');

// ——— uç noktalar —————————————————————————————————————————————————

/** PDF'i ayrıştırır, sonucu önizleme için döner. Kayıt ayrı adımda yapılır. */
async function pdfCoz(istek, yanit, sorgu) {
  const veri = await govdeyiOku(istek);
  if (!veri.length) return hata(yanit, 'Boş dosya geldi.');
  if (veri.subarray(0, 5).toString('latin1') !== '%PDF-') {
    return hata(yanit, 'Bu bir PDF dosyası değil.');
  }

  const ad = guvenliAd(
    Buffer.from(istek.headers['x-dosya-adi'] || '', 'base64').toString('utf8') || 'talep.pdf'
  );
  const ozet = ozetle(veri);
  const mevcut = depo.pdfVarMi(ozet);

  const { kaynak, sayfalar, uyari } = await pdfOku(veri, {
    ocrZorla: sorgu.get('ocr') === '1',
    log: (m) => console.log(m),
  });
  const cozum = ayristir(sayfalar);

  await fsp.writeFile(path.join(GECICI, `${ozet}.pdf`), veri);

  json(yanit, {
    ozet,
    ad,
    kaynak,
    sayfaSayisi: sayfalar.length,
    uyari,
    zatenVar: mevcut,
    ...cozum,
  });
}

/** Önizlemede düzeltilen satırları veritabanına yazar, PDF'i kalıcı klasöre taşır. */
async function kaydet(istek, yanit) {
  const gelen = await jsonOku(istek);
  const { ozet, ad, baslik = {}, kalemler = [], kaynak, sayfaSayisi } = gelen;
  if (!Array.isArray(kalemler) || !kalemler.length) return hata(yanit, 'Kaydedilecek kalem yok.');
  if (!baslik.talepNo) return hata(yanit, 'Talep no boş olamaz.');

  let pdfBilgisi = null;
  if (ozet) {
    if (depo.pdfVarMi(ozet)) return hata(yanit, 'Bu PDF zaten kayıtlı.', 409);
    const geciciYol = icindeMi(path.join(GECICI, `${guvenliAd(ozet)}.pdf`), GECICI);
    if (geciciYol && fs.existsSync(geciciYol)) {
      const dosyaAdi = `${guvenliAd(baslik.talepNo)}_${ozet.slice(0, 8)}.pdf`;
      await fsp.rename(geciciYol, path.join(PDF_KLASORU, dosyaAdi));
      pdfBilgisi = { dosya: dosyaAdi, ozet, ad: guvenliAd(ad), kaynak, sayfaSayisi };
    }
  }

  const sonuc = depo.talepEkle({ baslik, kalemler, pdf: pdfBilgisi });
  json(yanit, { ...sonuc, ozet: depo.ozet() });
}

function pdfGonder(yanit, talepId) {
  const talep = depo.talep(talepId);
  if (!talep?.pdf_dosya) return hata(yanit, 'Bu talebin PDF dosyası yok.', 404);
  const yol = icindeMi(path.join(PDF_KLASORU, talep.pdf_dosya), PDF_KLASORU);
  if (!yol || !fs.existsSync(yol)) return hata(yanit, 'PDF dosyası bulunamadı.', 404);
  yanit.writeHead(200, {
    'content-type': 'application/pdf',
    'content-disposition': `inline; filename*=UTF-8''${encodeURIComponent(
      talep.pdf_ad || talep.pdf_dosya
    )}`,
  });
  fs.createReadStream(yol).pipe(yanit);
}

async function onizlemeGonder(yanit, talepId, sayfaNo) {
  const talep = depo.talep(talepId);
  if (!talep?.pdf_dosya) return hata(yanit, 'PDF yok.', 404);
  const yol = icindeMi(path.join(PDF_KLASORU, talep.pdf_dosya), PDF_KLASORU);
  if (!yol || !fs.existsSync(yol)) return hata(yanit, 'PDF bulunamadı.', 404);
  const png = await sayfaGoruntusu(await fsp.readFile(yol), sayfaNo, 2);
  yanit.writeHead(200, { 'content-type': 'image/png', 'content-length': png.length });
  yanit.end(png);
}

const CSV_BASLIKLARI = [
  ['talep_no', 'TALEP NO'],
  ['proje', 'PROJE'],
  ['malzeme_kodu', 'MALZEME KODU'],
  ['aciklama', 'AÇIKLAMA'],
  ['miktar', 'MİKTAR'],
  ['birim', 'BİRİM'],
  ['nereden', 'NEREDEN'],
  ['poz', 'POZ'],
  ['metin', 'MALZEME METNİ'],
  ['tamamlandi', 'TAMAMLANDI'],
  ['tamamlanma_tarihi', 'TAMAMLANMA'],
  ['notlar', 'NOT'],
];

function csvGonder(yanit, sorgu) {
  const satirlar = depo.kalemler(Object.fromEntries(sorgu));
  const kacir = (d) => `"${String(d ?? '').replace(/"/g, '""')}"`;
  // Excel'in UTF-8'i tanıması için BOM, ayraç olarak da noktalı virgül.
  const govde =
    '\uFEFF' +
    [
      CSV_BASLIKLARI.map(([, b]) => kacir(b)).join(';'),
      ...satirlar.map((s) =>
        CSV_BASLIKLARI.map(([a]) =>
          kacir(a === 'tamamlandi' ? (s.tamamlandi ? 'EVET' : 'HAYIR') : s[a])
        ).join(';')
      ),
    ].join('\r\n');
  const tampon = Buffer.from(govde, 'utf8');
  yanit.writeHead(200, {
    'content-type': 'text/csv; charset=utf-8',
    'content-disposition': `attachment; filename="talepler-${new Date()
      .toISOString()
      .slice(0, 10)}.csv"`,
    'content-length': tampon.length,
  });
  yanit.end(tampon);
}

// ——— yönlendirme ——————————————————————————————————————————————————

const SAYFA = path.join(KOK, 'genel', 'index.html');

async function yonlendir(istek, yanit) {
  const url = new URL(istek.url, 'http://localhost');
  const yol = url.pathname;
  const sorgu = url.searchParams;
  const yontem = istek.method;

  if (yol === '/' || yol === '/index.html') {
    const html = await fsp.readFile(SAYFA);
    yanit.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
    });
    return yanit.end(html);
  }

  if (yol === '/api/durum') {
    return json(yanit, {
      ozet: depo.ozet(),
      secenekler: depo.secenekler(),
      ocrHazir: ocrHazirMi(),
    });
  }
  if (yol === '/api/coz' && yontem === 'POST') return pdfCoz(istek, yanit, sorgu);
  if (yol === '/api/kaydet' && yontem === 'POST') return kaydet(istek, yanit);
  if (yol === '/api/kalemler') return json(yanit, depo.kalemler(Object.fromEntries(sorgu)));
  if (yol === '/api/talepler') return json(yanit, depo.talepler());
  if (yol === '/api/disaver.csv') return csvGonder(yanit, sorgu);

  let e;
  if ((e = /^\/api\/kalem\/(\d+)$/.exec(yol)) && yontem === 'PATCH') {
    const gelen = await jsonOku(istek);
    const id = Number(e[1]);
    if ('tamamlandi' in gelen) depo.kalemDurumu(id, Boolean(gelen.tamamlandi));
    const { tamamlandi, ...alanlar } = gelen;
    const kalem = Object.keys(alanlar).length ? depo.kalemDuzenle(id, alanlar) : depo.kalem(id);
    return json(yanit, kalem);
  }
  if ((e = /^\/api\/talep\/(\d+)\/durum$/.exec(yol)) && yontem === 'POST') {
    const gelen = await jsonOku(istek);
    depo.talepDurumu(Number(e[1]), Boolean(gelen.tamamlandi));
    return json(yanit, { tamam: true, ozet: depo.ozet() });
  }
  if ((e = /^\/api\/talep\/(\d+)$/.exec(yol)) && yontem === 'DELETE') {
    const talep = depo.talepSil(Number(e[1]));
    if (talep?.pdf_dosya) {
      const p = icindeMi(path.join(PDF_KLASORU, talep.pdf_dosya), PDF_KLASORU);
      if (p) await fsp.rm(p, { force: true });
    }
    return json(yanit, { tamam: true, ozet: depo.ozet() });
  }
  if ((e = /^\/api\/pdf\/(\d+)$/.exec(yol))) return pdfGonder(yanit, Number(e[1]));
  if ((e = /^\/api\/onizleme\/(\d+)$/.exec(yol)))
    return onizlemeGonder(yanit, Number(e[1]), Number(sorgu.get('sayfa') || 1));

  hata(yanit, 'Bulunamadı.', 404);
}

const sunucu = http.createServer((istek, yanit) => {
  yonlendir(istek, yanit).catch((e) => {
    console.error(e);
    if (!yanit.headersSent) hata(yanit, e.message || 'Sunucu hatası', 500);
    else yanit.end();
  });
});

// Sadece bu bilgisayardan erişilsin.
sunucu.listen(PORT, '127.0.0.1', () => {
  console.log(`\n  Talep Takip çalışıyor →  http://localhost:${PORT}`);
  console.log(`  Veritabanı:  ${VERITABANI}`);
  console.log(`  PDF klasörü: ${PDF_KLASORU}`);
  console.log(
    `  OCR:         ${ocrHazirMi() ? 'hazır (tesseract.js)' : 'kurulu değil — npm install tesseract.js'}\n`
  );
});

for (const sinyal of ['SIGINT', 'SIGTERM']) {
  process.on(sinyal, () => {
    depo.kapat();
    sunucu.close(() => process.exit(0));
  });
}
