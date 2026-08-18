/**
 * 3B sahne.
 *
 * Dünya koordinatları modelinkiyle aynı hizada (mm):
 *   z = 0            duvar yüzeyi
 *   z = H − G        maskenin duvara bakan yüzü
 *   z = H            LED çipi
 *   +z               odaya doğru
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { renderWallTexture } from './projection.js';

export class Viewer {
  constructor(container) {
    this.container = container;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#0d1015');

    this.camera = new THREE.PerspectiveCamera(38, 1, 1, 20000);
    this.camera.position.set(280, 180, 780);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.target.set(0, 0, 60);

    // Maskeyi görünür kılan yumuşak dolgu ışığı (odadaki ortam ışığını temsil eder).
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    const key = new THREE.DirectionalLight(0xffffff, 0.9);
    key.position.set(200, 300, 600);
    this.scene.add(key);

    // --- duvar ---
    this.wallTexture = null;
    this.wallMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
    this.wall = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.wallMaterial);
    this.wall.position.z = 0;
    this.scene.add(this.wall);

    // --- maske ---
    this.maskMaterial = new THREE.MeshStandardMaterial({
      color: 0x2b2f36, roughness: 0.72, metalness: 0.04, side: THREE.DoubleSide,
    });
    this.mask = new THREE.Mesh(new THREE.BufferGeometry(), this.maskMaterial);
    this.scene.add(this.mask);

    // --- yüz levhasının arkasındaki aydınlık boşluk ---
    // Kesiklerden bu görünür; tamamlama parçalarının parlamasını sağlar.
    this.glowMaterial = new THREE.MeshBasicMaterial({ color: 0xffd9a0, toneMapped: false });
    this.glow = new THREE.Mesh(new THREE.BufferGeometry(), this.glowMaterial);
    this.scene.add(this.glow);

    // --- LED işareti ---
    this.led = new THREE.Mesh(
      new THREE.SphereGeometry(3, 20, 16),
      new THREE.MeshBasicMaterial({ color: 0xfff0c0, toneMapped: false }),
    );
    this.scene.add(this.led);

    // --- optik yardımcı çizgiler ---
    this.rays = new THREE.LineSegments(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: 0xffc46b, transparent: true, opacity: 0.35 }),
    );
    this.rays.visible = false;
    this.scene.add(this.rays);

    this._onResize = this._onResize.bind(this);
    window.addEventListener('resize', this._onResize);
    this._resizeObserver = new ResizeObserver(this._onResize);
    this._resizeObserver.observe(container);
    this._onResize();

    this._animate = this._animate.bind(this);
    this.renderer.setAnimationLoop(this._animate);
  }

  _onResize() {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  _animate() {
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  /**
   * Sahneyi yeni modele göre günceller.
   * @param {object} model  buildModel() çıktısı
   * @param {object} design
   */
  update(model, design) {
    if (!model?.ok) return;

    const H = design.ledDistance;
    const G = design.maskGap;
    const M = model.stats.magnification;

    // Duvarın kapsayacağı alan: siluet ve hedefin ikisini de rahatça alsın.
    const span = Math.max(
      model.stats.silhouetteWidth,
      model.stats.wallWidth,
      model.stats.wallHeight,
      design.targetWallWidth,
      design.targetWallHeight,
    ) * 1.5 + 200;

    // --- duvar dokusu ---
    // Işık yolunda iki katman var; ikisi de deseni şekillendiriyor.
    const layers = [
      { polygons: model.mask.polygons, magnification: M, penumbra: model.stats.penumbra },
    ];
    if (model.face) {
      const Mf = model.stats.faceMagnification;
      layers.push({
        polygons: model.face.polygons,
        magnification: Mf,
        penumbra: design.ledSize * Math.max(0, Mf - 1),
      });
    }

    const canvas = renderWallTexture(layers, {
      ledDistance: H,
      spanMm: span,
      size: 2048,
      lightColor: design.lightColor,
      wallColor: design.wallColor,
      intensity: design.intensity,
      exposure: design.exposure,
    });

    this.wallTexture?.dispose();
    this.wallTexture = new THREE.CanvasTexture(canvas);
    this.wallTexture.colorSpace = THREE.SRGBColorSpace;
    this.wallTexture.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    this.wallMaterial.map = this.wallTexture;
    this.wallMaterial.needsUpdate = true;

    this.wall.geometry.dispose();
    this.wall.geometry = new THREE.PlaneGeometry(span, span);

    // --- maske ---
    this.mask.geometry.dispose();
    this.mask.geometry = model.geometry;
    this.mask.position.z = H - G;      // yerel z=0 duvara bakan yüz

    this.glow.geometry.dispose();
    if (model.glowGeometry) {
      this.glow.geometry = model.glowGeometry;
      this.glow.position.z = H - G;
      this.glow.visible = true;
      this.glowMaterial.color.set(design.lightColor);
    } else {
      this.glow.geometry = new THREE.BufferGeometry();
      this.glow.visible = false;
    }

    // --- LED ---
    this.led.position.set(0, 0, H);

    // --- ışınlar ---
    this._updateRays(model, H, M, span);

    this.controls.target.set(0, 0, (H - G) * 0.5);
  }

  /** Levha kenarından duvara giden örnek ışınlar — büyütmeyi görselleştirir. */
  _updateRays(model, H, M, span) {
    const outline = (model.face ?? model.mask).outline?.[0]?.[0] ?? [];
    if (!outline.length) return;
    const step = Math.max(1, Math.floor(outline.length / 48));
    const pts = [];
    for (let i = 0; i < outline.length - 1; i += step) {
      const [x, y] = outline[i];
      pts.push(0, 0, H);                       // LED
      pts.push(x * M, y * M, 0);               // duvardaki iz
    }
    this.rays.geometry.dispose();
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    this.rays.geometry = g;
  }

  setRaysVisible(visible) { this.rays.visible = visible; }
  setMaskVisible(visible) {
    this.mask.visible = visible;
    this.glow.visible = visible && this.glow.geometry.getAttribute('position') != null;
  }

  /** Hazır kamera açıları. */
  setView(name, model, design) {
    const span = Math.max(400, model?.stats?.silhouetteWidth ?? 600);
    const H = model?.stats ? this.led.position.z : 60;
    switch (name) {
      case 'front':
        // Tamamlama SADECE belirtilen bakış mesafesinden hizalanır (geometrik
        // olarak zorunlu). Bu yüzden kamerayı tam oraya koyuyoruz: gördüğün şey,
        // odada o mesafeden bakınca göreceğin şey.
        this.camera.position.set(0, 0, design?.viewDistance ?? span * 2.1);
        this.controls.target.set(0, 0, 0);
        break;
      case 'side':
        this.camera.position.set(span * 1.2, span * 0.15, H * 3);
        this.controls.target.set(0, 0, H * 0.5);
        break;
      case 'detail':
        this.camera.position.set(H * 2.2, H * 1.6, H * 3.2);
        this.controls.target.set(0, 0, H * 0.6);
        break;
      case 'perspective':
      default:
        this.camera.position.set(span * 0.45, span * 0.32, span * 1.25);
        this.controls.target.set(0, 0, H * 0.5);
        break;
    }
    this.camera.updateProjectionMatrix();
  }

  /** Görüntüyü PNG olarak alır. */
  snapshot() {
    this.renderer.render(this.scene, this.camera);
    return this.renderer.domElement.toDataURL('image/png');
  }

  dispose() {
    this.renderer.setAnimationLoop(null);
    window.removeEventListener('resize', this._onResize);
    this._resizeObserver.disconnect();
    this.renderer.dispose();
  }
}
