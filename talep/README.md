# Talep Takip

Ambardan malzeme talep formu PDF'lerini okuyup tabloya çeviren, tamamlanma
durumunu takip eden lokal bir sistem. Tek bir HTML sayfası, SQLite veritabanı,
hepsi bu klasörün içinde. Dışarıya hiçbir bağlantı açılmaz.

```
PDF  →  metin katmanı / OCR  →  kolon ayrıştırma  →  onay ekranı  →  SQLite + PDF arşivi
```

## Kurulum ve çalıştırma

Node 22.5 veya üzeri gerekir (SQLite Node'un içinden geliyor, derlenecek paket yok).

```bash
cd talep
npm install
npm start
```

Sonra tarayıcıda **http://localhost:7345** adresini açın.

Sunucu yalnızca `127.0.0.1` dinler; ağdaki başka bir makine erişemez.
Farklı port için: `PORT=8080 npm start`.

## Kullanım

1. **PDF yükle**'ye basın ya da PDF'i sayfaya sürükleyin.
2. Açılan **onay ekranında** okunan satırları kontrol edin. Her hücre
   düzenlenebilir; satır silebilir, satır ekleyebilirsiniz. Talep no ve
   *nereden* (ambar) alanları üstteki kutulardan düzeltilir.
3. **Kaydet**'e basın — kalemler veritabanına yazılır, PDF `veri/pdfler/`
   klasörüne taşınır.
4. Listede her kalemin solundaki kutucukla **tamamlandı** işaretlenir. Talep
   başlığındaki kutucuk o talebin **tüm kalemlerini** birden işaretler; yanındaki
   çubuk kaçının bittiğini gösterir.

Listedeki proje, malzeme kodu, açıklama ve nereden hücreleri de yerinde
düzenlenebilir — hücreye tıklayıp yazın, `Enter`'a basın.

Üstteki arama kutusu Türkçe büyük/küçük harf ve `ı/i`, `ş/s`, `ğ/g` farkını
gözetmez: `demir` yazınca `İŞLENMİŞ DEMİR` de gelir. Birden fazla kelime
yazarsanız hepsini birden içeren kalemler listelenir.

**CSV indir** o anki filtreye uyan satırları Excel'in açabileceği biçimde verir
(UTF-8 BOM + noktalı virgül ayraç).

## Tablo kolonları

| Kolon | Nereden gelir |
|---|---|
| TALEP NO | Formun üstündeki *Talep No* |
| PROJE | Tablodaki *Proje* kolonu |
| MALZEME KODU | Tablodaki *Malzeme Kodu* kolonu |
| AÇIKLAMA | *SAP Malzeme Tanımı*; altında küçük punto ile *Malzeme/Talep Metni* |
| MİKTAR | *Miktar* + *Birim* |
| NEREDEN | Formun üstündeki *Depo Tanımı* (ve *Depo Yeri*) |
| DURUM | Sizin işaretlediğiniz tamamlanma bilgisi |

*Poz*, talep eden birim/kullanıcı ve talep tarihi de saklanır; CSV'ye ve talep
başlığına yansır.

## OCR

PDF dijital üretilmişse (SAP çıktısı gibi) metin katmanı okunur — hızlı ve
harfi harfine doğru. Metin katmanı yoksa (taranmış/fotoğraflanmış form) sayfa
görüntüye çevrilip **tesseract.js** ile Türkçe+İngilizce olarak okunur.

`npm install` bunu kendiliğinden kurar. Kurulmadıysa metin katmanı olan PDF'ler
yine çalışır, taranmış olanlar için şunu çalıştırın:

```bash
npm install tesseract.js
```

Türkçe+İngilizce dil dosyaları (~10 MB) ilk OCR'da bir kez indirilip
`veri/tessdata/` altına konur, sonrasında oradan okunur. İnternete kapalı bir
makinede kullanacaksanız önceden indirin:

```bash
npm run ocr-hazirla
```

Metin katmanı olan bir PDF yanlış okunduysa onay ekranındaki **OCR ile tekrar
oku** düğmesi sayfayı görüntüden okutur. OCR'da `0/O` ve `9/g` gibi karışmalar
olabilir; onay ekranı tam da bunun için var.

## Dosyalar

```
talep/
├── sunucu.js              yerel HTTP sunucusu ve uç noktalar
├── genel/index.html       tüm arayüz — tek dosya, harici bağımlılık yok
├── lib/
│   ├── pdf-metin.js       PDF'ten koordinatlı kelime çıkarma (metin katmanı + OCR)
│   ├── ayristir.js        kelimeleri form başlığına ve tablo satırlarına çevirme
│   └── db.js              SQLite şeması ve sorguları
├── ornek/ornek-talep.pdf  ayrıştırıcının doğrulandığı örnek form
├── test/                  node --test ile çalışan testler
└── veri/                  ← çalışırken oluşur, sürüm kontrolüne girmez
    ├── talepler.db        SQLite veritabanı
    ├── pdfler/            kaydedilen talep PDF'leri
    ├── tessdata/          OCR dil dosyaları (ilk kullanımda inen)
    └── gecici/            henüz onaylanmamış yüklemeler
```

`veri/` klasörü `.gitignore`'da. Yedek almak için bu klasörü kopyalamanız
yeterli — veritabanı ve PDF arşivi orada.

## Ayrıştırma nasıl çalışıyor

Satır sırasına göre metin okumak tablolarda güvenilmez; onun yerine
**koordinat** kullanılıyor:

1. Her kelime, `x0–x1` ve `y` konumuyla birlikte çıkarılır (metin katmanından ya
   da OCR'dan; ikisi de aynı biçimi döner).
2. Kelimeler `y`'lerindeki *boşluklara* göre satırlara kümelenir. Ortalama
   kaydıran yöntem OCR'ın gürültülü koordinatlarında satırları birbirine
   yapıştırıyordu; boşluk temelli kümeleme buna dayanıklı.
3. `Miktar` ve `Malzeme Kodu` etiketlerini taşıyan satır **tablo başlığı** kabul
   edilir; etiket öbeklerinin arasındaki orta noktalar kolon sınırı olur.
4. Her kelime merkez `x`'ine göre bir kolona düşer.
5. Hücreler tipine göre **onarılır**: miktar sayı olmalı, birim harf olmalı, sıra
   no tek sayı olmalı. Sınıra oturan parçalar (`B50` ile `55,820` arasındaki gibi)
   böylece doğru hücreye taşınır.
6. Sıra no ile başlamayan satırlar, bir önceki kalemin devamı sayılır — açıklaması
   alt satıra taşan kalemler bölünmez.

Kolon başlıkları tanınmazsa veya bir hücre okunamazsa onay ekranında sarı bir
uyarı çıkar; kayıt öncesi elle düzeltilir.

## Testler

```bash
npm test
```

Örnek formun 13 kaleminin tamamının doğru okunduğunu, Türkçe aramanın
çalıştığını ve kolon sınırı onarımının doğru davrandığını doğrular.
