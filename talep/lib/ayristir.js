// Ambardan malzeme talep formunu koordinatlı kelimelerden tabloya çevirir.
//
// Yöntem: kelimeler y'ye göre satırlara kümelenir, tablo başlığı ("No / Proje /
// Malzeme Kodu / Miktar ...") bulunur, başlık etiketlerinin x aralıklarından
// kolon sınırları çıkarılır. Her kelime merkez x'ine göre bir kolona düşer.
// Sonra hücreler tipe göre onarılır (miktar sayı olmalı, birim harf olmalı ...).

/** Türkçe duyarlı sadeleştirme: karşılaştırma için. */
export function sade(s) {
  return String(s ?? '')
    .replace(/ /g, ' ')
    .trim()
    .toLocaleLowerCase('tr')
    .replace(/[ı]/g, 'i')
    .replace(/[şŞ]/g, 's')
    .replace(/[ğĞ]/g, 'g')
    .replace(/[üÜ]/g, 'u')
    .replace(/[öÖ]/g, 'o')
    .replace(/[çÇ]/g, 'c')
    .replace(/\s+/g, ' ');
}

function ortanca(sayilar) {
  if (!sayilar.length) return 0;
  const s = [...sayilar].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

/**
 * Kelimeleri y'ye göre satırlara böler.
 *
 * Kümeleme, sıralı y değerleri arasındaki *boşluğa* bakar; ortalamayı kaydıran
 * yöntem OCR'ın gürültülü y'lerinde satırları birbirine yapıştırıyordu.
 * Eşik, tipik kelime yüksekliğinden türetilir: satır aralığından küçük,
 * satır içi oynamadan büyük.
 */
export function satirlar(kelimeler) {
  if (!kelimeler.length) return [];
  const esik = Math.min(8, Math.max(2.5, ortanca(kelimeler.map((k) => k.h || 9)) * 0.6));
  const sirali = [...kelimeler].sort((a, b) => a.y - b.y || a.x0 - b.x0);
  const cikti = [];
  let oncekiY = null;
  for (const k of sirali) {
    if (oncekiY === null || k.y - oncekiY > esik) cikti.push({ y: k.y, kelimeler: [] });
    cikti[cikti.length - 1].kelimeler.push(k);
    oncekiY = k.y;
  }
  for (const s of cikti) {
    s.kelimeler.sort((a, b) => a.x0 - b.x0);
    s.y = ortanca(s.kelimeler.map((k) => k.y));
    s.metin = s.kelimeler.map((k) => k.metin).join(' ');
  }
  return cikti;
}

/** Bir satırdaki kelimeleri, aralarındaki boşluğa göre etiket öbeklerine ayırır. */
function obekle(kelimeler, esik = 12) {
  const obekler = [];
  for (const k of kelimeler) {
    const son = obekler[obekler.length - 1];
    if (son && k.x0 - son.x1 <= esik) {
      son.kelimeler.push(k);
      son.x1 = Math.max(son.x1, k.x1);
      son.metin += ' ' + k.metin;
    } else {
      obekler.push({ x0: k.x0, x1: k.x1, metin: k.metin, kelimeler: [k] });
    }
  }
  return obekler;
}

// ——— Başlık alanları ———————————————————————————————————————————————

const ETIKETLER = [
  { anahtar: 'talepEdenBirim', desen: /^talep eden birim\/? ?(tase?ron)?$/ },
  { anahtar: 'talepEdenKullanici', desen: /^talep eden kullanici$/ },
  { anahtar: 'talepTarihSaat', desen: /^talep tarih ?\/? ?saat$/ },
  { anahtar: 'talepNo', desen: /^talep no$/ },
  { anahtar: 'depoTanimi', desen: /^depo tanimi$/ },
  { anahtar: 'depoYeri', desen: /^depo yeri$/ },
  { anahtar: 'uretimYeri', desen: /^uretim yeri$/ },
  { anahtar: 'tarih', desen: /^tarih$/ },
  { anahtar: 'sayfa', desen: /^sayfa( no)?$/ },
];

/** "Etiket : değer" ikililerini, aynı satırda yan yana olsalar bile çıkarır. */
export function basligiOku(satirListesi) {
  const alanlar = {};
  for (const satir of satirListesi) {
    const k = satir.kelimeler;
    // Etiketin bittiği ve ':' ile başladığı yerleri işaretle
    const bulunanlar = [];
    for (let i = 0; i < k.length; i++) {
      for (let uzunluk = 4; uzunluk >= 1; uzunluk--) {
        if (i + uzunluk > k.length) continue;
        const parca = sade(k.slice(i, i + uzunluk).map((w) => w.metin).join(' '));
        const eslesme = ETIKETLER.find((e) => e.desen.test(parca));
        if (eslesme) {
          bulunanlar.push({ anahtar: eslesme.anahtar, bas: i, son: i + uzunluk - 1 });
          i += uzunluk - 1;
          break;
        }
      }
    }
    if (!bulunanlar.length) continue;

    for (let b = 0; b < bulunanlar.length; b++) {
      const { anahtar, son } = bulunanlar[b];
      let i = son + 1;
      // etiketten sonraki ilk ':' işaretini geç
      while (i < k.length && /^[:：]$/.test(k[i].metin)) i++;
      if (i === son + 1 && k[i] && /^[:：]/.test(k[i].metin) === false) {
        // ':' ayrı kelime değil, "Talep No:" gibi bitişik olabilir
      }
      const sonrakiEtiketBasi = bulunanlar[b + 1]?.bas ?? k.length;
      const deger = [];
      for (; i < sonrakiEtiketBasi; i++) {
        const m = k[i].metin.replace(/^[:：]\s*/, '');
        if (m) deger.push(m);
      }
      const metin = deger.join(' ').trim();
      if (metin && !alanlar[anahtar]) alanlar[anahtar] = metin;
    }
  }
  return alanlar;
}

// ——— Tablo ————————————————————————————————————————————————————————

const KOLON_DESENLERI = [
  { anahtar: 'sira', desen: /^(no|sira( ?no)?|s\.? ?no|kalem)$/ },
  { anahtar: 'metin', desen: /^(malzeme ?\/? ?talep metni|talep metni|malzeme metni)$/ },
  { anahtar: 'proje', desen: /^(proje|proje kodu|is emri)$/ },
  { anahtar: 'poz', desen: /^(poz|poz no)$/ },
  { anahtar: 'kod', desen: /^(malzeme kodu|stok kodu|malzeme no|kod)$/ },
  { anahtar: 'aciklama', desen: /^((sap )?malzeme tanimi|tanim|aciklama|malzeme adi)$/ },
  { anahtar: 'miktar', desen: /^(miktar|adet)$/ },
  { anahtar: 'birim', desen: /^(birim|olcu birimi|br)$/ },
];

/** Tablo başlık satırından kolon sınırlarını çıkarır. */
export function kolonlariCoz(satir) {
  const obekler = obekle(satir.kelimeler, 12);
  const kolonlar = obekler.map((o) => {
    const s = sade(o.metin);
    const eslesme = KOLON_DESENLERI.find((k) => k.desen.test(s));
    return { anahtar: eslesme?.anahtar ?? null, etiket: o.metin, x0: o.x0, x1: o.x1 };
  });
  for (let i = 0; i < kolonlar.length; i++) {
    kolonlar[i].sol = i === 0 ? -Infinity : (kolonlar[i - 1].x1 + kolonlar[i].x0) / 2;
    kolonlar[i].sag =
      i === kolonlar.length - 1 ? Infinity : (kolonlar[i].x1 + kolonlar[i + 1].x0) / 2;
  }
  return kolonlar;
}

/** Satır tablo başlığı mı? En az üç tanıdık kolon etiketi arıyoruz. */
function baslikSatiriMi(satir) {
  const kolonlar = kolonlariCoz(satir);
  const tanidik = new Set(kolonlar.map((k) => k.anahtar).filter(Boolean));
  return tanidik.has('miktar') && (tanidik.has('kod') || tanidik.has('aciklama')) && tanidik.size >= 3
    ? kolonlar
    : null;
}

const DIPNOT = /^(stok yonetimi|departman yoneticisi|teknik ofis|pto|imza|toplam|sayfa \d)/;

function hucreleriKur(kolonlar) {
  const h = {};
  for (const k of kolonlar) if (k.anahtar) h[k.anahtar] = [];
  return h;
}

function satiriHucreleyeDagit(satir, kolonlar, hucreler) {
  let dolu = false;
  for (const kelime of satir.kelimeler) {
    const orta = (kelime.x0 + kelime.x1) / 2;
    const kolon = kolonlar.find((k) => orta >= k.sol && orta < k.sag);
    if (!kolon?.anahtar) continue;
    hucreler[kolon.anahtar].push(kelime.metin);
    dolu = true;
  }
  return dolu;
}

const SAYI = /^[0-9][0-9.,]*$/;
const BIRIM = /^[A-Za-zÇĞİÖŞÜçğıöşü]{1,6}\.?$/;

/** Hücreleri tipine göre onarır: kolon sınırına takılan parçaları doğru yere taşır. */
function hucreleriOnar(h) {
  const al = (a) => (h[a] ??= []);

  // Sıra no: yalnız ilk sayı; gerisi metne
  if (al('sira').length > 1) {
    const [ilk, ...kalan] = h.sira;
    if (SAYI.test(ilk)) {
      h.sira = [ilk];
      al('metin').unshift(...kalan);
    }
  }

  // Birim hücresine kaçmış miktar
  if (al('birim').length > 1 && SAYI.test(h.birim[0])) {
    al('miktar').push(h.birim.shift());
  }

  // Miktar hücresi: son sayı miktardır, öncesi açıklamaya geri döner
  if (al('miktar').length > 1) {
    let sonSayi = -1;
    for (let i = h.miktar.length - 1; i >= 0; i--) {
      if (SAYI.test(h.miktar[i])) { sonSayi = i; break; }
    }
    if (sonSayi >= 0) {
      const oncesi = h.miktar.slice(0, sonSayi);
      const sonrasi = h.miktar.slice(sonSayi + 1);
      h.miktar = [h.miktar[sonSayi]];
      al('aciklama').push(...oncesi);
      for (const p of sonrasi) (BIRIM.test(p) ? al('birim') : al('aciklama')).push(p);
    }
  }

  // Miktar boş kaldıysa açıklamanın sonundaki sayıyı al
  if (!al('miktar').length && al('aciklama').length) {
    const son = h.aciklama[h.aciklama.length - 1];
    if (SAYI.test(son) && h.aciklama.length > 1) h.miktar = [h.aciklama.pop()];
  }

  // "55,820KG" gibi bitişik yazımlar
  if (h.miktar?.length === 1) {
    const m = /^([0-9][0-9.,]*)\s*([A-Za-zÇĞİÖŞÜçğıöşü]{1,6})$/.exec(h.miktar[0]);
    if (m) {
      h.miktar = [m[1]];
      if (!al('birim').length) h.birim = [m[2]];
    }
  }
  return h;
}

function hucreMetni(parcalar) {
  return (parcalar ?? []).join(' ').replace(/\s+/g, ' ').trim();
}

/** "55.820,75" / "55,820" / "1 234.5" → sayı. Boşsa null. */
export function miktariSayiyaCevir(ham) {
  const s = String(ham ?? '').replace(/\s/g, '');
  if (!s) return null;
  let temiz;
  if (s.includes(',') && s.includes('.')) {
    // hangisi en sondaysa o ondalık ayracıdır
    temiz = s.lastIndexOf(',') > s.lastIndexOf('.')
      ? s.replace(/\./g, '').replace(',', '.')
      : s.replace(/,/g, '');
  } else if (s.includes(',')) {
    temiz = s.replace(',', '.');
  } else {
    // tek nokta: binlik mi ondalık mı? "1.234" binlik, "55.82" ondalık sayılır
    temiz = /^\d{1,3}(\.\d{3})+$/.test(s) ? s.replace(/\./g, '') : s;
  }
  const n = Number(temiz);
  return Number.isFinite(n) ? n : null;
}

/**
 * Sayfaları ayrıştırıp form başlığını ve kalemleri döner.
 * @param {Array} sayfalar pdfOku() çıktısındaki sayfalar
 */
export function ayristir(sayfalar) {
  const uyarilar = [];
  const tumSatirlar = [];
  for (const s of sayfalar) tumSatirlar.push(...satirlar(s.kelimeler).map((x) => ({ ...x, sayfa: s.no })));

  const baslik = basligiOku(tumSatirlar);
  const kalemler = [];
  let sonKolonlar = null;

  for (const sayfa of sayfalar) {
    const sayfaSatirlari = satirlar(sayfa.kelimeler);
    let baslikIndeksi = -1;
    let kolonlar = null;
    for (let i = 0; i < sayfaSatirlari.length; i++) {
      const bulunan = baslikSatiriMi(sayfaSatirlari[i]);
      if (bulunan) { kolonlar = bulunan; baslikIndeksi = i; break; }
    }
    if (!kolonlar) {
      if (!sonKolonlar) continue; // bu sayfada tablo yok
      kolonlar = sonKolonlar;     // çok sayfalı tabloda başlık tekrar etmeyebilir
      baslikIndeksi = -1;
    }
    sonKolonlar = kolonlar;

    const siraKolonuVar = kolonlar.some((k) => k.anahtar === 'sira');
    let oncekiKalem = null;

    for (let i = baslikIndeksi + 1; i < sayfaSatirlari.length; i++) {
      const satir = sayfaSatirlari[i];
      if (DIPNOT.test(sade(satir.metin))) break;
      if (baslikSatiriMi(satir)) continue; // tekrar eden başlık

      const hucreler = hucreleriKur(kolonlar);
      if (!satiriHucreleyeDagit(satir, kolonlar, hucreler)) continue;
      hucreleriOnar(hucreler);

      const siraHam = hucreMetni(hucreler.sira);
      const yeniKalem = siraKolonuVar
        ? SAYI.test(siraHam)
        : Boolean(hucreMetni(hucreler.kod) || hucreMetni(hucreler.miktar));

      if (yeniKalem) {
        const kalem = {
          sayfa: sayfa.no,
          sira: siraHam ? Number(siraHam) : kalemler.length + 1,
          metin: hucreMetni(hucreler.metin),
          proje: hucreMetni(hucreler.proje),
          poz: hucreMetni(hucreler.poz),
          kod: hucreMetni(hucreler.kod),
          aciklama: hucreMetni(hucreler.aciklama),
          miktar: hucreMetni(hucreler.miktar),
          birim: hucreMetni(hucreler.birim),
        };
        kalem.miktarSayi = miktariSayiyaCevir(kalem.miktar);
        kalemler.push(kalem);
        oncekiKalem = kalem;
      } else if (oncekiKalem) {
        // Alt satıra taşan açıklama / proje
        for (const alan of ['metin', 'proje', 'kod', 'aciklama']) {
          const ek = hucreMetni(hucreler[alan]);
          if (ek) oncekiKalem[alan] = (oncekiKalem[alan] ? oncekiKalem[alan] + ' ' : '') + ek;
        }
      }
    }
  }

  if (!kalemler.length) uyarilar.push('Tabloda kalem bulunamadı — kolon başlıkları tanınmadı olabilir.');
  for (const k of kalemler) {
    if (!k.kod) uyarilar.push(`Satır ${k.sira}: malzeme kodu okunamadı.`);
    if (k.miktarSayi === null) uyarilar.push(`Satır ${k.sira}: miktar okunamadı ("${k.miktar}").`);
  }

  const nereden = [baslik.depoTanimi, baslik.depoYeri && `(${baslik.depoYeri})`]
    .filter(Boolean)
    .join(' ');

  return {
    baslik: {
      talepNo: baslik.talepNo ?? '',
      birim: baslik.talepEdenBirim ?? '',
      kullanici: baslik.talepEdenKullanici ?? '',
      tarihSaat: baslik.talepTarihSaat ?? baslik.tarih ?? '',
      depoTanimi: baslik.depoTanimi ?? '',
      depoYeri: baslik.depoYeri ?? '',
      uretimYeri: baslik.uretimYeri ?? '',
      nereden,
    },
    kalemler,
    uyarilar: [...new Set(uyarilar)],
  };
}
