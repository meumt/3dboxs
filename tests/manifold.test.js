/**
 * Baskıya uygunluk kanıtı.
 *
 * Su geçirmez (manifold) bir katıda her kenar tam olarak iki üçgen tarafından,
 * birbirine ZIT yönde paylaşılır. Bu testler bunu doğruluyor: geçerse dilimleyici
 * modeli hatasız açar.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import opentype from 'opentype.js';

import { circleRing, roundedRectRing } from '../src/core/polygons.js';
import { extrudeToPositions, geometryFromPositions, meshVolume } from '../src/core/extrude.js';
import { textToPolygons } from '../src/core/text.js';
import { buildModel } from '../src/core/model.js';
import { defaultDesign } from '../src/core/state.js';

const FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf';
function loadFontSync(p) {
  const b = fs.readFileSync(p);
  return opentype.parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
}

/** Kenar eşleşmesini denetler; hataları döndürür. */
function checkManifold(positions) {
  const key = (x, y, z) => `${x.toFixed(4)},${y.toFixed(4)},${z.toFixed(4)}`;
  const edges = new Map();
  const triCount = positions.length / 9;

  for (let t = 0; t < triCount; t++) {
    const o = t * 9;
    const v = [
      key(positions[o], positions[o + 1], positions[o + 2]),
      key(positions[o + 3], positions[o + 4], positions[o + 5]),
      key(positions[o + 6], positions[o + 7], positions[o + 8]),
    ];
    // Yozlaşmış üçgenleri atla (sıfır alanlı; hacme katkısı yok)
    if (v[0] === v[1] || v[1] === v[2] || v[0] === v[2]) continue;
    for (let i = 0; i < 3; i++) {
      const a = v[i], b = v[(i + 1) % 3];
      edges.set(`${a}|${b}`, (edges.get(`${a}|${b}`) ?? 0) + 1);
    }
  }

  let unmatched = 0;
  let duplicated = 0;
  for (const [e, count] of edges) {
    const [a, b] = e.split('|');
    const opposite = edges.get(`${b}|${a}`) ?? 0;
    if (count > 1) duplicated++;
    if (opposite !== count) unmatched++;
  }
  return { unmatched, duplicated, edgeCount: edges.size };
}

test('basit levha su geçirmez', () => {
  const pos = extrudeToPositions([[roundedRectRing(40, 40, 6)]], [], { thickness: 3 });
  const r = checkManifold(pos);
  assert.equal(r.unmatched, 0, `${r.unmatched} kenar eşleşmedi`);
  assert.equal(r.duplicated, 0);
});

test('delikli levha su geçirmez', () => {
  const mp = [[roundedRectRing(60, 60, 4), circleRing(12, 0, 0, 128).reverse()]];
  const pos = extrudeToPositions(mp, [], { thickness: 2.5 });
  const r = checkManifold(pos);
  assert.equal(r.unmatched, 0, `${r.unmatched} kenar eşleşmedi`);
});

test('yazı kesilmiş levha su geçirmez', () => {
  const font = loadFontSync(FONT);
  const design = { ...defaultDesign(), text: 'NO\nWAY', boreDiameter: 30 };
  const model = buildModel(design, { font });
  assert.ok(model.ok, model.errors.join('; '));

  const pos = Array.from(model.geometry.getAttribute('position').array);
  const r = checkManifold(pos);
  assert.equal(r.unmatched, 0, `${r.unmatched} kenar eşleşmedi (${r.edgeCount} kenar)`);
  assert.ok(meshVolume(model.geometry) > 0);
});

test('boyun + bordür dahil tam parça su geçirmez', () => {
  const font = loadFontSync(FONT);
  const design = {
    ...defaultDesign(),
    text: 'BOX',
    plateShape: 'square',
    rimEnabled: true,
    collarEnabled: true,
    boreDiameter: 36,
  };
  const model = buildModel(design, { font });
  assert.ok(model.ok, model.errors.join('; '));
  const pos = Array.from(model.geometry.getAttribute('position').array);
  assert.equal(checkManifold(pos).unmatched, 0);
});

test('kopuk parça kalmıyor (baskıda düşen göbek yok)', () => {
  const font = loadFontSync(FONT);
  for (const text of ['OO', 'BOOB', '800', 'AĞAÇ', 'GÖZ']) {
    const model = buildModel({ ...defaultDesign(), text, boreDiameter: 0 }, { font });
    assert.ok(model.ok, `${text}: ${model.errors.join('; ')}`);
    assert.equal(model.stats.looseParts, 0, `"${text}" için ${model.stats.looseParts} kopuk parça kaldı`);
  }
});

test('optik zinciri uçtan uca tutarlı: duvarda istenen ölçü çıkıyor', () => {
  const font = loadFontSync(FONT);
  const design = {
    ...defaultDesign(),
    text: 'TEST',
    targetWallWidth: 500,
    targetWallHeight: 500,
    ledDistance: 60,
    maskGap: 15,
    lockAspect: true,
  };
  const model = buildModel(design, { font });
  assert.ok(model.ok);
  assert.equal(model.stats.magnification, 4);
  // En-boy kilidi açıkken çizim hedef kutuya sığar, taşmaz.
  assert.ok(model.stats.wallWidth <= 500.001, `duvarda ${model.stats.wallWidth}`);
  assert.ok(model.stats.wallHeight <= 500.001);
  // Ve kutunun en az bir kenarına tam oturur.
  const touches = Math.abs(model.stats.wallWidth - 500) < 0.01 || Math.abs(model.stats.wallHeight - 500) < 0.01;
  assert.ok(touches, 'hedef kutunun bir kenarına oturmalı');
  // Maske ölçüsü × M = duvar ölçüsü
  assert.ok(Math.abs(model.stats.artworkWidth * 4 - model.stats.wallWidth) < 0.001);
});

test('geçersiz optik düzgün hata veriyor, çökmüyor', () => {
  const font = loadFontSync(FONT);
  const model = buildModel({ ...defaultDesign(), ledDistance: 20, maskGap: 40 }, { font });
  assert.equal(model.ok, false);
  assert.ok(model.errors.length > 0);
  assert.equal(model.geometry, null);
});

test('maske levhası hedefle birlikte büyüyor', () => {
  const font = loadFontSync(FONT);
  const small = buildModel({ ...defaultDesign(), targetWallWidth: 300, targetWallHeight: 300 }, { font });
  const big = buildModel({ ...defaultDesign(), targetWallWidth: 900, targetWallHeight: 900 }, { font });
  assert.ok(big.stats.maskPlateWidth > small.stats.maskPlateWidth);
});

test('gölge tamamlama: yüz levhası çizimi GÖRÜNÜR ölçekte taşır, kopya değil', () => {
  const font = loadFontSync(FONT);
  const model = buildModel({
    ...defaultDesign(), text: 'NO\nWAY', completeShadow: true,
    targetWallWidth: 500, targetWallHeight: 500, viewDistance: 2000,
  }, { font });
  assert.ok(model.ok);
  assert.ok(model.face, 'yüz katmanı üretilmeli');

  const s = model.stats;
  // Tamamlama ölçüsü duvardaki ölçüyle aynı mertebede olmalı — maskeninkiyle değil.
  assert.ok(s.completionWidth > s.wallWidth * 0.9,
    `tamamlama ${s.completionWidth}, duvardaki ${s.wallWidth}`);
  assert.ok(s.completionWidth < s.wallWidth, 'paralaks yüzünden bir tık küçük olmalı');
  // Maske çiziminin küçük bir kopyası OLMAMALI — kullanıcının şikâyeti buydu.
  // Tamamlama, maske çiziminin yaklaşık M katı olmalı (yani duvardaki ölçekte).
  assert.ok(s.completionWidth > s.artworkWidth * s.magnification * 0.9,
    `tamamlama ${s.completionWidth}, maske çizimi ${s.artworkWidth}, M=${s.magnification}: kopya üretiliyor`);
});

test('gölge tamamlama: bakış mesafesi arttıkça ölçek duvardakine yakınsar', () => {
  const font = loadFontSync(FONT);
  const near = buildModel({ ...defaultDesign(), viewDistance: 800 }, { font });
  const far = buildModel({ ...defaultDesign(), viewDistance: 5000 }, { font });
  assert.ok(far.stats.completionWidth > near.stats.completionWidth);
  assert.ok(far.stats.completionWidth < far.stats.wallWidth);
  assert.ok(far.stats.completionWidth / far.stats.wallWidth > 0.98);
});

test('gölge tamamlama kapalıyken yüz katmanı üretilmiyor', () => {
  const font = loadFontSync(FONT);
  const model = buildModel({ ...defaultDesign(), completeShadow: false }, { font });
  assert.ok(model.ok);
  assert.equal(model.face, null);
});

test('iki katmanlı parça su geçirmez', () => {
  const font = loadFontSync(FONT);
  for (const text of ['NO\nWAY', 'OPEN', 'GÖZ 88']) {
    const model = buildModel({ ...defaultDesign(), text, completeShadow: true }, { font });
    assert.ok(model.ok, model.errors.join('; '));
    const pos = Array.from(model.geometry.getAttribute('position').array);
    assert.equal(checkManifold(pos).unmatched, 0, `"${text}" açık kenar bıraktı`);
  }
});
