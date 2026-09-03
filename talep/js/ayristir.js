// Ambardan malzeme talep formunu koordinatlı kelimelerden tabloya çevirir.
//
// Yöntem: kelimeler y'ye göre satırlara kümelenir, tablo başlığı ("No / Proje /
// Malzeme Kodu / Miktar ...") bulunur, başlık etiketlerinin x aralıklarından
// kolon sınırları çıkarılır. Her kelime merkez x'ine göre bir kolona düşer.
// Sonra hücreler tipine göre onarılır (miktar sayı olmalı, birim harf olmalı ...).

window.TT = window.TT || {};

TT.ayristirici = (() => {
  'use strict';

  /** Türkçe duyarlı sadeleştirme: karşılaştırma ve arama için. */
  function sade(s) {
    return String(s ?? '')
      .replace(/ /g, ' ')
      .trim()
      .toLocaleLowerCase('tr')
      .replace(/ı/g, 'i')
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
  function satirlar(kelimeler) {
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
  function obekle(kelimeler, esik) {
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

  // ——— Başlık alanları ———————————————————————————————————————————

  const ETIKETLER = [
    { anahtar: 'talepEdenBirim', desen: /^(talep eden birim\/? ?(tase?ron)?|requesting company)$/ },
    { anahtar: 'talepEdenKullanici', desen: /^(talep eden kullanici|requested by)$/ },
    { anahtar: 'talepTarihSaat', desen: /^(talep tarih ?\/? ?saat|request date)$/ },
    { anahtar: 'talepNo', desen: /^(talep no|request form no|request no|form no)$/ },
    { anahtar: 'depoTanimi', desen: /^(depo tanimi|warehouse desc\.?|warehouse description)$/ },
    { anahtar: 'depoYeri', desen: /^(depo yeri|warehouse|warehouse no)$/ },
    { anahtar: 'uretimYeri', desen: /^(uretim yeri|production place)$/ },
    { anahtar: 'faturaNo', desen: /^(fatura no|invoice no)$/ },
    { anahtar: 'tarih', desen: /^(tarih|date)$/ },
    { anahtar: 'sayfa', desen: /^(sayfa( no)?|page)$/ },
  ];

  /** "Etiket : değer" ikililerini, aynı satırda yan yana olsalar bile çıkarır. */
  function basligiOku(satirListesi) {
    const alanlar = {};
    for (const satir of satirListesi) {
      const k = satir.kelimeler;
      const bulunanlar = [];
      for (let i = 0; i < k.length; i++) {
        for (let uzunluk = 4; uzunluk >= 1; uzunluk--) {
          if (i + uzunluk > k.length) continue;
          const ham = k.slice(i, i + uzunluk).map((w) => w.metin).join(' ');
          // "Request form no:" gibi etiketlerde iki nokta son kelimeye yapışık geliyor.
          const parca = sade(ham).replace(/\s*:$/, '');
          if (!ETIKETLER.some((e) => e.desen.test(parca))) continue;
          // Etiket sayılması için ardından iki nokta gelmeli. Yoksa
          // "Warehouse Material Request Form" başlığı "Warehouse" etiketi sanılıyor.
          const yapisik = /:\s*$/.test(ham);
          const sonrakiIkiNokta = /^[:：]/.test(k[i + uzunluk]?.metin ?? '');
          if (!yapisik && !sonrakiIkiNokta) continue;
          bulunanlar.push({
            anahtar: ETIKETLER.find((e) => e.desen.test(parca)).anahtar,
            bas: i,
            son: i + uzunluk - 1,
          });
          i += uzunluk - 1;
          break;
        }
      }
      if (!bulunanlar.length) continue;

      for (let b = 0; b < bulunanlar.length; b++) {
        const { anahtar, son } = bulunanlar[b];
        let i = son + 1;
        while (i < k.length && /^[:：]$/.test(k[i].metin)) i++;
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

  // ——— Tablo ——————————————————————————————————————————————————————

  const KOLON_DESENLERI = [
    { anahtar: 'sira', desen: /^(no|no\.|sira( ?no)?|s\.? ?no|kalem|item no)$/ },
    { anahtar: 'metin', desen: /^(malzeme ?\/? ?talep metni|talep metni|malzeme metni|material description|material desc\.?|description)$/ },
    { anahtar: 'proje', desen: /^(proje|proje kodu|is emri|project|project no|project drawing number|drawing number)$/ },
    { anahtar: 'poz', desen: /^(poz|poz no|item ?\/? ?poz|item|position)$/ },
    { anahtar: 'kod', desen: /^(malzeme kodu|stok kodu|malzeme no|kod|material code|stock code|part no|order no|siparis no)$/ },
    { anahtar: 'aciklama', desen: /^((sap )?malzeme tanimi|tanim|aciklama|malzeme adi|material definition)$/ },
    { anahtar: 'miktar', desen: /^(miktar|adet|quantity|qty)$/ },
    { anahtar: 'birim', desen: /^(birim|olcu birimi|br|unit|uom)$/ },
    // Aşağıdakiler altı ana kolona girmiyor; açıklamanın altına küçük punto ile iliştiriliyor.
    { anahtar: 'kalinlik', desen: /^(kalinlik( \(mm\))?|thickness( \(mm\))?)$/ },
    { anahtar: 'kalite', desen: /^(kalite ?\/? ?(sinif)?|quality ?\/? ?(class)?)$/ },
    { anahtar: 'gost', desen: /^(gost no|gost)$/ },
    { anahtar: 'tedarikci', desen: /^(tedarikci|supplier)$/ },
    { anahtar: 'yer', desen: /^(yer|konum|location)$/ },
    { anahtar: 'satirNotu', desen: /^(remarks|note|notes)$/ },
  ];

  // "Order No" gerçek bir malzeme kodu değil; kod kolonu olarak o kullanıldığında
  // kullanıcıya söylüyoruz.
  const GERCEK_KOD = /^(malzeme kodu|stok kodu|malzeme no|kod|material code|stock code|part no)$/;

  // Formda karşılığı olmayan alanların yerine yazılanlar.
  const VARSAYILAN_NEREDEN = 'Endüstriyel';
  const VARSAYILAN_KULLANICI = 'Reaktör 4 T.O.';

  // Ana altı kolona girmeyen, açıklamanın altında toplanan kolonlar.
  const EK_KOLONLAR = [
    ['kalinlik', 'Kalınlık'],
    ['kalite', 'Kalite'],
    ['gost', 'Gost'],
    ['tedarikci', 'Tedarikçi'],
    ['yer', 'Yer'],
    ['satirNotu', 'Not'],
  ];

  function obekleriKolonaCevir(obekler) {
    const kolonlar = obekler.map((o) => {
      const s = sade(o.metin);
      const eslesme = KOLON_DESENLERI.find((k) => k.desen.test(s));
      return { anahtar: eslesme?.anahtar ?? null, etiket: o.metin, sadeEtiket: s, x0: o.x0, x1: o.x1 };
    });
    for (let i = 0; i < kolonlar.length; i++) {
      kolonlar[i].sol = i === 0 ? -Infinity : (kolonlar[i - 1].x1 + kolonlar[i].x0) / 2;
      kolonlar[i].sag =
        i === kolonlar.length - 1 ? Infinity : (kolonlar[i].x1 + kolonlar[i + 1].x0) / 2;
    }
    return kolonlar;
  }

  /**
   * Tablo başlık satırından kolon sınırlarını çıkarır.
   *
   * Kaç puntoluk boşluğun "kolon arası" sayılacağı forma göre değişiyor: bir
   * formda etiketler arasında 18 pt varken başka birinde 8 pt olabiliyor, üstelik
   * "Material Description" gibi iki kelimelik etiketlerin arası da 2 pt. Sabit bir
   * eşik ikisini birden tutturamıyor; bu yüzden birkaç eşik deneyip **en çok
   * kolonu tanıyanı** seçiyoruz.
   */
  function kolonlariCoz(satir) {
    const h = ortanca(satir.kelimeler.map((k) => k.h || 9)) || 9;
    const adaylar = [h * 0.7, h * 1.2, 12, 20];
    let enIyi = null;
    for (const esik of adaylar) {
      const kolonlar = obekleriKolonaCevir(obekle(satir.kelimeler, esik));
      const tanidik = kolonlar.filter((k) => k.anahtar).length;
      if (!enIyi || tanidik > enIyi.tanidik) enIyi = { kolonlar, tanidik };
    }
    return enIyi.kolonlar;
  }

  /**
   * Kolon sınırlarını veri satırlarına bakarak keskinleştirir.
   *
   * Sınır başta iki başlık etiketinin ortası olarak alınıyor, ama başlıklar ortalı
   * yazılıp veri sola dayandığında bu nokta yanlış yere düşüyor: "Item/Poz"
   * başlığı x=374'ten başlarken altındaki poz değeri 341'de duruyor ve proje
   * kolonuna karışıyor — listede "AKU...LC0172 4" gibi uydurma projeler çıkıyordu.
   *
   * Çözüm: veri kelimelerinin kapladığı aralıklar çıkarılıp aralarındaki boş
   * koridorlar bulunuyor; her sınır, kendisine en yakın koridorun ortasına
   * çekiliyor. Tek kısıt sınırın ayırdığı iki etiketin *merkezleri* arasında
   * kalması — böylece hiç verisi olmayan bir kolonun (boş "Thickness" gibi)
   * sınırı uzaktaki bir koridora savrulmuyor.
   */
  function sinirlariVeriyeGoreDuzelt(kolonlar, veriSatirlari) {
    const araliklar = [];
    for (const satir of veriSatirlari) {
      for (const k of satir.kelimeler) araliklar.push([k.x0, k.x1]);
    }
    if (araliklar.length < 2) return kolonlar;
    araliklar.sort((a, b) => a[0] - b[0]);

    // Üst üste binen kelimeleri birleştir → dolu bölgeler, aralarında koridorlar.
    const dolu = [];
    for (const [a, b] of araliklar) {
      const son = dolu[dolu.length - 1];
      if (son && a <= son[1]) son[1] = Math.max(son[1], b);
      else dolu.push([a, b]);
    }
    const koridorlar = [];
    for (let i = 1; i < dolu.length; i++) {
      const bosluk = [dolu[i - 1][1], dolu[i][0]];
      if (bosluk[1] - bosluk[0] >= 0.5) koridorlar.push((bosluk[0] + bosluk[1]) / 2);
    }
    if (!koridorlar.length) return kolonlar;

    const yeni = kolonlar.map((k) => ({ ...k }));
    let oncekiSinir = -Infinity;
    for (let i = 0; i < yeni.length - 1; i++) {
      const asil = yeni[i].sag;
      // Sınır, ayırdığı iki etiketin *merkezleri* arasında kalmak zorunda.
      // Bu sayede hiç verisi olmayan bir kolonun sınırı uzaktaki bir koridora
      // savrulmuyor, olan kolonlarınki ise doğru boşluğa oturuyor.
      const solMerkez = (yeni[i].x0 + yeni[i].x1) / 2;
      const sagMerkez = (yeni[i + 1].x0 + yeni[i + 1].x1) / 2;
      let enIyi = null;
      for (const orta of koridorlar) {
        if (orta <= solMerkez || orta >= sagMerkez) continue;
        const uzaklik = Math.abs(orta - asil);
        if (!enIyi || uzaklik < enIyi.uzaklik) enIyi = { orta, uzaklik };
      }
      const sinir = Math.max(enIyi ? enIyi.orta : asil, oncekiSinir);
      oncekiSinir = sinir;
      yeni[i].sag = sinir;
      yeni[i + 1].sol = sinir;
    }
    return yeni;
  }

  /** Satır tablo başlığı mı? Miktar + (kod veya tanım) + en az üç tanıdık etiket. */
  function baslikSatiriMi(satir) {
    const kolonlar = kolonlariCoz(satir);
    const tanidik = new Set(kolonlar.map((k) => k.anahtar).filter(Boolean));
    const tanimVar = tanidik.has('kod') || tanidik.has('aciklama') || tanidik.has('metin');
    return tanidik.has('miktar') && tanimVar && tanidik.size >= 3 ? kolonlar : null;
  }

  const DIPNOT =
    /^(stok yonetimi|departman yoneticisi|teknik ofis|pto|imza|toplam|sayfa \d|not ?:|requesting|recivied|received|ic-industry|stamp by|name surname)/;

  /**
   * "Thickness / (mm)" gibi iki satıra taşan başlık etiketlerini toplamak için:
   * bir satır, hiç rakam içermiyorsa ve başlığa yakınsa başlığın devamı sayılır.
   * Rakam koşulu veri satırlarını dışarıda tutuyor — veri satırında sıra no,
   * miktar ya da kod mutlaka rakam taşıyor.
   */
  function baslikDevamiOlabilirMi(satir) {
    return satir.kelimeler.length > 0 && satir.kelimeler.every((k) => !/\d/.test(k.metin));
  }

  /** Başlık satırını, üstüne/altına taşmış etiket parçalarıyla birleştirir. */
  function baslikBlogu(satirlar, indeks) {
    const h = ortanca(satirlar[indeks].kelimeler.map((k) => k.h || 9)) || 9;
    const esik = Math.max(6, h * 1.2);
    let bas = indeks;
    let son = indeks;
    while (bas > 0 && satirlar[bas].y - satirlar[bas - 1].y <= esik && baslikDevamiOlabilirMi(satirlar[bas - 1])) bas--;
    while (
      son < satirlar.length - 1 &&
      satirlar[son + 1].y - satirlar[son].y <= esik &&
      baslikDevamiOlabilirMi(satirlar[son + 1])
    ) son++;

    const kelimeler = [];
    for (let i = bas; i <= son; i++) kelimeler.push(...satirlar[i].kelimeler);
    kelimeler.sort((a, b) => a.x0 - b.x0);
    return { son, satir: { y: satirlar[indeks].y, kelimeler, metin: kelimeler.map((k) => k.metin).join(' ') } };
  }
  const SAYI = /^[0-9][0-9.,]*$/;
  const BIRIM = /^[A-Za-zÇĞİÖŞÜçğıöşü]{1,6}\.?$/;

  function hucreleriKur(kolonlar) {
    const h = {};
    for (const k of kolonlar) if (k.anahtar) h[k.anahtar] = [];
    return h;
  }

  function satiriHucrelereDagit(satir, kolonlar, hucreler) {
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

  /** Hücreleri tipine göre onarır: kolon sınırına takılan parçaları doğru yere taşır. */
  function hucreleriOnar(h) {
    const al = (a) => (h[a] = h[a] || []);

    // Sıra no: yalnız ilk sayı; gerisi metne
    if (al('sira').length > 1) {
      const [ilk, ...kalan] = h.sira;
      if (SAYI.test(ilk)) {
        h.sira = [ilk];
        al('metin').unshift(...kalan);
      }
    }

    // Birim hücresine kaçmış miktar
    if (al('birim').length > 1 && SAYI.test(h.birim[0])) al('miktar').push(h.birim.shift());

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
    if (!al('miktar').length && al('aciklama').length > 1) {
      const son = h.aciklama[h.aciklama.length - 1];
      if (SAYI.test(son)) h.miktar = [h.aciklama.pop()];
    }

    // "55,820KG" gibi bitişik yazımlar
    if (h.miktar && h.miktar.length === 1) {
      const m = /^([0-9][0-9.,]*)\s*([A-Za-zÇĞİÖŞÜçğıöşü]{1,6})$/.exec(h.miktar[0]);
      if (m) {
        h.miktar = [m[1]];
        if (!al('birim').length) h.birim = [m[2]];
      }
    }
    return h;
  }

  const hucreMetni = (parcalar) => (parcalar || []).join(' ').replace(/\s+/g, ' ').trim();

  /** "55.820,75" / "55,820" / "1 234.5" → sayı. Okunamazsa null. */
  function miktariSayiyaCevir(ham) {
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
      // tek nokta: "1.234" binlik, "55.82" ondalık sayılır
      temiz = /^\d{1,3}(\.\d{3})+$/.test(s) ? s.replace(/\./g, '') : s;
    }
    const n = Number(temiz);
    return Number.isFinite(n) ? n : null;
  }

  /**
   * Sayfaları ayrıştırıp form başlığını ve kalemleri döner.
   * @param {Array} sayfalar [{ no, genislik, yukseklik, kelimeler:[{metin,x0,x1,y,h}] }]
   */
  function ayristir(sayfalar) {
    const uyarilar = [];
    const tumSatirlar = [];
    for (const s of sayfalar) {
      for (const satir of satirlar(s.kelimeler)) tumSatirlar.push({ ...satir, sayfa: s.no });
    }

    const baslik = basligiOku(tumSatirlar);
    const kalemler = [];
    let sonKolonlar = null;
    let kodEtiketi = null;   // malzeme kodu kolonu yoksa yerine kullanılan etiket

    for (const sayfa of sayfalar) {
      const sayfaSatirlari = satirlar(sayfa.kelimeler);
      let baslikIndeksi = -1;
      let kolonlar = null;
      for (let i = 0; i < sayfaSatirlari.length; i++) {
        if (!baslikSatiriMi(sayfaSatirlari[i])) continue;
        // Etiketler iki satıra taşmış olabilir; bloğu toplayıp öyle çözüyoruz.
        const blok = baslikBlogu(sayfaSatirlari, i);
        kolonlar = kolonlariCoz(blok.satir);
        baslikIndeksi = blok.son;
        break;
      }
      if (!kolonlar) {
        if (!sonKolonlar) continue;  // bu sayfada tablo yok
        kolonlar = sonKolonlar;      // çok sayfalı tabloda başlık tekrar etmeyebilir
        baslikIndeksi = -1;
      }
      sonKolonlar = kolonlar;
      const kodKolonu = kolonlar.find((k) => k.anahtar === 'kod');
      if (kodKolonu && !GERCEK_KOD.test(kodKolonu.sadeEtiket)) kodEtiketi = kodKolonu.etiket;

      // Tablonun veri satırları — dipnota kadar.
      const veriSatirlari = [];
      for (let i = baslikIndeksi + 1; i < sayfaSatirlari.length; i++) {
        if (DIPNOT.test(sade(sayfaSatirlari[i].metin))) break;
        if (baslikSatiriMi(sayfaSatirlari[i])) continue; // tekrar eden başlık
        veriSatirlari.push(sayfaSatirlari[i]);
      }
      kolonlar = sinirlariVeriyeGoreDuzelt(kolonlar, veriSatirlari);

      const siraKolonuVar = kolonlar.some((k) => k.anahtar === 'sira');
      let oncekiKalem = null;

      for (const satir of veriSatirlari) {
        const hucreler = hucreleriKur(kolonlar);
        if (!satiriHucrelereDagit(satir, kolonlar, hucreler)) continue;
        hucreleriOnar(hucreler);

        const siraHam = hucreMetni(hucreler.sira);
        const yeniKalem = siraKolonuVar
          ? SAYI.test(siraHam)
          : Boolean(hucreMetni(hucreler.kod) || hucreMetni(hucreler.miktar));

        if (yeniKalem) {
          // Ana kolonlara girmeyen alanlar (kalınlık, kalite, gost, tedarikçi…)
          // kaybolmasın diye kalemin notuna toplanıyor.
          const notlar = EK_KOLONLAR
            .map(([anahtar, etiket]) => [etiket, hucreMetni(hucreler[anahtar])])
            .filter(([, deger]) => deger)
            .map(([etiket, deger]) => `${etiket}: ${deger}`)
            .join(' · ');

          const poz = hucreMetni(hucreler.poz);
          const metin = hucreMetni(hucreler.metin);
          const kodHucresi = hucreMetni(hucreler.kod);

          const kalem = {
            sayfa: sayfa.no,
            sira: siraHam ? Number(siraHam) : kalemler.length + 1,
            metin,
            proje: hucreMetni(hucreler.proje),
            poz,
            // Ayrı malzeme kodu kolonu olmayan formda sipariş no tek başına
            // satırları ayırt etmiyor (üç satırda da aynı olabiliyor); poz ekleniyor.
            kod: kodEtiketi ? [kodHucresi, poz].filter(Boolean).join('-') : kodHucresi,
            // Bu formda ayrı bir tanım kolonu yok; açıklama malzeme metninden gelir.
            aciklama: hucreMetni(hucreler.aciklama) || metin,
            miktar: hucreMetni(hucreler.miktar),
            birim: hucreMetni(hucreler.birim),
            notlar,
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

    if (!kalemler.length) {
      uyarilar.push('Tabloda kalem bulunamadı — kolon başlıkları tanınmadı olabilir.');
    }
    if (kodEtiketi) {
      uyarilar.push(
        `Bu formda ayrı bir malzeme kodu kolonu yok; MALZEME KODU olarak "${kodEtiketi}" ve poz birleştirildi.`
      );
    }
    for (const k of kalemler) {
      if (!k.kod) uyarilar.push(`Satır ${k.sira}: malzeme kodu okunamadı.`);
      if (k.miktarSayi === null) uyarilar.push(`Satır ${k.sira}: miktar okunamadı ("${k.miktar}").`);
    }

    // Depo satırları olmayan formlar endüstriyel ambardan geliyor.
    const nereden =
      [baslik.depoTanimi, baslik.depoYeri && `(${baslik.depoYeri})`].filter(Boolean).join(' ') ||
      VARSAYILAN_NEREDEN;

    return {
      baslik: {
        talepNo: baslik.talepNo ?? '',
        birim: baslik.talepEdenBirim ?? '',
        // Talep eden kullanıcı alanı olmayan formlarda sabit değer yazılıyor.
        kullanici: baslik.talepEdenKullanici || VARSAYILAN_KULLANICI,
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

  return { ayristir, satirlar, sade, miktariSayiyaCevir, kolonlariCoz };
})();
