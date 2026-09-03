# Talep Takip

Ambardan malzeme talep formu PDF'lerini okuyup tabloya çeviren, her kalemi
onaylayıp reddedebildiğiniz sistem. **Kurulum yok, sunucu yok, Node yok** — `index.html`
dosyasına çift tıklayın, açılır.

```
PDF  →  metin katmanı / OCR  →  kolon ayrıştırma  →  onay ekranı  →  SQLite + PDF arşivi
```

Veritabanı gerçek bir **SQLite** dosyası (`talepler.db`), PDF'ler de yanındaki
`pdfler/` klasöründe duruyor. Uygulama dışarıya tek bir ağ isteği bile yapmıyor:
PDF motoru, SQLite ve OCR — hepsi klasördeki dosyalarda.

## Çalıştırma

`index.html`'e çift tıklayın. İlk açılışta üstteki şeritten **Klasör seç**'e
basıp verilerin duracağı klasörü gösterin (bu klasörün kendisi olabilir).
Tarayıcı izni hatırlar; sonraki açılışlarda bir tık ile onaylarsınız.

- **Chrome / Edge** — klasöre doğrudan yazar, önerilen kullanım.
- **Firefox / Safari** — klasör erişimi desteklenmiyor; veriler tarayıcının
  kendi belleğinde tutulur, **Yedek al** düğmesiyle `talepler.db`'yi indirip
  saklarsınız, **Yedekten yükle** ile geri alırsınız.

Ağ üzerinden paylaşmak isterseniz klasörü herhangi bir statik sunucuyla da
yayınlayabilirsiniz — ama gerekmiyor.

## Kullanım

### Tek PDF

1. **PDF yükle**'ye basın ya da PDF'i sayfaya sürükleyin.
2. Açılan **onay ekranında** okunan satırları kontrol edin. Her hücre
   düzenlenebilir; satır silebilir, satır ekleyebilirsiniz. Talep no ve
   *nereden* (ambar) alanları üstteki kutulardan düzeltilir.
3. **Kaydet**'e basın — kalemler veritabanına yazılır, PDF `pdfler/` klasörüne
   kopyalanır.

### Toplu ekleme

Onlarca PDF'i birden sürükleyin (ya da dosya seçicide hepsini seçin). Hepsi
sırayla okunur, sonunda tek bir **özet listesi** açılır: hangi dosya, hangi talep
no, kaç kalem, metin katmanından mı OCR'dan mı okundu, bir sorun var mı.

- Daha önce kaydedilmiş bir PDF **Kopya** olarak işaretlenir ve seçili gelmez.
- Okunamayan dosya sebebiyle birlikte listelenir, kaydedilmez.
- Bir formu tek tek gözden geçirmek isterseniz satırındaki **Düzenle** ile onay
  ekranını açar, düzeltip listeye dönersiniz.
- **Kaydet** yalnız işaretli formları yazar.

### Gruplama

**Taleplere göre grupla** işaretliyken her talep bir başlık satırıyla geliyor.
Başlığa (ya da soldaki ▾ okuna) tıklamak o talebin kalemlerini gizler; başlık
satırı, sayaçları ve onay/red butonlarıyla birlikte durmaya devam eder.
Filtrelerin yanındaki **Hepsini kapat / Hepsini aç** düğmesi tümünü birden
toplar. Onlarca talep varken liste böyle bir ekrana sığıyor.

### Onay ve red

Her kalemin solunda iki buton var: **✓ onayla**, **✕ reddet**. Etkin butona
tekrar basmak kalemi *bekliyor*a döndürür. Talep başlığındaki aynı ikili o
talebin **tüm kalemlerini** birden işaretler; yanındaki çubukta yeşil onay,
kırmızı red payı görünür. Üst şeritteki sayaçlar bekleyen / onaylanan /
reddedilen toplamlarını gösterir, filtre kutusundan da bunlara göre süzebilirsiniz.

Listedeki proje, malzeme kodu, açıklama ve nereden hücreleri de yerinde
düzenlenebilir — hücreye tıklayıp yazın, `Enter`'a basın.

Arama kutusu Türkçe büyük/küçük harf ve `ı/i`, `ş/s`, `ğ/g` farkını gözetmez:
`demir` yazınca `İŞLENMİŞ DEMİR` de gelir. Birden fazla kelime yazarsanız
hepsini birden içeren kalemler listelenir.

**CSV indir** o anki filtreye uyan satırları Excel'in doğrudan açabileceği
biçimde verir (UTF-8 BOM + noktalı virgül ayraç); durum kolonu da içinde.
**Yedek al** ise veritabanının o anki kopyasını indirir.

## Tablo kolonları

| Kolon | Nereden gelir |
|---|---|
| TALEP NO | Formun üstündeki *Talep No* |
| PROJE | Tablodaki *Proje* kolonu |
| MALZEME KODU | Tablodaki *Malzeme Kodu* kolonu |
| AÇIKLAMA | *SAP Malzeme Tanımı*; altında küçük punto ile *Malzeme/Talep Metni* |
| MİKTAR | *Miktar* + *Birim* |
| NEREDEN | Formun üstündeki *Depo Tanımı* (ve *Depo Yeri*) |
| DURUM | Sizin verdiğiniz onay / red kararı |

*Poz*, talep eden birim/kullanıcı ve talep tarihi de saklanır; CSV'ye ve talep
başlığına yansır.

### Desteklenen formlar

İki form düzeni denenmiş durumda ve ikisi de tam çıkıyor:

- **Türkçe SAP formu** — *IC İçtaş Nükleer Ambardan Malzeme Talep Formu*.
- **İngilizce form** — *Warehouse Material Request Form*: 13 kolon, başlık
  etiketlerinin bir kısmı iki satıra taşıyor (*Thickness / (mm)*).

Kolon adları hem Türkçe hem İngilizce tanınıyor. İkinci formda ayrı bir malzeme
kodu kolonu yok; MALZEME KODU olarak *Order No* alınıyor ve onay ekranında bu
söyleniyor. Altı ana kolona girmeyen alanlar (kalınlık, kalite, gost, tedarikçi,
yer, not) kaybolmuyor — açıklamanın altında küçük punto ile toplanıyor.

Başka bir düzen gelirse ayrıştırıcı yine kolon başlıklarını arar; tanıyamazsa
onay ekranında uyarır ve satırları elle düzeltirsiniz.

## OCR

PDF dijital üretilmişse (SAP çıktısı gibi) metin katmanı okunur — hızlı ve harfi
harfine doğru. Metin katmanı yoksa (taranmış/fotoğraflanmış form) sayfa
görüntüye çevrilip **tesseract.js** ile Türkçe+İngilizce olarak okunur. Bu geçiş
kendiliğinden olur; ayrıca onay ekranındaki **OCR ile tekrar oku** düğmesiyle
elle de zorlayabilirsiniz.

OCR motoru ve dil modelleri `js/kutuphane/ocr/` klasöründe hazır duruyor
(~13 MB) ve yalnızca ilk OCR'da belleğe alınır. İnternet gerekmez. OCR'da
`0/O`, `Ø/@` gibi karışmalar olabilir — onay ekranı tam da bunun için var.

## Veriler nerede

Seçtiğiniz klasörde:

```
talepler.db     SQLite veritabanı — DB Browser, Python, Excel eklentileri hepsi açar
pdfler/         kaydedilen talep PDF'leri (talepno_özet.pdf)
```

Yedek almak için bu iki şeyi kopyalamanız yeterli. Uygulama klasörünü
(`index.html` ve `js/`) aynı yere koyabilir ya da ayrı tutabilirsiniz.

## Dosyalar

```
talep/
├── index.html                  uygulama — çift tıklayıp açacağınız dosya
├── test.html                   testler — çift tıklayınca çalışır
├── js/
│   ├── ayristir.js             kelimeleri form başlığına ve tablo satırlarına çevirme
│   ├── pdf-metin.js            PDF'ten koordinatlı kelime çıkarma (metin katmanı + OCR)
│   ├── veritabani.js           SQLite şeması ve sorguları
│   ├── depo.js                 klasöre / tarayıcı belleğine yazma
│   ├── uygulama.js             arayüz ve akış
│   └── kutuphane/              dış kütüphaneler (aşağıya bakın)
├── ornek/                      ayrıştırıcının doğrulandığı iki örnek form
└── test/                       aynı PDF'ler, testlerin kullanması için gömülü
```

### Kütüphaneler

Hepsi klasörde duruyor, hiçbiri ağdan çekilmiyor:

| Dosya | Ne |
|---|---|
| `kutuphane/pdf.js` | pdf.js 3.11.174 — PDF okuma ve çizme |
| `kutuphane/pdf-worker.b64.js` | pdf.js worker'ı |
| `kutuphane/pdf-fontlar.b64.js` | pdf.js yedek fontları (Liberation + Foxit) |
| `kutuphane/sql-wasm.js` + `sql-wasm.b64.js` | sql.js 1.13 — SQLite 3.49 (WebAssembly) |
| `kutuphane/ocr/` | tesseract.js 5.1 + WASM çekirdeği + tur/eng dil modelleri |

`.b64.js` uzantılı dosyalar ikili içeriği base64 olarak taşıyor. Sebebi:
`file://` üzerinde tarayıcı yan dosyaları `fetch` ile okumaya izin vermiyor, ama
`<script src="...">` ile yüklemeye izin veriyor.

## Ayrıştırma nasıl çalışıyor

Satır sırasına göre metin okumak tablolarda güvenilmez; onun yerine
**koordinat** kullanılıyor:

1. Her kelime, `x0–x1` ve `y` konumuyla birlikte çıkarılır (metin katmanından ya
   da OCR'dan; ikisi de aynı biçimi döner).
2. Kelimeler `y`'lerindeki *boşluklara* göre satırlara kümelenir. Ortalamayı
   kaydıran yöntem OCR'ın gürültülü koordinatlarında satırları birbirine
   yapıştırıyordu; boşluk temelli kümeleme buna dayanıklı.
3. `Miktar` ve `Malzeme Kodu` etiketlerini taşıyan satır **tablo başlığı** kabul
   edilir. Etiketler iki satıra taşmış olabileceği için (*Thickness* altında
   *(mm)*) hemen üstteki ve alttaki rakamsız satırlar da başlığa katılır —
   rakam koşulu veri satırlarını dışarıda tutuyor.
4. Kelimelerin hangi boşlukta kolon değiştirdiği forma göre değişiyor: bir formda
   etiket araları 18 pt, başkasında 8 pt, ama iki kelimelik etiketin kendi içi
   2 pt. Sabit bir eşik ikisini tutturamadığı için birkaç eşik denenip **en çok
   kolonu tanıyan** seçiliyor. Etiket öbeklerinin arasındaki orta noktalar kolon
   sınırı olur.
5. Her kelime merkez `x`'ine göre bir kolona düşer.
6. Hücreler tipine göre **onarılır**: miktar sayı olmalı, birim harf olmalı, sıra
   no tek sayı olmalı. Sınıra oturan parçalar (örnek formda `B50` ile `55,820`
   arasındaki gibi) böylece doğru hücreye taşınır.
7. Sıra no ile başlamayan satırlar, bir önceki kalemin devamı sayılır —
   açıklaması alt satıra taşan kalemler bölünmez.

Kolon başlıkları tanınmazsa veya bir hücre okunamazsa onay ekranında sarı bir
uyarı çıkar; kayıt öncesi elle düzeltilir.

## Testler

`test.html` dosyasına çift tıklayın. İki örnek formun da eksiksiz okunduğunu,
Türkçe aramayı, kolon sınırı onarımını, iki satıra taşan başlıkları, onay/red
durumlarını ve veritabanı işlemlerini doğrular (72 test).

## Bilinen sınırlar

- Klasöre yazma (File System Access API) yalnızca Chrome ve Edge'de var.
  Firefox/Safari'de tarayıcı belleği + elle yedek kullanılır.
- Tarayıcı, klasör iznini sayfa her açıldığında bir tıkla onaylatır; bu
  tarayıcının güvenlik kuralı, uygulamadan atlatılamıyor.
- Veritabanı her değişiklikte bütünüyle yeniden yazılır. Binlerce kalemde bile
  dosya birkaç yüz KB olduğu için sorun değil, ama milyonluk ölçek için
  tasarlanmadı.
