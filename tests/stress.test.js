/**
 * Geniş tarama: farklı yazı, biçim ve ayar kombinasyonlarında üretilen katının
 * DAİMA su geçirmez ve tek parça olduğunu doğrular. Bu, "STL'i bas" vaadinin
 * asıl güvencesi.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import opentype from 'opentype.js';

import { buildModel } from '../src/core/model.js';
import { defaultDesign } from '../src/core/state.js';
import { countOpenEdges } from '../src/core/seal.js';

const FONTS = [
  '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
  '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf',
  '/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf',
];

function loadFontSync(p) {
  const b = fs.readFileSync(p);
  return opentype.parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
}

const TEXTS = [
  'NO\nWAY', 'FUCK\nYOU', 'BOX', 'OPEN', 'HELLO\nWORLD', '888', 'OOO',
  'AĞAÇ', 'GÜNAYDIN', 'İSTANBUL', 'ÇÖZÜM', 'ŞŞŞ',
  'A', 'O', 'i', 'W', '@#%&', '2024', 'a b c',
  'ÇOK\nUZUN\nBIR\nYAZI', 'Ig', 'Bq',
];

const SHAPES = ['circle', 'square', 'rect', 'arrow'];

test('tüm yazılarda katı su geçirmez ve tek parça', () => {
  const font = loadFontSync(FONTS[0]);
  const failures = [];

  for (const text of TEXTS) {
    const model = buildModel({ ...defaultDesign(), text }, { font });
    if (!model.ok) { failures.push(`${text}: kurulamadı — ${model.errors.join('; ')}`); continue; }
    const pos = Array.from(model.geometry.getAttribute('position').array);
    const open = countOpenEdges(pos);
    if (open > 0) failures.push(`"${text}": ${open} açık kenar`);
    if (model.stats.looseParts > 0) failures.push(`"${text}": ${model.stats.looseParts} kopuk parça`);
  }

  assert.equal(failures.length, 0, '\n' + failures.join('\n'));
});

test('tüm levha biçimlerinde su geçirmez', () => {
  const font = loadFontSync(FONTS[0]);
  const failures = [];

  for (const plateShape of SHAPES) {
    for (const rimEnabled of [false, true]) {
      const model = buildModel(
        { ...defaultDesign(), text: 'NO\nWAY', plateShape, rimEnabled }, { font },
      );
      if (!model.ok) { failures.push(`${plateShape}/rim=${rimEnabled}: kurulamadı`); continue; }
      const open = countOpenEdges(Array.from(model.geometry.getAttribute('position').array));
      if (open > 0) failures.push(`${plateShape} (bordür=${rimEnabled}): ${open} açık kenar`);
    }
  }
  assert.equal(failures.length, 0, '\n' + failures.join('\n'));
});

test('tüm fontlarda su geçirmez', () => {
  const failures = [];
  for (const path of FONTS) {
    const font = loadFontSync(path);
    for (const text of ['NO\nWAY', 'OPEN 88', 'ÇÖZÜM']) {
      const model = buildModel({ ...defaultDesign(), text }, { font });
      if (!model.ok) { failures.push(`${path}/${text}: kurulamadı`); continue; }
      const open = countOpenEdges(Array.from(model.geometry.getAttribute('position').array));
      if (open > 0) failures.push(`${path.split('/').pop()} "${text}": ${open} açık kenar`);
    }
  }
  assert.equal(failures.length, 0, '\n' + failures.join('\n'));
});

test('optik ayarları taranınca da su geçirmez kalıyor', () => {
  const font = loadFontSync(FONTS[0]);
  const failures = [];

  for (const ledDistance of [30, 55, 90]) {
    for (const maskGap of [6, 14, 25]) {
      if (maskGap >= ledDistance) continue;
      for (const targetWallWidth of [250, 500, 900]) {
        const model = buildModel({
          ...defaultDesign(), text: 'BOO', ledDistance, maskGap,
          targetWallWidth, targetWallHeight: targetWallWidth,
        }, { font });
        if (!model.ok) { failures.push(`H=${ledDistance} G=${maskGap} W=${targetWallWidth}: kurulamadı`); continue; }
        const open = countOpenEdges(Array.from(model.geometry.getAttribute('position').array));
        if (open > 0) failures.push(`H=${ledDistance} G=${maskGap} W=${targetWallWidth}: ${open} açık kenar`);
        // Duvardaki ölçü daima hedefi aşmamalı
        if (model.stats.wallWidth > targetWallWidth + 0.01) {
          failures.push(`H=${ledDistance} G=${maskGap}: duvarda ${model.stats.wallWidth} > ${targetWallWidth}`);
        }
      }
    }
  }
  assert.equal(failures.length, 0, '\n' + failures.join('\n'));
});

test('köprü ayarları taranınca kopuk parça kalmıyor', () => {
  const font = loadFontSync(FONTS[0]);
  const failures = [];
  for (const bridgeWidth of [0.8, 1.8, 3.0]) {
    for (const bridgesPerIsland of [1, 2, 3]) {
      const model = buildModel({
        ...defaultDesign(), text: 'GÖZ 800', bridgeWidth, bridgesPerIsland,
      }, { font });
      if (!model.ok) { failures.push(`w=${bridgeWidth} n=${bridgesPerIsland}: kurulamadı`); continue; }
      if (model.stats.looseParts > 0) {
        failures.push(`w=${bridgeWidth} n=${bridgesPerIsland}: ${model.stats.looseParts} kopuk parça`);
      }
      const open = countOpenEdges(Array.from(model.geometry.getAttribute('position').array));
      if (open > 0) failures.push(`w=${bridgeWidth} n=${bridgesPerIsland}: ${open} açık kenar`);
    }
  }
  assert.equal(failures.length, 0, '\n' + failures.join('\n'));
});
