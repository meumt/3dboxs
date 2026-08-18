/**
 * Maskeyi SVG olarak dışa aktarır — lazer kesim / CNC için.
 * Birim mm; viewBox doğrudan gerçek ölçüdür.
 */

export function multiPolygonToSVG(mp, { width, height, margin = 5, title = '3dboxs maske' } = {}) {
  const w = width + margin * 2;
  const h = height + margin * 2;
  const paths = [];

  for (const poly of mp) {
    let d = '';
    for (const ring of poly) {
      ring.forEach(([x, y], i) => {
        // SVG y ekseni aşağı bakar; modelimizde yukarı. Çeviriyoruz.
        const sx = (x + width / 2 + margin).toFixed(3);
        const sy = (height / 2 - y + margin).toFixed(3);
        d += `${i === 0 ? 'M' : 'L'}${sx},${sy} `;
      });
      d += 'Z ';
    }
    if (d) paths.push(`<path d="${d.trim()}" />`);
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg"
     width="${w}mm" height="${h}mm"
     viewBox="0 0 ${w} ${h}">
  <title>${title}</title>
  <g fill="#000000" fill-rule="evenodd" stroke="none">
    ${paths.join('\n    ')}
  </g>
</svg>
`;
}
