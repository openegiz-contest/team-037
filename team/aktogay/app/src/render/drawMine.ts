/** Отрисовка карьера на Canvas 2D (вид сверху). Статический слой кэшируется, динамический — каждый кадр. */
import { gradeAt, pitPoint, type Simulation } from '../sim';
import { MATERIAL_COLOR, TRUCK_COLOR } from '../ui/theme';

export interface View {
  scale: number; // пикселей CSS на метр
  ox: number;
  oy: number;
  w: number;
  h: number;
}

export type Selection = { kind: 'truck' | 'excavator'; id: number } | null;

export function makeView(sim: Simulation, w: number, h: number): View {
  const b = sim.layout.bounds;
  const scale = Math.min(w / (b.maxX - b.minX), h / (b.maxY - b.minY));
  const ox = (w - (b.maxX - b.minX) * scale) / 2 - b.minX * scale;
  const oy = (h - (b.maxY - b.minY) * scale) / 2 - b.minY * scale;
  return { scale, ox, oy, w, h };
}

const sx = (v: View, x: number) => v.ox + x * v.scale;
const sy = (v: View, y: number) => v.oy + y * v.scale;

function lerpColor(a: [number, number, number], b: [number, number, number], t: number): string {
  return `rgb(${Math.round(a[0] + (b[0] - a[0]) * t)},${Math.round(a[1] + (b[1] - a[1]) * t)},${Math.round(a[2] + (b[2] - a[2]) * t)})`;
}

function label(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, color = '#cfd4da', align: CanvasTextAlign = 'center') {
  ctx.font = `600 ${size}px "Segoe UI", Roboto, sans-serif`;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(10,12,14,0.85)';
  ctx.strokeText(text, x, y);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}

/** Направление «от центра карьера» для размещения площадок. */
function outward(x: number, y: number): [number, number] {
  const l = Math.hypot(x, y) || 1;
  return [x / l, y / l];
}

export function drawStatic(ctx: CanvasRenderingContext2D, sim: Simulation, v: View): void {
  const cfg = sim.cfg;
  const g = sim.layout.graph;
  const fs = Math.max(11, Math.min(15, v.w / 60));

  // Фон — степь вокруг карьера.
  const bg = ctx.createRadialGradient(v.w / 2, v.h / 2, 10, v.w / 2, v.h / 2, Math.max(v.w, v.h) * 0.7);
  bg.addColorStop(0, '#1c1a16');
  bg.addColorStop(1, '#101113');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, v.w, v.h);

  // Сетка координат (как в диспетчерской).
  ctx.strokeStyle = 'rgba(255,255,255,0.035)';
  ctx.lineWidth = 1;
  const step = 500 * v.scale;
  for (let x = v.ox % step; x < v.w; x += step) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, v.h);
    ctx.stroke();
  }
  for (let y = v.oy % step; y < v.h; y += step) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(v.w, y);
    ctx.stroke();
  }

  const ellipse = (s: number) => {
    ctx.beginPath();
    for (let i = 0; i <= 160; i++) {
      const p = pitPoint(cfg, s, (i / 160) * Math.PI * 2);
      if (i === 0) ctx.moveTo(sx(v, p.x), sy(v, p.y));
      else ctx.lineTo(sx(v, p.x), sy(v, p.y));
    }
    ctx.closePath();
  };

  // Горизонтали рельефа вокруг карьера.
  for (const s of [1.35, 1.22, 1.1]) {
    ellipse(s);
    ctx.strokeStyle = 'rgba(180,160,130,0.07)';
    ctx.stroke();
  }

  // Уступы: от бровки (светлее) к дну (темнее).
  const n = cfg.pit.benchCount;
  const sMin = cfg.pit.bottomScale * 0.75;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const s = 1.03 - t * (1.03 - sMin);
    ellipse(s);
    ctx.fillStyle = lerpColor([74, 64, 52], [30, 27, 24], t);
    ctx.fill();
    ctx.strokeStyle = `rgba(214,190,150,${0.22 - t * 0.12})`;
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  // Подтопленное дно.
  ellipse(sMin * 0.7);
  ctx.fillStyle = 'rgba(40,70,80,0.55)';
  ctx.fill();

  // Площадки на поверхности.
  const site = (node: number, w: number, h: number, fill: string, stroke: string, text: string, push: number) => {
    const p = g.nodes[node];
    const [dx, dy] = outward(p.x, p.y);
    const cx = p.x + dx * push;
    const cy = p.y + dy * push;
    ctx.fillStyle = fill;
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(sx(v, cx - w / 2), sy(v, cy - h / 2), w * v.scale, h * v.scale, 4);
    ctx.fill();
    ctx.stroke();
    return { x: sx(v, cx), y: sy(v, cy - h / 2) - fs * 0.9, text };
  };
  const labels = [
    site(sim.layout.leach.node, 560, 260, 'rgba(43,179,154,0.16)', 'rgba(43,179,154,0.6)', 'КУЧНОЕ ВЫЩЕЛАЧИВАНИЕ', 170),
    site(sim.layout.waste.node, 420, 460, 'rgba(156,143,128,0.18)', 'rgba(156,143,128,0.55)', 'ОТВАЛ ВСКРЫШИ', 240),
    site(sim.layout.garage.node, 300, 170, 'rgba(120,130,145,0.16)', 'rgba(150,160,175,0.5)', 'ГАРАЖ / АЗС', 70),
  ];
  // Штриховка отвала.
  {
    const p = g.nodes[sim.layout.waste.node];
    const [dx, dy] = outward(p.x, p.y);
    ctx.save();
    ctx.strokeStyle = 'rgba(156,143,128,0.18)';
    for (let k = -4; k <= 4; k++) {
      const cx = p.x + dx * 240;
      const cy = p.y + dy * 240 + k * 50;
      ctx.beginPath();
      ctx.moveTo(sx(v, cx - 195), sy(v, cy));
      ctx.lineTo(sx(v, cx + 195), sy(v, cy));
      ctx.stroke();
    }
    ctx.restore();
  }

  // Фабрика и конвейер.
  const plant = sim.layout.plant;
  ctx.fillStyle = 'rgba(224,179,65,0.12)';
  ctx.strokeStyle = 'rgba(224,179,65,0.6)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(sx(v, plant.x - 170), sy(v, plant.y - 110), 340 * v.scale, 220 * v.scale, 4);
  ctx.fill();
  ctx.stroke();
  labels.push({ x: sx(v, plant.x), y: sy(v, plant.y - 110) - fs * 0.9, text: 'ОБОГАТИТЕЛЬНАЯ ФАБРИКА' });

  // Дороги.
  for (const e of g.edges) {
    const a = g.nodes[e.a];
    const b = g.nodes[e.b];
    const wide = e.kind === 'ramp' || e.kind === 'surface' || e.kind === 'rim';
    ctx.strokeStyle = wide ? '#7a6d5a' : '#5f5546';
    ctx.lineWidth = Math.max(wide ? 2.5 : 1.8, (wide ? 26 : 18) * v.scale);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(sx(v, a.x), sy(v, a.y));
    ctx.lineTo(sx(v, b.x), sy(v, b.y));
    ctx.stroke();
  }
  // Осевая линия на съездах.
  ctx.setLineDash([4, 5]);
  ctx.strokeStyle = 'rgba(240,220,170,0.25)';
  ctx.lineWidth = 1;
  for (const e of g.edges) {
    if (e.kind !== 'ramp') continue;
    const a = g.nodes[e.a];
    const b = g.nodes[e.b];
    ctx.beginPath();
    ctx.moveTo(sx(v, a.x), sy(v, a.y));
    ctx.lineTo(sx(v, b.x), sy(v, b.y));
    ctx.stroke();
  }
  ctx.setLineDash([]);

  for (const l of labels) label(ctx, l.text, l.x, l.y, fs * 0.85, '#aeb5bf');

  // Подписи съездов.
  const rA = g.nodes[sim.layout.rampA[3]];
  const rB = g.nodes[sim.layout.rampB[3]];
  label(ctx, 'Восточный съезд', sx(v, rA.x) + fs * 0.3, sy(v, rA.y) + fs * 1.2, fs * 0.75, '#8d8577');
  label(ctx, 'Западный съезд', sx(v, rB.x) - fs * 0.3, sy(v, rB.y) - fs * 1.2, fs * 0.75, '#8d8577');

  // Масштабная линейка.
  const barM = 500;
  const bx = 14;
  const by = v.h - 16;
  ctx.strokeStyle = '#8d8577';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(bx, by);
  ctx.lineTo(bx + barM * v.scale, by);
  ctx.stroke();
  label(ctx, '500 м', bx + (barM * v.scale) / 2, by - 9, fs * 0.75, '#8d8577');
}

export interface DynamicOpts {
  now: number; // performance.now(), мс
  alpha: number;
  selection: Selection;
}

export function drawDynamic(ctx: CanvasRenderingContext2D, sim: Simulation, v: View, o: DynamicOpts): void {
  const g = sim.layout.graph;
  const blinkOn = Math.floor(o.now / 350) % 2 === 0;
  const fs = Math.max(11, Math.min(15, v.w / 60));

  // Зоны взрывных работ: объявлен — жёлтый пунктир, взрыв и оцепление — красная зона.
  for (const b of sim.blasts) {
    if (b.phase !== 'warning' && b.phase !== 'active') continue;
    const cx = sx(v, b.x);
    const cy = sy(v, b.y);
    const rr = b.radius * v.scale;
    const active = b.phase === 'active';
    ctx.beginPath();
    ctx.arc(cx, cy, rr, 0, Math.PI * 2);
    ctx.fillStyle = active ? 'rgba(239,68,68,0.16)' : 'rgba(245,158,11,0.10)';
    ctx.fill();
    ctx.setLineDash(active ? [] : [6, 5]);
    ctx.strokeStyle = active ? (blinkOn ? '#ef4444' : '#7f1d1d') : '#f59e0b';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.setLineDash([]);
    const mins = Math.max(0, Math.ceil((b.t - sim.now) / 60));
    label(ctx, active ? '✸ ОЦЕПЛЕНИЕ' : `⚠ ВЗРЫВ через ${mins} мин`, cx, cy - rr - fs * 0.6, fs * 0.85, active ? '#fca5a5' : '#fcd34d');
  }

  // Закрытые участки дорог.
  for (const c of sim.closures) {
    ctx.strokeStyle = blinkOn ? '#ef4444' : '#7f1d1d';
    ctx.lineWidth = Math.max(4, 30 * v.scale);
    ctx.setLineDash([6, 4]);
    for (const id of c.edges) {
      const e = g.edges[id];
      const a = g.nodes[e.a];
      const b = g.nodes[e.b];
      ctx.beginPath();
      ctx.moveTo(sx(v, a.x), sy(v, a.y));
      ctx.lineTo(sx(v, b.x), sy(v, b.y));
      ctx.stroke();
    }
    ctx.setLineDash([]);
    const mid = g.edges[c.edges[Math.floor(c.edges.length / 2)]];
    const m = g.nodes[mid.a];
    label(ctx, '⊘ ЗАКРЫТО', sx(v, m.x), sy(v, m.y) - fs, fs * 0.85, '#fca5a5');
  }

  // Конвейер дробилка → фабрика.
  const crusher = sim.crusher;
  const plant = sim.layout.plant;
  const starving = sim.stockpile.t <= 0.01;
  ctx.strokeStyle = starving ? (blinkOn ? '#ef4444' : '#5b1a1a') : '#e0b341';
  ctx.lineWidth = Math.max(2, 14 * v.scale);
  ctx.setLineDash([8, 6]);
  ctx.lineDashOffset = starving ? 0 : -(o.now / 40) % 14;
  ctx.beginPath();
  ctx.moveTo(sx(v, crusher.x), sy(v, crusher.y));
  ctx.lineTo(sx(v, plant.x - 170), sy(v, plant.y));
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.lineDashOffset = 0;

  // Дробилка с бункером.
  {
    const cx = sx(v, crusher.x);
    const cy = sy(v, crusher.y);
    const s = Math.max(14, 90 * v.scale);
    ctx.fillStyle = '#2a2418';
    ctx.strokeStyle = starving ? (blinkOn ? '#ef4444' : '#7f1d1d') : '#e0b341';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(cx - s / 2, cy - s / 2, s, s, 3);
    ctx.fill();
    ctx.stroke();
    // Индикатор бункера.
    const frac = crusher.binT / crusher.binCapT;
    const bw = Math.max(6, s * 0.3);
    const bh = s * 1.4;
    const bx = cx + s / 2 + 6;
    const by = cy - bh / 2;
    ctx.fillStyle = '#0f1114';
    ctx.fillRect(bx, by, bw, bh);
    ctx.fillStyle = frac < 0.2 ? '#ef4444' : frac < 0.45 ? '#f59e0b' : '#22c55e';
    ctx.fillRect(bx, by + bh * (1 - frac), bw, bh * frac);
    ctx.strokeStyle = '#4b5563';
    ctx.lineWidth = 1;
    ctx.strokeRect(bx, by, bw, bh);
    label(ctx, 'ДРОБИЛКА', cx, cy - s / 2 - fs * 0.9, fs * 0.85, '#e0b341');
    label(ctx, `бункер ${Math.round(crusher.binT)} т · ${sim.binGrade.toFixed(2)}% Cu`, cx, cy + s / 2 + fs * 0.9, fs * 0.75, '#aeb5bf');
    if (starving && blinkOn) label(ctx, 'ПРОСТОЙ ОФ', sx(v, plant.x), sy(v, plant.y), fs * 1.1, '#f87171');
  }

  // Экскаваторы.
  for (const ex of sim.excavators) {
    const x = sx(v, ex.x);
    const y = sy(v, ex.y);
    const r = Math.max(7, 34 * v.scale);
    const q = ex.queue.length;
    if (q > 0) {
      // Подсветка очереди: чем длиннее, тем ярче.
      const glow = ctx.createRadialGradient(x, y, r, x, y, r * (2.4 + q * 0.6));
      glow.addColorStop(0, `rgba(245,158,11,${Math.min(0.55, 0.18 + q * 0.12)})`);
      glow.addColorStop(1, 'rgba(245,158,11,0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(x, y, r * (2.4 + q * 0.6), 0, Math.PI * 2);
      ctx.fill();
    }
    const broken = ex.state === 'broken';
    // Стрела в сторону забоя (к центру карьера).
    const [dx, dy] = outward(ex.x, ex.y);
    ctx.strokeStyle = '#d6d3d1';
    ctx.lineWidth = Math.max(2, r * 0.28);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x - dx * r * 1.7, y - dy * r * 1.7);
    ctx.stroke();
    ctx.fillStyle = MATERIAL_COLOR[ex.material];
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = Math.max(2, r * 0.3);
    ctx.strokeStyle = broken
      ? blinkOn
        ? '#ef4444'
        : '#450a0a'
      : ex.state === 'blast'
        ? blinkOn
          ? '#f97316'
          : '#431407'
        : ex.state === 'working'
          ? '#22c55e'
          : '#6b7280';
    ctx.stroke();
    if (o.selection?.kind === 'excavator' && o.selection.id === ex.id) {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, r + 7, 0, Math.PI * 2);
      ctx.stroke();
    }
    label(ctx, broken ? `${ex.name} ⚠` : ex.name, x, y - r - fs * 0.8, fs * 0.95, broken ? '#fca5a5' : '#f3f4f6');
    if (ex.gradeBase > 0) label(ctx, `${gradeAt(ex, sim.now).toFixed(2)}% Cu`, x, y + r + fs * 0.85, fs * 0.72, '#e0b341');
    if (q > 0) {
      const bxp = x + r * 0.9;
      const byp = y - r * 0.9;
      ctx.fillStyle = q >= 3 ? '#ef4444' : '#f59e0b';
      ctx.beginPath();
      ctx.arc(bxp, byp, fs * 0.7, 0, Math.PI * 2);
      ctx.fill();
      label(ctx, String(q), bxp, byp + 0.5, fs * 0.8, '#111');
    }
  }

  // Путь выбранного самосвала.
  const sel = o.selection?.kind === 'truck' ? sim.trucks[o.selection.id] : null;
  if (sel && sel.seg < sel.path.length - 1) {
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.moveTo(sx(v, sel.x), sy(v, sel.y));
    for (let i = sel.seg + 1; i < sel.path.length; i++) {
      const n = g.nodes[sel.path[i]];
      ctx.lineTo(sx(v, n.x), sy(v, n.y));
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Самосвалы.
  const tr = Math.max(4.5, 20 * v.scale);
  for (const t of sim.trucks) {
    const wx = t.px + (t.x - t.px) * o.alpha;
    const wy = t.py + (t.y - t.py) * o.alpha;
    const x = sx(v, wx);
    const y = sy(v, wy);
    if (t.state === 'broken' && !blinkOn) {
      ctx.fillStyle = '#450a0a';
    } else {
      ctx.fillStyle = TRUCK_COLOR[t.state];
    }
    ctx.beginPath();
    ctx.arc(x, y, tr, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = 'rgba(10,12,14,0.9)';
    ctx.stroke();
    if (t.loadT > 0 && t.material) {
      ctx.fillStyle = MATERIAL_COLOR[t.material];
      ctx.beginPath();
      ctx.arc(x, y, tr * 0.45, 0, Math.PI * 2);
      ctx.fill();
    }
    if (t.state === 'broken') label(ctx, '!', x, y - tr - 6, fs, '#fca5a5');
    else if (t.health.alert || t.state === 'service') {
      ctx.strokeStyle = blinkOn ? '#22d3ee' : 'rgba(34,211,238,0.35)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, tr + 4, 0, Math.PI * 2);
      ctx.stroke();
      if (t.state !== 'service') label(ctx, `⚡${t.health.risk}%`, x, y - tr - 9, fs * 0.8, '#67e8f9');
    }
    if (sel === t) {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, tr + 4, 0, Math.PI * 2);
      ctx.stroke();
      label(ctx, t.name, x, y - tr - fs * 0.9, fs * 0.9, '#ffffff');
    }
  }
}

/** Поиск объекта под курсором. */
export function hitTest(sim: Simulation, v: View, px: number, py: number): Selection {
  let best: Selection = null;
  let bestD = 16;
  for (const t of sim.trucks) {
    const d = Math.hypot(sx(v, t.x) - px, sy(v, t.y) - py);
    if (d < bestD) {
      bestD = d;
      best = { kind: 'truck', id: t.id };
    }
  }
  if (best) return best;
  bestD = 26;
  for (const e of sim.excavators) {
    const d = Math.hypot(sx(v, e.x) - px, sy(v, e.y) - py);
    if (d < bestD) {
      bestD = d;
      best = { kind: 'excavator', id: e.id };
    }
  }
  return best;
}
