/**
 * Низкополигональные, но детальные модели техники и объектов (стиль «диорама»).
 * Размеры — в метрах реальной машины, затем масштабируются (EQUIP_SCALE), чтобы техника
 * была различима на карьере шириной 3 км.
 */
import * as THREE from 'three';

export const EQUIP_SCALE = 2.2;

const std = (color: string, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.65, metalness: 0.15, ...extra });

const MAT = {
  yellow: std('#f2b630', { roughness: 0.5 }),
  yellowDark: std('#c98d17', { roughness: 0.55 }),
  dark: std('#2b2c30', { roughness: 0.85 }),
  darker: std('#18191c', { roughness: 0.9 }),
  tyre: std('#121315', { roughness: 1 }),
  steel: std('#9aa1a9', { metalness: 0.6, roughness: 0.4 }),
  chrome: std('#cfd6dd', { metalness: 0.8, roughness: 0.25 }),
  glass: std('#1c3a52', { metalness: 0.7, roughness: 0.15, emissive: '#0d2233', emissiveIntensity: 0.4 }),
  concrete: std('#b9b8b2', { roughness: 0.95 }),
  concreteDark: std('#7d7c77', { roughness: 0.95 }),
  wall: std('#d4d6d8', { roughness: 0.6, metalness: 0.25 }),
  roof: std('#46586a', { roughness: 0.7 }),
  rail: std('#c9d1d8', { roughness: 0.5, metalness: 0.3 }),
  // Самосвал: кирпично-красный кузов, светлая кабина и площадка.
  truckBody: std('#c4442c', { roughness: 0.5 }),
  truckBodyDark: std('#93321f', { roughness: 0.55 }),
  truckCab: std('#e9edf0', { roughness: 0.45 }),
  // Экскаватор: стально-синий корпус, светлая стрела.
  exBody: std('#2c6f8e', { roughness: 0.5 }),
  exBodyDark: std('#1d4d63', { roughness: 0.55 }),
  exBoom: std('#e3e8ec', { roughness: 0.45 }),
  lamp: new THREE.MeshStandardMaterial({ color: '#fff4d6', emissive: '#ffe2a3', emissiveIntensity: 3 }),
  window: new THREE.MeshStandardMaterial({ color: '#ffd98a', emissive: '#ffcf70', emissiveIntensity: 2.2 }),
};

function box(w: number, h: number, d: number, mat: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

function cyl(rt: number, rb: number, h: number, mat: THREE.Material, seg = 16): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/** Цилиндр, лежащий вдоль оси Z (колёса, ролики, катки). */
function wheel(r: number, w: number, mat: THREE.Material, x: number, y: number, z: number, seg = 18): THREE.Mesh {
  const m = cyl(r, r, w, mat, seg);
  m.rotation.x = Math.PI / 2;
  m.position.set(x, y, z);
  return m;
}

/** Перила: стойки + поручень вдоль отрезка. */
function railing(x0: number, z0: number, x1: number, z1: number, y: number, h: number, mat: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  const len = Math.hypot(x1 - x0, z1 - z0);
  const n = Math.max(2, Math.round(len / 2));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    g.add(box(0.15, h, 0.15, mat, x0 + (x1 - x0) * t, y + h / 2, z0 + (z1 - z0) * t));
  }
  const top = box(len, 0.15, 0.15, mat, (x0 + x1) / 2, y + h, (z0 + z1) / 2);
  top.rotation.y = -Math.atan2(z1 - z0, x1 - x0);
  g.add(top);
  return g;
}

/** Камень (общая геометрия для россыпи, кузовов и конвейера). */
export const ROCK_GEO = new THREE.DodecahedronGeometry(1, 0);

/** Кольцо-подсветка на земле под объектом (цвет состояния), светится через bloom. */
export function groundRing(r: number): THREE.Mesh {
  const m = new THREE.Mesh(
    new THREE.RingGeometry(r * 0.78, r, 48),
    new THREE.MeshBasicMaterial({
      color: '#ffffff',
      transparent: true,
      opacity: 0.9,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  m.rotation.x = -Math.PI / 2;
  m.renderOrder = 2;
  return m;
}

/** Мягкое пятно света (спрайт) — для фонарей и маячков. */
let glowTex: THREE.Texture | null = null;
export function glowSprite(color: string, size: number): THREE.Sprite {
  if (!glowTex) {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const ctx = c.getContext('2d')!;
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.25, 'rgba(255,255,255,0.55)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
    glowTex = new THREE.CanvasTexture(c);
  }
  const s = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: glowTex, color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
  );
  s.scale.setScalar(size);
  return s;
}

// ───────────────────────────── самосвал ─────────────────────────────

export interface TruckModel {
  root: THREE.Group;
  ring: THREE.Mesh;
  beacon: THREE.Mesh;
  heap: THREE.Group;
  heapMat: THREE.MeshStandardMaterial;
  body: THREE.Group;
}

/** Карьерный самосвал класса 220 т (габариты ~14 × 8 × 7 м), нос — по +X. */
export function makeTruck(): TruckModel {
  const root = new THREE.Group();
  const g = new THREE.Group();
  g.scale.setScalar(EQUIP_SCALE);
  root.add(g);

  // Рама и мосты.
  g.add(box(12.5, 1.1, 3.6, MAT.dark, -0.3, 2.3, 0));
  g.add(box(1.2, 1.2, 6.2, MAT.darker, 4.6, 1.9, 0));
  g.add(box(1.4, 1.4, 6.6, MAT.darker, -3.6, 1.9, 0));
  // Колёса: передняя ось + сдвоенная задняя, с дисками.
  const wheels: [number, number][] = [
    [4.6, 3.3],
    [4.6, -3.3],
    [-3.6, 2.6],
    [-3.6, -2.6],
    [-3.6, 4.0],
    [-3.6, -4.0],
  ];
  for (const [x, z] of wheels) {
    g.add(wheel(1.9, 1.3, MAT.tyre, x, 1.9, z));
    g.add(wheel(0.95, 1.35, MAT.steel, x, 1.9, z, 12));
  }
  // Крылья над передними колёсами.
  g.add(box(3.4, 0.35, 1.7, MAT.truckBody, 4.6, 4.05, 3.3));
  g.add(box(3.4, 0.35, 1.7, MAT.truckBody, 4.6, 4.05, -3.3));
  // Капот, радиатор, бампер, фары.
  g.add(box(3.0, 2.6, 3.6, MAT.truckBody, 5.4, 3.9, 0));
  g.add(box(0.25, 2.0, 2.8, MAT.darker, 6.95, 3.8, 0));
  for (let i = 0; i < 4; i++) g.add(box(0.1, 0.12, 2.6, MAT.steel, 7.1, 3.1 + i * 0.45, 0));
  g.add(box(0.6, 0.6, 6.6, MAT.dark, 7.0, 2.4, 0));
  g.add(box(0.15, 0.45, 0.9, MAT.lamp, 7.12, 4.65, 1.2));
  g.add(box(0.15, 0.45, 0.9, MAT.lamp, 7.12, 4.65, -1.2));
  // Верхняя площадка с перилами, кабина слева, лестница.
  g.add(box(3.2, 0.3, 7.4, MAT.truckCab, 5.4, 5.35, 0));
  g.add(railing(6.9, -3.6, 6.9, 3.6, 5.5, 1.0, MAT.rail));
  g.add(box(2.6, 2.4, 2.6, MAT.truckCab, 4.9, 6.7, 2.2));
  g.add(box(0.1, 1.3, 2.2, MAT.glass, 6.22, 7.0, 2.2));
  g.add(box(2.2, 1.3, 0.1, MAT.glass, 4.9, 7.0, 3.52));
  g.add(box(2.9, 0.2, 2.9, MAT.truckCab, 4.9, 8.0, 2.2));
  const ladder = box(0.25, 4.2, 0.9, MAT.steel, 7.0, 3.3, 3.0);
  ladder.rotation.z = 0.35;
  g.add(ladder);
  g.add(box(0.5, 0.35, 0.12, MAT.chrome, 6.3, 7.4, 3.7)); // зеркало
  // Проблесковый маячок (цвет состояния).
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.45, 12, 8), new THREE.MeshBasicMaterial({ color: '#ffffff' }));
  beacon.position.set(4.9, 8.45, 2.2);
  g.add(beacon);

  // Кузов на шарнире у задней оси: днище, борта с рёбрами, передний борт и козырёк над кабиной.
  const body = new THREE.Group();
  body.position.set(-5.8, 3.0, 0);
  g.add(body);
  body.add(box(9.6, 0.5, 7.0, MAT.truckBody, 4.8, 0.3, 0));
  for (const z of [3.6, -3.6]) {
    body.add(box(9.6, 3.6, 0.35, MAT.truckBody, 4.8, 2.2, z));
    for (let i = 0; i < 4; i++) body.add(box(0.3, 3.4, 0.35, MAT.truckBodyDark, 1.6 + i * 2.4, 2.1, z + Math.sign(z) * 0.3));
    body.add(box(9.8, 0.35, 0.6, MAT.truckBodyDark, 4.8, 4.05, z));
  }
  body.add(box(0.4, 4.2, 7.5, MAT.truckBody, 9.6, 2.4, 0));
  body.add(box(3.6, 0.35, 7.6, MAT.truckBody, 11.3, 4.45, 0)); // козырёк над кабиной
  // Груз — горка камней (цвет материала).
  const heapMat = std('#c9a54a', { roughness: 1, flatShading: true });
  const heap = new THREE.Group();
  const rocks: [number, number, number, number][] = [
    [3.0, 2.7, 1.4, 1.9],
    [5.2, 3.2, -0.6, 2.3],
    [7.0, 2.8, 1.6, 1.7],
    [4.4, 2.6, -2.2, 1.6],
    [6.4, 2.6, -2.0, 1.5],
    [2.4, 2.3, -1.2, 1.4],
    [5.0, 4.4, 0.6, 1.6],
  ];
  for (const [x, y, z, r] of rocks) {
    const rock = new THREE.Mesh(ROCK_GEO, heapMat);
    rock.scale.set(r * 1.2, r * 0.9, r);
    rock.position.set(x, y, z);
    rock.rotation.set(x, z, y);
    rock.castShadow = true;
    heap.add(rock);
  }
  body.add(heap);

  const ring = groundRing(8.5 * EQUIP_SCALE);
  ring.position.y = 0.6;
  root.add(ring);
  return { root, ring, beacon, heap, heapMat, body };
}

// ───────────────────────────── экскаватор ─────────────────────────────

export interface ExcavatorModel {
  root: THREE.Group;
  house: THREE.Group;
  boom: THREE.Group;
  stick: THREE.Group;
  ring: THREE.Mesh;
  scan: THREE.Mesh[];
  light: THREE.Mesh;
  band: THREE.Mesh;
}

/** Гидравлический экскаватор (прямая лопата) ~ 20 м: гусеницы с катками, поворотная платформа, стрела, рукоять, ковш с зубьями. */
export function makeExcavator(): ExcavatorModel {
  const root = new THREE.Group();
  const g = new THREE.Group();
  g.scale.setScalar(EQUIP_SCALE);
  root.add(g);

  // Гусеничный ход.
  for (const z of [3.7, -3.7]) {
    g.add(box(9.4, 2.3, 2.4, MAT.darker, 0, 1.25, z));
    g.add(wheel(1.2, 2.45, MAT.darker, 4.7, 1.25, z));
    g.add(wheel(1.2, 2.45, MAT.darker, -4.7, 1.25, z));
    for (let i = 0; i < 5; i++) g.add(wheel(0.45, 2.5, MAT.steel, -3.4 + i * 1.7, 0.75, z, 10));
    // Траки: тонкие поперечные пластины сверху.
    for (let i = 0; i < 10; i++) g.add(box(0.35, 0.18, 2.5, MAT.dark, -4.2 + i * 0.93, 2.47, z));
  }
  g.add(box(6, 1.4, 5, MAT.dark, 0, 2.6, 0));
  const turntable = cyl(2.2, 2.2, 0.6, MAT.steel, 20);
  turntable.position.set(0, 3.3, 0);
  g.add(turntable);

  // Поворотная платформа.
  const house = new THREE.Group();
  house.position.y = 3.6;
  g.add(house);
  house.add(box(9.4, 4.4, 7.4, MAT.exBody, -1.2, 2.2, 0));
  house.add(box(3.4, 3.4, 7.6, MAT.dark, -5.4, 1.8, 0)); // противовес
  house.add(box(5.2, 0.6, 6.6, MAT.exBodyDark, -2.4, 4.7, 0)); // капот двигателя
  for (let i = 0; i < 5; i++) house.add(box(0.2, 0.15, 5.6, MAT.dark, -4.4 + i * 1.0, 5.05, 0));
  const band = box(9.5, 0.8, 7.5, std('#ffffff'), -1.2, 3.2, 0); // полоса цвета материала
  house.add(band);
  for (const z of [1.6, -1.6]) {
    const stack = cyl(0.25, 0.25, 2.2, MAT.dark, 10);
    stack.position.set(-3.6, 5.6, z);
    house.add(stack);
  }
  house.add(railing(-5.8, 3.75, 3.4, 3.75, 4.4, 1.0, MAT.rail));
  house.add(railing(-5.8, -3.75, 3.4, -3.75, 4.4, 1.0, MAT.rail));
  // Кабина с окнами.
  house.add(box(2.8, 2.8, 2.8, MAT.exBoom, 3.4, 5.8, 2.3));
  house.add(box(0.1, 1.5, 2.4, MAT.glass, 4.85, 6.0, 2.3));
  house.add(box(2.4, 1.5, 0.1, MAT.glass, 3.4, 6.0, 3.72));
  house.add(box(3.1, 0.2, 3.1, MAT.exBodyDark, 3.4, 7.3, 2.3));
  house.add(box(0.15, 0.5, 0.8, MAT.lamp, 4.95, 7.0, 1.4)); // прожектор
  const light = new THREE.Mesh(new THREE.SphereGeometry(0.55, 12, 8), new THREE.MeshBasicMaterial({ color: '#22c55e' }));
  light.position.set(-2, 6.3, 0);
  house.add(light);

  // Стрела с гидроцилиндрами.
  const boom = new THREE.Group();
  boom.position.set(3.2, 3.0, 0);
  boom.rotation.z = 0.75;
  house.add(boom);
  boom.add(box(12, 1.7, 1.5, MAT.exBoom, 6, 0, 0.85));
  boom.add(box(12, 1.7, 1.5, MAT.exBoom, 6, 0, -0.85));
  boom.add(box(11, 0.4, 3.0, MAT.exBodyDark, 6, 0.9, 0));
  for (const z of [1.9, -1.9]) {
    const c1 = cyl(0.35, 0.35, 6.5, MAT.chrome, 10);
    c1.rotation.z = Math.PI / 2 - 0.25;
    c1.position.set(3.6, -1.2, z);
    boom.add(c1);
    const c0 = cyl(0.55, 0.55, 3.5, MAT.exBodyDark, 10);
    c0.rotation.z = Math.PI / 2 - 0.25;
    c0.position.set(1.4, -1.8, z);
    boom.add(c0);
  }
  // Рукоять.
  const stick = new THREE.Group();
  stick.position.set(12, 0, 0);
  stick.rotation.z = -1.9;
  boom.add(stick);
  stick.add(box(8, 1.3, 1.6, MAT.exBoom, 4, 0, 0));
  const sc = cyl(0.3, 0.3, 5.5, MAT.chrome, 10);
  sc.rotation.z = Math.PI / 2;
  sc.position.set(3.2, 1.05, 0);
  stick.add(sc);
  // Ковш с зубьями.
  stick.add(box(3.2, 3.6, 4.6, MAT.dark, 8.4, -0.6, 0));
  stick.add(box(3.4, 0.4, 4.8, MAT.steel, 8.4, -2.5, 0));
  for (let i = 0; i < 5; i++) stick.add(box(0.9, 0.35, 0.45, MAT.steel, 9.9, -2.6, -1.9 + i * 0.95));

  const ring = groundRing(36 * (EQUIP_SCALE / 3));
  ring.position.y = 0.6;
  root.add(ring);
  // Расходящиеся «сканирующие» кольца при работе.
  const scan = [0, 1].map(() => {
    const s = groundRing(30);
    s.position.y = 1;
    root.add(s);
    return s;
  });
  return { root, house, boom, stick, ring, scan, light, band };
}

// ───────────────────────────── объекты поверхности ─────────────────────────────

/** Корпус с гофрированными стенами и светящейся полосой окон. */
function shed(w: number, h: number, d: number, withWindows = true): THREE.Group {
  const g = new THREE.Group();
  g.add(box(w, h, d, MAT.wall, 0, h / 2, 0));
  for (let x = -w / 2 + 3; x < w / 2; x += 4) {
    g.add(box(0.8, h - 1, 0.6, MAT.concrete, x, h / 2, d / 2 + 0.2));
    g.add(box(0.8, h - 1, 0.6, MAT.concrete, x, h / 2, -d / 2 - 0.2));
  }
  g.add(box(w + 4, 2.2, d + 4, MAT.roof, 0, h + 1.1, 0));
  if (withWindows) {
    g.add(box(w * 0.75, 2.4, 0.4, MAT.window, 0, h * 0.62, d / 2 + 0.6));
    g.add(box(w * 0.75, 2.4, 0.4, MAT.window, 0, h * 0.62, -d / 2 - 0.6));
  }
  return g;
}

/** Первичная дробилка: корпус, приёмный бункер, площадка разгрузки с перилами и силос (бункер руды перед ОФ). */
export function makeCrusher(): { root: THREE.Group; fill: THREE.Mesh; fillMat: THREE.MeshStandardMaterial } {
  const root = new THREE.Group();
  root.add(box(120, 6, 90, MAT.concreteDark, 0, 3, 0));
  const hall = shed(60, 44, 50);
  hall.position.set(10, 6, 0);
  root.add(hall);
  // Площадка разгрузки самосвалов + приёмная воронка.
  root.add(box(40, 10, 60, MAT.concrete, -42, 8, 0));
  root.add(railing(-62, -30, -62, 30, 13, 4, MAT.rail));
  root.add(railing(-62, 30, -22, 30, 13, 4, MAT.rail));
  root.add(railing(-62, -30, -22, -30, 13, 4, MAT.rail));
  const hopper = cyl(18, 7, 14, MAT.steel, 4);
  hopper.rotation.y = Math.PI / 4;
  hopper.position.set(-30, 18, 0);
  root.add(hopper);
  root.add(box(26, 0.6, 26, MAT.darker, -30, 25, 0));
  // Силос с индикатором заполнения.
  const shell = new THREE.Mesh(
    new THREE.CylinderGeometry(22, 22, 70, 28, 1, true),
    new THREE.MeshStandardMaterial({ color: '#a9bccb', transparent: true, opacity: 0.3, side: THREE.DoubleSide, depthWrite: false }),
  );
  shell.position.set(62, 41, 0);
  root.add(shell);
  for (let i = 0; i < 4; i++) {
    const leg = cyl(1.2, 1.2, 8, MAT.steel, 8);
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    leg.position.set(62 + Math.cos(a) * 18, 4, Math.sin(a) * 18);
    root.add(leg);
  }
  const fillMat = new THREE.MeshStandardMaterial({ color: '#22c55e', emissive: '#22c55e', emissiveIntensity: 0.6 });
  const fill = new THREE.Mesh(new THREE.CylinderGeometry(20, 20, 1, 28), fillMat);
  fill.position.set(62, 6, 0);
  root.add(fill);
  const cap = cyl(23, 23, 3, MAT.steel, 28);
  cap.position.set(62, 77, 0);
  root.add(cap);
  return { root, fill, fillMat };
}

/** Обогатительная фабрика: главный корпус с окнами, корпус мельниц, сгустители, склад руды, труба. */
export function makePlant(): THREE.Group {
  const root = new THREE.Group();
  root.add(box(360, 4, 340, MAT.concreteDark, 0, 2, 0));
  const main = shed(280, 64, 130);
  main.position.set(0, 4, 0);
  root.add(main);
  const mills = shed(120, 86, 80);
  mills.position.set(-100, 4, -20);
  root.add(mills);
  for (const z of [-40, 40]) {
    const mill = cyl(20, 20, 64, MAT.steel, 24);
    mill.rotation.z = Math.PI / 2;
    mill.position.set(50, 28, z + 120);
    root.add(mill);
  }
  for (const x of [-100, 0, 100]) {
    const tank = cyl(36, 36, 14, MAT.concrete, 32);
    tank.position.set(x, 9, -135);
    root.add(tank);
    const water = new THREE.Mesh(new THREE.CircleGeometry(33, 32), std('#3f7a83', { roughness: 0.15, metalness: 0.3 }));
    water.rotation.x = -Math.PI / 2;
    water.position.set(x, 16.2, -135);
    root.add(water);
  }
  const stack = cyl(5, 7, 120, MAT.wall, 16);
  stack.position.set(130, 62, -50);
  root.add(stack);
  for (let i = 0; i < 4; i++) root.add(box(10.5, 3, 10.5, i % 2 ? MAT.wall : std('#d64545'), 130, 106 + i * 3.2, -50));
  return root;
}

/** Отвал вскрыши: ярусный курган. */
export function makeWasteDump(): THREE.Group {
  const root = new THREE.Group();
  const mat = std('#9a7f62', { roughness: 1, flatShading: true });
  const t1 = cyl(230, 290, 40, mat, 11);
  t1.position.y = 20;
  const t2 = cyl(160, 210, 36, mat, 11);
  t2.position.y = 58;
  const t3 = cyl(90, 140, 26, mat, 11);
  t3.position.y = 89;
  root.add(t1, t2, t3);
  return root;
}

/** Площадка кучного выщелачивания: штабель оксидной руды с сетью капельного орошения. */
export function makeLeachPad(): THREE.Group {
  const root = new THREE.Group();
  root.add(box(520, 22, 230, std('#a89a6c', { roughness: 1 }), 0, 11, 0));
  root.add(box(460, 14, 180, std('#7fa07a', { roughness: 1 }), 0, 29, 0));
  for (let i = -3; i <= 3; i++) root.add(box(440, 0.8, 4, std('#bfe8dc'), 0, 36.5, i * 24));
  return root;
}

/**
 * Пруды растворов: чаши с плёнкой и насосные. Продуктивный раствор (PLS) с площадки — зеленоватый
 * от меди, рафинат после экстракции — светлее: медь из него уже забрали.
 */
export function makeSolutionPonds(): THREE.Group {
  const root = new THREE.Group();
  const liner = std('#2b3a42', { roughness: 0.9 });
  const basins = [
    { x: -200, w: 240, d: 160, color: '#1f8f72' },
    { x: 60, w: 200, d: 140, color: '#2f8f94' },
    { x: 280, w: 210, d: 150, color: '#4a86a8' },
  ];
  for (const b of basins) {
    root.add(box(b.w + 26, 11, b.d + 26, liner, b.x, 5.5, 0));
    const water = new THREE.Mesh(new THREE.PlaneGeometry(b.w, b.d), std(b.color, { roughness: 0.08, metalness: 0.35 }));
    water.rotation.x = -Math.PI / 2;
    water.position.set(b.x, 11.4, 0);
    root.add(water);
  }
  // Насосные станции между чашами.
  for (const x of [-65, 180]) {
    root.add(box(36, 18, 28, MAT.wall, x, 9, 108));
    root.add(box(38, 3, 30, std('#2f6f8f'), x, 19.5, 108));
  }
  return root;
}

/**
 * Завод SX-EW: ряды миксер-отстойников экстракции (в них янтарная органика), баки электролита,
 * цех электролиза и площадка готовых катодов.
 */
export function makeSxEw(): THREE.Group {
  const root = new THREE.Group();
  root.add(box(540, 4, 330, MAT.concreteDark, 0, 2, 0));
  // Экстракция: два ряда миксер-отстойников с мешалками.
  for (const z of [-92, -20]) {
    root.add(box(300, 20, 48, std('#6f7a84', { roughness: 0.7 }), -100, 14, z));
    const org = new THREE.Mesh(new THREE.PlaneGeometry(288, 40), std('#c9933f', { roughness: 0.25 }));
    org.rotation.x = -Math.PI / 2;
    org.position.set(-100, 24.4, z);
    root.add(org);
    for (let i = 0; i < 4; i++) {
      const mix = cyl(9, 9, 26, MAT.steel, 12);
      mix.position.set(-220 + i * 80, 34, z);
      root.add(mix);
      root.add(box(4.5, 13, 4.5, MAT.darker, -220 + i * 80, 50, z));
    }
  }
  // Баки органики и электролита.
  for (let i = 0; i < 3; i++) {
    const t = cyl(23, 23, 48, MAT.wall, 20);
    t.position.set(-215 + i * 60, 28, 112);
    root.add(t);
  }
  // Цех электролиза и площадка катодов.
  const hall = shed(200, 48, 130);
  hall.position.set(155, 4, -30);
  root.add(hall);
  for (let i = 0; i < 4; i++) root.add(box(28, 10, 48, std('#c2763a', { metalness: 0.55, roughness: 0.4 }), 90 + i * 38, 9, 118));
  return root;
}

/** Гараж / АЗС: боксы с воротами, топливные резервуары. */
export function makeGarage(): THREE.Group {
  const root = new THREE.Group();
  root.add(box(260, 3, 130, MAT.concreteDark, 0, 1.5, 0));
  const hall = shed(170, 40, 70);
  hall.position.set(-20, 3, 0);
  root.add(hall);
  for (let i = 0; i < 4; i++) root.add(box(30, 26, 1.5, MAT.darker, -80 + i * 40, 16, 36));
  for (const x of [95, 120]) {
    const t = cyl(11, 11, 46, MAT.wall, 20);
    t.rotation.x = Math.PI / 2;
    t.position.set(x, 14, -10);
    root.add(t);
  }
  return root;
}

/** Мачта освещения: опора, прожекторы, световое пятно. */
export function makeLightMast(): THREE.Group {
  const g = new THREE.Group();
  g.add(box(10, 3, 10, MAT.concreteDark, 0, 1.5, 0));
  const pole = cyl(1.4, 2.0, 80, MAT.steel, 10);
  pole.position.y = 42;
  g.add(pole);
  g.add(box(16, 2.5, 4, MAT.dark, 0, 82, 0));
  for (const x of [-5, 0, 5]) g.add(box(4, 2.5, 3, MAT.lamp, x, 80.5, 2.5));
  const glow = glowSprite('#ffe7b0', 70);
  glow.position.set(0, 80, 6);
  g.add(glow);
  return g;
}

/** Шлагбаум/барьер на закрытом участке дороги. */
export function makeBarrier(): THREE.Group {
  const root = new THREE.Group();
  const red = new THREE.MeshStandardMaterial({ color: '#ef4444', emissive: '#ef4444', emissiveIntensity: 0.8 });
  root.add(box(40, 6, 6, red, 0, 10, 0));
  root.add(box(3, 12, 3, MAT.wall, -18, 5, 0));
  root.add(box(3, 12, 3, MAT.wall, 18, 5, 0));
  return root;
}

// ───────────────────────────── буровой станок ─────────────────────────────

export interface DrillModel {
  root: THREE.Group;
  /** Мачта на шарнире: 0 — вертикально (бурение), ~1.4 — уложена для переезда. */
  mast: THREE.Group;
  /** Буровой став — вращается при бурении. */
  rod: THREE.Mesh;
  ring: THREE.Mesh;
  light: THREE.Mesh;
}

/** Гусеничный станок шарошечного бурения (~14 × 6 м, мачта ~20 м), передом — по +X. */
export function makeDrillRig(): DrillModel {
  const root = new THREE.Group();
  const g = new THREE.Group();
  g.scale.setScalar(EQUIP_SCALE);
  root.add(g);
  const body = std('#5d6b78', { roughness: 0.55 });
  const red = std('#b8452f', { roughness: 0.5 });
  // Гусеницы.
  for (const z of [2.4, -2.4]) {
    g.add(box(12, 1.6, 1.4, MAT.darker, 0, 0.8, z));
    for (let i = 0; i < 6; i++) g.add(wheel(0.45, 1.5, MAT.steel, -5 + i * 2, 0.8, z, 10));
  }
  // Платформа, машинное отделение (компрессор), кабина у мачты.
  g.add(box(13, 0.6, 6, body, 0, 1.9, 0));
  g.add(box(5.5, 3, 4.6, body, -3.2, 3.7, 0));
  for (let i = 0; i < 5; i++) g.add(box(0.15, 2, 4.4, MAT.dark, -5.2 + i * 1, 3.8, 0));
  g.add(box(2.6, 2.6, 2.4, MAT.truckCab, 4.2, 3.5, 2));
  g.add(box(0.1, 1.4, 2.0, MAT.glass, 5.52, 3.8, 2));
  g.add(railing(-6.4, 2.95, 6.4, 2.95, 2.2, 1.0, MAT.rail));
  // Домкраты-аутригеры.
  for (const [x, z] of [[5.8, 2.6], [5.8, -2.6], [-6, 2.6], [-6, -2.6]] as const) g.add(box(0.5, 1.6, 0.5, MAT.steel, x, 1.2, z));
  // Мачта на шарнире у переднего края.
  const mast = new THREE.Group();
  mast.position.set(5.2, 2.4, -0.6);
  g.add(mast);
  mast.add(box(1.4, 20, 1.4, red, 0, 10, 0));
  for (let i = 0; i < 9; i++) mast.add(box(1.6, 0.18, 1.6, MAT.dark, 0, 1.5 + i * 2.2, 0));
  mast.add(box(1.8, 1.2, 1.8, MAT.dark, 0, 18.5, 0)); // вращатель
  const rod = cyl(0.25, 0.25, 17, MAT.steel, 8);
  rod.position.set(0.95, 9, 0);
  mast.add(rod);
  const light = new THREE.Mesh(new THREE.SphereGeometry(0.5, 10, 8), new THREE.MeshBasicMaterial({ color: '#22c55e' }));
  light.position.set(0, 20.6, 0);
  mast.add(light);
  const ring = groundRing(9 * EQUIP_SCALE);
  ring.position.y = 0.6;
  root.add(ring);
  return { root, mast, rod, ring, light };
}
