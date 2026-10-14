/**
 * 3D-сцена цифрового двойника на Three.js. Читает состояние Simulation каждый кадр
 * (как 2D-карта) и обновляет модели; сама симуляция от сцены не зависит.
 */
import * as THREE from 'three';
import { CSS2DObject, CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { gradeAt, MATERIAL_SHORT, type Blast, type Simulation, type TruckState } from '../sim';
import type { Selection } from '../render/drawMine';
import { fmtInt } from '../ui/format';
import { MATERIAL_COLOR, TRUCK_COLOR } from '../ui/theme';
import {
  EQUIP_SCALE,
  makeBarrier,
  makeCrusher,
  makeExcavator,
  makeGarage,
  makeLeachPad,
  makeLightMast,
  makeDrillRig,
  type DrillModel,
  makePlant,
  makeTruck,
  makeWasteDump,
  ROCK_GEO,
  type ExcavatorModel,
  type TruckModel,
} from './models';
import { blockBounds, buildRoads, buildTerrain, buildWater, makeHeightAt, PIT_DEPTH, scatterRocks, type Block } from './terrain';

export type CameraPreset = 'overview' | 'crusher' | 'bottom' | 'side';
/** Здания, у которых есть «внутренний двойник» (мнемосхема). */
export type BuildingKind = 'crusher' | 'plant' | 'garage' | 'leach' | 'waste';

const BG = '#0a1526';

/** HTML подписи «таблички»: точка статуса + текст. */
function tag(dot: string, html: string): string {
  return `<span class="dot" style="background:${dot};box-shadow:0 0 6px ${dot}"></span>${html}`;
}

function outward(x: number, y: number): [number, number] {
  const l = Math.hypot(x, y) || 1;
  return [x / l, y / l];
}

function label(className: string, html = ''): CSS2DObject {
  const div = document.createElement('div');
  div.className = className;
  div.innerHTML = html;
  return new CSS2DObject(div);
}

function lerpAngle(a: number, b: number, t: number): number {
  const d = Math.atan2(Math.sin(b - a), Math.cos(b - a));
  return a + d * t;
}

interface Tween {
  fromPos: THREE.Vector3;
  toPos: THREE.Vector3;
  fromTarget: THREE.Vector3;
  toTarget: THREE.Vector3;
  start: number;
  dur: number;
}

export class MineScene {
  readonly renderer: THREE.WebGLRenderer;
  private readonly labels: CSS2DRenderer;
  readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly controls: OrbitControls;
  private readonly heightAt: (x: number, y: number) => number;
  private readonly trucks: TruckModel[] = [];
  private readonly heading: number[] = [];
  private readonly excavators: ExcavatorModel[] = [];
  private readonly exLabels: CSS2DObject[] = [];
  /** Буровые станки и сетки скважин на блоках. */
  private readonly drills: DrillModel[] = [];
  private readonly drillLabels: CSS2DObject[] = [];
  private readonly drillHeading: number[] = [];
  private readonly holes: THREE.InstancedMesh[] = [];
  private readonly holesShown: number[] = [];
  private readonly exAngles: { face: number; truck: number }[] = [];
  private readonly truckLabel: CSS2DObject;
  private readonly alertLabels: CSS2DObject[] = [];
  private readonly crusher: ReturnType<typeof makeCrusher>;
  private readonly conveyorMat: THREE.MeshStandardMaterial;
  private readonly ore: THREE.InstancedMesh;
  private readonly conveyorFrom = new THREE.Vector3();
  private readonly conveyorTo = new THREE.Vector3();
  private readonly panels: { obj: CSS2DObject; render: () => string }[] = [];
  private readonly closures = new Map<string, THREE.Group>();
  private readonly blastViz = new Map<number, { grp: THREE.Group; zone: THREE.Mesh; lbl: CSS2DObject; boomAt: number | null; dust: THREE.Mesh; flash: THREE.Mesh }>();
  private readonly ro: ResizeObserver;
  private raf = 0;
  private lastPanel = 0;
  private tween: Tween | null = null;
  private follow = false;
  private selection: Selection = null;
  private readonly tmp = new THREE.Matrix4();
  private readonly crusherPos: THREE.Vector3;
  /** Постобработка со свечением — только в полном качестве. */
  private readonly composer: EffectComposer | null = null;
  private readonly bloom: UnrealBloomPass | null = null;
  private readonly light: boolean;
  private readonly onSlow: (() => void) | null;
  private lastRender = 0;
  /** Сторож производительности: средняя длительность кадра за окно наблюдения. */
  private perf = { start: 0, frames: 0, fired: false };
  private readonly blk: Block;
  private trail: THREE.Mesh | null = null;
  /** Здания для выбора кликом. */
  private readonly buildings: THREE.Object3D[] = [];
  private trailKey = '';

  constructor(
    private readonly container: HTMLElement,
    private readonly sim: Simulation,
    opts: { light?: boolean; onSlow?: () => void } = {},
  ) {
    const cfg = sim.cfg;
    this.heightAt = makeHeightAt(cfg);
    this.light = !!opts.light;
    this.onSlow = opts.onSlow ?? null;
    const light = this.light;

    // Лёгкий режим: без сглаживания и теней, пиксель 1:1 — программный WebGL справляется.
    this.renderer = new THREE.WebGLRenderer({ antialias: !light, powerPreference: light ? 'default' : 'high-performance' });
    this.renderer.setPixelRatio(light ? 1 : Math.min(window.devicePixelRatio, 1.5));
    this.renderer.shadowMap.enabled = !light;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.2;
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.style.display = 'block';

    this.labels = new CSS2DRenderer();
    Object.assign(this.labels.domElement.style, { position: 'absolute', inset: '0', pointerEvents: 'none' });
    container.appendChild(this.labels.domElement);

    this.camera = new THREE.PerspectiveCamera(42, 1, 10, 30000);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = 1.42;
    this.controls.minDistance = 150;
    this.controls.maxDistance = 12000;
    this.controls.autoRotateSpeed = 0.35;
    this.controls.addEventListener('start', () => {
      this.tween = null;
    });

    // Атмосфера и свет.
    this.scene.background = new THREE.Color(BG);
    this.scene.fog = new THREE.Fog(BG, 5500, 14000);
    this.scene.add(new THREE.HemisphereLight('#d6e6ff', '#3b2c1f', 1.25));
    const sun = new THREE.DirectionalLight('#ffe2b8', 2.6);
    sun.position.set(-2200, 3200, 1800);
    sun.castShadow = !light;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -3600, right: 3600, top: 3000, bottom: -3000, near: 100, far: 10000 });
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 2;
    this.scene.add(sun);

    // Рельеф до горизонта: чаша с уступами, вокруг — степь, которая растворяется в дымке.
    this.blk = blockBounds(sim);
    const blk = this.blk;
    const ground = new THREE.Mesh(new THREE.RingGeometry(2200, 30000, light ? 48 : 128, 1), new THREE.MeshStandardMaterial({ color: '#b8996a', roughness: 1 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -12;
    ground.receiveShadow = true;
    this.scene.add(ground);
    this.scene.add(buildTerrain(cfg, null));
    this.scene.add(buildWater(cfg));
    this.scene.add(buildRoads(sim, this.heightAt));

    // Объекты поверхности.
    const g = sim.layout.graph;
    const place = (obj: THREE.Object3D, node: number, push: number, faceNode = true) => {
      const n = g.nodes[node];
      const [dx, dy] = outward(n.x, n.y);
      const cx = n.x + dx * push;
      const cy = n.y + dy * push;
      obj.position.set(cx, this.heightAt(cx, cy) - 2, cy);
      if (faceNode) obj.rotation.y = -Math.atan2(n.y - cy, n.x - cx) + Math.PI;
      this.scene.add(obj);
      return obj.position;
    };

    this.crusher = makeCrusher();
    this.crusher.root.scale.setScalar(2);
    this.crusherPos = place(this.crusher.root, sim.layout.crusher.node, 120).clone();
    const leach = makeLeachPad();
    place(leach, sim.layout.leach.node, 175, false);
    const dump = makeWasteDump();
    place(dump, sim.layout.waste.node, 300, false);
    const garage = makeGarage();
    this.crusher.root.userData = { building: 'crusher' };
    leach.userData = { building: 'leach' };
    dump.userData = { building: 'waste' };
    garage.userData = { building: 'garage' };
    this.buildings.push(this.crusher.root, leach, dump, garage);
    // Гараж — сбоку от стоянки, сама стоянка — у въезда (узла гаража).
    {
      const f = sim.parkingFrame();
      const P = sim.parking;
      const side = ((P.cols - 1) / 2) * P.dx + 260;
      const mid = P.aisle0 + P.dy * 1.8;
      const gx = f.cx + f.ox * mid + f.tx * side;
      const gy = f.cy + f.oy * mid + f.ty * side;
      garage.position.set(gx, this.heightAt(gx, gy) - 2, gy);
      garage.rotation.y = -Math.atan2(f.oy, f.ox) + Math.PI / 2;
      this.scene.add(garage);
      const parkingLot = this.buildParking();
      parkingLot.userData = { building: 'garage' };
      this.buildings.push(parkingLot);
      this.scene.add(parkingLot);
    }
    const plant = makePlant();
    plant.scale.setScalar(1.3);
    const pp = sim.layout.plant;
    plant.position.set(pp.x, this.heightAt(pp.x, pp.y) - 2, pp.y);
    plant.rotation.y = -Math.atan2(this.crusherPos.z - pp.y, this.crusherPos.x - pp.x);
    this.scene.add(plant);
    plant.userData = { building: 'plant' };
    this.buildings.push(plant);

    // Россыпь камней (в стороне от дорог и площадок) и мачты освещения по бровке.
    const avoid = [
      { x: this.crusherPos.x, y: this.crusherPos.z, r: 180 },
      { x: pp.x, y: pp.y, r: 280 },
      { x: leach.position.x, y: leach.position.z, r: 320 },
      { x: dump.position.x, y: dump.position.z, r: 320 },
      { x: garage.position.x, y: garage.position.z, r: 170 },
      { x: sim.parkingSlot(2 * sim.parking.cols + 2).x, y: sim.parkingSlot(2 * sim.parking.cols + 2).y, r: 460 },
    ];
    if (!light) this.scene.add(scatterRocks(sim, blk, this.heightAt, avoid));
    for (let i = 0; i < 10; i++) {
      const th = (i / 10) * Math.PI * 2 + 0.3;
      const a = cfg.pit.semiMajorM * 1.1;
      const b = cfg.pit.semiMinorM * 1.13;
      const x = Math.cos(th) * a;
      const y = Math.sin(th) * b;
      if (avoid.some((o) => Math.hypot(o.x - x, o.y - y) < o.r)) continue;
      const mast = makeLightMast();
      mast.position.set(x, this.heightAt(x, y), y);
      this.scene.add(mast);
    }

    // Конвейер дробилка → фабрика.
    this.conveyorFrom.set(this.crusherPos.x, this.crusherPos.y + 95, this.crusherPos.z);
    this.conveyorTo.set(pp.x, plant.position.y + 80, pp.y);
    const len = this.conveyorFrom.distanceTo(this.conveyorTo);
    this.conveyorMat = new THREE.MeshStandardMaterial({ color: '#2f3338', emissive: '#000000', roughness: 0.8 });
    const belt = new THREE.Mesh(new THREE.BoxGeometry(len, 4, 14), this.conveyorMat);
    belt.position.copy(this.conveyorFrom).lerp(this.conveyorTo, 0.5);
    belt.lookAt(this.conveyorTo);
    belt.rotateY(Math.PI / 2);
    belt.castShadow = true;
    this.scene.add(belt);
    // Опоры конвейера.
    const nSup = Math.max(2, Math.floor(len / 60));
    for (let i = 1; i < nSup; i++) {
      const p = this.conveyorFrom.clone().lerp(this.conveyorTo, i / nSup);
      const ground = this.heightAt(p.x, p.z);
      const post = new THREE.Mesh(new THREE.BoxGeometry(4, p.y - ground, 4), new THREE.MeshStandardMaterial({ color: '#8b939c', metalness: 0.5, roughness: 0.4 }));
      post.position.set(p.x, (p.y + ground) / 2, p.z);
      post.castShadow = true;
      this.scene.add(post);
    }
    this.ore = new THREE.InstancedMesh(ROCK_GEO, new THREE.MeshStandardMaterial({ color: '#8b6b47', roughness: 1, flatShading: true }), 40);
    this.scene.add(this.ore);

    // Экскаваторы.
    sim.excavators.forEach((ex) => {
      const m = makeExcavator();
      m.root.userData = { kind: 'excavator', id: ex.id };
      (m.band.material as THREE.MeshStandardMaterial).color.set(MATERIAL_COLOR[ex.material]);
      const h = this.heightAt(ex.x, ex.y);
      m.root.position.set(ex.x, h + 1, ex.y);
      const [ox, oy] = outward(ex.x, ex.y);
      const face = Math.atan2(-oy, -ox); // забой — к центру карьера
      const acc = g.nodes[ex.accessNode];
      const truck = Math.atan2(acc.y - ex.y, acc.x - ex.x);
      m.root.rotation.y = -face;
      this.exAngles.push({ face, truck });
      this.scene.add(m.root);
      this.excavators.push(m);
      const lbl = label('lbl3d');
      lbl.position.set(0, 120, 0);
      m.root.add(lbl);
      this.exLabels.push(lbl);
    });

    // Буровые станки и сетки скважин (по блоку у каждого забоя).
    sim.drill.rigs.forEach(() => {
      const d = makeDrillRig();
      this.scene.add(d.root);
      this.drills.push(d);
      this.drillHeading.push(0);
      const lbl = label('lbl3d');
      lbl.position.set(0, 150, 0);
      d.root.add(lbl);
      this.drillLabels.push(lbl);
    });
    const holeGeo = new THREE.CylinderGeometry(4.5, 4.5, 1.2, 10);
    const holeMat = new THREE.MeshBasicMaterial({ color: '#1a1410' });
    sim.drill.blocks.forEach(() => {
      const im = new THREE.InstancedMesh(holeGeo, holeMat, 30);
      im.count = 0;
      this.scene.add(im);
      this.holes.push(im);
      this.holesShown.push(-1);
    });

    // Самосвалы.
    for (const t of sim.trucks) {
      const m = makeTruck();
      m.root.userData = { kind: 'truck', id: t.id };
      this.scene.add(m.root);
      this.trucks.push(m);
      this.heading.push(Math.atan2(sim.parkingFrame().oy, sim.parkingFrame().ox));
      const al = label('lbl3d alert');
      al.position.set(0, 80, 0);
      al.visible = false;
      m.root.add(al);
      this.alertLabels.push(al);
    }
    this.truckLabel = label('lbl3d sel');
    this.scene.add(this.truckLabel);

    // Голографические информационные панели.
    const panel = (pos: THREE.Vector3, render: () => string) => {
      const obj = label('holo');
      obj.position.copy(pos);
      this.scene.add(obj);
      // Подсказка: по клику на здание открывается его «внутренний двойник».
      this.panels.push({ obj, render: () => `${render()}<div class="hint">▸ клик по зданию — что внутри</div>` });
    };
    const c = sim.crusher;
    panel(new THREE.Vector3(this.crusherPos.x, this.crusherPos.y + 240, this.crusherPos.z), () => {
      const pct = Math.round((c.binT / c.binCapT) * 100);
      const starving = c.binT <= 0.01;
      return `<b>ДРОБИЛКА ККД</b><br>Бункер: <span class="v">${fmtInt(c.binT)} т (${pct}%)</span><br>Подача на ОФ: <span class="v">${cfg.dumps.crusher.plantFeedTpm} т/мин</span><br>Статус: ${
        starving ? '<span class="bad">ПРОСТОЙ</span>' : '<span class="ok">РАБОТА</span>'
      }<br>Очередь: <span class="v">${c.queue.length}</span><br>Содержание Cu: ${
        c.binT > 1
          ? `<span class="${Math.abs(sim.binGrade - cfg.grade.targetPct) <= cfg.grade.bandPct ? 'ok' : 'bad'}">${sim.binGrade.toFixed(2)}%</span> (цель ${cfg.grade.targetPct}%)`
          : '—'
      }`;
    });
    panel(new THREE.Vector3(pp.x, plant.position.y + 240, pp.y), () => {
      const m = sim.stats.mined;
      return `<b>ОБОГАТИТЕЛЬНАЯ ФАБРИКА</b><br>Руда (сульфид): <span class="v">${fmtInt(m.sulfide)} т</span><br>Простой ОФ: <span class="${
        c.starvedSec > 0 ? 'bad' : 'v'
      }">${(c.starvedSec / 60).toFixed(1)} мин</span>`;
    });
    const leachD = sim.dumps[1];
    panel(new THREE.Vector3(leach.position.x, leach.position.y + 110, leach.position.z), () => `<b>КУЧНОЕ ВЫЩЕЛАЧИВАНИЕ</b><br>Оксид: <span class="v">${fmtInt(leachD.tonnes)} т</span>`);
    const wasteD = sim.dumps[2];
    panel(new THREE.Vector3(dump.position.x, dump.position.y + 150, dump.position.z), () => `<b>ОТВАЛ</b><br>Вскрыша: <span class="v">${fmtInt(wasteD.tonnes)} т</span>`);

    // Мягкое свечение фонарей, окон, колец статуса.
    if (!light) {
      this.composer = new EffectComposer(this.renderer);
      this.composer.addPass(new RenderPass(this.scene, this.camera));
      this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.55, 0.45, 0.62);
      this.composer.addPass(this.bloom);
      this.composer.addPass(new OutputPass());
    }

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(container);
    this.resize();
    this.applyPreset('overview', false);
    this.raf = requestAnimationFrame(this.frame);
    if (import.meta.env.DEV) (window as unknown as { __mine?: MineScene }).__mine = this;
  }

  // ───────────────────────────── управление ─────────────────────────────

  setSelection(sel: Selection): void {
    this.selection = sel;
    if (!sel || sel.kind !== 'truck') this.follow = false;
  }

  setAutoRotate(on: boolean): void {
    this.controls.autoRotate = on;
  }

  setFollow(on: boolean): void {
    this.follow = on && this.selection?.kind === 'truck';
    if (this.follow && this.selection) {
      const t = this.sim.trucks[this.selection.id];
      const h = this.heightAt(t.x, t.y);
      const target = new THREE.Vector3(t.x, h, t.y);
      this.flyTo(target.clone().add(new THREE.Vector3(260, 220, 320)), target);
    }
  }

  applyPreset(p: CameraPreset, animate = true): void {
    this.follow = false;
    let pos: THREE.Vector3;
    let target: THREE.Vector3;
    switch (p) {
      case 'crusher':
        target = this.crusherPos.clone().add(new THREE.Vector3(0, 30, 0));
        pos = target.clone().add(new THREE.Vector3(-650, 420, 650));
        break;
      case 'bottom':
        target = new THREE.Vector3(0, -PIT_DEPTH + 40, 0);
        pos = new THREE.Vector3(-900, -60, 700);
        break;
      case 'side':
        target = new THREE.Vector3(0, -260, 0);
        pos = new THREE.Vector3(0, 300, 4600);
        break;
      default:
        // Вся диорама наискосок, как макет на столе.
        target = new THREE.Vector3(150, -200, 120);
        pos = new THREE.Vector3(2100, 1900, 2700);
    }
    if (animate) this.flyTo(pos, target);
    else {
      this.camera.position.copy(pos);
      this.controls.target.copy(target);
      this.controls.update();
    }
  }

  private flyTo(pos: THREE.Vector3, target: THREE.Vector3): void {
    this.tween = {
      fromPos: this.camera.position.clone(),
      toPos: pos,
      fromTarget: this.controls.target.clone(),
      toTarget: target,
      start: performance.now(),
      dur: 1300,
    };
  }

  /** Объект под курсором (клиентские координаты). */
  pick(clientX: number, clientY: number): Selection {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const objs = [...this.trucks.map((t) => t.root), ...this.excavators.map((e) => e.root)];
    const hit = ray.intersectObjects(objs, true)[0];
    if (hit) {
      let o: THREE.Object3D | null = hit.object;
      while (o && !o.userData.kind) o = o.parent;
      if (o) return { kind: o.userData.kind, id: o.userData.id };
    }
    // Промах — ближайший к лучу самосвал в пределах ~24 px.
    let best: Selection = null;
    let bestD = 24;
    const v = new THREE.Vector3();
    for (const t of this.trucks) {
      v.copy(t.root.position).project(this.camera);
      const px = ((v.x + 1) / 2) * rect.width + rect.left;
      const py = ((1 - v.y) / 2) * rect.height + rect.top;
      const d = Math.hypot(px - clientX, py - clientY);
      if (d < bestD && v.z < 1) {
        bestD = d;
        best = { kind: 'truck', id: t.root.userData.id };
      }
    }
    return best;
  }

  /** Буровые станки: положение, мачта (бурение — вертикально, переезд — уложена), сетки скважин. */
  private syncDrills(now: number, blink: boolean): void {
    const sim = this.sim;
    sim.drill.rigs.forEach((g, i) => {
      const d = this.drills[i];
      const prev = d.root.position;
      const h = this.heightAt(g.x, g.y);
      const dx = g.x - prev.x;
      const dz = g.y - prev.z;
      if (g.state === 'moving' && Math.hypot(dx, dz) > 0.5) this.drillHeading[i] = Math.atan2(dz, dx);
      else if (g.state === 'drilling') this.drillHeading[i] = Math.atan2(-g.y, -g.x); // мачтой к центру карьера
      d.root.position.set(g.x, h + 1, g.y);
      d.root.rotation.y = -this.drillHeading[i];
      const lowered = g.state === 'moving' ? -1.45 : 0;
      d.mast.rotation.z += (lowered - d.mast.rotation.z) * 0.08;
      const drilling = g.state === 'drilling' && g.reposition <= 0;
      if (drilling) d.rod.rotation.y += 0.4;
      d.rod.position.y = drilling ? 9 - (g.holeDepth / 16) * 7 : 9;
      const col = g.state === 'broken' ? (blink ? '#ef4444' : '#450a0a') : drilling ? '#22c55e' : g.state === 'moving' ? '#38bdf8' : '#f59e0b';
      (d.light.material as THREE.MeshBasicMaterial).color.set(col);
      (d.ring.material as THREE.MeshBasicMaterial).color.set(col);
    });
    sim.drill.blocks.forEach((b, k) => {
      if (this.holesShown[k] === b.holesDone) return;
      this.holesShown[k] = b.holesDone;
      const im = this.holes[k];
      for (let j = 0; j < b.holesDone; j++) {
        const p = sim.drill.holePos(b, j);
        this.tmp.makeTranslation(p.x, this.heightAt(p.x, p.y) + 0.8, p.y);
        im.setMatrixAt(j, this.tmp);
      }
      im.count = b.holesDone;
      im.instanceMatrix.needsUpdate = true;
    });
    if (now - this.lastDrillLabel > 300) {
      this.lastDrillLabel = now;
      sim.drill.rigs.forEach((g, i) => {
        const b = g.target !== null ? sim.drill.blocks[g.target] : null;
        const where = b ? ` · блок у ${sim.excavators[b.exId].name} ${b.holesDone}/${b.holesTotal}` : '';
        const st =
          g.state === 'broken'
            ? `<br><span class="bad">⚠ ПОЛОМКА · ещё ${Math.ceil(g.brokenLeft / 60)} мин</span>`
            : g.state === 'moving'
              ? '<br>переезд по дорогам'
              : g.state === 'drilling'
                ? `<br>скважина <span class="warn">${g.holeDepth.toFixed(1)}/16 м</span>${g.penetration ? ` · ${g.penetration.toFixed(0)} м/ч` : ''}`
                : '';
        const dot = g.state === 'broken' ? '#ef4444' : g.state === 'drilling' ? '#22c55e' : g.state === 'moving' ? '#38bdf8' : '#f59e0b';
        (this.drillLabels[i].element as HTMLElement).innerHTML = tag(dot, `<b>${g.name}</b> · буровой${where}${st}`);
      });
    }
  }
  private lastDrillLabel = 0;

  /** Здание под курсором — для «внутреннего двойника». */
  pickBuilding(clientX: number, clientY: number): BuildingKind | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const hit = ray.intersectObjects(this.buildings, true)[0];
    let o: THREE.Object3D | null = hit?.object ?? null;
    while (o && !o.userData.building) o = o.parent;
    return o ? (o.userData.building as BuildingKind) : null;
  }

  get domElement(): HTMLCanvasElement {
    return this.renderer.domElement;
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    this.controls.dispose();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else mat?.dispose();
    });
    this.composer?.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.labels.domElement.remove();
  }

  // ───────────────────────────── кадр ─────────────────────────────

  private resize(): void {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (w === 0 || h === 0) return;
    this.renderer.setSize(w, h);
    this.composer?.setSize(w, h);
    this.bloom?.resolution.set(w / 2, h / 2);
    this.labels.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private frame = (now: number): void => {
    this.raf = requestAnimationFrame(this.frame);
    // Лёгкий режим: не чаще 30 кадров в секунду.
    if (this.light && now - this.lastRender < 32) return;
    this.lastRender = now;
    this.watchPerf(now);
    this.update(now);
    if (this.tween) {
      const k = Math.min(1, (now - this.tween.start) / this.tween.dur);
      const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
      this.camera.position.lerpVectors(this.tween.fromPos, this.tween.toPos, e);
      this.controls.target.lerpVectors(this.tween.fromTarget, this.tween.toTarget, e);
      if (k >= 1) this.tween = null;
    }
    this.controls.update();
    if (this.composer) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
    this.labels.render(this.scene, this.camera);
  };

  /**
   * Если в полном качестве кадр в среднем дольше 70 мс (меньше ~14 кадров/с) — сообщаем, чтобы
   * интерфейс переключился в лёгкий режим. Первые 3 с не считаем: идёт компиляция шейдеров.
   */
  private watchPerf(now: number): void {
    if (this.light || !this.onSlow || this.perf.fired || document.hidden) return;
    if (!this.perf.start) this.perf.start = now + 3000;
    if (now < this.perf.start) return;
    this.perf.frames++;
    const span = now - this.perf.start;
    if (span < 4000) return;
    if (span / this.perf.frames > 70) {
      this.perf.fired = true;
      this.onSlow();
    } else this.perf = { start: now, frames: 0, fired: false };
  }

  private update(now: number): void {
    const sim = this.sim;
    const alpha = sim.finished ? 1 : sim.alpha;
    const blink = Math.floor(now / 350) % 2 === 0;
    const sel = this.selection;

    // Самосвалы.
    sim.trucks.forEach((t, i) => {
      const m = this.trucks[i];
      const x = t.px + (t.x - t.px) * alpha;
      const y = t.py + (t.y - t.py) * alpha;
      m.root.position.set(x, this.heightAt(x, y) + 3, y);
      const dx = t.x - t.px;
      const dy = t.y - t.py;
      if (Math.hypot(dx, dy) > 0.3 && (t.state === 'empty' || t.state === 'loaded')) {
        let dir = Math.atan2(dy, dx);
        // С места на стоянке выезжаем задним ходом: нос смотрит против движения.
        const g = sim.layout.graph;
        if (t.seg < t.path.length - 1 && g.nodes[t.path[t.seg]].kind === 'slot') dir += Math.PI;
        this.heading[i] = lerpAngle(this.heading[i], dir, 0.25);
      }
      m.root.rotation.y = -this.heading[i];
      const color = this.truckColor(t.state, blink);
      (m.ring.material as THREE.MeshBasicMaterial).color.set(color);
      (m.beacon.material as THREE.MeshBasicMaterial).color.set(color);
      const selected = sel?.kind === 'truck' && sel.id === t.id;
      m.ring.scale.setScalar(selected ? 1.5 + 0.15 * Math.sin(now / 150) : 1);
      m.heap.visible = t.loadT > 0;
      if (t.material) m.heapMat.color.set(MATERIAL_COLOR[t.material]);
      const al = this.alertLabels[i];
      const showAlert = (t.health.alert && t.state !== 'broken') || t.state === 'service';
      al.visible = showAlert && !selected;
      if (showAlert) (al.element as HTMLElement).innerHTML = tag('#22d3ee', t.state === 'service' ? 'ППР' : `риск ${t.health.risk}%`);
      const tip = t.state === 'dumping' ? 0.85 : 0;
      m.body.rotation.z += (tip - m.body.rotation.z) * 0.15;
    });

    // Подпись выбранного самосвала и слежение камерой.
    if (sel?.kind === 'truck') {
      const t = sim.trucks[sel.id];
      const m = this.trucks[sel.id];
      this.truckLabel.visible = true;
      this.truckLabel.position.copy(m.root.position).add(new THREE.Vector3(0, 85, 0));
      (this.truckLabel.element as HTMLElement).innerHTML = tag(TRUCK_COLOR[t.state], `truck-${t.name.replace('№', '')}`);
      if (this.follow && !this.tween) {
        const delta = m.root.position.clone().sub(this.controls.target);
        this.controls.target.add(delta.multiplyScalar(0.12));
        this.camera.position.add(delta);
      }
    } else this.truckLabel.visible = false;
    this.syncTrail(now);

    // Экскаваторы: поворот платформы между забоем и самосвалом, «копание» рукоятью.
    sim.excavators.forEach((ex, i) => {
      const m = this.excavators[i];
      const { face, truck } = this.exAngles[i];
      let target = face;
      if (ex.state === 'working') {
        const ph = (Math.sin(now / 900 + i * 1.7) + 1) / 2;
        target = lerpAngle(face, truck, ph);
        m.stick.rotation.z = -1.9 + 0.35 * Math.sin(now / 450 + i);
        m.boom.rotation.z = 0.75 + 0.12 * Math.sin(now / 900 + i);
      }
      const rel = Math.atan2(Math.sin(target - face), Math.cos(target - face));
      m.house.rotation.y = -rel;
      const col =
        ex.state === 'broken'
          ? blink
            ? '#ef4444'
            : '#450a0a'
          : ex.state === 'blast'
            ? blink
              ? '#f97316'
              : '#431407'
            : ex.state === 'nostock'
              ? blink
                ? '#a855f7'
                : '#2e1065'
              : ex.state === 'working'
              ? '#22c55e'
              : '#f59e0b';
      (m.light.material as THREE.MeshBasicMaterial).color.set(col);
      (m.ring.material as THREE.MeshBasicMaterial).color.set(col);
      const selected = sel?.kind === 'excavator' && sel.id === ex.id;
      m.ring.scale.setScalar(selected ? 1.35 + 0.1 * Math.sin(now / 150) : 1 + Math.min(0.6, ex.queue.length * 0.15));
      // Расходящиеся кольца у работающего экскаватора.
      m.scan.forEach((s, k) => {
        const ph = ((now / 1800 + k * 0.5 + i * 0.13) % 1 + 1) % 1;
        s.visible = ex.state === 'working';
        s.scale.setScalar(1 + ph * 3.2);
        const sm = s.material as THREE.MeshBasicMaterial;
        sm.color.set('#2dd4bf');
        sm.opacity = 0.7 * (1 - ph);
      });
    });

    // Дробилка: уровень силоса, конвейер.
    const c = sim.crusher;
    const frac = c.binT / c.binCapT;
    const hFill = Math.max(0.5, frac * 66);
    this.crusher.fill.scale.y = hFill;
    this.crusher.fill.position.y = 2 + hFill / 2;
    const fillCol = frac < 0.2 ? '#ef4444' : frac < 0.45 ? '#f59e0b' : '#22c55e';
    this.crusher.fillMat.color.set(fillCol);
    this.crusher.fillMat.emissive.set(fillCol);
    const starving = c.binT <= 0.01;
    this.conveyorMat.emissive.set(starving ? (blink ? '#7f1d1d' : '#000000') : '#000000');
    this.conveyorMat.color.set(starving ? '#7f1d1d' : '#6b7280');
    for (let k = 0; k < this.ore.count; k++) {
      const f = (now / 9000 + k / this.ore.count) % 1;
      const p = this.conveyorFrom.clone().lerp(this.conveyorTo, f);
      p.y += 5;
      this.tmp.makeScale(starving ? 0 : 1, starving ? 0 : 1, starving ? 0 : 1).setPosition(p);
      this.ore.setMatrixAt(k, this.tmp);
    }
    this.ore.instanceMatrix.needsUpdate = true;

    this.syncClosures(blink);
    this.syncBlasts(now, blink);
    this.syncDrills(now, blink);

    // Тексты панелей обновляем реже, чем кадры.
    if (now - this.lastPanel > 300) {
      this.lastPanel = now;
      for (const p of this.panels) (p.obj.element as HTMLElement).innerHTML = p.render();
      sim.excavators.forEach((ex, i) => {
        const q = ex.queue.length;
        const st =
          ex.state === 'broken'
            ? '<span class="bad">⚠ ПОЛОМКА</span>'
            : ex.state === 'blast'
              ? '<span class="bad">✸ ОЦЕПЛЕНИЕ</span>'
              : ex.state === 'nostock'
                ? '<span class="bad">⛏ НЕТ ВЗОРВАННОЙ МАССЫ</span>'
                : '';
        const gr = ex.gradeBase > 0 ? ` <span class="warn">${gradeAt(ex, sim.now).toFixed(2)}% Cu</span>` : '';
        const dot = ex.state === 'broken' ? '#ef4444' : ex.state === 'blast' ? '#f97316' : ex.state === 'working' ? '#2dd4bf' : '#f59e0b';
        (this.exLabels[i].element as HTMLElement).innerHTML = tag(
          dot,
          `<b>${ex.name}</b> · <span style="color:${MATERIAL_COLOR[ex.material]}">${MATERIAL_SHORT[ex.material]}</span>${gr}` +
            (q > 0 ? ` · <span class="${q >= 3 ? 'bad' : 'warn'}">очередь ${q}</span>` : '') +
            (st ? `<br>${st}` : ''),
        );
      });
    }
  }

  /** Стоянка: асфальт, проезды, разметка мест, бордюр — по той же геометрии, что граф движения. */
  private buildParking(): THREE.Group {
    const P = this.sim.parking;
    const f = P.frame;
    const grp = new THREE.Group();
    grp.position.set(f.cx, this.heightAt(f.cx, f.cy) + 1.2, f.cy);
    grp.rotation.y = -Math.atan2(f.oy, f.ox); // локальная X — «наружу», локальная Z — поперёк
    const crossOf = (c: number) => (c - (P.cols - 1) / 2) * P.dx;
    const zMin = crossOf(0) - P.dx * 1.4;
    const zMax = crossOf(P.cols - 1) + P.dx * 0.6;
    const xMax = P.aisle0 + (P.rows - 1) * P.dy + P.depth + 55;
    const pad = new THREE.Mesh(new THREE.BoxGeometry(xMax + 10, 2, zMax - zMin), new THREE.MeshStandardMaterial({ color: '#45484d', roughness: 0.9 }));
    pad.position.set(xMax / 2 - 5, 0, (zMin + zMax) / 2);
    pad.receiveShadow = true;
    grp.add(pad);
    const white = new THREE.MeshStandardMaterial({ color: '#f1f3f5', roughness: 0.6 });
    const yellow = new THREE.MeshStandardMaterial({ color: '#f5c542', roughness: 0.6 });
    for (let r = 0; r < P.rows; r++) {
      const aisle = P.aisle0 + r * P.dy;
      // Границы мест: белые линии от проезда вглубь.
      for (let c = 0; c <= P.cols; c++) {
        const z = crossOf(c) - P.dx / 2;
        const m = new THREE.Mesh(new THREE.BoxGeometry(P.depth + 40, 0.4, 2.5), white);
        m.position.set(aisle + 20 + (P.depth + 40) / 2, 1.2, z);
        grp.add(m);
      }
      // Осевая разметка проезда — жёлтый пунктир.
      for (let z = zMin + 20; z < zMax - 10; z += 30) {
        const m = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.4, 14), yellow);
        m.position.set(aisle, 1.2, z);
        grp.add(m);
      }
    }
    // Продольная полоса (слева): жёлтый пунктир вдоль.
    const spineZ = crossOf(0) - P.dx * 0.9;
    for (let x = 10; x < xMax - 40; x += 30) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(14, 0.4, 2.5), yellow);
      m.position.set(x, 1.2, spineZ);
      grp.add(m);
    }
    // Бордюр по периметру, кроме въезда со стороны карьера.
    const curb = new THREE.MeshStandardMaterial({ color: '#c9ced3', roughness: 0.8 });
    for (const [bw, bd, bx, bz] of [
      [xMax, 4, xMax / 2, zMax],
      [xMax, 4, xMax / 2, zMin],
      [4, zMax - zMin, xMax, (zMin + zMax) / 2],
    ] as const) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(bw, 4, bd), curb);
      b.position.set(bx, 2, bz);
      b.castShadow = true;
      grp.add(b);
    }
    return grp;
  }

  /** Светящаяся лента оставшегося маршрута выбранного самосвала. */
  private syncTrail(now: number): void {
    const sel = this.selection;
    const t = sel?.kind === 'truck' ? this.sim.trucks[sel.id] : null;
    const key = t && t.seg < t.path.length - 1 ? `${t.id}:${t.path.join(',')}:${t.seg}` : '';
    if (key !== this.trailKey) {
      this.trailKey = key;
      if (this.trail) {
        this.trail.geometry.dispose();
        this.scene.remove(this.trail);
        this.trail = null;
      }
      if (t && key) {
        const g = this.sim.layout.graph;
        const pts: [number, number][] = [[t.x, t.y], ...t.path.slice(t.seg + 1).map((n) => [g.nodes[n].x, g.nodes[n].y] as [number, number])];
        const pos: number[] = [];
        const idx: number[] = [];
        const w = 7;
        // Сглаживаем: шаг 15 м вдоль ломаной, высота — по рельефу.
        for (let i = 0; i + 1 < pts.length; i++) {
          const [ax, ay] = pts[i];
          const [bx, by] = pts[i + 1];
          const len = Math.hypot(bx - ax, by - ay) || 1;
          const nx = (-(by - ay) / len) * w;
          const ny = ((bx - ax) / len) * w;
          const n = Math.max(1, Math.ceil(len / 15));
          for (let k = 0; k <= n; k++) {
            const x = ax + ((bx - ax) * k) / n;
            const y = ay + ((by - ay) * k) / n;
            const h = this.heightAt(x, y) + 6;
            const base = pos.length / 3;
            pos.push(x + nx, h, y + ny, x - nx, h, y - ny);
            if (k > 0) idx.push(base - 2, base, base - 1, base - 1, base, base + 1);
          }
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        geo.setIndex(idx);
        this.trail = new THREE.Mesh(
          geo,
          new THREE.MeshBasicMaterial({ color: '#2dd4bf', transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }),
        );
        this.trail.renderOrder = 3;
        this.scene.add(this.trail);
      }
    }
    if (this.trail) (this.trail.material as THREE.MeshBasicMaterial).opacity = 0.55 + 0.3 * Math.sin(now / 250);
  }

  private truckColor(s: TruckState, blink: boolean): string {
    if (s === 'broken') return blink ? '#ef4444' : '#3b0a0a';
    return TRUCK_COLOR[s];
  }

  /** Зона взрыва: объявлен — жёлтый «купол», взрыв — вспышка и облако пыли (в реальном времени), оцепление — красный. */
  private syncBlasts(now: number, blink: boolean): void {
    const sim = this.sim;
    const live = new Set<number>();
    for (const b of sim.blasts) {
      if (b.phase !== 'warning' && b.phase !== 'active') continue;
      live.add(b.id);
      let v = this.blastViz.get(b.id);
      if (!v) v = this.makeBlastViz(b);
      const active = b.phase === 'active';
      const zm = v.zone.material as THREE.MeshBasicMaterial;
      zm.color.set(active ? '#ef4444' : '#f59e0b');
      zm.opacity = active ? (blink ? 0.22 : 0.12) : 0.12;
      const mins = Math.max(0, Math.ceil((b.t - sim.now) / 60));
      (v.lbl.element as HTMLElement).innerHTML = active ? '✸ <b>ВЗРЫВНЫЕ РАБОТЫ</b> · оцепление' : `⚠ <b>Взрыв через ${mins} мин</b> · вывод техники`;
      if (active && v.boomAt === null) v.boomAt = now;
      // Анимация взрыва идёт в реальном времени (3 с), независимо от скорости модели.
      if (v.boomAt !== null) {
        const k = Math.min(1, (now - v.boomAt) / 3000);
        v.dust.visible = k < 1;
        v.dust.scale.setScalar(0.2 + k * 1.1);
        (v.dust.material as THREE.MeshStandardMaterial).opacity = 0.75 * (1 - k);
        const f = Math.min(1, (now - v.boomAt) / 450);
        v.flash.visible = f < 1;
        v.flash.scale.setScalar(0.3 + f * 1.4);
        (v.flash.material as THREE.MeshBasicMaterial).opacity = 0.9 * (1 - f);
      }
    }
    for (const [id, v] of this.blastViz) {
      if (live.has(id)) continue;
      v.lbl.removeFromParent();
      v.grp.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
      this.scene.remove(v.grp);
      this.blastViz.delete(id);
    }
  }

  private makeBlastViz(b: Blast) {
    const grp = new THREE.Group();
    const h = this.heightAt(b.x, b.y);
    grp.position.set(b.x, h, b.y);
    const zone = new THREE.Mesh(
      new THREE.CylinderGeometry(b.radius, b.radius, 160, 48, 1, true),
      new THREE.MeshBasicMaterial({ color: '#f59e0b', transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false }),
    );
    zone.position.y = 70;
    grp.add(zone);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(b.radius - 8, b.radius, 64),
      new THREE.MeshBasicMaterial({ color: '#f59e0b', side: THREE.DoubleSide, transparent: true, opacity: 0.9, depthWrite: false }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 6;
    grp.add(ring);
    const dust = new THREE.Mesh(
      new THREE.SphereGeometry(b.radius * 0.6, 24, 16),
      new THREE.MeshStandardMaterial({ color: '#b9a688', transparent: true, opacity: 0, roughness: 1, depthWrite: false }),
    );
    dust.position.y = 40;
    dust.visible = false;
    grp.add(dust);
    const flash = new THREE.Mesh(
      new THREE.SphereGeometry(b.radius * 0.35, 20, 12),
      new THREE.MeshBasicMaterial({ color: '#ffb347', transparent: true, opacity: 0, depthWrite: false }),
    );
    flash.position.y = 30;
    flash.visible = false;
    grp.add(flash);
    const lbl = label('lbl3d bad');
    lbl.position.set(0, 200, 0);
    grp.add(lbl);
    this.scene.add(grp);
    const v = { grp, zone, lbl, boomAt: null as number | null, dust, flash };
    this.blastViz.set(b.id, v);
    return v;
  }

  private syncClosures(blink: boolean): void {
    const g = this.sim.layout.graph;
    const active = new Set(this.sim.closures.map((c) => c.label));
    for (const [key, grp] of this.closures) {
      if (!active.has(key)) {
        const css: CSS2DObject[] = [];
        grp.traverse((o) => {
          if (o instanceof CSS2DObject) css.push(o);
          (o as THREE.Mesh).geometry?.dispose();
        });
        // 'removed' приходит только удаляемому объекту — HTML-подписи убираем явно.
        for (const o of css) o.removeFromParent();
        this.scene.remove(grp);
        this.closures.delete(key);
      }
    }
    for (const c of this.sim.closures) {
      let grp = this.closures.get(c.label);
      if (!grp) {
        grp = new THREE.Group();
        const mat = new THREE.MeshBasicMaterial({ color: '#ef4444', transparent: true, opacity: 0.75 });
        for (const id of c.edges) {
          const e = g.edges[id];
          const a = g.nodes[e.a];
          const b = g.nodes[e.b];
          const mx = (a.x + b.x) / 2;
          const my = (a.y + b.y) / 2;
          const strip = new THREE.Mesh(new THREE.BoxGeometry(e.len, 3, 38), mat);
          strip.position.set(mx, this.heightAt(mx, my) + 4, my);
          strip.rotation.y = -Math.atan2(b.y - a.y, b.x - a.x);
          grp.add(strip);
        }
        const mid = g.edges[c.edges[Math.floor(c.edges.length / 2)]];
        const n = g.nodes[mid.a];
        const bar = makeBarrier();
        bar.position.set(n.x, this.heightAt(n.x, n.y) + 2, n.y);
        bar.scale.setScalar(EQUIP_SCALE / 2);
        grp.add(bar);
        const lbl = label('lbl3d bad', '⊘ ЗАКРЫТО');
        lbl.position.set(n.x, this.heightAt(n.x, n.y) + 70, n.y);
        grp.add(lbl);
        this.scene.add(grp);
        this.closures.set(c.label, grp);
      }
      const strip = grp.children[0] as THREE.Mesh;
      (strip.material as THREE.MeshBasicMaterial).opacity = blink ? 0.85 : 0.35;
    }
  }
}
