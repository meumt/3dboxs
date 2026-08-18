/**
 * Levhayı lambaya tutturan parçalar.
 *
 * - Boyun (collar): orta deliğin çevresinde, LED'e doğru uzanan silindirik bilezik.
 *   Lambanın gövdesine geçer ve maskeyi LED'den tam olarak G kadar uzakta tutar.
 *   Yüksekliği doğrudan optiği belirlediği için en kritik ölçüdür.
 *
 * - Kenar bordürü (rim): levhanın kenarında duvara doğru uzanan ince duvar.
 *   Levhayı sertleştirir ve kenardan sızan ışığı toparlar. İsteğe bağlı.
 */
import polygonClipping from 'polygon-clipping';
import { circleRing } from './polygons.js';
import { plateOutline } from './plate.js';

const pc = polygonClipping.default ?? polygonClipping;

/** Halka (annulus) MultiPolygon'u: dış çember + iç çember deliği. */
export function annulus(innerDiameter, wallThickness, segments = 96) {
  const ri = innerDiameter / 2;
  const ro = ri + wallThickness;
  return [[circleRing(ro, 0, 0, segments), circleRing(ri, 0, 0, segments).slice().reverse()]];
}

/**
 * Levha dış hattını içeri kaydırıp bordür halkası üretir.
 * Çember/kare/dikdörtgen için tam, ok biçimi için yaklaşık (ölçek küçültme) çalışır.
 */
export function rimRing({ shape, width, height, cornerRadius, arrowTipRatio, arrowPointLeft, thickness }) {
  const outer = plateOutline({ shape, width, height, cornerRadius, arrowTipRatio, arrowPointLeft });
  const inner = plateOutline({
    shape,
    width: Math.max(1, width - thickness * 2),
    height: Math.max(1, height - thickness * 2),
    cornerRadius: Math.max(0, cornerRadius - thickness),
    arrowTipRatio,
    arrowPointLeft,
  });
  try {
    return pc.difference(outer, inner);
  } catch {
    return [];
  }
}
