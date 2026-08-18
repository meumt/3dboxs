/**
 * Kontrol paneli.
 *
 * Sıralama kullanıcının kendi düşünce sırasını izliyor:
 * önce BİÇİM, sonra NE YAZACAĞI, sonra DUVARDA KAÇ SANTİM olacağı.
 * Gerisi (lamba, montaj, köprüler) altta ve varsayılan olarak kapalı.
 */
import {
  el, group, hint, slider, number, textArea, select, segmented, checkbox,
  colorInput, button, fileButton, row,
} from './widgets.js';
import { FONTS, LAMP_PRESETS } from '../core/state.js';
import { PLATE_SHAPES } from '../core/plate.js';

export function buildPanel(container, ctx) {
  const d = ctx.getDesign();
  const set = ctx.set;
  const dyn = {};

  // ------------------------------------------------------------ 1 · biçim

  const shapeGroup = group('1 · Biçim ve ölçü', [
    segmented({
      label: 'Levha biçimi',
      value: d.plateShape,
      options: Object.entries(PLATE_SHAPES).map(([value, label]) => ({ value, label })),
      onInput: (v) => { set({ plateShape: v }); refreshShape(v); },
    }),
    row([
      number({ label: 'Genişlik', value: d.plateWidth, min: 40, max: 600, step: 5, unit: 'mm',
               onInput: (v) => set({ plateWidth: v }) }),
      (dyn.plateH = number({ label: 'Yükseklik', value: d.plateHeight, min: 40, max: 600, step: 5, unit: 'mm',
                             onInput: (v) => set({ plateHeight: v }) })),
    ]),
    hint('Duvarda asılı duracak parçanın ölçüsü. Büyüdükçe duvardaki yazının daha büyük bir ' +
         'kısmını kapatır — ve tam o kısmı kendi üzerinde tamamlar.'),
    slider({ label: 'Levha kalınlığı', value: d.plateThickness, min: 0.8, max: 8, step: 0.2, unit: 'mm',
             onInput: (v) => set({ plateThickness: v }) }),
    (dyn.corner = slider({ label: 'Köşe yarıçapı', value: d.cornerRadius, min: 0, max: 60, step: 1, unit: 'mm',
                           onInput: (v) => set({ cornerRadius: v }) })),
    (dyn.arrow = el('div', { class: 'group-body', style: 'padding:0;gap:10px' }, [
      slider({ label: 'Ok ucu oranı', value: d.arrowTipRatio, min: 0.05, max: 0.45, step: 0.01,
               onInput: (v) => set({ arrowTipRatio: v }) }),
      segmented({
        label: 'Ok yönü',
        value: d.arrowPointLeft ? 'left' : 'right',
        options: [{ value: 'left', label: '← Sol' }, { value: 'right', label: 'Sağ →' }],
        onInput: (v) => set({ arrowPointLeft: v === 'left' }),
      }),
    ])),
  ]);

  // ------------------------------------------------------------ 2 · kaynak

  const textFields = el('div', { class: 'group-body', style: 'padding:0;gap:10px' }, [
    textArea({ label: 'Yazı (Enter ile alt satır)', value: d.text, rows: 3,
               onInput: (v) => set({ text: v }) }),
    select({ label: 'Font', value: d.fontUrl,
             options: FONTS.map((f) => ({ value: f.url, label: f.name })),
             onInput: (v) => set({ fontUrl: v }) }),
    row([
      slider({ label: 'Harf aralığı', value: d.letterSpacing, min: -0.08, max: 0.4, step: 0.01,
               onInput: (v) => set({ letterSpacing: v }) }),
      slider({ label: 'Satır yüksekliği', value: d.lineHeight, min: 0.7, max: 2, step: 0.05,
               onInput: (v) => set({ lineHeight: v }) }),
    ]),
    segmented({
      label: 'Hizalama', value: d.align,
      options: [{ value: 'left', label: 'Sol' }, { value: 'center', label: 'Orta' }, { value: 'right', label: 'Sağ' }],
      onInput: (v) => set({ align: v }),
    }),
  ]);

  const svgFields = el('div', { class: 'group-body', style: 'padding:0;gap:10px' }, [
    fileButton({ label: 'SVG dosyası seç…', accept: '.svg,image/svg+xml', onFile: (f) => ctx.loadSVG(f) }),
    (dyn.svgStatus = hint('Henüz dosya yüklenmedi.')),
    checkbox({ label: 'Açık renkleri delik say', value: d.svgLightHoles,
               onInput: (v) => ctx.setSvgHoles(v) }),
    hint('Çoğu logoda delikler, gövdenin üstüne beyaz şekil çizilerek yapılır. Bu kutu açıkken ' +
         'o beyaz alanlar gerçek delik olarak kesilir. Logon boş çıkarsa kapat.'),
    hint('Yalnızca DOLGULU alanlar kesilir. Sadece çizgiden oluşan logoları vektör programında ' +
         '"outline"a çevir.'),
  ]);

  function refreshSource(source) {
    textFields.style.display = source === 'text' ? 'grid' : 'none';
    svgFields.style.display = source === 'svg' ? 'grid' : 'none';
  }

  const sourceGroup = group('2 · Ne yazsın?', [
    segmented({
      label: 'Kaynak', value: d.source,
      options: [{ value: 'text', label: 'Yazı' }, { value: 'svg', label: 'SVG logo' }],
      onInput: (v) => { set({ source: v }); refreshSource(v); },
    }),
    textFields,
    svgFields,
    slider({ label: 'Döndür', value: d.artworkRotation, min: -180, max: 180, step: 1, unit: '°',
             onInput: (v) => set({ artworkRotation: v }) }),
    checkbox({ label: 'Negatif (çizim karanlık, çevresi ışıklı)', value: d.invert,
               onInput: (v) => { set({ invert: v }); refreshInvert(v); } }),
    (dyn.frame = slider({ label: 'Çerçeve kalınlığı', value: d.frameWidth, min: 2, max: 40, step: 0.5, unit: 'mm',
                          onInput: (v) => set({ frameWidth: v }) })),
    (dyn.invertHint = hint('Negatif modda çizimi ayakta tutmak için levha kenarında çerçeve bırakılır; ' +
                           'harfler oraya köprülerle bağlanır.')),
  ]);

  // ------------------------------------------------------------ 3 · hedef

  const targetGroup = group('3 · Duvarda ne kadar büyük olsun?', [
    row([
      (dyn.tw = number({ label: 'Genişlik', value: d.targetWallWidth, min: 50, max: 3000, step: 10, unit: 'mm',
                         onInput: (v) => set({ targetWallWidth: v }) })),
      (dyn.th = number({ label: 'Yükseklik', value: d.targetWallHeight, min: 50, max: 3000, step: 10, unit: 'mm',
                         onInput: (v) => set({ targetWallHeight: v }) })),
    ]),
    checkbox({ label: 'En-boy oranını koru', value: d.lockAspect, onInput: (v) => set({ lockAspect: v }) }),
    hint('Bu, ışığın DUVARDA çizeceği boyuttur. Maskedeki ölçüyü sistem büyütme oranına göre kendi hesaplar.'),
    el('div', { class: 'seg' }, [
      button({ label: '30×30', onClick: () => ctx.setSize(300, 300) }),
      button({ label: '50×50', onClick: () => ctx.setSize(500, 500) }),
      button({ label: '80×80', onClick: () => ctx.setSize(800, 800) }),
      button({ label: '100×60', onClick: () => ctx.setSize(1000, 600) }),
    ]),
  ]);

  // ------------------------------------------------------------ 4 · lamba

  const lampPreset = LAMP_PRESETS.find((p) => p.id === d.lampPreset) ?? LAMP_PRESETS[0];

  const lampGroup = group('4 · Lamba ve optik', [
    select({ label: 'Lamba', value: d.lampPreset,
             options: LAMP_PRESETS.map((p) => ({ value: p.id, label: p.name })),
             onInput: (v) => ctx.setLampPreset(v) }),
    (dyn.lampNote = hint(lampPreset.note)),
    row([
      (dyn.lampDia = number({ label: 'Puck çapı', value: d.lampDiameter, min: 5, max: 200, step: 1, unit: 'mm',
                              onInput: (v) => set({ lampDiameter: v }) })),
      (dyn.lampDepth = number({ label: 'Puck yüksekliği', value: d.lampDepth, min: 2, max: 100, step: 1, unit: 'mm',
                                onInput: (v) => set({ lampDepth: v }) })),
    ]),
    row([
      (dyn.flux = number({ label: 'Işık akışı', value: d.luminousFlux, min: 0, max: 3000, step: 5, unit: 'lm',
                           onInput: (v) => set({ luminousFlux: v }) })),
      (dyn.ledSize = number({ label: 'Yayan yüzey çapı', value: d.ledSize, min: 0.5, max: 80, step: 0.5, unit: 'mm',
                              onInput: (v) => set({ ledSize: v }) })),
    ]),
    hint('Puck ölçüleri yuvanın açılacağı boyutu belirler. Işık akışı duvardaki gerçek ' +
         'aydınlığı (lüks) hesaplamak için kullanılır.'),

    (dyn.H = number({ label: 'H · LED\'in duvara uzaklığı', value: d.ledDistance, min: 15, max: 400, step: 1, unit: 'mm',
                      onInput: (v) => set({ ledDistance: v }) })),
    (dyn.G = slider({ label: 'G · LED ile maske arası', value: d.maskGap, min: 2, max: 200, step: 0.5, unit: 'mm',
                      onInput: (v) => set({ maskGap: v }) })),
    hint('Büyütme M = H / G. H lambadan gelmiyor — puck sadece 1 cm boyunda, ' +
         'onu duvardan ne kadar uzakta tutacağını AYAKLARIN boyu belirliyor. ' +
         'Yani H senin tasarım kararın.'),

    checkbox({ label: 'Diyafram tak (keskinlik için)', value: d.apertureEnabled,
               onInput: (v) => { set({ apertureEnabled: v }); refreshAperture(v); } }),
    (dyn.aperture = slider({ label: 'Diyafram çapı', value: d.apertureDiameter, min: 1, max: 60, step: 0.5, unit: 'mm',
                             onInput: (v) => set({ apertureDiameter: v }) })),
    (dyn.apertureHint = hint('Yayan yüzeyin önüne küçük bir delik koymak kenarları keskinleştirir ' +
                             'ama ışığı alanla orantılı azaltır. Takas budur; sağdaki lüks değerine bak.')),

    number({ label: 'Maske kenar payı', value: d.maskMargin, min: 0, max: 40, step: 1, unit: 'mm',
             onInput: (v) => set({ maskMargin: v }) }),
    (dyn.bore = number({ label: 'Maske orta deliği', value: d.boreDiameter, min: 0, max: 200, step: 1, unit: 'mm',
                         onInput: (v) => set({ boreDiameter: v }) })),
    hint('Puck arkada, kollarla taşınıyor; maskenin ortasında delik gerekmiyor (0 bırak).'),
  ]);

  // ------------------------------------------------- 5 · gölgeyi tamamlama

  const completionGroup = group('5 · Gölgeyi tamamlama', [
    checkbox({ label: 'Levha, duvardaki eksik parçayı tamamlasın', value: d.completeShadow,
               onInput: (v) => { set({ completeShadow: v }); refreshCompletion(v); } }),
    hint('Levha, duvardaki yazının ortasını kapatır. Bu açıkken görünen levhaya yazının TAM O ' +
         'KAPANAN parçası gerçek ölçeğinde kesilir — küçük bir kopyası değil. Karşıdan bakınca ' +
         'yazı bütün görünür.'),
    (dyn.view = number({ label: 'Bakış mesafesi', value: d.viewDistance, min: 300, max: 10000, step: 100, unit: 'mm',
                         onInput: (v) => set({ viewDistance: v }) })),
    (dyn.viewHint = hint('Tamamlama bu mesafeye göre hizalanır — geometrik olarak tek bir mesafede ' +
                         'tam oturur. "Duvar" görünümü kamerayı tam buraya koyar.')),
    (dyn.faceOff = slider({ label: 'Maske ile yüz levhası arası', value: d.faceOffset, min: 2, max: 60, step: 0.5, unit: 'mm',
                            onInput: (v) => set({ faceOffset: v }) })),
  ]);

  // ------------------------------------------------------------ 6 · montaj

  const mountGroup = group('6 · İskelet', [
    hint('Puck, ışık konisinin dışından dolaşan kollarla taşınır. LED düzleminde koni ' +
         'bir noktaya indiği için kollar orada hiçbir şey kesmez; gölgeleri yazının ' +
         'değil, çevresindeki hâlenin üzerine düşer.'),
    row([
      number({ label: 'Kol sayısı', value: d.armCount, min: 2, max: 6, step: 1,
               onInput: (v) => set({ armCount: v }) }),
      number({ label: 'Kol genişliği', value: d.armWidth, min: 3, max: 20, step: 0.5, unit: 'mm',
               onInput: (v) => set({ armWidth: v }) }),
    ]),
    row([
      number({ label: 'Ayak sayısı', value: d.footCount, min: 2, max: 6, step: 1,
               onInput: (v) => set({ footCount: v }) }),
      number({ label: 'Ayak genişliği', value: d.footWidth, min: 4, max: 25, step: 0.5, unit: 'mm',
               onInput: (v) => set({ footWidth: v }) }),
    ]),
    hint('Ayaklar maskeyi duvardan (H − G) kadar uzakta tutar. Kapalı bir bordür yerine ' +
         'ayrık ayaklar var; kapalı bordür ışığın duvara yayılmasını keserdi.'),
    slider({ label: 'Yuva et kalınlığı', value: d.socketThickness, min: 1, max: 6, step: 0.2, unit: 'mm',
             onInput: (v) => set({ socketThickness: v }) }),
    checkbox({ label: 'Yuvanın arkası kapalı', value: d.socketBackPlate,
               onInput: (v) => set({ socketBackPlate: v }) }),
  ], false);

  // ------------------------------------------------------------ 7 · köprüler

  const bridgeGroup = group('7 · Şablon köprüleri', [
    checkbox({ label: 'Kopan göbekleri otomatik bağla', value: d.autoBridge,
               onInput: (v) => set({ autoBridge: v }) }),
    slider({ label: 'Köprü kalınlığı', value: d.bridgeWidth, min: 0.4, max: 6, step: 0.1, unit: 'mm',
             onInput: (v) => set({ bridgeWidth: v }) }),
    slider({ label: 'Ada başına köprü', value: d.bridgesPerIsland, min: 1, max: 4, step: 1,
             onInput: (v) => set({ bridgesPerIsland: v }) }),
    hint('"O", "A", "8", "Ö" gibi harflerin göbeği levhadan kopar. Köprüler onları tutar; duvarda ' +
         'ince karanlık çizgi olarak görünürler.'),
  ], false);

  // ------------------------------------------------------------ 8 · görünüm

  const viewGroup = group('8 · Görünüm', [
    row([
      colorInput({ label: 'Işık rengi', value: d.lightColor, onInput: (v) => set({ lightColor: v }) }),
      colorInput({ label: 'Duvar rengi', value: d.wallColor, onInput: (v) => set({ wallColor: v }) }),
    ]),
    slider({ label: 'Parlaklık', value: d.intensity, min: 0.2, max: 2.5, step: 0.05,
             onInput: (v) => set({ intensity: v }) }),
    slider({ label: 'Pozlama eğrisi', value: d.exposure, min: 0.15, max: 1, step: 0.01,
             onInput: (v) => set({ exposure: v }) }),
    hint('Pozlama yalnızca ÖNİZLEMEYİ etkiler — fotoğraf makinesinin pozu gibi. 1 = ham fizik. ' +
         'Sağdaki ölçüler her hâlükârda ham fizikten gelir.'),
  ], false);

  // ------------------------------------------------------------ 9 · çıktı

  const outputGroup = group('9 · Çıktı', [
    select({ label: 'Malzeme', value: d.material,
             options: ['PLA', 'PETG', 'ABS', 'ASA'].map((m) => ({ value: m, label: m })),
             onInput: (v) => set({ material: v }) }),
    number({ label: 'Yazıcı tablası', value: d.bedSize, min: 80, max: 600, step: 10, unit: 'mm',
             onInput: (v) => set({ bedSize: v }) }),
    button({ label: '⬇  STL indir (baskı için)', variant: 'primary', onClick: ctx.actions.exportSTL }),
    button({ label: '⬇  SVG indir (lazer kesim)', onClick: ctx.actions.exportSVG }),
    button({ label: '⬇  Önizleme görüntüsü (PNG)', onClick: ctx.actions.exportPNG }),
    button({ label: '⬇  Ayarları kaydet (JSON)', onClick: ctx.actions.exportJSON }),
    fileButton({ label: '⬆  Ayarları yükle (JSON)', accept: '.json,application/json',
                 onFile: ctx.actions.importJSON }),
    button({ label: 'Varsayılanlara dön', onClick: ctx.actions.reset }),
  ], true);

  container.append(
    shapeGroup, sourceGroup, targetGroup, lampGroup, completionGroup,
    mountGroup, bridgeGroup, viewGroup, outputGroup,
  );

  // ------------------------------------------------------------ koşullu alanlar

  function refreshShape(shape) {
    dyn.corner.style.display = (shape === 'square' || shape === 'rect') ? 'grid' : 'none';
    dyn.arrow.style.display = shape === 'arrow' ? 'grid' : 'none';
    dyn.plateH.style.display = (shape === 'rect' || shape === 'arrow') ? 'grid' : 'none';
  }
  function refreshAperture(on) {
    dyn.aperture.style.display = on ? 'grid' : 'none';
    dyn.apertureHint.style.display = on ? 'block' : 'none';
  }
  function refreshInvert(on) {
    dyn.frame.style.display = on ? 'grid' : 'none';
    dyn.invertHint.style.display = on ? 'block' : 'none';
  }
  function refreshCompletion(on) {
    dyn.view.style.display = on ? 'grid' : 'none';
    dyn.viewHint.style.display = on ? 'block' : 'none';
    dyn.faceOff.style.display = on ? 'grid' : 'none';
  }

  refreshShape(d.plateShape);
  refreshSource(d.source);
  refreshAperture(d.apertureEnabled);
  refreshInvert(d.invert);
  refreshCompletion(d.completeShadow);

  return {
    sync(design) {
      dyn.H.setValue?.(design.ledDistance);
      dyn.bore.setValue?.(design.boreDiameter);
      dyn.ledSize.setValue?.(design.ledSize);
      dyn.lampDia.setValue?.(design.lampDiameter);
      dyn.lampDepth.setValue?.(design.lampDepth);
      dyn.flux.setValue?.(design.luminousFlux);
      dyn.tw.setValue?.(design.targetWallWidth);
      dyn.th.setValue?.(design.targetWallHeight);
      const p = LAMP_PRESETS.find((x) => x.id === design.lampPreset);
      if (p) dyn.lampNote.textContent = p.note;
    },
    setSvgStatus(text) { dyn.svgStatus.textContent = text; },
  };
}
