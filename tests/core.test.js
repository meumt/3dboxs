import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import opentype from 'opentype.js';

import { signedArea, multiPolygonArea, circleRing, roundedRectRing, bounds, fitInto } from '../src/core/polygons.js';
import { magnification, maskSizeForWallSize, solve, penumbraWidth } from '../src/core/optics.js';
import { textToPolygons } from '../src/core/text.js';
import { buildPlate } from '../src/core/plate.js';
import { bridgeIslands, countLooseParts } from '../src/core/bridges.js';
import { extrudeToPositions, geometryFromPositions, meshVolume } from '../src/core/extrude.js';
import { geometryToBinarySTL } from '../src/export/stl.js';

const FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf';
function loadFontSync(p) {
  const b = fs.readFileSync(p);
  return opentype.parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
}

test('signedArea: CCW pozitif, CW negatif', () => {
  const ccw = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]];
  assert.equal(signedArea(ccw), 100);
  assert.equal(signedArea([...ccw].reverse()), -100);
});

test('circleRing alanı πr² değerine yakınsar', () => {
  const r = 50;
  const area = Math.abs(signedArea(circleRing(r, 0, 0, 512)));
  assert.ok(Math.abs(area - Math.PI * r * r) / (Math.PI * r * r) < 0.001);
});

test('roundedRectRing köşe yarıçapını kısıtlar', () => {
  const ring = roundedRectRing(20, 20, 999);
  const b = bounds([[ring]]);
  assert.ok(Math.abs(b.width - 20) < 0.01);
  assert.ok(Math.abs(b.height - 20) < 0.01);
});

test('optik: M = H / G ve tersine çevrilebilir', () => {
  const M = magnification({ ledDistance: 60, maskGap: 15 });
  assert.equal(M, 4);
  assert.equal(maskSizeForWallSize(500, M), 125);

  const s = solve({ ledDistance: 60, maskGap: 15, targetWallWidth: 500, targetWallHeight: 500, ledSize: 6 });
  assert.equal(s.magnification, 4);
  assert.equal(s.maskWidth, 125);
  assert.equal(s.maskDistanceFromWall, 45);
  // maskedeki 125 mm duvarda tekrar 500 mm olmalı
  assert.equal(s.maskWidth * s.magnification, 500);
});

test('optik: geçersiz kurulumlar reddedilir', () => {
  assert.ok(Number.isNaN(magnification({ ledDistance: 20, maskGap: 20 })));
  assert.ok(Number.isNaN(magnification({ ledDistance: 20, maskGap: 30 })));
  assert.equal(solve({ ledDistance: 20, maskGap: 30, targetWallWidth: 500, targetWallHeight: 500 }).valid, false);
});

test('yarı gölge büyütmeyle artar', () => {
  assert.equal(penumbraWidth(6, 4), 18);
  assert.ok(penumbraWidth(6, 8) > penumbraWidth(6, 4));
});

test('fitInto en-boy oranını korur', () => {
  const rect = [[roundedRectRing(200, 100)]];
  const fitted = fitInto(rect, 50, 50, 'contain');
  const b = bounds(fitted);
  assert.ok(Math.abs(b.width - 50) < 0.01);
  assert.ok(Math.abs(b.height - 25) < 0.01);
  assert.ok(Math.abs(b.cx) < 1e-6 && Math.abs(b.cy) < 1e-6);
});

test('yazı poligonlara çevrilir ve delikler korunur', () => {
  const font = loadFontSync(FONT);
  const o = textToPolygons(font, 'O', { fontSize: 100 });
  assert.ok(o.length >= 1, 'en az bir poligon');
  assert.equal(o[0].length, 2, '"O" bir dış hat + bir delik olmalı');

  const multi = textToPolygons(font, 'AB\nCD', { fontSize: 100, align: 'center' });
  const b = bounds(multi);
  assert.ok(b.height > 100, 'iki satır tek satırdan yüksek');
});

test('Türkçe karakterler çalışır', () => {
  const font = loadFontSync(FONT);
  const tr = textToPolygons(font, 'ÇĞİÖŞÜ', { fontSize: 100 });
  assert.ok(tr.length >= 6);
});

test('köprüler kopuk adaları gövdeye bağlar', () => {
  const font = loadFontSync(FONT);
  const plate = buildPlate({
    artwork: textToPolygons(font, 'OO', { fontSize: 100 }),
    artworkWidth: 100, artworkHeight: 50,
    shape: 'circle', plateWidth: 160, plateHeight: 160,
    boreDiameter: 0, autoBridge: false,
  });
  assert.ok(countLooseParts(plate.polygons) > 0, 'köprüsüz hâlde göbekler kopuk');

  const bridged = buildPlate({
    artwork: textToPolygons(font, 'OO', { fontSize: 100 }),
    artworkWidth: 100, artworkHeight: 50,
    shape: 'circle', plateWidth: 160, plateHeight: 160,
    boreDiameter: 0, autoBridge: true, bridgeWidth: 2, bridgesPerIsland: 2,
  });
  assert.equal(countLooseParts(bridged.polygons), 0, 'köprüden sonra tek parça');
  assert.ok(bridged.report.bridges > 0);
});

test('köprüleme zaten bağlı geometriyi bozmaz', () => {
  const square = [[roundedRectRing(50, 50)]];
  const r = bridgeIslands(square, { width: 2 });
  assert.equal(r.bridges, 0);
  assert.equal(r.polygons.length, 1);
});

test('extrude: kapalı katı ve doğru hacim üretir', () => {
  const square = [[roundedRectRing(10, 10)]];
  const geo = geometryFromPositions(extrudeToPositions(square, [], { thickness: 3, z0: 0 }));
  const vol = meshVolume(geo);
  assert.ok(Math.abs(vol - 300) < 0.001, `hacim 300 mm³ olmalı, ${vol} çıktı`);
});

test('extrude: delikli parçanın hacmi delik kadar azalır', () => {
  const withHole = [[roundedRectRing(20, 20), circleRing(5, 0, 0, 256).reverse()]];
  const geo = geometryFromPositions(extrudeToPositions(withHole, [], { thickness: 2 }));
  const expected = (400 - Math.PI * 25) * 2;
  const vol = meshVolume(geo);
  assert.ok(Math.abs(vol - expected) / expected < 0.005, `beklenen ~${expected.toFixed(1)}, çıkan ${vol.toFixed(1)}`);
});

test('extrude: üçgen sayısı çift ve pozisyonlar 3 ile bölünür', () => {
  const square = [[roundedRectRing(10, 10)]];
  const pos = extrudeToPositions(square, [], { thickness: 1 });
  assert.equal(pos.length % 9, 0);
});

test('STL: başlık, üçgen sayısı ve dosya boyutu doğru', () => {
  const square = [[roundedRectRing(10, 10)]];
  const geo = geometryFromPositions(extrudeToPositions(square, [], { thickness: 2 }));
  const buf = geometryToBinarySTL(geo, 'test');
  const view = new DataView(buf);
  const count = view.getUint32(80, true);
  assert.equal(count, geo.getAttribute('position').count / 3);
  assert.equal(buf.byteLength, 84 + count * 50);
});

test('levha alanı: kesilen alan levhadan küçük olmalı', () => {
  const font = loadFontSync(FONT);
  const plate = buildPlate({
    artwork: textToPolygons(font, 'NO WAY', { fontSize: 100 }),
    artworkWidth: 120, artworkHeight: 40,
    shape: 'circle', plateWidth: 160, plateHeight: 160,
    boreDiameter: 30, autoBridge: true,
  });
  const outlineArea = multiPolygonArea(plate.outline);
  const solidArea = multiPolygonArea(plate.polygons);
  assert.ok(solidArea < outlineArea, 'yazı gerçekten kesilmiş olmalı');
  assert.ok(solidArea > outlineArea * 0.3, 'levhanın çoğu ayakta kalmalı');
});
