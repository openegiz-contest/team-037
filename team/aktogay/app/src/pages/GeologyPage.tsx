/**
 * Раздел «Геология»: где в карьере руда — «глазами» приборов рудного контроля.
 *
 * Блочная модель (разведочное бурение) — план по горизонту и разрез вглубь; XRF-анализ шлама взрывных
 * скважин — точки, которые реально пробурили буровые станки модели; гиперспектральный скан бортов
 * дроном — что видно на открытых стенках; электроразведка — аномалия сульфидов под дном карьера.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { PageHeader } from '../components/PageHeader';
import { BENCH_M, BLOCK_M, BLOCK_T, blockSummary, buildOreModel, CUTOFF, DEST_RU, holeAssays, type HoleAssay, type OreModel, type Zone } from '../geo/orebody';
import { pitPointOf, type Simulation } from '../sim';
import { insidePits, pitsBounds } from '../geo/relief';
import { fmtInt } from '../ui/format';

type Device = 'model' | 'xrf' | 'hyper' | 'ip';

const DEVICES: { key: Device; label: string; tool: string; what: string }[] = [
  {
    key: 'model',
    label: 'Блочная модель',
    tool: 'разведочное бурение с отбором керна + лаборатория',
    what: 'Сетка блоков 25 × 25 × 15 м со средним содержанием меди. По ней планируют карьер и решают, что руда, а что вскрыша.',
  },
  {
    key: 'xrf',
    label: 'XRF шлама скважин',
    tool: 'рентгенофлуоресцентный анализатор шлама взрывных скважин',
    what: 'Каждая пробуренная скважина — проба. Уточняет границу руды прямо перед взрывом: блок пойдёт на фабрику, на выщелачивание или в отвал.',
  },
  {
    key: 'hyper',
    label: 'Гиперспектральный скан',
    tool: 'дрон с гиперспектральной камерой',
    what: 'По спектру минералов различает на открытых бортах оксидную руду (малахит), сульфидную (халькопирит) и пустую породу.',
  },
  {
    key: 'ip',
    label: 'Электроразведка (ВП)',
    tool: 'метод вызванной поляризации',
    what: 'Сульфиды «заряжаются» током. Аномалия показывает руду под дном карьера — куда пойдёт карьер дальше.',
  },
];

const ZONE_RU: Record<Zone, string> = { oxide: 'оксидная руда → выщелачивание', sulfide: 'сульфидная руда → фабрика', waste: 'пустая порода → отвал' };

/** Цвет блока по содержанию: пустая порода — серая, оксид — бирюзовый, сульфид — от охры к жёлтому. */
function oreColor(zone: Zone, cu: number): string {
  if (zone === 'waste') return cu > CUTOFF * 0.7 ? '#5b5547' : '#3d4047';
  const k = Math.min(1, Math.max(0, (cu - CUTOFF) / 0.35));
  if (zone === 'oxide') return `hsl(${172 - 10 * k} ${55 + 25 * k}% ${30 + 22 * k}%)`;
  return `hsl(${28 + 22 * k} ${70 + 20 * k}% ${32 + 26 * k}%)`;
}
/** Палитра гиперспектра: минералы. */
function hyperColor(zone: Zone, cu: number): string {
  if (zone === 'oxide') return cu > 0.32 ? '#22c55e' : '#4ade80'; // малахит / хризоколла
  if (zone === 'sulfide') return cu > 0.35 ? '#facc15' : '#ca8a04'; // халькопирит
  return '#8b7a66'; // кварц-полевошпатовая порода
}
/** Палитра электроразведки (заряжаемость): фиолетовый → жёлтый. */
function ipColor(v: number): string {
  const k = Math.min(1, Math.max(0, v));
  return `hsl(${280 - 230 * k} 75% ${18 + 42 * k}%)`;
}

interface Props {
  sim: Simulation;
  now: number;
}

export function GeologyPage({ sim, now }: Props) {
  const model = useMemo(() => buildOreModel(sim), [sim]);
  const [device, setDevice] = useState<Device>('model');
  const [bench, setBench] = useState(4);
  const [secY, setSecY] = useState(0);
  const [hover, setHover] = useState<null | { x: number; y: number; z: number; cu: number; zone: Zone; mined: boolean; src: string }>(null);
  const z = model.benches[Math.min(bench, model.benches.length - 1)];
  const dev = DEVICES.find((d) => d.key === device)!;

  const stats = useMemo(() => horizonStats(sim, model, z), [sim, model, z]);
  const holes = useMemo(() => holeAssays(sim, model), [sim, model, Math.floor(now / 60)]);

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto p-5">
      <PageHeader
        title="Геология"
        subtitle="Где в карьере руда. Руда лежит не везде: границы рудного тела находят разведочным бурением, анализом шлама взрывных скважин, сканированием бортов и электроразведкой. Ниже — карьер глазами этих приборов. Модель месторождения условная, подогнана к забоям экскаваторов."
        now={now}
      >
        <div className="flex flex-wrap overflow-hidden rounded-lg border border-line text-[13px]">
          {DEVICES.map((d) => (
            <button key={d.key} onClick={() => setDevice(d.key)} className={`px-3 py-1.5 font-semibold ${device === d.key ? 'bg-amber-500 text-black' : 'text-ink-2 hover:bg-panel-2'}`}>
              {d.label}
            </button>
          ))}
        </div>
      </PageHeader>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <section className="panel flex flex-col">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
            <div>
              <h3 className="text-[14px] font-semibold">{device === 'hyper' ? 'Борта карьера сверху — снимок дрона' : device === 'ip' ? 'Аномалия под дном карьера, глубина ~120 м ниже дна' : device === 'xrf' ? 'Пробы шлама взрывных скважин' : `План горизонта −${fmtInt(-z)} м`}</h3>
              <div className="mt-0.5 text-[12px] text-ink-3">
                Прибор: {dev.tool}
              </div>
            </div>
            {(device === 'model' || device === 'xrf') && (
              <label className="flex items-center gap-2 text-[12px] text-ink-3">
                горизонт
                <input type="range" min={0} max={model.benches.length - 1} value={bench} onChange={(e) => setBench(Number(e.target.value))} className="w-40 accent-amber-500" />
                <span className="num w-14 text-ink">−{fmtInt(-z)} м</span>
              </label>
            )}
          </div>
          <PlanCanvas sim={sim} model={model} device={device} z={z} holes={holes} secY={secY} onHover={setHover} />
          <div className="border-t border-line px-4 py-2 text-[12px] text-ink-3">
            {hover ? (
              <span>
                <b className="text-ink">{hover.src}</b> · x {fmtInt(hover.x)}, y {fmtInt(hover.y)}, отметка −{fmtInt(-hover.z)} м ·{' '}
                {hover.mined ? 'уже вынуто' : <>Cu <b className="num text-amber-300">{hover.cu.toFixed(2)} %</b> · {ZONE_RU[hover.zone]}</>}
              </span>
            ) : (
              <Legend device={device} />
            )}
          </div>
        </section>

        <aside className="flex flex-col gap-4">
          <section className="panel px-4 py-3">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-amber-400">{dev.label}</div>
            <p className="mt-1.5 text-[13px] leading-relaxed text-ink-2">{dev.what}</p>
          </section>
          {device === 'xrf' ? (
            <XrfPanel holes={holes} sim={sim} />
          ) : device !== 'model' ? (
            <section className="panel px-4 py-3 text-[13px] leading-relaxed text-ink-2">
              {device === 'hyper'
                ? 'Сверху карьера видна только открытая поверхность бортов и дна. Зелёное — оксидная руда в верхних уступах, жёлтое — сульфидная ниже, серо-коричневое — пустая порода. Так геолог проверяет, совпадает ли вскрытый борт с моделью.'
                : 'Под дном карьера сульфидная руда продолжается: яркая аномалия — будущие горизонты. По ней планируют углубку карьера и следующие стадии.'}
            </section>
          ) : (
            <section className="panel px-4 py-3">
              <h3 className="text-[13px] font-semibold">Горизонт −{fmtInt(-z)} м: что ещё в массиве</h3>
              <div className="mt-2 space-y-1.5 text-[13px]">
                <StatRow color={oreColor('sulfide', 0.4)} k="Сульфидная руда" v={`${fmtInt(stats.sulfideT / 1e3)} тыс. т`} sub={`ср. ${stats.sulfideCu.toFixed(2)} % Cu`} />
                <StatRow color={oreColor('oxide', 0.35)} k="Оксидная руда" v={`${fmtInt(stats.oxideT / 1e3)} тыс. т`} sub={`ср. ${stats.oxideCu.toFixed(2)} % Cu`} />
                <StatRow color={oreColor('waste', 0.05)} k="Пустая порода" v={`${fmtInt(stats.wasteT / 1e3)} тыс. т`} sub="" />
                <div className="border-t border-line pt-1.5 text-[12px] text-ink-3">
                  Меди в руде горизонта (в контуре карьера): <b className="num text-ink">{fmtInt(stats.cuT)} т</b>
                  <br />
                  Коэффициент вскрыши: <b className="num text-ink">{stats.strip.toFixed(2)}</b> т породы на тонну руды
                </div>
              </div>
            </section>
          )}
          <section className="panel px-4 py-3 text-[12px] leading-relaxed text-ink-3">
            Бортовое содержание {CUTOFF.toFixed(2)} % Cu: ниже — порода в отвал. Блок {BLOCK_M} × {BLOCK_M} × {BENCH_M} м ≈ {fmtInt(BLOCK_T)} т. Зона окисления —
            верхние ~110 м. Наведите курсор на карту, чтобы увидеть блок.
          </section>
        </aside>
      </div>

      <section className="panel flex flex-col">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
          <div>
            <h3 className="text-[14px] font-semibold">Разрез карьера вдоль длинной оси</h3>
            <div className="mt-0.5 text-[12px] text-ink-3">Над линией борта — уже вынуто; ниже — массив по блочной модели. Видно, как рудное тело уходит вглубь под дно карьера.</div>
          </div>
          <label className="flex items-center gap-2 text-[12px] text-ink-3">
            линия разреза
            <input type="range" min={-600} max={600} step={25} value={secY} onChange={(e) => setSecY(Number(e.target.value))} className="w-40 accent-amber-500" />
            <span className="num w-16 text-ink">y {secY > 0 ? '+' : ''}{secY} м</span>
          </label>
        </div>
        <SectionCanvas sim={sim} model={model} y={secY} z={device === 'model' || device === 'xrf' ? z : null} />
      </section>
    </div>
  );
}

function StatRow({ color, k, v, sub }: { color: string; k: string; v: string; sub: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="h-3 w-3 shrink-0 rounded-sm" style={{ background: color }} />
      <span className="flex-1 text-ink-2">{k}</span>
      <span className="num text-right font-semibold">
        {v}
        {sub && <span className="block text-[11px] font-normal text-ink-3">{sub}</span>}
      </span>
    </div>
  );
}

function Legend({ device }: { device: Device }) {
  const items: [string, string][] =
    device === 'hyper'
      ? [['#22c55e', 'малахит, хризоколла (оксид)'], ['#facc15', 'халькопирит (сульфид)'], ['#8b7a66', 'пустая порода']]
      : device === 'ip'
        ? [[ipColor(0.1), 'слабая заряжаемость'], [ipColor(0.55), 'средняя'], [ipColor(1), 'сильная — сульфиды']]
        : [[oreColor('sulfide', 0.25), 'сульфид 0,2–0,3 %'], [oreColor('sulfide', 0.5), 'сульфид 0,5 % +'], [oreColor('oxide', 0.3), 'оксидная руда'], [oreColor('waste', 0.05), 'пустая порода'], ['#16181d', 'уже вынуто']];
  return (
    <span className="flex flex-wrap gap-x-4 gap-y-1">
      {items.map(([c, l]) => (
        <span key={l} className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: c }} />
          {l}
        </span>
      ))}
      <span className="text-ink-3">· наведите курсор на карту</span>
    </span>
  );
}

// ───────────────────────────── расчёты ─────────────────────────────

function insidePit(sim: Simulation, x: number, y: number, k = 1): boolean {
  return insidePits(sim.cfg, x, y, k);
}

/** Половины размеров области, охватывающей все выработки (план — симметрично вокруг начала координат). */
function halfExtent(sim: Simulation, kx: number, ky: number): { A: number; B: number } {
  const b = pitsBounds(sim.cfg);
  return { A: Math.max(-b.minX, b.maxX) * kx, B: Math.max(-b.minY, b.maxY) * ky };
}

function horizonStats(sim: Simulation, m: OreModel, z: number) {
  let sT = 0, sCu = 0, oT = 0, oCu = 0, wT = 0;
  const { A, B } = halfExtent(sim, 1, 1);
  for (let x = -A; x <= A; x += BLOCK_M)
    for (let y = -B; y <= B; y += BLOCK_M) {
      if (!insidePit(sim, x, y)) continue;
      if (m.surface(x, y) < z) continue; // на этом горизонте уже вынуто
      const zone = m.zone(x, y, z);
      const cu = m.cu(x, y, z);
      if (zone === 'sulfide') { sT += BLOCK_T; sCu += cu * BLOCK_T; }
      else if (zone === 'oxide') { oT += BLOCK_T; oCu += cu * BLOCK_T; }
      else wT += BLOCK_T;
    }
  return {
    sulfideT: sT,
    oxideT: oT,
    wasteT: wT,
    sulfideCu: sT ? sCu / sT : 0,
    oxideCu: oT ? oCu / oT : 0,
    cuT: (sCu + oCu) / 100,
    strip: sT + oT ? wT / (sT + oT) : 0,
  };
}

type Hole = HoleAssay;

function XrfPanel({ holes, sim }: { holes: Hole[]; sim: Simulation }) {
  const rows = blockSummary(sim, holes).map((r) => ({ ...r, dest: DEST_RU[r.dest] }));
  return (
    <section className="panel px-4 py-3">
      <h3 className="text-[13px] font-semibold">Рудный контроль по блокам</h3>
      <div className="mt-0.5 text-[12px] text-ink-3">Скважины, которые пробурили станки БУ-1 и БУ-2, и решение, куда пойдёт блок после взрыва.</div>
      <table className="mt-2 w-full text-[12.5px]">
        <thead>
          <tr className="text-left text-[10.5px] uppercase tracking-wider text-ink-3">
            <th className="py-1 font-medium">Блок у</th>
            <th className="py-1 font-medium">Проб</th>
            <th className="py-1 font-medium">Ср. Cu</th>
            <th className="py-1 font-medium">Куда</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.name} className="border-t border-line/60">
              <td className="py-1 font-semibold">{r.name}</td>
              <td className="num py-1">
                {r.n}/{r.total}
              </td>
              <td className="num py-1 text-amber-300">{r.avg === null ? '—' : `${r.avg.toFixed(2)} %`}</td>
              <td className="py-1 text-ink-2">{r.dest}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

// ───────────────────────────── холсты ─────────────────────────────

function useCanvasSize(ref: React.RefObject<HTMLDivElement | null>, aspect: number) {
  const [w, setW] = useState(900);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(Math.max(320, Math.floor(el.clientWidth))));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return { w, h: Math.round(w * aspect) };
}

function PlanCanvas({
  sim,
  model,
  device,
  z,
  holes,
  secY,
  onHover,
}: {
  sim: Simulation;
  model: OreModel;
  device: Device;
  z: number;
  holes: Hole[];
  secY: number;
  onHover: (h: null | { x: number; y: number; z: number; cu: number; zone: Zone; mined: boolean; src: string }) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const cv = useRef<HTMLCanvasElement>(null);
  const { A, B } = halfExtent(sim, 1.12, 1.15);
  const { w, h } = useCanvasSize(box, B / A);
  const sx = (x: number) => ((x + A) / (2 * A)) * w;
  const sy = (y: number) => ((y + B) / (2 * B)) * h;

  // Подложка (тяжёлая часть) — пересчитывается только при смене прибора, горизонта или размера.
  const bg = useMemo(() => {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g = c.getContext('2d')!;
    g.fillStyle = '#101216';
    g.fillRect(0, 0, w, h);
    const step = device === 'ip' ? 50 : BLOCK_M;
    const cw = (step / (2 * A)) * w + 0.6;
    const ch = (step / (2 * B)) * h + 0.6;
    for (let x = -A; x < A; x += step)
      for (let y = -B; y < B; y += step) {
        const cx = x + step / 2, cy = y + step / 2;
        let col: string | null = null;
        if (device === 'model' || device === 'xrf') {
          const surf = model.surface(cx, cy);
          if (surf < z) col = '#16181d'; // выработано
          else col = device === 'xrf' ? shade(oreColor(model.zone(cx, cy, z), model.cu(cx, cy, z))) : oreColor(model.zone(cx, cy, z), model.cu(cx, cy, z));
        } else if (device === 'hyper') {
          if (!insidePit(sim, cx, cy, 1.02)) continue;
          const sz = model.surface(cx, cy) - 2;
          col = hyperColor(model.zone(cx, cy, sz), model.cu(cx, cy, sz));
        } else {
          // ВП: сглаженная доля сульфидов в объёме ~120 м под дном карьера
          let s = 0, n = 0;
          for (const dz of [-330, -370, -410])
            for (const [ox, oy] of [[0, 0], [60, 0], [-60, 0], [0, 60], [0, -60]]) {
              const zz = model.zone(cx + ox, cy + oy, dz);
              s += zz === 'sulfide' || zz === 'oxide' ? Math.min(1, model.cu(cx + ox, cy + oy, dz) / 0.5) : 0.05;
              n++;
            }
          col = ipColor(s / n);
        }
        g.fillStyle = col;
        g.fillRect(sx(x), sy(y), cw, ch);
      }
    // Контур карьера (бровка и дно) и дороги.
    g.lineWidth = 1.5;
    g.strokeStyle = device === 'ip' ? 'rgba(255,255,255,.65)' : 'rgba(240,230,210,.8)';
    for (const pit of sim.cfg.pits)
      for (const s of [1, pit.bottomScale]) {
        g.beginPath();
        for (let i = 0; i <= 96; i++) {
          const p = pitPointOf(pit, s, (i / 96) * Math.PI * 2);
          if (i === 0) g.moveTo(sx(p.x), sy(p.y));
          else g.lineTo(sx(p.x), sy(p.y));
        }
        g.stroke();
      }
    const gr = sim.layout.graph;
    g.strokeStyle = 'rgba(255,255,255,.18)';
    g.lineWidth = 1;
    g.beginPath();
    for (const e of gr.edges) {
      if (e.kind === 'lot' || e.kind === 'park') continue;
      const a = gr.nodes[e.a], b = gr.nodes[e.b];
      g.moveTo(sx(a.x), sy(a.y));
      g.lineTo(sx(b.x), sy(b.y));
    }
    g.stroke();
    return c;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sim, model, device, z, w, h]);

  // Живой слой: экскаваторы, буровые, пробы, линия разреза.
  useEffect(() => {
    const c = cv.current;
    if (!c) return;
    const g = c.getContext('2d')!;
    g.drawImage(bg, 0, 0);
    g.setLineDash([6, 5]);
    g.strokeStyle = 'rgba(56,189,248,.7)';
    g.beginPath();
    g.moveTo(0, sy(secY));
    g.lineTo(w, sy(secY));
    g.stroke();
    g.setLineDash([]);
    if (device === 'xrf') {
      for (const hl of holes) {
        g.fillStyle = oreColor(hl.cu < CUTOFF ? 'waste' : model.zone(hl.x, hl.y, hl.z), hl.cu < CUTOFF ? 0.05 : hl.cu);
        g.strokeStyle = '#0b0d10';
        g.beginPath();
        g.arc(sx(hl.x), sy(hl.y), 3.2, 0, Math.PI * 2);
        g.fill();
        g.stroke();
      }
    }
    g.font = '600 12px Inter, sans-serif';
    for (const e of sim.excavators) {
      g.fillStyle = '#0b0d10';
      g.beginPath();
      g.arc(sx(e.x), sy(e.y), 6, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = e.material === 'sulfide' ? '#facc15' : e.material === 'oxide' ? '#2dd4bf' : '#a3a3a3';
      g.lineWidth = 2.5;
      g.stroke();
      g.fillStyle = '#fff';
      g.fillText(e.name, sx(e.x) + 9, sy(e.y) + 4);
    }
    for (const r of sim.drill.rigs) {
      g.fillStyle = '#ef4444';
      g.fillRect(sx(r.x) - 3, sy(r.y) - 3, 6, 6);
    }
  }, [bg, holes, sim, sim.now, device, model, secY, w, sx, sy]);

  const move = (ev: React.MouseEvent<HTMLCanvasElement>) => {
    const rc = ev.currentTarget.getBoundingClientRect();
    const x = ((ev.clientX - rc.left) / rc.width) * 2 * A - A;
    const y = ((ev.clientY - rc.top) / rc.height) * 2 * B - B;
    if (device === 'hyper') {
      const sz = model.surface(x, y) - 2;
      onHover({ x, y, z: sz, cu: model.cu(x, y, sz), zone: model.zone(x, y, sz), mined: false, src: 'Скан борта' });
      return;
    }
    if (device === 'ip') {
      onHover({ x, y, z: -370, cu: model.cu(x, y, -370), zone: model.zone(x, y, -370), mined: false, src: 'Под дном (по модели)' });
      return;
    }
    if (device === 'xrf') {
      const near = holes.reduce<Hole | null>((best, hl) => (Math.hypot(hl.x - x, hl.y - y) < 18 && (!best || Math.hypot(hl.x - x, hl.y - y) < Math.hypot(best.x - x, best.y - y)) ? hl : best), null);
      if (near) {
        onHover({ x: near.x, y: near.y, z: near.z, cu: near.cu, zone: near.cu < CUTOFF ? 'waste' : model.zone(near.x, near.y, near.z), mined: false, src: 'Проба XRF скважины' });
        return;
      }
    }
    onHover({ x, y, z, cu: model.cu(x, y, z), zone: model.zone(x, y, z), mined: model.surface(x, y) < z, src: 'Блок модели' });
  };

  return (
    <div ref={box} className="w-full">
      <canvas ref={cv} width={w} height={h} className="block w-full cursor-crosshair" onMouseMove={move} onMouseLeave={() => onHover(null)} />
    </div>
  );
}

/** Приглушить цвет (подложка под пробами XRF). */
function shade(col: string): string {
  if (col.startsWith('hsl')) return col.replace(/(\d+)%\)$/, (_, l) => `${Math.round(Number(l) * 0.45)}%)`);
  return '#26282d';
}

function SectionCanvas({ sim, model, y, z }: { sim: Simulation; model: OreModel; y: number; z: number | null }) {
  const box = useRef<HTMLDivElement>(null);
  const cv = useRef<HTMLCanvasElement>(null);
  const A = halfExtent(sim, 1.12, 1).A;
  const zTop = 40;
  const zBot = -520;
  const { w, h } = useCanvasSize(box, 0.28);
  useEffect(() => {
    const c = cv.current;
    if (!c) return;
    const g = c.getContext('2d')!;
    const sx = (x: number) => ((x + A) / (2 * A)) * w;
    const sz = (zz: number) => ((zTop - zz) / (zTop - zBot)) * h;
    g.fillStyle = '#0d1b2a';
    g.fillRect(0, 0, w, h);
    const dx = BLOCK_M;
    const dz = 10;
    const cw = (dx / (2 * A)) * w + 0.6;
    const ch = (dz / (zTop - zBot)) * h + 0.6;
    for (let x = -A; x < A; x += dx) {
      const surf = model.surface(x + dx / 2, y);
      for (let zz = zTop; zz > zBot; zz -= dz) {
        const zc = zz - dz / 2;
        if (zc > surf) continue; // воздух / вынуто
        g.fillStyle = oreColor(model.zone(x + dx / 2, y, zc), model.cu(x + dx / 2, y, zc));
        g.fillRect(sx(x), sz(zz), cw, ch);
      }
    }
    // Граница зоны окисления.
    g.strokeStyle = 'rgba(45,212,191,.8)';
    g.setLineDash([4, 4]);
    g.beginPath();
    for (let x = -A; x <= A; x += dx) {
      const zz = model.oxideBase(x, y);
      if (x === -A) g.moveTo(sx(x), sz(zz));
      else g.lineTo(sx(x), sz(zz));
    }
    g.stroke();
    g.setLineDash([]);
    // Профиль карьера.
    g.strokeStyle = '#f5e9d3';
    g.lineWidth = 2;
    g.beginPath();
    for (let x = -A; x <= A; x += 10) {
      const zz = model.surface(x, y);
      if (x === -A) g.moveTo(sx(x), sz(zz));
      else g.lineTo(sx(x), sz(zz));
    }
    g.stroke();
    g.lineWidth = 1;
    if (z !== null) {
      g.strokeStyle = 'rgba(245,158,11,.8)';
      g.setLineDash([6, 4]);
      g.beginPath();
      g.moveTo(0, sz(z));
      g.lineTo(w, sz(z));
      g.stroke();
      g.setLineDash([]);
    }
    // Экскаваторы рядом с линией разреза.
    g.font = '600 11px Inter, sans-serif';
    for (const e of sim.excavators) {
      if (Math.abs(e.y - y) > 160) continue;
      const ez = model.surface(e.x, e.y);
      g.fillStyle = '#fff';
      g.beginPath();
      g.arc(sx(e.x), sz(ez), 4, 0, Math.PI * 2);
      g.fill();
      g.fillText(e.name, sx(e.x) + 6, sz(ez) - 6);
    }
    // Шкала глубин.
    g.fillStyle = 'rgba(255,255,255,.55)';
    for (let zz = 0; zz >= zBot; zz -= 100) {
      g.fillText(`${zz} м`, 4, sz(zz) + 4);
      g.fillRect(36, sz(zz), 6, 1);
    }
    g.fillStyle = 'rgba(45,212,191,.9)';
    g.fillText('граница зоны окисления', w - 160, sz(model.oxideBase(A * 0.8, y)) - 6);
  }, [sim, model, y, z, w, h, A]);
  return (
    <div ref={box} className="w-full">
      <canvas ref={cv} width={w} height={h} className="block w-full" />
    </div>
  );
}
