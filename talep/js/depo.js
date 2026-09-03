// Diske yazma katmanı.
//
// İki kip var:
//
//   'klasor'   — File System Access API. Kullanıcı bir kez klasör seçer, izin
//                tarayıcıda saklanır; talepler.db ve pdfler/ o klasörde durur.
//                Chrome/Edge'de file:// üzerinden de çalışır.
//
//   'tarayici' — Firefox/Safari gibi klasör erişimi olmayan tarayıcılarda yedek
//                kip. Her şey IndexedDB'de tutulur; kullanıcı .db dosyasını elle
//                indirip geri yükleyebilir.

window.TT = window.TT || {};

TT.depo = (() => {
  'use strict';

  const IDB_ADI = 'talep-takip';
  const DB_DOSYA = 'talepler.db';
  const PDF_KLASORU = 'pdfler';
  const KILIT_DOSYA = 'talepler.kilit';

  // Bir kilit bu süre boyunca hiç değişmediyse sahibi ölmüş sayılır.
  const KILIT_OMRU = 15000;
  // Kilidi yazdıktan sonra "gerçekten bizde mi" diye bakmadan önceki bekleme.
  const DOGRULAMA_BEKLEMESI = 150;

  const benimKimligim =
    (crypto.randomUUID?.() ?? String(Math.random())) + '-' + Date.now().toString(36);

  let idb = null;

  function idbAc() {
    if (idb) return idb;
    idb = new Promise((tamam, hata) => {
      const istek = indexedDB.open(IDB_ADI, 1);
      istek.onupgradeneeded = () => {
        const db = istek.result;
        if (!db.objectStoreNames.contains('ayar')) db.createObjectStore('ayar');
        if (!db.objectStoreNames.contains('dosya')) db.createObjectStore('dosya');
      };
      istek.onsuccess = () => tamam(istek.result);
      istek.onerror = () => hata(istek.error);
    });
    return idb;
  }

  async function idbIslem(magaza, kip, is) {
    const db = await idbAc();
    return new Promise((tamam, hata) => {
      const tx = db.transaction(magaza, kip);
      const istek = is(tx.objectStore(magaza));
      tx.oncomplete = () => tamam(istek?.result);
      tx.onerror = () => hata(tx.error);
      tx.onabort = () => hata(tx.error);
    });
  }

  const idbAl = (magaza, anahtar) => idbIslem(magaza, 'readonly', (m) => m.get(anahtar));
  const idbYaz = (magaza, anahtar, deger) => idbIslem(magaza, 'readwrite', (m) => m.put(deger, anahtar));
  const idbSil = (magaza, anahtar) => idbIslem(magaza, 'readwrite', (m) => m.delete(anahtar));

  const durum = {
    kip: 'tarayici',
    klasor: null,       // FileSystemDirectoryHandle
    klasorAdi: '',
  };

  const klasorDesteklenirMi = () => typeof window.showDirectoryPicker === 'function';

  /**
   * Açılışta çağrılır: daha önce seçilmiş klasör varsa ve izin hâlâ duruyorsa
   * onu kullanır. İzin "sor" durumundaysa kullanıcı düğmeye basana kadar
   * yedek kipte kalırız (izin istemek kullanıcı hareketi gerektiriyor).
   */
  async function baslat() {
    if (!klasorDesteklenirMi()) return durum;
    try {
      const kayitli = await idbAl('ayar', 'klasor');
      if (!kayitli) return durum;
      const izin = await kayitli.queryPermission({ mode: 'readwrite' });
      if (izin === 'granted') {
        durum.kip = 'klasor';
        durum.klasor = kayitli;
        durum.klasorAdi = kayitli.name;
      } else {
        durum.bekleyenKlasor = kayitli; // izin için kullanıcı hareketi lazım
        durum.klasorAdi = kayitli.name;
      }
    } catch {
      // handle bozulmuşsa yok say
    }
    return durum;
  }

  /** Kullanıcı hareketiyle çağrılmalı: klasör seçtirir ya da izni tazeler. */
  async function klasorSec({ tekrarIzin = false } = {}) {
    if (!klasorDesteklenirMi()) {
      throw new Error(
        'Bu tarayıcı klasör erişimini desteklemiyor. Chrome veya Edge kullanın; ' +
          'ya da yedek kipte çalışıp veritabanını elle indirin.'
      );
    }
    let klasor = tekrarIzin ? durum.bekleyenKlasor : null;
    if (klasor) {
      const izin = await klasor.requestPermission({ mode: 'readwrite' });
      if (izin !== 'granted') throw new Error('Klasör izni verilmedi.');
    } else {
      klasor = await window.showDirectoryPicker({ id: 'talep-takip', mode: 'readwrite' });
    }
    durum.kip = 'klasor';
    durum.klasor = klasor;
    durum.klasorAdi = klasor.name;
    durum.bekleyenKlasor = null;
    try {
      await idbYaz('ayar', 'klasor', klasor);
    } catch {
      // Tanıtıcı saklanamadıysa klasör bu oturumda çalışır, sonraki açılışta tekrar sorulur.
      durum.hatirlanmadi = true;
    }
    return durum;
  }

  /** Klasör kipinden çıkar (veriler klasörde kalır). */
  async function klasoruBirak() {
    durum.kip = 'tarayici';
    durum.klasor = null;
    durum.klasorAdi = '';
    durum.bekleyenKlasor = null;
    await idbSil('ayar', 'klasor');
  }

  // ——— dosya işlemleri ———

  async function dosyaYaz(ad, bayt, altKlasor) {
    if (durum.kip === 'klasor') {
      let hedef = durum.klasor;
      if (altKlasor) hedef = await hedef.getDirectoryHandle(altKlasor, { create: true });
      const dosya = await hedef.getFileHandle(ad, { create: true });
      const akis = await dosya.createWritable();
      await akis.write(bayt);
      await akis.close();
      return;
    }
    await idbYaz('dosya', (altKlasor ? altKlasor + '/' : '') + ad, bayt);
  }

  async function dosyaOku(ad, altKlasor) {
    if (durum.kip === 'klasor') {
      try {
        let hedef = durum.klasor;
        if (altKlasor) hedef = await hedef.getDirectoryHandle(altKlasor, { create: true });
        const dosya = await hedef.getFileHandle(ad);
        return new Uint8Array(await (await dosya.getFile()).arrayBuffer());
      } catch (e) {
        if (e.name === 'NotFoundError') return null;
        throw e;
      }
    }
    const deger = await idbAl('dosya', (altKlasor ? altKlasor + '/' : '') + ad);
    return deger ? new Uint8Array(deger) : null;
  }

  async function dosyaSil(ad, altKlasor) {
    if (durum.kip === 'klasor') {
      try {
        let hedef = durum.klasor;
        if (altKlasor) hedef = await hedef.getDirectoryHandle(altKlasor, { create: true });
        await hedef.removeEntry(ad);
      } catch (e) {
        if (e.name !== 'NotFoundError') throw e;
      }
      return;
    }
    await idbSil('dosya', (altKlasor ? altKlasor + '/' : '') + ad);
  }

  /** Dosyanın "değişti mi" damgası: boyut + son değiştirilme. Yoksa null. */
  async function dosyaDamgasi(ad = DB_DOSYA) {
    if (durum.kip !== 'klasor') return null;
    try {
      const dosya = await (await durum.klasor.getFileHandle(ad)).getFile();
      return { boyut: dosya.size, zaman: dosya.lastModified };
    } catch (e) {
      if (e.name === 'NotFoundError') return null;
      throw e;
    }
  }

  const damgaAyni = (a, b) => Boolean(a && b && a.boyut === b.boyut && a.zaman === b.zaman);

  // ——— paylaşımlı klasör kilidi ———
  //
  // Klasör birden çok kişiyle paylaşılıyorsa iki kişi aynı anda yazdığında biri
  // diğerinin değişikliğini eziyor. File System Access API'de "varsa oluşturma"
  // gibi atomik bir işlem yok; bu yüzden klasik iddia-doğrula yöntemi:
  // kilidi yazıp kısa bir süre bekliyoruz, sonra tekrar okuyup hâlâ bizde mi diye
  // bakıyoruz. Biri araya girdiyse kaybediyor ve yeniden deniyoruz.
  //
  // Kilit yalnızca oku-değiştir-yaz üçlüsü boyunca (birkaç on milisaniye) tutulur.
  // Bayatlık ölçüsü kilit dosyasının *değişmemesi*: makinelerin saatleri farklı
  // olabildiği için karşı tarafın damgasıyla kendi saatimizi kıyaslamıyoruz.

  const bekle = (ms) => new Promise((c) => setTimeout(c, ms));
  let gorulenKilit = null;   // { imza, ilkGorulme }

  async function kilidiOku() {
    const bayt = await dosyaOku(KILIT_DOSYA);
    if (!bayt?.length) return null;
    try {
      const veri = JSON.parse(new TextDecoder().decode(bayt));
      const damga = await dosyaDamgasi(KILIT_DOSYA);
      return { sahip: veri.sahip, imza: `${veri.sahip}|${damga?.zaman ?? 0}|${damga?.boyut ?? 0}` };
    } catch {
      return null;
    }
  }

  const kilidiYaz = () =>
    dosyaYaz(KILIT_DOSYA, new TextEncoder().encode(JSON.stringify({ sahip: benimKimligim })));

  /** Kilidin bir süredir hiç kıpırdamadığını (sahibi gitmiş) tespit eder. */
  function bayatMi(kilit) {
    if (!gorulenKilit || gorulenKilit.imza !== kilit.imza) {
      gorulenKilit = { imza: kilit.imza, ilkGorulme: Date.now() };
      return false;
    }
    return Date.now() - gorulenKilit.ilkGorulme > KILIT_OMRU;
  }

  /**
   * Yazma kilidini alır; bırakma işlevini döner.
   * Tek kullanıcılı kiplerde (tarayıcı belleği) hiçbir şey yapmaz.
   */
  async function kilitAl({ enFazlaBekleme = 20000 } = {}) {
    if (durum.kip !== 'klasor') return async () => {};
    const bitis = Date.now() + enFazlaBekleme;
    for (;;) {
      const kilit = await kilidiOku();
      if (!kilit || kilit.sahip === benimKimligim || bayatMi(kilit)) {
        await kilidiYaz();
        await bekle(DOGRULAMA_BEKLEMESI);
        const dogrulama = await kilidiOku();
        if (dogrulama?.sahip === benimKimligim) {
          gorulenKilit = null;
          return async () => { await dosyaSil(KILIT_DOSYA).catch(() => {}); };
        }
      }
      if (Date.now() > bitis) {
        throw new Error(
          'Dosya şu an başka bir kullanıcıda; kilit bırakılmadı. Birkaç saniye sonra tekrar deneyin.'
        );
      }
      await bekle(200 + Math.random() * 400); // çakışmayı dağıtmak için rastgele bekleme
    }
  }

  // ——— veritabanı dosyası ———

  const veritabaniniOku = () => dosyaOku(DB_DOSYA);
  const veritabaniniYaz = (bayt) => dosyaYaz(DB_DOSYA, bayt);

  // ——— PDF arşivi ———

  const pdfYaz = (ad, bayt) => dosyaYaz(ad, bayt, PDF_KLASORU);
  const pdfOku = (ad) => dosyaOku(ad, PDF_KLASORU);
  const pdfSil = (ad) => dosyaSil(ad, PDF_KLASORU);

  /** Tarayıcıya indirtir (yedek kipte veritabanını, her kipte CSV'yi almak için). */
  function indir(ad, bayt, tur = 'application/octet-stream') {
    const url = URL.createObjectURL(new Blob([bayt], { type: tur }));
    const a = document.createElement('a');
    a.href = url;
    a.download = ad;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  return {
    durum,
    baslat,
    klasorSec,
    klasoruBirak,
    klasorDesteklenirMi,
    veritabaniniOku,
    veritabaniniYaz,
    dosyaDamgasi,
    damgaAyni,
    kilitAl,
    pdfYaz,
    pdfOku,
    pdfSil,
    indir,
    DB_DOSYA,
    PDF_KLASORU,
  };
})();
