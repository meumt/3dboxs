import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ayristir, satirlar, sade, miktariSayiyaCevir } from '../lib/ayristir.js';
import { metinKatmani, pdfOku } from '../lib/pdf-metin.js';
import { Depo } from '../lib/db.js';

const KOK = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const ORNEK = path.join(KOK, 'ornek', 'ornek-talep.pdf');

const kelime = (metin, x0, x1, y, h = 9) => ({ metin, x0, x1, y, h });

test('sade() Türkçe harfleri karşılaştırılabilir hâle getirir', () => {
  assert.equal(sade('İŞLENMİŞ DEMİR'), 'islenmis demir');
  assert.equal(sade('  Malzeme   Kodu '), 'malzeme kodu');
  assert.equal(sade('Üretim Yeri'), 'uretim yeri');
});

test('miktariSayiyaCevir() Türk ve İngiliz yazımını ayırt eder', () => {
  assert.equal(miktariSayiyaCevir('55,820'), 55.82);
  assert.equal(miktariSayiyaCevir('1.234'), 1234); // binlik ayracı
  assert.equal(miktariSayiyaCevir('55.82'), 55.82); // ondalık nokta
  assert.equal(miktariSayiyaCevir('1.234.567,89'), 1234567.89);
  assert.equal(miktariSayiyaCevir('1,234,567.89'), 1234567.89);
  assert.equal(miktariSayiyaCevir(''), null);
  assert.equal(miktariSayiyaCevir('abc'), null);
});

test('satirlar() satır aralığına göre kümeler, kaymaz', () => {
  // 18 pt aralıkla üç satır; her satırın kendi içinde 3 pt oynama var.
  const kelimeler = [];
  for (let s = 0; s < 3; s++) {
    for (let k = 0; k < 6; k++) {
      kelimeler.push(kelime(`s${s}k${k}`, k * 60, k * 60 + 40, 100 + s * 18 + (k % 2 ? 2.5 : 0)));
    }
  }
  const sonuc = satirlar(kelimeler);
  assert.equal(sonuc.length, 3, 'üç satır bekleniyordu');
  for (const s of sonuc) assert.equal(s.kelimeler.length, 6);
});

test('ayristir() kolon sınırına oturan hücreleri onarır', () => {
  // "B50" açıklama ile miktar kolonunun tam sınırında duruyor.
  const kelimeler = [
    kelime('No', 26, 37, 100),
    kelime('Malzeme', 483, 520, 100), kelime('Kodu', 521, 543, 100),
    kelime('SAP', 584, 600, 100), kelime('Malzeme', 602, 638, 100), kelime('Tanımı', 640, 667, 100),
    kelime('Miktar', 704, 727, 100),
    kelime('Birim', 745, 767, 100),

    kelime('00001', 21, 43, 120),
    kelime('4600032199', 471, 515, 120),
    kelime('Ø20', 661, 676, 120),
    kelime('B50', 678, 692, 120), // merkezi 685 → miktar kolonuna düşer, geri alınmalı
    kelime('55,820', 696, 720, 120),
    kelime('KG', 741, 752, 120),
  ];
  const { kalemler } = ayristir([{ no: 1, genislik: 792, yukseklik: 612, kelimeler }]);
  assert.equal(kalemler.length, 1);
  assert.equal(kalemler[0].miktar, '55,820');
  assert.equal(kalemler[0].miktarSayi, 55.82);
  assert.equal(kalemler[0].birim, 'KG');
  assert.equal(kalemler[0].aciklama, 'Ø20 B50');
  assert.equal(kalemler[0].kod, '4600032199');
});

test('ayristir() miktara yapışık birimi ayırır', () => {
  const kelimeler = [
    kelime('No', 26, 37, 100),
    kelime('Malzeme', 483, 520, 100), kelime('Kodu', 521, 543, 100),
    kelime('Miktar', 704, 727, 100),
    kelime('00007', 21, 43, 120),
    kelime('4600032199', 471, 515, 120),
    kelime('12,5KG', 696, 730, 120),
  ];
  const { kalemler } = ayristir([{ no: 1, genislik: 792, yukseklik: 612, kelimeler }]);
  assert.equal(kalemler[0].miktar, '12,5');
  assert.equal(kalemler[0].birim, 'KG');
});

test('örnek talep formu eksiksiz okunur', async () => {
  const sayfalar = await metinKatmani(fs.readFileSync(ORNEK));
  const { baslik, kalemler, uyarilar } = ayristir(sayfalar);

  assert.equal(baslik.talepNo, '0022866');
  assert.equal(baslik.depoTanimi, '8 NOLU AMBAR');
  assert.equal(baslik.depoYeri, '1024');
  assert.equal(baslik.kullanici, 'MKEFELIOGLU');
  assert.equal(baslik.birim, 'Reaktör-4 IC Nük');
  assert.equal(baslik.nereden, '8 NOLU AMBAR (1024)');
  assert.deepEqual(uyarilar, []);

  assert.equal(kalemler.length, 13);
  assert.deepEqual(kalemler[0], {
    sayfa: 1,
    sira: 1,
    metin: 'İŞLENMİŞ DEMİR',
    proje: 'AKU.0179.40UJA.0.KZ.TB0016',
    poz: '34',
    kod: '4600032199',
    aciklama: '0179.40UJA.0.KZ.TB0016 / Ø20 B50',
    miktar: '55,820',
    birim: 'KG',
    miktarSayi: 55.82,
  });
  assert.equal(kalemler.at(-1).miktar, '57,110');
  assert.equal(kalemler.at(-1).poz, '1');
  for (const k of kalemler) {
    assert.equal(k.kod, '4600032199');
    assert.equal(k.birim, 'KG');
    assert.ok(k.miktarSayi > 0);
  }
});

test('pdfOku() metin katmanı varken OCR\'a düşmez', async () => {
  const { kaynak, sayfalar } = await pdfOku(fs.readFileSync(ORNEK));
  assert.equal(kaynak, 'metin');
  assert.equal(sayfalar.length, 1);
});

test('depo: kayıt, arama, tamamlama', async (t) => {
  const klasor = fs.mkdtempSync(path.join(os.tmpdir(), 'talep-'));
  const depo = new Depo(path.join(klasor, 'deneme.db'));
  t.after(() => { depo.kapat(); fs.rmSync(klasor, { recursive: true, force: true }); });

  const sayfalar = await metinKatmani(fs.readFileSync(ORNEK));
  const { baslik, kalemler } = ayristir(sayfalar);
  const { talepId, kalemSayisi } = depo.talepEkle({
    baslik,
    kalemler,
    pdf: { dosya: 'x.pdf', ozet: 'ozet1', ad: 'x.pdf', kaynak: 'metin', sayfaSayisi: 1 },
  });
  assert.equal(kalemSayisi, 13);
  assert.deepEqual(depo.ozet(), { kalem: 13, tamamlanan: 0, bekleyen: 13, talep: 1 });

  // Türkçe arama büyük/küçük harften ve harf işaretlerinden etkilenmemeli
  for (const q of ['demir', 'DEMİR', 'İşlenmiş', 'tb0016', 'demir 4600']) {
    assert.equal(depo.kalemler({ arama: q }).length, 13, `arama: ${q}`);
  }
  assert.equal(depo.kalemler({ arama: 'bakır' }).length, 0);

  // aynı PDF ikinci kez eklenemez
  assert.ok(depo.pdfVarMi('ozet1'));
  assert.equal(depo.pdfVarMi('baska'), null);

  // tek kalem tamamlama
  const ilk = depo.kalemler()[0];
  depo.kalemDurumu(ilk.id, true);
  assert.equal(depo.ozet().tamamlanan, 1);
  assert.equal(depo.kalemler({ durum: 'bekleyen' }).length, 12);
  assert.ok(depo.kalem(ilk.id).tamamlanma_tarihi);

  // talebin tamamını tamamlama ve geri alma
  depo.talepDurumu(talepId, true);
  assert.equal(depo.ozet().bekleyen, 0);
  depo.talepDurumu(talepId, false);
  assert.equal(depo.ozet().tamamlanan, 0);

  // düzenleme arama dizinine de yansımalı
  depo.kalemDuzenle(ilk.id, { aciklama: 'PASLANMAZ BORU' });
  assert.equal(depo.kalemler({ arama: 'paslanmaz' }).length, 1);
  // beyaz listede olmayan alan yazılmamalı
  depo.kalemDuzenle(ilk.id, { tamamlandi: 1, talep_id: 999 });
  assert.equal(depo.kalem(ilk.id).tamamlandi, 0);
  assert.equal(depo.kalem(ilk.id).talep_id, talepId);

  depo.talepSil(talepId);
  assert.deepEqual(depo.ozet(), { kalem: 0, tamamlanan: 0, bekleyen: 0, talep: 0 });
});
