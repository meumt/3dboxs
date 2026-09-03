// SQLite katmanı — sql.js (SQLite'ın WebAssembly derlemesi) ile tarayıcıda.
//
// Veritabanı bellekte tutulur, her değişiklikten sonra tek bir .db dosyası
// olarak diske yazılır (bkz. depo.js). Dosya gerçek SQLite biçimindedir:
// DB Browser for SQLite, Python, DBeaver — hepsi açar.

window.TT = window.TT || {};

TT.Veritabani = (() => {
  'use strict';

  const sade = (s) => TT.ayristirici.sade(s);

  const SEMA = `
CREATE TABLE IF NOT EXISTS talep (
  id            INTEGER PRIMARY KEY,
  talep_no      TEXT    NOT NULL,
  birim         TEXT,
  kullanici     TEXT,
  talep_tarihi  TEXT,
  nereden       TEXT,
  depo_yeri     TEXT,
  uretim_yeri   TEXT,
  pdf_dosya     TEXT,
  pdf_ozet      TEXT UNIQUE,
  pdf_ad        TEXT,
  sayfa_sayisi  INTEGER,
  kaynak        TEXT,
  notlar        TEXT,
  eklenme       TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS kalem (
  id                INTEGER PRIMARY KEY,
  talep_id          INTEGER NOT NULL REFERENCES talep(id) ON DELETE CASCADE,
  sira              INTEGER,
  talep_no          TEXT,
  proje             TEXT,
  poz               TEXT,
  malzeme_kodu      TEXT,
  aciklama          TEXT,
  metin             TEXT,
  miktar            TEXT,
  miktar_sayi       REAL,
  birim             TEXT,
  nereden           TEXT,
  durum             TEXT NOT NULL DEFAULT 'bekliyor',   -- bekliyor | onay | red
  durum_tarihi      TEXT,
  notlar            TEXT,
  arama_metni       TEXT
);

CREATE INDEX IF NOT EXISTS ix_kalem_talep ON kalem(talep_id);
CREATE INDEX IF NOT EXISTS ix_kalem_no    ON kalem(talep_no);
CREATE INDEX IF NOT EXISTS ix_kalem_durum ON kalem(durum);
CREATE INDEX IF NOT EXISTS ix_kalem_kod   ON kalem(malzeme_kodu);
`;

  // SQLite'ın lower()'ı yalnız ASCII'yi küçültür: "DEMİR" araması "demir" ile
  // eşleşmez. Bu yüzden aranabilir alanların Türkçe'den arındırılmış kopyasını
  // arama_metni kolonunda tutup sorguyu da aynı şekilde katlıyoruz.
  const ARANAN_ALANLAR = [
    'talep_no', 'proje', 'poz', 'malzeme_kodu', 'aciklama', 'metin', 'nereden', 'notlar',
  ];
  const aramaMetni = (k) => ARANAN_ALANLAR.map((a) => sade(k[a] ?? '')).join(' ');

  // Dışarıdan güncellenebilecek kalem alanları — SQL'e ad enjeksiyonu olmasın diye beyaz liste.
  const DUZENLENEBILIR = new Set([
    'proje', 'poz', 'malzeme_kodu', 'aciklama', 'metin', 'miktar', 'birim', 'nereden', 'notlar', 'sira',
  ]);

  const DURUMLAR = new Set(['bekliyor', 'onay', 'red']);

  let SQL = null;

  /** sql.js motorunu bir kez başlatır (WASM base64'ten gelir, fetch yok). */
  async function motoruBaslat() {
    if (SQL) return SQL;
    SQL = await initSqlJs({ wasmBinary: TT.pdf.b64Ikili(window.SQL_WASM_B64) });
    return SQL;
  }

  class Veritabani {
    constructor(db) {
      this.db = db;
      this.db.run('PRAGMA foreign_keys = ON;');
      this.db.run(SEMA);
      this.eskiSemayiTasi();
    }

    /** Mevcut bir .db dosyasından ya da sıfırdan açar. */
    static async ac(bayt) {
      const SQL = await motoruBaslat();
      return new Veritabani(bayt && bayt.length ? new SQL.Database(bayt) : new SQL.Database());
    }

    /** Diske yazılacak SQLite dosyasının baytları. */
    disaAktar() {
      return this.db.export();
    }

    kapat() {
      this.db.close();
    }

    // ——— küçük sorgu yardımcıları ———

    /** Satırları nesne dizisi olarak döner. */
    sorgu(sql, parametreler = []) {
      const ifade = this.db.prepare(sql);
      try {
        ifade.bind(parametreler);
        const satirlar = [];
        while (ifade.step()) satirlar.push(ifade.getAsObject());
        return satirlar;
      } finally {
        ifade.free();
      }
    }

    tek(sql, parametreler = []) {
      return this.sorgu(sql, parametreler)[0] ?? null;
    }

    calistir(sql, parametreler = []) {
      this.db.run(sql, parametreler);
    }

    /** Önceki sürümlerde açılmış veritabanlarını günceller. */
    eskiSemayiTasi() {
      const kolonlar = this.sorgu('PRAGMA table_info(kalem)').map((k) => k.name);
      if (!kolonlar.includes('arama_metni')) {
        this.calistir('ALTER TABLE kalem ADD COLUMN arama_metni TEXT');
      }
      // Eski sürümde tek bir "tamamlandı" kutusu vardı; artık onay/red/bekliyor.
      if (!kolonlar.includes('durum')) {
        this.calistir("ALTER TABLE kalem ADD COLUMN durum TEXT NOT NULL DEFAULT 'bekliyor'");
        if (kolonlar.includes('tamamlandi')) {
          this.calistir("UPDATE kalem SET durum = CASE WHEN tamamlandi = 1 THEN 'onay' ELSE 'bekliyor' END");
        }
      }
      if (!kolonlar.includes('durum_tarihi')) {
        this.calistir('ALTER TABLE kalem ADD COLUMN durum_tarihi TEXT');
        if (kolonlar.includes('tamamlanma_tarihi')) {
          this.calistir('UPDATE kalem SET durum_tarihi = tamamlanma_tarihi');
        }
      }
      for (const eski of ['tamamlandi', 'tamamlanma_tarihi']) {
        if (kolonlar.includes(eski)) this.calistir(`ALTER TABLE kalem DROP COLUMN ${eski}`);
      }
      for (const { id } of this.sorgu('SELECT id FROM kalem WHERE arama_metni IS NULL')) {
        this.calistir('UPDATE kalem SET arama_metni = ? WHERE id = ?', [
          aramaMetni(this.kalem(id)),
          id,
        ]);
      }
    }

    // ——— talepler ———

    /** Aynı PDF daha önce yüklendi mi? */
    pdfVarMi(ozet) {
      return this.tek('SELECT id, talep_no, pdf_ad FROM talep WHERE pdf_ozet = ?', [ozet]);
    }

    /** Bir talebi ve kalemlerini tek işlemde yazar. */
    talepEkle({ baslik, kalemler, pdf }) {
      this.calistir('BEGIN');
      try {
        const talepNo = baslik.talepNo || '(no yok)';
        this.calistir(
          `INSERT INTO talep (talep_no, birim, kullanici, talep_tarihi, nereden, depo_yeri,
                              uretim_yeri, pdf_dosya, pdf_ozet, pdf_ad, sayfa_sayisi, kaynak, notlar)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [
            talepNo,
            baslik.birim ?? '',
            baslik.kullanici ?? '',
            baslik.tarihSaat ?? '',
            baslik.nereden ?? '',
            baslik.depoYeri ?? '',
            baslik.uretimYeri ?? '',
            pdf?.dosya ?? null,
            pdf?.ozet ?? null,
            pdf?.ad ?? null,
            pdf?.sayfaSayisi ?? null,
            pdf?.kaynak ?? 'elle',
            baslik.notlar ?? '',
          ]
        );
        const talepId = this.tek('SELECT last_insert_rowid() AS id').id;

        let i = 0;
        for (const k of kalemler) {
          i++;
          const satir = {
            talep_no: talepNo,
            proje: k.proje ?? '',
            poz: k.poz ?? '',
            malzeme_kodu: k.kod ?? k.malzeme_kodu ?? '',
            aciklama: k.aciklama ?? '',
            metin: k.metin ?? '',
            nereden: k.nereden || baslik.nereden || '',
            notlar: k.notlar ?? '',
          };
          this.calistir(
            `INSERT INTO kalem (talep_id, sira, talep_no, proje, poz, malzeme_kodu, aciklama,
                                metin, miktar, miktar_sayi, birim, nereden, notlar, arama_metni)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
            [
              talepId,
              Number(k.sira) || i,
              satir.talep_no,
              satir.proje,
              satir.poz,
              satir.malzeme_kodu,
              satir.aciklama,
              satir.metin,
              k.miktar ?? '',
              k.miktarSayi ?? k.miktar_sayi ?? null,
              k.birim ?? '',
              satir.nereden,
              satir.notlar,
              aramaMetni(satir),
            ]
          );
        }
        this.calistir('COMMIT');
        return { talepId, kalemSayisi: kalemler.length };
      } catch (e) {
        this.calistir('ROLLBACK');
        throw e;
      }
    }

    /** Kalemleri filtreleyerek listeler. */
    kalemler({ arama = '', durum = 'hepsi', talepNo = '', proje = '', nereden = '', limit = 5000 } = {}) {
      const kosullar = [];
      const parametreler = [];

      for (const kelime of String(arama).trim().split(/\s+/).filter(Boolean)) {
        kosullar.push('k.arama_metni LIKE ?');
        parametreler.push(`%${sade(kelime)}%`);
      }
      if (durum === 'bekleyen') kosullar.push("k.durum = 'bekliyor'");
      if (durum === 'onay') kosullar.push("k.durum = 'onay'");
      if (durum === 'red') kosullar.push("k.durum = 'red'");
      if (talepNo) { kosullar.push('k.talep_no = ?'); parametreler.push(talepNo); }
      if (proje) { kosullar.push('k.proje = ?'); parametreler.push(proje); }
      if (nereden) { kosullar.push('k.nereden = ?'); parametreler.push(nereden); }

      const nerede = kosullar.length ? 'WHERE ' + kosullar.join(' AND ') : '';
      return this.sorgu(
        `SELECT k.*, t.pdf_dosya, t.pdf_ad, t.kaynak, t.eklenme, t.birim AS talep_birim,
                t.kullanici AS talep_kullanici, t.talep_tarihi
         FROM kalem k JOIN talep t ON t.id = k.talep_id
         ${nerede}
         ORDER BY t.id DESC, k.sira ASC
         LIMIT ?`,
        [...parametreler, limit]
      );
    }

    ozet() {
      const s = this.tek(
        `SELECT COUNT(*) AS kalem,
                COALESCE(SUM(CASE WHEN durum='onay' THEN 1 ELSE 0 END), 0) AS onay,
                COALESCE(SUM(CASE WHEN durum='red'  THEN 1 ELSE 0 END), 0) AS red,
                COUNT(DISTINCT talep_no) AS talep
         FROM kalem`
      );
      const kalem = s.kalem ?? 0;
      return {
        kalem,
        onay: s.onay ?? 0,
        red: s.red ?? 0,
        bekleyen: kalem - (s.onay ?? 0) - (s.red ?? 0),
        talep: s.talep ?? 0,
      };
    }

    /** Filtre açılır listeleri için ayrık değerler. */
    secenekler() {
      const kolon = (ad) =>
        this.sorgu(`SELECT DISTINCT ${ad} AS d FROM kalem WHERE ${ad} <> '' ORDER BY d`).map((r) => r.d);
      return { talepNo: kolon('talep_no'), proje: kolon('proje'), nereden: kolon('nereden') };
    }

    kalemDurumu(id, durum) {
      this.durumYaz('id = ?', durum, [id]);
      return this.kalem(id);
    }

    talepDurumu(talepId, durum) {
      this.durumYaz('talep_id = ?', durum, [talepId]);
    }

    durumYaz(nerede, durum, parametreler) {
      if (!DURUMLAR.has(durum)) throw new Error(`Geçersiz durum: ${durum}`);
      this.calistir(
        `UPDATE kalem SET durum = ?,
                          durum_tarihi = CASE WHEN ? = 'bekliyor' THEN NULL ELSE datetime('now','localtime') END
         WHERE ${nerede}`,
        [durum, durum, ...parametreler]
      );
    }

    kalemDuzenle(id, alanlar) {
      const girdiler = Object.entries(alanlar).filter(([a]) => DUZENLENEBILIR.has(a));
      if (!girdiler.length) return this.kalem(id);
      const set = girdiler.map(([a]) => `${a} = ?`).join(', ');
      this.calistir(`UPDATE kalem SET ${set} WHERE id = ?`, [...girdiler.map(([, d]) => d), id]);
      // Düzenlenen değer arama dizinine de yansımalı.
      this.calistir('UPDATE kalem SET arama_metni = ? WHERE id = ?', [
        aramaMetni(this.kalem(id)),
        id,
      ]);
      return this.kalem(id);
    }

    kalem(id) {
      return this.tek('SELECT * FROM kalem WHERE id = ?', [id]);
    }

    talep(id) {
      return this.tek('SELECT * FROM talep WHERE id = ?', [id]);
    }

    talepSil(id) {
      const t = this.talep(id);
      this.calistir('DELETE FROM kalem WHERE talep_id = ?', [id]);
      this.calistir('DELETE FROM talep WHERE id = ?', [id]);
      return t;
    }
  }

  return Veritabani;
})();
