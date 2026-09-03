// SQLite katmanı. Node 22+ içindeki node:sqlite kullanılıyor — derlenecek
// yerel paket yok, veritabanı dosyası uygulamayla aynı klasörde duruyor.

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import { sade } from './ayristir.js';

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
  tamamlandi        INTEGER NOT NULL DEFAULT 0,
  tamamlanma_tarihi TEXT,
  notlar            TEXT,
  arama_metni       TEXT
);

CREATE INDEX IF NOT EXISTS ix_kalem_talep  ON kalem(talep_id);
CREATE INDEX IF NOT EXISTS ix_kalem_no     ON kalem(talep_no);
CREATE INDEX IF NOT EXISTS ix_kalem_durum  ON kalem(tamamlandi);
CREATE INDEX IF NOT EXISTS ix_kalem_kod    ON kalem(malzeme_kodu);
`;

// SQLite'ın lower()'ı yalnız ASCII'yi küçültür; "DEMİR" araması "demir" ile
// eşleşmez. Bu yüzden aranabilir alanların Türkçe'den arındırılmış bir kopyasını
// arama_metni kolonunda tutup sorguyu da aynı şekilde katlıyoruz.
const ARANAN_ALANLAR = ['talep_no', 'proje', 'poz', 'malzeme_kodu', 'aciklama', 'metin', 'nereden', 'notlar'];

const aramaMetni = (k) => ARANAN_ALANLAR.map((a) => sade(k[a] ?? '')).join(' ');

/** Dışarıdan güncellenebilecek kalem alanları — SQL'e ad enjeksiyonu olmasın diye beyaz liste. */
const DUZENLENEBILIR = new Set([
  'proje', 'poz', 'malzeme_kodu', 'aciklama', 'metin', 'miktar', 'birim', 'nereden', 'notlar', 'sira',
]);

export class Depo {
  constructor(dosya) {
    mkdirSync(dirname(dosya), { recursive: true });
    this.db = new DatabaseSync(dosya);
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.db.exec(SEMA);
    this.eskiSemayiTasi();
  }

  /** Önceki sürümlerde açılmış veritabanlarını günceller. */
  eskiSemayiTasi() {
    const kolonlar = this.db.prepare('PRAGMA table_info(kalem)').all().map((k) => k.name);
    if (!kolonlar.includes('arama_metni')) {
      this.db.exec('ALTER TABLE kalem ADD COLUMN arama_metni TEXT');
    }
    const eksik = this.db.prepare('SELECT id FROM kalem WHERE arama_metni IS NULL').all();
    if (!eksik.length) return;
    const guncelle = this.db.prepare('UPDATE kalem SET arama_metni = ? WHERE id = ?');
    for (const { id } of eksik) guncelle.run(aramaMetni(this.kalem(id)), id);
  }

  kapat() {
    this.db.close();
  }

  /** Aynı PDF daha önce yüklendi mi? */
  pdfVarMi(ozet) {
    return this.db.prepare('SELECT id, talep_no, pdf_ad FROM talep WHERE pdf_ozet = ?').get(ozet) ?? null;
  }

  /**
   * Bir talebi ve kalemlerini tek işlemde yazar.
   * @returns {{ talepId:number, kalemSayisi:number }}
   */
  talepEkle({ baslik, kalemler, pdf }) {
    const yaz = () => {
      const { lastInsertRowid } = this.db
        .prepare(
          `INSERT INTO talep (talep_no, birim, kullanici, talep_tarihi, nereden, depo_yeri,
                              uretim_yeri, pdf_dosya, pdf_ozet, pdf_ad, sayfa_sayisi, kaynak, notlar)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
        )
        .run(
          baslik.talepNo || '(no yok)',
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
          baslik.notlar ?? ''
        );
      const talepId = Number(lastInsertRowid);

      const ekle = this.db.prepare(
        `INSERT INTO kalem (talep_id, sira, talep_no, proje, poz, malzeme_kodu, aciklama,
                            metin, miktar, miktar_sayi, birim, nereden, arama_metni)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
      );
      let i = 0;
      for (const k of kalemler) {
        i++;
        const satir = {
          talep_no: baslik.talepNo || '(no yok)',
          proje: k.proje ?? '',
          poz: k.poz ?? '',
          malzeme_kodu: k.kod ?? k.malzeme_kodu ?? '',
          aciklama: k.aciklama ?? '',
          metin: k.metin ?? '',
          nereden: k.nereden || baslik.nereden || '',
          notlar: '',
        };
        ekle.run(
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
          aramaMetni(satir)
        );
      }
      return { talepId, kalemSayisi: kalemler.length };
    };

    this.db.exec('BEGIN');
    try {
      const sonuc = yaz();
      this.db.exec('COMMIT');
      return sonuc;
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }

  /** Kalemleri filtreleyerek listeler. */
  kalemler({ arama = '', durum = 'hepsi', talepNo = '', proje = '', nereden = '', limit = 2000 } = {}) {
    const kosullar = [];
    const parametreler = [];

    for (const kelime of arama.trim().split(/\s+/).filter(Boolean)) {
      kosullar.push('k.arama_metni LIKE ?');
      parametreler.push(`%${sade(kelime)}%`);
    }
    if (durum === 'bekleyen') kosullar.push('k.tamamlandi = 0');
    if (durum === 'tamamlanan') kosullar.push('k.tamamlandi = 1');
    if (talepNo) { kosullar.push('k.talep_no = ?'); parametreler.push(talepNo); }
    if (proje) { kosullar.push('k.proje = ?'); parametreler.push(proje); }
    if (nereden) { kosullar.push('k.nereden = ?'); parametreler.push(nereden); }

    const nerede = kosullar.length ? 'WHERE ' + kosullar.join(' AND ') : '';
    return this.db
      .prepare(
        `SELECT k.*, t.pdf_dosya, t.pdf_ad, t.kaynak, t.eklenme, t.birim AS talep_birim,
                t.kullanici AS talep_kullanici, t.talep_tarihi
         FROM kalem k JOIN talep t ON t.id = k.talep_id
         ${nerede}
         ORDER BY t.id DESC, k.sira ASC
         LIMIT ?`
      )
      .all(...parametreler, limit);
  }

  /** Talep başlıkları + tamamlanma sayacı. */
  talepler() {
    return this.db
      .prepare(
        `SELECT t.*,
                COUNT(k.id)                              AS kalem_sayisi,
                SUM(CASE WHEN k.tamamlandi=1 THEN 1 ELSE 0 END) AS tamamlanan
         FROM talep t LEFT JOIN kalem k ON k.talep_id = t.id
         GROUP BY t.id ORDER BY t.id DESC`
      )
      .all();
  }

  ozet() {
    const s = this.db
      .prepare(
        `SELECT COUNT(*) AS kalem,
                SUM(CASE WHEN tamamlandi=1 THEN 1 ELSE 0 END) AS tamamlanan,
                COUNT(DISTINCT talep_no) AS talep
         FROM kalem`
      )
      .get();
    return {
      kalem: s.kalem ?? 0,
      tamamlanan: s.tamamlanan ?? 0,
      bekleyen: (s.kalem ?? 0) - (s.tamamlanan ?? 0),
      talep: s.talep ?? 0,
    };
  }

  /** Filtre açılır listeleri için ayrık değerler. */
  secenekler() {
    const kolon = (ad) =>
      this.db
        .prepare(`SELECT DISTINCT ${ad} AS d FROM kalem WHERE ${ad} <> '' ORDER BY d`)
        .all()
        .map((r) => r.d);
    return { talepNo: kolon('talep_no'), proje: kolon('proje'), nereden: kolon('nereden') };
  }

  kalemDurumu(id, tamamlandi) {
    this.db
      .prepare(
        `UPDATE kalem SET tamamlandi = ?,
                          tamamlanma_tarihi = CASE WHEN ? = 1 THEN datetime('now','localtime') ELSE NULL END
         WHERE id = ?`
      )
      .run(tamamlandi ? 1 : 0, tamamlandi ? 1 : 0, id);
    return this.kalem(id);
  }

  talepDurumu(talepId, tamamlandi) {
    this.db
      .prepare(
        `UPDATE kalem SET tamamlandi = ?,
                          tamamlanma_tarihi = CASE WHEN ? = 1 THEN datetime('now','localtime') ELSE NULL END
         WHERE talep_id = ?`
      )
      .run(tamamlandi ? 1 : 0, tamamlandi ? 1 : 0, talepId);
  }

  kalemDuzenle(id, alanlar) {
    const girdiler = Object.entries(alanlar).filter(([a]) => DUZENLENEBILIR.has(a));
    if (!girdiler.length) return this.kalem(id);
    const set = girdiler.map(([a]) => `${a} = ?`).join(', ');
    this.db.prepare(`UPDATE kalem SET ${set} WHERE id = ?`).run(...girdiler.map(([, d]) => d), id);
    // Düzenlenen değer arama dizinine de yansımalı.
    const guncel = this.kalem(id);
    this.db.prepare('UPDATE kalem SET arama_metni = ? WHERE id = ?').run(aramaMetni(guncel), id);
    return this.kalem(id);
  }

  kalem(id) {
    return this.db.prepare('SELECT * FROM kalem WHERE id = ?').get(id) ?? null;
  }

  talep(id) {
    return this.db.prepare('SELECT * FROM talep WHERE id = ?').get(id) ?? null;
  }

  talepSil(id) {
    const t = this.talep(id);
    this.db.prepare('DELETE FROM talep WHERE id = ?').run(id);
    return t;
  }
}
