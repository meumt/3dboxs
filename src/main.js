import './styles.css';
import { Viewer } from './three/viewer.js';
import { buildPanel } from './ui/panel.js';
import { buildModel } from './core/model.js';
import { loadFont } from './core/text.js';
import { svgToPolygons } from './core/svgimport.js';
import { defaultDesign, loadDesign, saveDesign, applyLampPreset } from './core/state.js';
import { geometryToBinarySTL } from './export/stl.js';
import { multiPolygonToSVG } from './export/svgexport.js';
import { downloadBlob, downloadText, slugify } from './export/download.js';

const viewport = document.getElementById('viewport');
const controls = document.getElementById('controls');
const readout = document.getElementById('readout');
const notesBox = document.getElementById('notes');

let design = loadDesign() ?? defaultDesign();
let font = null;
let svgPolygons = null;
let svgName = '';
let svgSource = '';        // seçenekler değişince yeniden çözebilmek için ham metin
let model = null;
let panel = null;
let pendingNotes = [];     // bir sonraki çizimde bir kez gösterilecek uyarılar

const viewer = new Viewer(viewport);

// ---------------------------------------------------------------- yeniden kur

let rebuildQueued = false;

/** Ağır işi bir sonraki kareye erteleyip yazarken takılmayı önler. */
function scheduleRebuild() {
  if (rebuildQueued) return;
  rebuildQueued = true;
  requestAnimationFrame(() => {
    rebuildQueued = false;
    rebuild();
  });
}

function rebuild() {
  let next;
  try {
    next = buildModel(design, { font, svgPolygons });
  } catch (err) {
    console.error(err);
    showNotes([{ level: 'error', text: `Tasarım kurulamadı: ${err.message}` }]);
    return;
  }

  model = next;

  showNotes([
    ...pendingNotes,
    ...model.errors.map((text) => ({ level: 'error', text })),
    ...model.warnings.map((text) => ({ level: 'warn', text })),
    ...model.diagnostics,
  ]);
  pendingNotes = [];

  if (!model.ok) {
    readout.innerHTML = '';
    return;
  }

  viewer.update(model, design);
  showReadout(model);
  saveDesign(design);
}

// ---------------------------------------------------------------- gösterim

function showNotes(notes) {
  notesBox.innerHTML = '';
  for (const n of notes.slice(0, 4)) {
    const div = document.createElement('div');
    div.className = `note ${n.level}`;
    div.textContent = n.text;
    notesBox.append(div);
  }
}

function showReadout(m) {
  const s = m.stats;
  const rows = [
    ['Büyütme', `<b>${s.magnification.toFixed(2)}×</b>`],
    ['Duvarda', `<b>${Math.round(s.wallWidth)} × ${Math.round(s.wallHeight)}</b> mm`],
    ['Maskede', `${s.artworkWidth.toFixed(1)} × ${s.artworkHeight.toFixed(1)} mm`],
    ['Maske levhası', `${s.maskPlateWidth.toFixed(0)} × ${s.maskPlateHeight.toFixed(0)} mm`],
    ['Görünen levha', `${s.plateWidth.toFixed(0)} × ${s.plateHeight.toFixed(0)} mm`],
  ];

  if (Number.isFinite(s.completionWidth)) {
    rows.push(
      ['Kapattığı alan', `${Math.round(s.occludedDiameter)} mm`],
      ['Tamamlama ölçeği', `<b>${Math.round(s.completionWidth)}</b> mm`],
    );
  }

  rows.push(
    ['Kenar bulanıklığı', `${s.penumbra.toFixed(1)} mm`],
    ['Toplam derinlik', `${s.totalDepth.toFixed(1)} mm`],
    ['Köprü', `${s.bridges}`],
    ['Malzeme', `${s.volumeCm3.toFixed(1)} cm³ · ${s.massGrams.toFixed(0)} g`],
    ['Üçgen', `${s.triangles.toLocaleString('tr-TR')}`],
  );

  readout.innerHTML =
    '<h3>Ölçüler</h3><dl>' +
    rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('') +
    '</dl>';
}

// ---------------------------------------------------------------- eylemler

function set(patch) {
  const fontChanged = patch.fontUrl && patch.fontUrl !== design.fontUrl;
  design = { ...design, ...patch };
  if (fontChanged) setFont(design.fontUrl);
  else scheduleRebuild();
}

async function setFont(url) {
  try {
    font = await loadFont(url);
    scheduleRebuild();
  } catch (err) {
    showNotes([{ level: 'error', text: err.message }]);
  }
}

function baseName() {
  return slugify(design.source === 'svg' ? (svgName || 'logo') : design.text.replace(/\n/g, '-'));
}

const actions = {
  exportSTL() {
    if (!model?.ok) return;
    const stl = geometryToBinarySTL(model.geometry, `3dboxs ${baseName()}`);
    downloadBlob(new Blob([stl], { type: 'model/stl' }), `${baseName()}-golge-kutu.stl`);
  },

  exportSVG() {
    if (!model?.ok) return;
    // Maske ve yüz levhası ayrı düzlemlerde; ikisini de veriyoruz.
    downloadText(
      multiPolygonToSVG(model.mask.polygons, {
        width: model.stats.maskPlateWidth,
        height: model.stats.maskPlateHeight,
        title: `3dboxs ${baseName()} — maske`,
      }),
      `${baseName()}-maske.svg`, 'image/svg+xml',
    );

    if (model.face) {
      downloadText(
        multiPolygonToSVG(model.face.polygons, {
          width: model.stats.plateWidth,
          height: model.stats.plateHeight,
          title: `3dboxs ${baseName()} — yüz levhası`,
        }),
        `${baseName()}-yuz-levhasi.svg`, 'image/svg+xml',
      );
    }
  },

  exportPNG() {
    const a = document.createElement('a');
    a.href = viewer.snapshot();
    a.download = `${baseName()}-onizleme.png`;
    a.click();
  },

  exportJSON() {
    downloadText(JSON.stringify(design, null, 2), `${baseName()}-ayarlar.json`, 'application/json');
  },

  async importJSON(file) {
    try {
      design = { ...defaultDesign(), ...JSON.parse(await file.text()) };
      rebuildPanel();
      await setFont(design.fontUrl);
    } catch (err) {
      showNotes([{ level: 'error', text: `Ayar dosyası okunamadı: ${err.message}` }]);
    }
  },

  reset() {
    design = defaultDesign();
    svgPolygons = null;
    svgSource = '';
    svgName = '';
    rebuildPanel();
    setFont(design.fontUrl);
  },
};

/** Saklanan SVG metnini geçerli seçeneklerle yeniden çözer. */
function parseSVG(label) {
  if (!svgSource) return;
  try {
    const { polygons, warnings } = svgToPolygons(svgSource, {
      lightFillsAreHoles: design.svgLightHoles,
    });
    svgPolygons = polygons;
    panel?.setSvgStatus(`Yüklendi: ${label}`);
    pendingNotes = warnings.map((text) => ({ level: 'warn', text }));
  } catch (err) {
    svgPolygons = null;
    panel?.setSvgStatus(`Hata: ${err.message}`);
    pendingNotes = [{ level: 'error', text: err.message }];
  }
}

async function loadSVG(file) {
  svgSource = await file.text();
  svgName = file.name.replace(/\.svg$/i, '');
  parseSVG(file.name);
  set({ source: 'svg' });
}

function rebuildPanel() {
  controls.innerHTML = '';
  panel = buildPanel(controls, {
    getDesign: () => design,
    set,
    setLampPreset(id) {
      design = applyLampPreset(design, id);
      panel.sync(design);
      scheduleRebuild();
    },
    setSize(w, h) {
      design = { ...design, targetWallWidth: w, targetWallHeight: h };
      panel.sync(design);
      scheduleRebuild();
    },
    setSvgHoles(on) {
      design = { ...design, svgLightHoles: on };
      parseSVG(svgName ? `${svgName}.svg` : 'logo.svg');
      scheduleRebuild();
    },
    loadSVG,
    actions,
  });
  if (svgName) panel.setSvgStatus(`Yüklendi: ${svgName}.svg`);
}

// ---------------------------------------------------------------- görünüm çubuğu

document.querySelectorAll('#viewbar button[data-view]').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#viewbar button[data-view]').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    viewer.setView(btn.dataset.view, model, design);
  });
});
document.getElementById('toggle-rays').addEventListener('change', (e) => {
  viewer.setRaysVisible(e.target.checked);
});
document.getElementById('toggle-mask').addEventListener('change', (e) => {
  viewer.setMaskVisible(e.target.checked);
});

// ---------------------------------------------------------------- başlat

rebuildPanel();
setFont(design.fontUrl);
scheduleRebuild();
