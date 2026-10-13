/**
 * 3D «внутри здания»: цех дробилки, обогатительной фабрики и гаража. Оборудование собрано из простых
 * фигур (в стиле сцены карьера) и живёт по данным двойника: разгрузка самосвала, вращение
 * дробилки и мельниц, уровень в бункере, руда на конвейерах, пена во флотации. При простое
 * всё останавливается и загораются красные маяки.
 *
 * Размеры — в метрах. Лёгкий режим (без видеокарты): без сглаживания, точечных светильников
 * и с меньшим числом частиц, не чаще 30 кадров/с.
 */
import * as THREE from 'three';
import { CSS2DObject, CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { Simulation } from '../sim';
import { fmtInt } from '../ui/format';
import { MATERIAL_COLOR, TRUCK_COLOR } from '../ui/theme';
import { EQUIP_SCALE, makeTruck, ROCK_GEO, type TruckModel } from './models';

export type InteriorKind = 'crusher' | 'plant' | 'garage';

const std = (color: string, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.7, metalness: 0.2, ...extra });

const M = {
  floor: std('#5d5f63', { roughness: 0.95 }),
  concrete: std('#8f8e89', { roughness: 0.95 }),
  wall: std('#3d4651', { roughness: 0.8 }),
  steel: std('#8d959e', { metalness: 0.55, roughness: 0.4 }),
  dark: std('#2a2d32', { roughness: 0.8 }),
  yellow: std('#e0a526', { roughness: 0.5 }),
  green: std('#3f7d5a', { roughness: 0.6 }),
  blue: std('#2f6f9a', { roughness: 0.55 }),
  belt: std('#1b1c1f', { roughness: 0.95 }),
  glass: new THREE.MeshStandardMaterial({ color: '#9fb8cc', transparent: true, opacity: 0.18, roughness: 0.1, metalness: 0.1, side: THREE.DoubleSide, depthWrite: false }),
  ore: std(MATERIAL_COLOR.sulfide, { roughness: 1, flatShading: true }),
  slurry: std('#5b5a52', { roughness: 0.4 }),
  froth: std('#c9c7a8', { roughness: 0.9 }),
  conc: std('#7a8a3e', { roughness: 0.6 }),
};

function box(w: number, h: number, d: number, mat: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  return m;
}

function cyl(rt: number, rb: number, h: number, mat: THREE.Material, seg = 24, open = false): THREE.Mesh {
  return new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg, 1, open), mat);
}

/** Конвейер по ломаной: лента + ролики; руда едет по точкам ленты. */
class Conveyor {
  readonly group = new THREE.Group();
  private readonly pts: THREE.Vector3[];
  private readonly lens: number[] = [];
  private readonly total: number;
  private readonly rocks: THREE.InstancedMesh;
  private readonly n: number;
  private offset = 0;
  private readonly tmp = new THREE.Object3D();

  constructor(points: [number, number, number][], count: number) {
    this.pts = points.map((p) => new THREE.Vector3(...p));
    for (let i = 0; i < this.pts.length - 1; i++) {
      const a = this.pts[i];
      const b = this.pts[i + 1];
      const len = a.distanceTo(b);
      this.lens.push(len);
      const mid = a.clone().add(b).multiplyScalar(0.5);
      const belt = box(len, 0.35, 2.2, M.belt);
      belt.position.copy(mid);
      belt.lookAt(b);
      belt.rotateY(Math.PI / 2);
      this.group.add(belt);
      // Боковины и стойки.
      const frame = box(len, 0.5, 2.6, M.steel);
      frame.position.copy(mid).add(new THREE.Vector3(0, -0.45, 0));
      frame.quaternion.copy(belt.quaternion);
      this.group.add(frame);
      for (let k = 0; k <= Math.floor(len / 6); k++) {
        const p = a.clone().lerp(b, len > 0 ? (k * 6) / len : 0);
        if (p.y > 1) this.group.add(box(0.35, p.y - 0.6, 0.35, M.steel, p.x, (p.y - 0.6) / 2, p.z + 1.1), box(0.35, p.y - 0.6, 0.35, M.steel, p.x, (p.y - 0.6) / 2, p.z - 1.1));
      }
    }
    this.total = this.lens.reduce((s, l) => s + l, 0);
    this.n = count;
    this.rocks = new THREE.InstancedMesh(ROCK_GEO, M.ore, count);
    this.group.add(this.rocks);
    this.place();
  }

  private at(d: number): THREE.Vector3 {
    let r = ((d % this.total) + this.total) % this.total;
    for (let i = 0; i < this.lens.length; i++) {
      if (r <= this.lens[i]) return this.pts[i].clone().lerp(this.pts[i + 1], r / this.lens[i]);
      r -= this.lens[i];
    }
    return this.pts[this.pts.length - 1].clone();
  }

  private place(): void {
    for (let i = 0; i < this.n; i++) {
      const p = this.at(this.offset + (i * this.total) / this.n);
      this.tmp.position.set(p.x, p.y + 0.55, p.z + (((i * 37) % 7) - 3) * 0.18);
      const s = 0.38 + ((i * 13) % 5) * 0.06;
      this.tmp.scale.set(s, s * 0.8, s);
      this.tmp.rotation.set(i, i * 2, i * 3);
      this.tmp.updateMatrix();
      this.rocks.setMatrixAt(i, this.tmp.matrix);
    }
    this.rocks.instanceMatrix.needsUpdate = true;
  }

  /** speed — м/с ленты; visible — есть ли руда на ленте. */
  update(dt: number, speed: number, loaded: boolean): void {
    this.rocks.visible = loaded;
    if (speed <= 0) return;
    this.offset += dt * speed;
    this.place();
  }
}

/** Маяк: зелёный — работа, красный мигающий — простой. */
function beacon(x: number, y: number, z: number): { mesh: THREE.Mesh; mat: THREE.MeshStandardMaterial } {
  const mat = new THREE.MeshStandardMaterial({ color: '#22c55e', emissive: '#22c55e', emissiveIntensity: 1.6 });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.55, 14, 10), mat);
  mesh.position.set(x, y, z);
  return { mesh, mat };
}

export class InteriorScene {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly labels: CSS2DRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(45, 1, 0.5, 600);
  private readonly controls: OrbitControls;
  private readonly ro: ResizeObserver;
  private raf = 0;
  private last = performance.now();
  private lastRender = 0;
  private readonly light: boolean;
  private readonly updaters: ((dt: number, now: number) => void)[] = [];
  private readonly labelObjs: { obj: CSS2DObject; render: () => string }[] = [];
  private labelTick = 0;

  constructor(
    private readonly container: HTMLElement,
    private readonly sim: Simulation,
    kind: InteriorKind,
    opts: { light?: boolean } = {},
  ) {
    this.light = !!opts.light;
    this.renderer = new THREE.WebGLRenderer({ antialias: !this.light });
    this.renderer.setPixelRatio(this.light ? 1 : Math.min(window.devicePixelRatio, 1.5));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    this.renderer.domElement.style.display = 'block';
    container.appendChild(this.renderer.domElement);
    this.labels = new CSS2DRenderer();
    Object.assign(this.labels.domElement.style, { position: 'absolute', inset: '0', pointerEvents: 'none' });
    container.appendChild(this.labels.domElement);

    this.scene.background = new THREE.Color('#0f1419');
    this.scene.fog = new THREE.Fog('#0f1419', 140, 320);
    this.scene.add(new THREE.HemisphereLight('#dfe9f5', '#3a3128', 1.5));
    const sun = new THREE.DirectionalLight('#fff1d8', 1.6);
    sun.position.set(30, 60, 40);
    this.scene.add(sun);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = 1.45;
    this.controls.minDistance = 15;
    this.controls.maxDistance = 200;

    this.buildHall(kind === 'crusher' ? 110 : kind === 'plant' ? 130 : 150);
    if (kind === 'crusher') this.buildCrusher();
    else if (kind === 'plant') this.buildPlant();
    else this.buildGarage();

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(container);
    this.resize();
    this.raf = requestAnimationFrame(this.frame);
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    this.controls.dispose();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry && m.geometry !== ROCK_GEO) m.geometry.dispose();
    });
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.labels.domElement.remove();
  }

  // ───────────────────────────── общее ─────────────────────────────

  private resize(): void {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h);
    this.labels.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private frame = (now: number): void => {
    this.raf = requestAnimationFrame(this.frame);
    if (this.light && now - this.lastRender < 32) return;
    this.lastRender = now;
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    for (const u of this.updaters) u(dt, now);
    if (now - this.labelTick > 250) {
      this.labelTick = now;
      for (const l of this.labelObjs) (l.obj.element as HTMLElement).innerHTML = l.render();
    }
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    this.labels.render(this.scene, this.camera);
  };

  private label(x: number, y: number, z: number, render: () => string): void {
    const el = document.createElement('div');
    el.className = 'holo';
    const obj = new CSS2DObject(el);
    obj.position.set(x, y, z);
    this.scene.add(obj);
    this.labelObjs.push({ obj, render });
  }

  private lamp(x: number, y: number, z: number): void {
    this.scene.add(box(1.6, 0.3, 1.6, M.dark, x, y, z));
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.45, 10, 8), new THREE.MeshStandardMaterial({ color: '#fff4d6', emissive: '#ffe2a3', emissiveIntensity: 2 }));
    bulb.position.set(x, y - 0.4, z);
    this.scene.add(bulb);
    if (!this.light) {
      const p = new THREE.PointLight('#ffd9a0', 120, 60, 1.6);
      p.position.set(x, y - 1.5, z);
      this.scene.add(p);
    }
  }

  /** Цех: пол с разметкой, задняя и боковая стены, фермы перекрытия, светильники. */
  private buildHall(len: number): void {
    const floor = box(len, 0.4, 70, M.floor, 0, -0.2, 0);
    this.scene.add(floor);
    for (let x = -len / 2 + 5; x < len / 2; x += 10) this.scene.add(box(0.25, 0.05, 70, M.dark, x, 0.02, 0));
    this.scene.add(box(len, 0.06, 1.2, M.yellow, 0, 0.03, 16));
    this.scene.add(box(len, 32, 1, M.wall, 0, 16, -35));
    this.scene.add(box(1, 32, 70, M.wall, -len / 2, 16, 0));
    for (let x = -len / 2 + 6; x < len / 2; x += 12) {
      this.scene.add(box(0.8, 32, 0.8, M.steel, x, 16, -34));
      this.scene.add(box(0.6, 0.9, 70, M.steel, x, 31.5, 0));
      this.lamp(x, 30.5, -6);
    }
    this.scene.add(box(len, 1.2, 0.6, M.steel, 0, 31.5, -34));
  }

  // ───────────────────────────── дробилка ─────────────────────────────

  private buildCrusher(): void {
    const sim = this.sim;
    const c = sim.crusher;
    const cfg = sim.cfg;

    // Площадка разгрузки на эстакаде.
    this.scene.add(box(28, 1.2, 20, M.concrete, -30, 14, 0));
    for (const [x, z] of [[-42, -8], [-42, 8], [-18, -8], [-18, 8]]) this.scene.add(box(1.4, 14, 1.4, M.concrete, x, 7, z));
    this.scene.add(box(1.2, 1.4, 20, M.yellow, -16.4, 15.3, 0)); // упор для колёс
    // Самосвал задом к воронке (нос — по −X), реальный размер.
    const truck: TruckModel = makeTruck();
    truck.root.scale.setScalar(1 / EQUIP_SCALE);
    truck.root.rotation.y = Math.PI;
    truck.root.position.set(-25, 14.6, 0);
    truck.ring.visible = false;
    this.scene.add(truck.root);

    // Приёмная воронка и конусная дробилка под ней.
    const hopperMat = M.steel.clone();
    hopperMat.side = THREE.DoubleSide;
    const hopper = cyl(8, 2.6, 7, hopperMat, 4, true);
    hopper.rotation.y = Math.PI / 4;
    hopper.position.set(-8, 11.5, 0);
    this.scene.add(hopper);
    const housing = cyl(4.2, 4.6, 6, M.blue, 28);
    housing.position.set(-8, 3, 0);
    this.scene.add(housing);
    this.scene.add(box(5, 3, 3, M.dark, -1.5, 1.5, -5)); // привод
    const mantle = new THREE.Group();
    const cone = cyl(0.6, 3.4, 3.2, M.steel, 20);
    cone.position.y = 1.6;
    mantle.add(cone);
    mantle.position.set(-8, 6, 0);
    this.scene.add(mantle);
    const bCrusher = beacon(-8, 15.8, -4.2);
    this.scene.add(bCrusher.mesh);

    // Падающая из кузова руда.
    const fallN = this.light ? 10 : 22;
    const fall = new THREE.InstancedMesh(ROCK_GEO, M.ore, fallN);
    this.scene.add(fall);
    const fallT = Array.from({ length: fallN }, (_, i) => i / fallN);
    const tmp = new THREE.Object3D();

    // Конвейер: дробилка → верх бункера; бункер → фабрика.
    const up = new Conveyor([[-4, 1.2, 0], [14, 22, 0]], this.light ? 14 : 26);
    this.scene.add(up.group);
    const out = new Conveyor([[22, 1.6, 0], [54, 1.6, 0]], this.light ? 12 : 22);
    this.scene.add(out.group);

    // Бункер дроблёной руды: прозрачные стенки, внутри — руда по уровню.
    const binR = 7;
    const binH = 20;
    const shell = cyl(binR, binR, binH, M.glass, 32, true);
    shell.position.set(18, binH / 2 + 2, 0);
    this.scene.add(shell);
    for (const y of [2, binH + 2]) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(binR, 0.3, 8, 40), M.steel);
      ring.rotation.x = Math.PI / 2;
      ring.position.set(18, y, 0);
      this.scene.add(ring);
    }
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
      this.scene.add(box(0.6, binH + 2, 0.6, M.steel, 18 + Math.cos(a) * binR, binH / 2 + 1, Math.sin(a) * binR));
    }
    const fillMat = std(MATERIAL_COLOR.sulfide, { roughness: 1, flatShading: true });
    const fill = cyl(binR - 0.4, binR - 0.4, 1, fillMat, 32);
    this.scene.add(fill);
    const cap = cyl(binR - 0.4, binR - 0.4, 0.2, fillMat, 9); // «неровная» поверхность руды
    this.scene.add(cap);
    this.scene.add(box(5, 1.2, 3, M.dark, 20, 2.4, 0)); // питатель под бункером
    const bBin = beacon(18, binH + 3.2, 0);
    this.scene.add(bBin.mesh);

    // Проём в стене к фабрике.
    this.scene.add(box(1, 8, 6, M.dark, 55, 4, 0));

    let tip = 0;
    this.updaters.push((dt, now) => {
      const dumping = c.active.length > 0;
      const starved = c.binT <= 0.01;
      const blink = Math.floor(now / 400) % 2 === 0;
      // Самосвал: опрокидывание кузова при разгрузке.
      truck.root.visible = dumping || c.queue.length > 0;
      truck.heap.visible = dumping && tip < 0.6;
      tip += ((dumping ? 0.85 : 0) - tip) * Math.min(1, dt * 2.5);
      truck.body.rotation.z = tip;
      // Руда сыплется в воронку.
      fall.visible = dumping && tip > 0.45;
      if (fall.visible) {
        for (let i = 0; i < fallN; i++) {
          fallT[i] = (fallT[i] + dt * 0.9) % 1;
          const t = fallT[i];
          tmp.position.set(-15 + t * 6 + Math.sin(i * 7) * 0.8, 15 - t * t * 9, Math.cos(i * 5) * 2.2);
          tmp.scale.setScalar(0.5 + (i % 3) * 0.15);
          tmp.rotation.set(t * 6 + i, i, t * 4);
          tmp.updateMatrix();
          fall.setMatrixAt(i, tmp.matrix);
        }
        fall.instanceMatrix.needsUpdate = true;
      }
      // Дробилка: конус «качается», когда есть руда в разгрузке.
      const crushing = dumping;
      mantle.rotation.y += dt * (crushing ? 6 : 0.6);
      mantle.rotation.z = crushing ? Math.sin(now / 90) * 0.06 : 0;
      up.update(dt, crushing ? 2.6 : 0, crushing);
      out.update(dt, starved ? 0 : 2.6, !starved);
      // Уровень руды в бункере, цвет — по качеству.
      const pct = Math.max(0.002, Math.min(1, c.binT / c.binCapT));
      const h = pct * (binH - 0.6);
      fill.scale.y = h;
      fill.position.set(18, 2 + h / 2, 0);
      cap.position.set(18, 2 + h + 0.1, 0);
      cap.visible = pct > 0.01;
      const inBand = Math.abs(sim.binGrade - cfg.grade.targetPct) <= cfg.grade.bandPct;
      fillMat.color.set(pct < 0.2 ? '#b45309' : inBand ? MATERIAL_COLOR.sulfide : '#d6a24a');
      // Маяки.
      bCrusher.mat.color.set(crushing ? '#22c55e' : '#f59e0b');
      bCrusher.mat.emissive.set(crushing ? '#22c55e' : '#f59e0b');
      const binCol = starved ? (blink ? '#ef4444' : '#3b0d0d') : pct < 0.2 ? '#f59e0b' : '#22c55e';
      bBin.mat.color.set(binCol);
      bBin.mat.emissive.set(binCol);
    });

    // Подписи.
    this.label(-30, 24, 0, () => {
      const a = c.active[0];
      return `<b>ПЛОЩАДКА РАЗГРУЗКИ</b><br>${a ? `разгружается <span class="v">${sim.trucks[a.truck]?.name ?? ''}</span>` : 'свободно'}<br>ждут: <span class="v">${c.queue.length}</span>`;
    });
    this.label(-8, 1, 7, () => `<b>КОНУСНАЯ ДРОБИЛКА</b><br>${c.active.length ? '<span class="ok">ДРОБИТ</span>' : c.binT <= 0.01 ? '<span class="bad">ЖДЁТ РУДУ</span>' : 'вхолостую'}`);
    this.label(27, binH - 4, 4, () => {
      const pct = Math.round((c.binT / c.binCapT) * 100);
      const g = sim.binGrade;
      const ok = Math.abs(g - cfg.grade.targetPct) <= cfg.grade.bandPct;
      const left = c.binT / cfg.dumps.crusher.plantFeedTpm;
      return `<b>БУНКЕР</b><br><span class="v">${fmtInt(c.binT)} т (${pct}%)</span><br>Cu: <span class="${ok ? 'ok' : 'bad'}">${c.binT > 0.01 ? g.toFixed(3) + '%' : '—'}</span><br>${c.binT > 0.01 ? `запас: <span class="v">${Math.round(left)} мин</span>` : '<span class="bad">ПУСТО — ОФ СТОИТ</span>'}`;
    });
    this.label(42, 6, 0, () => (c.binT > 0.01 ? `<b>НА ФАБРИКУ</b><br><span class="v">${fmtInt(cfg.dumps.crusher.plantFeedTpm * 60)} т/ч</span>` : '<b>КОНВЕЙЕР</b><br><span class="bad">СТОИТ</span>'));

    this.camera.position.set(22, 24, 40);
    this.controls.target.set(-2, 8, 0);
  }

  // ───────────────────────────── гараж ─────────────────────────────

  private buildGarage(): void {
    const sim = this.sim;
    const cfg = sim.cfg;
    const BAYS = 3;
    const POSTS = 2;

    // Самосвал реального размера (нос по +X).
    const mkTruck = (x: number, z: number, rotY: number) => {
      const t = makeTruck();
      t.root.scale.setScalar(1 / EQUIP_SCALE);
      t.root.position.set(x, 0, z);
      t.root.rotation.y = rotY;
      t.ring.visible = false;
      t.heap.visible = false;
      t.root.visible = false;
      this.scene.add(t.root);
      return t;
    };

    // Ремонтные боксы: перегородки, кран-балка, механик, тележка, лампа.
    const bays: { truck: TruckModel; crane: THREE.Group; mech: THREE.Group; lamp: { mesh: THREE.Mesh; mat: THREE.MeshStandardMaterial } }[] = [];
    const vest = std('#f97316', { roughness: 0.6 });
    // Боксы вдоль задней стены, машины носом к воротам (+Z).
    const bayX = (i: number) => -54 + i * 17;
    for (let i = 0; i < BAYS; i++) {
      const x = bayX(i);
      this.scene.add(box(0.5, 6, 26, M.wall, x - 8.2, 3, -20));
      this.scene.add(box(0.6, 0.05, 26, M.yellow, x + 7.6, 0.04, -20));
      const truck = mkTruck(x, -22, -Math.PI / 2);
      const crane = new THREE.Group();
      crane.add(box(15, 1, 1, M.yellow, 0, 0, 0));
      crane.add(box(1.4, 1.2, 1.4, M.dark, 0, -1, 0));
      crane.add(box(0.15, 6, 0.15, M.steel, 0, -4.2, 0));
      crane.position.set(x, 22, -22);
      this.scene.add(crane);
      this.scene.add(box(0.8, 0.8, 30, M.steel, x - 7.4, 22.6, -20), box(0.8, 0.8, 30, M.steel, x + 7.4, 22.6, -20));
      const mech = new THREE.Group();
      const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.45, 0.9, 4, 8), vest);
      torso.position.y = 1.4;
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.32, 10, 8), std('#f2c79a'));
      head.position.y = 2.35;
      const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.36, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), M.yellow);
      helmet.position.y = 2.4;
      mech.add(torso, head, helmet);
      mech.position.set(x + 5, 0, -16);
      this.scene.add(mech);
      this.scene.add(box(1, 1, 1.6, std('#b91c1c'), x - 5.5, 0.5, -12)); // тележка с инструментом
      const lamp = beacon(x, 7, -34);
      this.scene.add(lamp.mesh);
      bays.push({ truck, crane, mech, lamp });
    }

    // АЗС: островок, колонки со шлангами.
    const posts: { truck: TruckModel; hose: THREE.Mesh; lamp: { mesh: THREE.Mesh; mat: THREE.MeshStandardMaterial } }[] = [];
    this.scene.add(box(26, 0.4, 24, M.concrete, 6, 0.2, -10));
    this.scene.add(box(26, 0.8, 24, std('#c4442c'), 6, 12, -10)); // навес
    for (const x of [-6, 18]) for (const z of [-21, 1]) this.scene.add(box(0.7, 12, 0.7, M.steel, x, 6, z));
    for (let i = 0; i < POSTS; i++) {
      const z = -16 + i * 12;
      this.scene.add(box(1.4, 3.2, 1.2, std('#e9edf0'), 6, 1.8, z + 3.5));
      this.scene.add(box(1.5, 0.9, 1.3, std('#0f766e'), 6, 3.8, z + 3.5));
      const truck = mkTruck(4, z, 0);
      const hose = cyl(0.12, 0.12, 4.5, M.dark, 6);
      hose.rotation.x = Math.PI / 2.4;
      hose.position.set(5, 2.6, z + 1.6);
      this.scene.add(hose);
      const lamp = beacon(6, 4.6, z + 3.5);
      this.scene.add(lamp.mesh);
      posts.push({ truck, hose, lamp });
    }

    // Стоянка: места по номерам, на занятых — упрощённые машины (корпус + кабина) цвета состояния.
    const P = sim.parking;
    const cols = Math.max(1, P.cols);
    const slotN = sim.slotOccupant.length;
    const rows = Math.ceil(slotN / cols);
    const sx = 9;
    const sz = 16;
    const x0 = 28;
    const z0 = -((rows - 1) * sz) / 2 - 6;
    this.scene.add(box(cols * sx + 6, 0.3, rows * sz + 6, std('#4b4d52', { roughness: 1 }), x0 + ((cols - 1) * sx) / 2, 0.15, z0 + ((rows - 1) * sz) / 2));
    const parked: { body: THREE.Mesh; cab: THREE.Mesh; mat: THREE.MeshStandardMaterial }[] = [];
    for (let k = 0; k < slotN; k++) {
      const x = x0 + (k % cols) * sx;
      const z = z0 + Math.floor(k / cols) * sz;
      this.scene.add(box(0.2, 0.05, 13, M.yellow, x - sx / 2, 0.32, z), box(0.2, 0.05, 13, M.yellow, x + sx / 2, 0.32, z));
      const mat = std('#c4442c', { roughness: 0.6 });
      const body = box(5.6, 3.6, 9, mat, x, 2.2, z + 1.2);
      const cab = box(5.6, 2.6, 3, std('#e9edf0'), x, 3.2, z - 4.6);
      body.visible = false;
      cab.visible = false;
      this.scene.add(body, cab);
      parked.push({ body, cab, mat });
    }

    let craneT = 0;
    this.updaters.push((dt, now) => {
      const blink = Math.floor(now / 450) % 2 === 0;
      const service = sim.trucks.filter((t) => t.state === 'service');
      const refuel = sim.trucks.filter((t) => t.state === 'refuel');
      craneT += dt;
      bays.forEach((b, i) => {
        const t = service[i];
        b.truck.root.visible = !!t;
        b.mech.visible = !!t;
        b.truck.body.rotation.z = t ? 0.55 : 0;
        b.crane.position.z = -22 + (t ? Math.sin(craneT * 0.4 + i) * 6 : 0);
        b.mech.position.z = -16 + (t ? Math.sin(craneT * 0.7 + i * 2) * 1.2 : 0);
        const col = t ? (blink ? '#f97316' : '#7c2d12') : '#22c55e';
        b.lamp.mat.color.set(col);
        b.lamp.mat.emissive.set(col);
      });
      posts.forEach((p, i) => {
        const t = refuel[i];
        p.truck.root.visible = !!t;
        p.hose.visible = !!t;
        const col = t ? '#38bdf8' : '#22c55e';
        p.lamp.mat.color.set(col);
        p.lamp.mat.emissive.set(col);
      });
      sim.slotOccupant.forEach((occ, k) => {
        const p = parked[k];
        const t = occ !== null ? sim.trucks[occ] : null;
        // На месте — только ожидающие машины (на заправке и в ремонте они показаны у колонок и в боксах).
        const here = !!t && t.parkSlot === k && t.state === 'idle';
        p.body.visible = here;
        p.cab.visible = here;
        if (t) p.mat.color.set(TRUCK_COLOR[t.state]);
      });
    });

    for (let i = 0; i < BAYS; i++) {
      this.label(bayX(i), 16, -22, () => {
        const service = sim.trucks.filter((t) => t.state === 'service');
        const t = service[i];
        return t
          ? `<b>БОКС ${i + 1} · ППР</b><br><span class="v">${t.name}</span><br>${t.health.sign ? 'проверка: ' + (t.health.sign === 'engine' ? 'двигатель' : t.health.sign === 'tyre' ? 'шины' : 'гидравлика') + '<br>' : ''}осталось: <span class="v">${Math.ceil(t.timer / 60)} мин</span>`
          : `<b>БОКС ${i + 1}</b><br><span class="ok">свободен</span>`;
      });
    }
    this.label(6, 16, -10, () => {
      const refuel = sim.trucks.filter((t) => t.state === 'refuel');
      const rows = refuel.map((t) => `<span class="v">${t.name}</span> · ${Math.round((t.fuelL / cfg.truck.fuelTankL) * 100)}%`).join('<br>');
      const going = sim.trucks.filter((t) => t.dest?.kind === 'garage' && t.dest.purpose === 'refuel' && t.state !== 'refuel').length;
      return `<b>АЗС</b><br>${rows || 'никто не заправляется'}${going ? `<br>едут: <span class="v">${going}</span>` : ''}`;
    });
    this.label(x0 + ((cols - 1) * sx) / 2, 9, z0 - 12, () => {
      const occupied = sim.slotOccupant.filter((o) => o !== null).length;
      const broken = sim.trucks.filter((t) => t.state === 'broken').length;
      return `<b>СТОЯНКА</b><br>занято: <span class="v">${occupied} из ${slotN}</span>${broken ? `<br><span class="bad">аварийный ремонт на трассе: ${broken}</span>` : ''}`;
    });

    this.camera.position.set(-14, 28, 34);
    this.controls.target.set(-20, 4, -16);
  }

  // ───────────────────────────── фабрика ─────────────────────────────

  private buildPlant(): void {
    const sim = this.sim;
    const st = sim.stats;
    const cfg = sim.cfg;
    const running = () => sim.crusher.binT > 0.01;

    // Конвейер питания с анализатором над лентой.
    const feed = new Conveyor([[-64, 9, 0], [-40, 9, 0]], this.light ? 10 : 18);
    this.scene.add(feed.group);
    this.scene.add(box(4, 3.4, 4.2, M.yellow, -54, 11.3, 0));
    const pgnaa = beacon(-54, 13.6, 0);
    this.scene.add(pgnaa.mesh);

    // Мельница ПСИ: большой барабан вдоль X, зубчатый венец, привод.
    const sag = new THREE.Group();
    const drum = cyl(6, 6, 9, M.green, 32);
    drum.rotation.z = Math.PI / 2;
    sag.add(drum);
    const gear = new THREE.Mesh(new THREE.TorusGeometry(6.4, 0.5, 8, 40), M.steel);
    gear.rotation.y = Math.PI / 2;
    gear.position.x = 2.5;
    sag.add(gear);
    for (const sx of [-1, 1]) {
      const end = cyl(2.2, 5.6, 2, M.steel, 24);
      end.rotation.z = (sx * Math.PI) / 2;
      end.position.x = sx * 5.5;
      sag.add(end);
    }
    sag.position.set(-28, 9, 0);
    this.scene.add(sag);
    for (const x of [-34.5, -21.5]) this.scene.add(box(3, 9, 6, M.concrete, x, 4.5, 0));
    this.scene.add(box(6, 4, 4, M.dark, -26, 2, -9)); // двигатель

    // Шаровая мельница.
    const ball = new THREE.Group();
    const bdrum = cyl(4, 4, 12, M.green, 28);
    bdrum.rotation.z = Math.PI / 2;
    ball.add(bdrum);
    const bgear = new THREE.Mesh(new THREE.TorusGeometry(4.4, 0.4, 8, 36), M.steel);
    bgear.rotation.y = Math.PI / 2;
    bgear.position.x = 3;
    ball.add(bgear);
    ball.position.set(-6, 6.5, 0);
    this.scene.add(ball);
    for (const x of [-12.5, 0.5]) this.scene.add(box(2, 6.5, 5, M.concrete, x, 3.25, 0));

    // Гидроциклоны на площадке.
    this.scene.add(box(8, 0.6, 8, M.steel, 9, 14, 0));
    for (const x of [8, 10, 12.4]) {
      for (const z of [-2, 2]) this.scene.add(box(0.3, 14, 0.3, M.steel, x - 2.5, 7, z * 1.8));
    }
    for (const [x, z] of [[7, -2], [11, -2], [7, 2], [11, 2]]) {
      const cone = cyl(1.2, 0.3, 4, M.steel, 14);
      cone.position.set(x, 17, z);
      this.scene.add(cone);
    }
    // Пульпопровод мельницы → циклоны → флотация.
    const pipe = (a: [number, number, number], b: [number, number, number]) => {
      const va = new THREE.Vector3(...a);
      const vb = new THREE.Vector3(...b);
      const p = cyl(0.5, 0.5, va.distanceTo(vb), M.slurry, 10);
      p.position.copy(va.clone().add(vb).multiplyScalar(0.5));
      p.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), vb.clone().sub(va).normalize());
      this.scene.add(p);
    };
    pipe([0, 3, 3], [6, 18, 3]);
    pipe([12, 16, 0], [18, 6, 0]);

    // Флотация: ряд камер, пена и пузырьки.
    const cells: THREE.Mesh[] = [];
    for (let i = 0; i < 6; i++) {
      const x = 20 + i * 5.2;
      this.scene.add(box(4.6, 5, 5.4, M.blue, x, 2.5, 0));
      const froth = box(4.2, 0.3, 5, M.froth, x, 5.1, 0);
      this.scene.add(froth);
      cells.push(froth);
      this.scene.add(box(0.4, 2.2, 0.4, M.dark, x, 6.4, 0)); // привод импеллера
    }
    this.scene.add(box(31, 0.8, 1, M.conc, 33, 4.6, 3.3)); // желоб концентрата
    const bubN = this.light ? 24 : 60;
    const bubbles = new THREE.InstancedMesh(new THREE.SphereGeometry(0.22, 8, 6), M.froth, bubN);
    this.scene.add(bubbles);
    const bubT = Array.from({ length: bubN }, (_, i) => (i * 0.37) % 1);
    const tmp = new THREE.Object3D();

    // Сгуститель концентрата с вращающейся фермой.
    const thick = cyl(8, 8, 3, M.concrete, 36);
    thick.position.set(44, 1.5, -18);
    this.scene.add(thick);
    const liquor = cyl(7.6, 7.6, 0.2, M.conc, 36);
    liquor.position.set(44, 3, -18);
    this.scene.add(liquor);
    const rake = box(15, 0.4, 0.8, M.steel, 0, 0, 0);
    const rakeG = new THREE.Group();
    rakeG.add(rake);
    rakeG.position.set(44, 3.6, -18);
    this.scene.add(rakeG);
    pipe([48, 4.6, 3.3], [44, 3.4, -10]);
    // Хвосты — трубой за стену.
    pipe([50, 1.2, -3], [64, 1.2, -3]);
    const bPlant = beacon(-28, 16.5, 0);
    this.scene.add(bPlant.mesh);
    const bFlot = beacon(33, 8.5, -3.2);
    this.scene.add(bFlot.mesh);

    this.updaters.push((dt, now) => {
      const on = running();
      const blink = Math.floor(now / 400) % 2 === 0;
      feed.update(dt, on ? 2.4 : 0, on);
      sag.rotation.x += dt * (on ? 0.9 : 0);
      ball.rotation.x += dt * (on ? 1.4 : 0);
      rakeG.rotation.y += dt * (on ? 0.25 : 0.05);
      for (const f of cells) f.visible = on;
      bubbles.visible = on;
      if (on) {
        for (let i = 0; i < bubN; i++) {
          bubT[i] = (bubT[i] + dt * (0.5 + (i % 5) * 0.08)) % 1;
          const cell = i % 6;
          tmp.position.set(20 + cell * 5.2 + Math.sin(i * 3.1) * 1.6, 5.2 + bubT[i] * 1.6, Math.cos(i * 1.7) * 2);
          tmp.scale.setScalar(1 - bubT[i] * 0.6);
          tmp.updateMatrix();
          bubbles.setMatrixAt(i, tmp.matrix);
        }
        bubbles.instanceMatrix.needsUpdate = true;
      }
      const inBand = Math.abs(sim.binGrade - cfg.grade.targetPct) <= cfg.grade.bandPct;
      const pg = on ? (inBand ? '#22c55e' : '#f59e0b') : '#3b3f45';
      pgnaa.mat.color.set(pg);
      pgnaa.mat.emissive.set(pg);
      for (const b of [bPlant, bFlot]) {
        const col = on ? '#22c55e' : blink ? '#ef4444' : '#3b0d0d';
        b.mat.color.set(col);
        b.mat.emissive.set(col);
      }
    });

    const recovery = () => (st.cuFeedT > 0 ? (st.cuConcT / st.cuFeedT) * 100 : cfg.grade.recoveryMax * 100);
    this.label(-54, 17, 4, () => {
      const on = running();
      const ok = Math.abs(sim.binGrade - cfg.grade.targetPct) <= cfg.grade.bandPct;
      return `<b>ПИТАНИЕ · PGNAA</b><br>${on ? `<span class="v">${fmtInt(cfg.dumps.crusher.plantFeedTpm * 60)} т/ч</span><br>Cu: <span class="${ok ? 'ok' : 'bad'}">${sim.binGrade.toFixed(3)}%</span>` : '<span class="bad">НЕТ РУДЫ</span>'}`;
    });
    this.label(-28, 19, -4, () => `<b>МЕЛЬНИЦА ПСИ</b><br>${running() ? '<span class="ok">ИЗМЕЛЬЧЕНИЕ</span>' : '<span class="bad">СТОИТ</span>'}`);
    this.label(-6, 12, 6, () => `<b>ШАРОВАЯ МЕЛЬНИЦА</b><br>${running() ? 'работает' : '<span class="bad">стоит</span>'}`);
    this.label(9, 22, -4, () => '<b>ГИДРОЦИКЛОНЫ</b>');
    this.label(30, 10, 6, () => `<b>ФЛОТАЦИЯ</b><br>извлечение: <span class="v">${recovery().toFixed(1)}%</span>`);
    this.label(46, 10, -20, () => `<b>КОНЦЕНТРАТ</b><br><span class="v">${st.cuConcT.toFixed(1)} т Cu</span><br>хвосты: ${st.cuLossT.toFixed(2)} т Cu`);

    this.camera.position.set(4, 30, 52);
    this.controls.target.set(-8, 6, -2);
  }
}
