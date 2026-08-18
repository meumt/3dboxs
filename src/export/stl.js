/**
 * İkili STL yazıcı.
 *
 * Geometri indekssiz üçgen listesi olarak gelir (bkz. core/extrude.js).
 * STL'de birim yoktur; dilimleyiciler mm varsayar — bizim birimimiz de mm.
 */

export function geometryToBinarySTL(geometry, header = '3dboxs') {
  const pos = geometry.getAttribute('position');
  const triangleCount = Math.floor(pos.count / 3);
  const buffer = new ArrayBuffer(84 + triangleCount * 50);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);

  // 80 baytlık başlık
  const headerBytes = new TextEncoder().encode(header.slice(0, 79));
  bytes.set(headerBytes, 0);
  view.setUint32(80, triangleCount, true);

  let offset = 84;
  for (let i = 0; i < triangleCount; i++) {
    const i0 = i * 3;
    const ax = pos.getX(i0),     ay = pos.getY(i0),     az = pos.getZ(i0);
    const bx = pos.getX(i0 + 1), by = pos.getY(i0 + 1), bz = pos.getZ(i0 + 1);
    const cx = pos.getX(i0 + 2), cy = pos.getY(i0 + 2), cz = pos.getZ(i0 + 2);

    // Yüzey normali (sağ el kuralı)
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len; ny /= len; nz /= len;

    view.setFloat32(offset, nx, true);      offset += 4;
    view.setFloat32(offset, ny, true);      offset += 4;
    view.setFloat32(offset, nz, true);      offset += 4;
    for (const [x, y, z] of [[ax, ay, az], [bx, by, bz], [cx, cy, cz]]) {
      view.setFloat32(offset, x, true);     offset += 4;
      view.setFloat32(offset, y, true);     offset += 4;
      view.setFloat32(offset, z, true);     offset += 4;
    }
    view.setUint16(offset, 0, true);        offset += 2;
  }

  return buffer;
}
