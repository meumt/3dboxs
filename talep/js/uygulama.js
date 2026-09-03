// Arayüz ve akış. Sunucu yok: PDF okuma, ayrıştırma ve SQLite hep bu sayfada.

window.TT = window.TT || {};

TT.uygulama = (() => {
  'use strict';

  const $ = (s) => document.querySelector(s);
  const kacir = (d) =>
    String(d ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  let db = null;          // TT.Veritabani örneği
  let kalemler = [];      // ekranda duran satırlar
  let cozum = null;       // onay penceresindeki ayrıştırma sonucu
  let sonDosya = null;    // { ad, bayt } — "OCR ile tekrar oku" için elde tutulur

  // ——— küçük yardımcılar ———

  function bildir(mesaj, tur = '') {
    const kutu = document.createElement('div');
    kutu.className = 'bildirim ' + tur;
    kutu.textContent = mesaj;
    $('#bildirimler').append(kutu);
    setTimeout(() => kutu.remove(), 5000);
  }

  function calisiyor(acik, yazi = 'Okunuyor…') {
    $('#calisiyorYazi').textContent = yazi;
    $('#calisiyor').classList.toggle('acik', acik);
  }

  async function ozetle(bayt) {
    const oz = await crypto.subtle.digest('SHA-256', bayt);
    return [...new Uint8Array(oz)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  /** Dosya adını güvenli hâle getirir. */
  const guvenliAd = (ad) =>
    String(ad || 'talep')
      .replace(/[\\/:*?"<>|]/g, '_')
      .replace(/[\u0000-\u001f\u007f]/g, '')
      .replace(/^\.+/, '')
      .slice(0, 100) || 'talep';

  /** Veritabanını diske yaz. */
  async function kaydet({ hemen = false } = {}) {
    try {
      await TT.depo.veritabaniniYaz(db.disaAktar(), { hemen });
    } catch (e) {
      bildir('Diske yazılamadı: ' + e.message, 'kotu');
    }
  }

  // ——— depolama şeridi ———

  function depoSeridiCiz() {
    const d = TT.depo.durum;
    const serit = $('#depoSerit');
    if (d.kip === 'klasor') {
      serit.className = 'iyi';
      serit.innerHTML = `
        <span>✔ Kayıt klasörü: <code>${kacir(d.klasorAdi)}</code> — veritabanı
        <code>${TT.depo.DB_DOSYA}</code>, PDF'ler <code>${TT.depo.PDF_KLASORU}/</code> içinde.</span>
        <span class="bosluk" style="flex:1"></span>
        <button class="dugme ufak" id="klasorDegistir">Klasörü değiştir</button>`;
    } else if (d.bekleyenKlasor) {
      serit.className = 'uyari';
      serit.innerHTML = `
        <span>⚠ <b>${kacir(d.klasorAdi)}</b> klasörüne erişim izni tazelenmeli — tarayıcı,
        sayfa her açıldığında bir tık istiyor.</span>
        <span class="bosluk" style="flex:1"></span>
        <button class="dugme ufak ana" id="klasorAc">Klasörü aç</button>`;
    } else if (TT.depo.klasorDesteklenirMi()) {
      serit.className = 'uyari';
      serit.innerHTML = `
        <span>⚠ Henüz kayıt klasörü seçilmedi. Şu an her şey <b>tarayıcı belleğinde</b>;
        veritabanını klasörde tutmak için bir klasör seçin.</span>
        <span class="bosluk" style="flex:1"></span>
        <button class="dugme ufak ana" id="klasorSec">Klasör seç</button>`;
    } else {
      serit.className = 'uyari';
      serit.innerHTML = `
        <span>⚠ Bu tarayıcı klasöre yazmayı desteklemiyor (Chrome/Edge destekler).
        Veriler tarayıcı belleğinde tutuluyor — düzenli olarak <b>Yedek al</b> deyin.</span>
        <span class="bosluk" style="flex:1"></span>
        <button class="dugme ufak" id="yedekYukle">Yedekten yükle</button>`;
    }
  }

  async function klasoreGec(tekrarIzin) {
    const oncekiKip = TT.depo.durum.kip;
    try {
      await TT.depo.klasorSec({ tekrarIzin });
      // Klasörde veritabanı varsa onu aç — asla üzerine yazma.
      const mevcut = await TT.depo.veritabaniniOku();
      const bellektekiKalem = db ? db.ozet().kalem : 0;
      if (mevcut && mevcut.length) {
        if (
          bellektekiKalem &&
          !confirm(
            `Seçtiğiniz klasörde zaten bir ${TT.depo.DB_DOSYA} var.\n\n` +
              `Klasördeki veritabanı açılsın mı? Şu an ekranda duran ${bellektekiKalem} kalem ` +
              `görünmez olur (önce "Yedek al" ile indirebilirsiniz).`
          )
        ) {
          await TT.depo.klasoruBirak();
          if (oncekiKip === 'tarayici') depoSeridiCiz();
          return;
        }
        db = await TT.Veritabani.ac(mevcut);
      } else {
        await kaydet({ hemen: true });
      }
      depoSeridiCiz();
      await yenile();
      bildir(`Kayıt klasörü: ${TT.depo.durum.klasorAdi}`, 'iyi');
      if (TT.depo.durum.hatirlanmadi) {
        bildir('Klasör bu oturumda kullanılacak; tarayıcı hatırlamadı, sayfayı her açtığınızda tekrar seçmeniz gerekebilir.');
      }
    } catch (e) {
      if (e.name !== 'AbortError') bildir(e.message, 'kotu');
    }
  }

  // ——— liste ———

  function filtreler() {
    return {
      arama: $('#arama').value,
      durum: $('#fDurum').value,
      talepNo: $('#fTalep').value,
      proje: $('#fProje').value,
      nereden: $('#fNereden').value,
    };
  }

  async function yenile() {
    kalemler = db.kalemler(filtreler());
    sayaclariCiz(db.ozet());
    seceneklerCiz(db.secenekler());
    tabloCiz();
  }

  function sayaclariCiz(o) {
    $('#sayaclar').innerHTML = `
      <div class="sayac">Talep <b>${o.talep}</b></div>
      <div class="sayac">Kalem <b>${o.kalem}</b></div>
      <div class="sayac bekleyen">Bekleyen <b>${o.bekleyen}</b></div>
      <div class="sayac tamam">Tamamlanan <b>${o.tamamlanan}</b></div>`;
  }

  function seceneklerCiz(s) {
    const doldur = (id, degerler, hepsi) => {
      const el = $(id);
      const secili = el.value;
      el.innerHTML =
        `<option value="">${hepsi}</option>` +
        degerler.map((d) => `<option${d === secili ? ' selected' : ''}>${kacir(d)}</option>`).join('');
    };
    doldur('#fTalep', s.talepNo, 'Tüm talepler');
    doldur('#fProje', s.proje, 'Tüm projeler');
    doldur('#fNereden', s.nereden, 'Tüm ambarlar');
  }

  function kalemSatiri(k, gruplu) {
    const miktar =
      kacir(k.miktar) + (k.birim ? ` <span style="color:var(--soluk)">${kacir(k.birim)}</span>` : '');
    return `
    <tr class="${k.tamamlandi ? 'bitti' : ''}" data-id="${k.id}">
      <td class="durumHucre"><input type="checkbox" data-is="tamamla" ${k.tamamlandi ? 'checked' : ''}></td>
      <td class="talepNo">${kacir(k.talep_no)}<span class="altYazi">#${k.sira}</span></td>
      <td><span class="duzenlenir" contenteditable data-alan="proje">${kacir(k.proje)}</span></td>
      <td class="kod"><span class="duzenlenir" contenteditable data-alan="malzeme_kodu">${kacir(k.malzeme_kodu)}</span></td>
      <td>
        <span class="aciklamaAna duzenlenir" contenteditable data-alan="aciklama">${kacir(k.aciklama)}</span>
        ${k.metin ? `<span class="altYazi">${kacir(k.metin)}</span>` : ''}
      </td>
      <td class="sayi">${miktar}</td>
      <td><span class="duzenlenir" contenteditable data-alan="nereden">${kacir(k.nereden)}</span></td>
      <td>${
        k.tamamlandi
          ? `<span class="rozet tamam">Tamamlandı</span>${
              k.tamamlanma_tarihi ? `<span class="altYazi">${kacir(k.tamamlanma_tarihi)}</span>` : ''
            }`
          : '<span class="rozet bekliyor">Bekliyor</span>'
      }</td>
      <td>${
        !gruplu && k.pdf_dosya
          ? `<button class="dugme ufak" data-is="pdf" data-talep="${k.talep_id}">PDF</button>`
          : ''
      }</td>
    </tr>`;
  }

  function grupBasligi(talepId, satirlar) {
    const ilk = satirlar[0];
    const biten = satirlar.filter((k) => k.tamamlandi).length;
    const oran = Math.round((biten / satirlar.length) * 100);
    const kaynakAdi = ilk.kaynak === 'ocr' ? 'OCR' : ilk.kaynak === 'metin' ? 'metin katmanı' : 'elle';
    return `
    <tr class="grupBasi" data-talep="${talepId}">
      <td colspan="9">
        <div class="grupIc">
          <input type="checkbox" data-is="talepTamamla" data-talep="${talepId}"
                 ${biten === satirlar.length ? 'checked' : ''} title="Talebin tüm kalemlerini işaretle">
          <span class="no">${kacir(ilk.talep_no)}</span>
          <span class="rozet ${ilk.kaynak === 'ocr' ? 'ocr' : 'metin'}">${kaynakAdi}</span>
          <span class="bilgi">${kacir(ilk.talep_tarihi || '')} ${
      ilk.talep_kullanici ? '· ' + kacir(ilk.talep_kullanici) : ''
    } ${ilk.talep_birim ? '· ' + kacir(ilk.talep_birim) : ''}</span>
          <div class="cubuk" title="${biten}/${satirlar.length}"><i style="width:${oran}%"></i></div>
          <span class="bilgi">${biten}/${satirlar.length} kalem</span>
          <div class="bosluk" style="flex:1"></div>
          ${ilk.pdf_dosya ? `<button class="dugme ufak" data-is="pdf" data-talep="${talepId}">PDF aç</button>` : ''}
          <button class="dugme ufak tehlike" data-is="talepSil" data-talep="${talepId}">Sil</button>
        </div>
      </td>
    </tr>`;
  }

  function tabloCiz() {
    const govde = $('#govde');
    $('#bosMesaj').hidden = kalemler.length > 0;
    if (!kalemler.length) {
      govde.innerHTML = '';
      return;
    }
    if (!$('#grupla').checked) {
      govde.innerHTML = kalemler.map((k) => kalemSatiri(k, false)).join('');
      return;
    }
    const gruplar = new Map();
    for (const k of kalemler) {
      if (!gruplar.has(k.talep_id)) gruplar.set(k.talep_id, []);
      gruplar.get(k.talep_id).push(k);
    }
    govde.innerHTML = [...gruplar]
      .map(([id, satirlar]) => grupBasligi(id, satirlar) + satirlar.map((k) => kalemSatiri(k, true)).join(''))
      .join('');
  }

  // ——— PDF okuma ———

  async function pdfIsle(dosya, ocrZorla = false) {
    calisiyor(true, ocrZorla ? 'OCR yapılıyor, biraz sürebilir…' : 'PDF okunuyor…');
    try {
      const ad = guvenliAd(dosya.ad ?? dosya.name);
      const bayt = dosya.bayt ?? new Uint8Array(await dosya.arrayBuffer());
      if (new TextDecoder().decode(bayt.subarray(0, 5)) !== '%PDF-') {
        throw new Error('Bu bir PDF dosyası değil.');
      }
      const ozet = await ozetle(bayt);
      const sonuc = await TT.pdf.pdfOku(bayt, {
        ocrZorla,
        bildir: (m) => calisiyor(true, m),
      });
      const cikti = TT.ayristirici.ayristir(sonuc.sayfalar);

      sonDosya = { ad, bayt };
      onizlemeAc({
        ...cikti,
        ozet,
        ad,
        kaynak: sonuc.kaynak,
        sayfaSayisi: sonuc.sayfalar.length,
        uyari: sonuc.uyari,
        zatenVar: db.pdfVarMi(ozet),
      });
    } catch (e) {
      console.error(e);
      bildir(e.message, 'kotu');
    } finally {
      calisiyor(false);
    }
  }

  // ——— onay penceresi ———

  function onizlemeAc(sonuc) {
    cozum = sonuc;
    $('#kaynakRozet').innerHTML = `<span class="rozet ${sonuc.kaynak === 'ocr' ? 'ocr' : 'metin'}">${
      sonuc.kaynak === 'ocr' ? 'OCR ile okundu' : 'metin katmanından okundu'
    }</span>`;

    const uyarilar = [...(sonuc.uyarilar || [])];
    if (sonuc.uyari) uyarilar.push(sonuc.uyari);
    if (sonuc.zatenVar) {
      uyarilar.push(`Bu PDF daha önce "${sonuc.zatenVar.talep_no}" talebi olarak kaydedilmiş.`);
    }
    $('#uyarilar').innerHTML = uyarilar.length
      ? `<div class="uyariKutu"><b>Kontrol edin:</b><ul>${uyarilar
          .map((u) => `<li>${kacir(u)}</li>`)
          .join('')}</ul></div>`
      : '';

    const kopya = Boolean(sonuc.zatenVar);
    $('#onayla').disabled = kopya;
    $('#onayla').textContent = kopya ? 'Zaten kayıtlı' : 'Kaydet';

    $('#bTalepNo').value = sonuc.baslik.talepNo || '';
    $('#bNereden').value = sonuc.baslik.nereden || '';
    $('#bBirim').value = sonuc.baslik.birim || '';
    $('#bKullanici').value = sonuc.baslik.kullanici || '';
    $('#bTarih').value = sonuc.baslik.tarihSaat || '';
    $('#bNot').value = '';

    onizlemeTabloCiz();
    $('#onizlemeOrtu').classList.add('acik');
  }

  function onizlemeTabloCiz() {
    const alanlar = ['proje', 'poz', 'kod', 'aciklama', 'metin', 'miktar', 'birim'];
    $('#onizlemeGovde').innerHTML = cozum.kalemler
      .map(
        (k, i) => `
      <tr data-i="${i}">
        <td style="color:var(--soluk)">${k.sira ?? i + 1}</td>
        ${alanlar
          .map(
            (a) =>
              `<td contenteditable data-alan="${a}"${a === 'miktar' ? ' class="sayi"' : ''}>${kacir(k[a])}</td>`
          )
          .join('')}
        <td><button class="dugme ufak tehlike" data-is="satirSil">×</button></td>
      </tr>`
      )
      .join('');
    $('#onizlemeOzet').textContent = `${cozum.kalemler.length} kalem`;
  }

  async function onayla() {
    const nereden = $('#bNereden').value.trim();
    const baslik = {
      talepNo: $('#bTalepNo').value.trim(),
      nereden,
      birim: $('#bBirim').value.trim(),
      kullanici: $('#bKullanici').value.trim(),
      tarihSaat: $('#bTarih').value.trim(),
      depoYeri: cozum.baslik.depoYeri,
      uretimYeri: cozum.baslik.uretimYeri,
      notlar: $('#bNot').value.trim(),
    };
    if (!baslik.talepNo) return bildir('Talep no boş olamaz.', 'kotu');
    if (!cozum.kalemler.length) return bildir('Kaydedilecek kalem yok.', 'kotu');

    calisiyor(true, 'Kaydediliyor…');
    try {
      const dosyaAdi = `${guvenliAd(baslik.talepNo)}_${cozum.ozet.slice(0, 8)}.pdf`;
      await TT.depo.pdfYaz(dosyaAdi, sonDosya.bayt);

      const sonuc = db.talepEkle({
        baslik,
        kalemler: cozum.kalemler.map((k) => ({ ...k, nereden: k.nereden || nereden })),
        pdf: {
          dosya: dosyaAdi,
          ozet: cozum.ozet,
          ad: cozum.ad,
          kaynak: cozum.kaynak,
          sayfaSayisi: cozum.sayfaSayisi,
        },
      });
      await kaydet({ hemen: true });
      $('#onizlemeOrtu').classList.remove('acik');
      bildir(`${sonuc.kalemSayisi} kalem kaydedildi.`, 'iyi');
      await yenile();
    } catch (e) {
      console.error(e);
      bildir(e.message, 'kotu');
    } finally {
      calisiyor(false);
    }
  }

  // ——— CSV ———

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

  function csvIndir() {
    const satirlar = db.kalemler(filtreler());
    const kacirCsv = (d) => `"${String(d ?? '').replace(/"/g, '""')}"`;
    // Excel'in UTF-8'i tanıması için BOM, ayraç olarak da noktalı virgül.
    const govde =
      '\uFEFF' +
      [
        CSV_BASLIKLARI.map(([, b]) => kacirCsv(b)).join(';'),
        ...satirlar.map((s) =>
          CSV_BASLIKLARI.map(([a]) =>
            kacirCsv(a === 'tamamlandi' ? (s.tamamlandi ? 'EVET' : 'HAYIR') : s[a])
          ).join(';')
        ),
      ].join('\r\n');
    TT.depo.indir(
      `talepler-${new Date().toISOString().slice(0, 10)}.csv`,
      new TextEncoder().encode(govde),
      'text/csv;charset=utf-8'
    );
  }

  // ——— olaylar ———

  function olaylariBagla() {
    $('#depoSerit').addEventListener('click', (o) => {
      const id = o.target.closest('button')?.id;
      if (id === 'klasorSec' || id === 'klasorDegistir') klasoreGec(false);
      if (id === 'klasorAc') klasoreGec(true);
      if (id === 'yedekYukle') $('#yedekSecici').click();
    });

    $('#govde').addEventListener('change', async (olay) => {
      const el = olay.target;
      try {
        if (el.dataset.is === 'tamamla') {
          db.kalemDurumu(Number(el.closest('tr').dataset.id), el.checked);
        } else if (el.dataset.is === 'talepTamamla') {
          db.talepDurumu(Number(el.dataset.talep), el.checked);
        } else return;
        await kaydet();
        await yenile();
      } catch (e) {
        bildir(e.message, 'kotu');
      }
    });

    $('#govde').addEventListener('click', async (olay) => {
      const dugme = olay.target.closest('button');
      if (!dugme) return;
      const talepId = Number(dugme.dataset.talep);
      if (dugme.dataset.is === 'pdf') {
        try {
          const talep = db.talep(talepId);
          const bayt = await TT.depo.pdfOku(talep.pdf_dosya);
          if (!bayt) throw new Error('PDF dosyası bulunamadı.');
          const url = URL.createObjectURL(new Blob([bayt], { type: 'application/pdf' }));
          if (!window.open(url, '_blank')) TT.depo.indir(talep.pdf_ad || talep.pdf_dosya, bayt, 'application/pdf');
          setTimeout(() => URL.revokeObjectURL(url), 60000);
        } catch (e) {
          bildir(e.message, 'kotu');
        }
      } else if (dugme.dataset.is === 'talepSil') {
        if (!confirm('Bu talep ve tüm kalemleri silinsin mi? PDF dosyası da silinir.')) return;
        const talep = db.talepSil(talepId);
        if (talep?.pdf_dosya) await TT.depo.pdfSil(talep.pdf_dosya).catch(() => {});
        await kaydet({ hemen: true });
        bildir('Talep silindi.', 'iyi');
        await yenile();
      }
    });

    // Hücre düzenleme: odaktan çıkınca kaydet
    $('#govde').addEventListener('focusout', async (olay) => {
      const el = olay.target;
      if (!el.dataset?.alan) return;
      const id = Number(el.closest('tr').dataset.id);
      const kalem = kalemler.find((k) => k.id === id);
      const yeni = el.textContent.trim();
      if (!kalem || kalem[el.dataset.alan] === yeni) return;
      try {
        db.kalemDuzenle(id, { [el.dataset.alan]: yeni });
        kalem[el.dataset.alan] = yeni;
        await kaydet();
        bildir('Güncellendi.', 'iyi');
      } catch (e) {
        bildir(e.message, 'kotu');
        el.textContent = kalem[el.dataset.alan] ?? '';
      }
    });

    $('#govde').addEventListener('keydown', (olay) => {
      if (!olay.target.dataset?.alan) return;
      if (olay.key === 'Enter') { olay.preventDefault(); olay.target.blur(); }
      if (olay.key === 'Escape') olay.target.blur();
    });

    let aramaZaman;
    $('#arama').addEventListener('input', () => {
      clearTimeout(aramaZaman);
      aramaZaman = setTimeout(yenile, 180);
    });
    for (const id of ['#fDurum', '#fTalep', '#fProje', '#fNereden']) {
      $(id).addEventListener('change', yenile);
    }
    $('#grupla').addEventListener('change', tabloCiz);
    $('#csvDugme').addEventListener('click', csvIndir);
    $('#yedekDugme').addEventListener('click', () =>
      TT.depo.indir(
        `talepler-${new Date().toISOString().slice(0, 10)}.db`,
        db.disaAktar(),
        'application/vnd.sqlite3'
      )
    );

    $('#yedekSecici').addEventListener('change', async (olay) => {
      const dosya = olay.target.files[0];
      olay.target.value = '';
      if (!dosya) return;
      if (!confirm('Mevcut veriler bu yedekle değiştirilecek. Devam edilsin mi?')) return;
      try {
        db = await TT.Veritabani.ac(new Uint8Array(await dosya.arrayBuffer()));
        await kaydet({ hemen: true });
        await yenile();
        bildir('Yedek yüklendi.', 'iyi');
      } catch (e) {
        bildir('Yedek okunamadı: ' + e.message, 'kotu');
      }
    });

    // PDF yükleme
    $('#yukleDugme').addEventListener('click', () => $('#dosyaSecici').click());
    $('#atmaAlani').addEventListener('click', () => $('#dosyaSecici').click());
    $('#dosyaSecici').addEventListener('change', (olay) => {
      const dosya = olay.target.files[0];
      olay.target.value = '';
      if (dosya) pdfIsle(dosya);
    });

    const atma = $('#atmaAlani');
    for (const ad of ['dragenter', 'dragover']) {
      document.addEventListener(ad, (o) => { o.preventDefault(); atma.classList.add('uzerinde'); });
    }
    document.addEventListener('dragleave', (o) => {
      if (o.relatedTarget === null) atma.classList.remove('uzerinde');
    });
    document.addEventListener('drop', (o) => {
      o.preventDefault();
      atma.classList.remove('uzerinde');
      const dosya = [...(o.dataTransfer?.files || [])].find(
        (d) => /\.pdf$/i.test(d.name) || d.type === 'application/pdf'
      );
      if (dosya) pdfIsle(dosya);
      else if (o.dataTransfer?.files.length) bildir('Sadece PDF dosyası yükleyebilirsiniz.', 'kotu');
    });

    // Onay penceresi
    $('#onizlemeGovde').addEventListener('input', (olay) => {
      const hucre = olay.target;
      if (!hucre.dataset?.alan) return;
      cozum.kalemler[Number(hucre.closest('tr').dataset.i)][hucre.dataset.alan] = hucre.textContent.trim();
    });
    $('#onizlemeGovde').addEventListener('click', (olay) => {
      if (olay.target.closest('button')?.dataset.is !== 'satirSil') return;
      cozum.kalemler.splice(Number(olay.target.closest('tr').dataset.i), 1);
      onizlemeTabloCiz();
    });
    $('#satirEkle').addEventListener('click', () => {
      const son = cozum.kalemler[cozum.kalemler.length - 1];
      cozum.kalemler.push({
        sira: cozum.kalemler.length + 1,
        proje: son?.proje ?? '', poz: '', kod: '',
        aciklama: '', metin: '', miktar: '', birim: son?.birim ?? '',
      });
      onizlemeTabloCiz();
    });
    $('#ocrTekrar').addEventListener('click', () => {
      if (sonDosya) pdfIsle(sonDosya, true);
    });
    $('#vazgec').addEventListener('click', () => $('#onizlemeOrtu').classList.remove('acik'));
    $('#onayla').addEventListener('click', onayla);
    $('#onizlemeOrtu').addEventListener('click', (o) => {
      if (o.target === $('#onizlemeOrtu')) $('#vazgec').click();
    });
    document.addEventListener('keydown', (o) => {
      if (o.key === 'Escape' && $('#onizlemeOrtu').classList.contains('acik')) $('#vazgec').click();
    });
  }

  // ——— açılış ———

  async function baslat() {
    try {
      await TT.depo.baslat();
      db = await TT.Veritabani.ac(await TT.depo.veritabaniniOku());
      depoSeridiCiz();
      olaylariBagla();
      await yenile();
      window.TT_HAZIR = true;
    } catch (e) {
      console.error(e);
      document.body.insertAdjacentHTML(
        'afterbegin',
        `<div class="uyariKutu" style="margin:20px">Açılış hatası: ${kacir(e.message)}</div>`
      );
    }
  }

  return { baslat, get db() { return db; }, yenile, pdfIsle };
})();

TT.uygulama.baslat();
