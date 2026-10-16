/**
 * Раздел «Карта ГОК»: 2D-схема всего горно-обогатительного комбината. Карьер, техника и объекты
 * переработки из модели — живые; остальные здания комбината — условная схема по открытым данным.
 * Колесо — масштаб, перетаскивание — сдвиг, клик по объекту — карточка.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { PageHeader } from '../components/PageHeader';
import { buildSiteMap, LAYERS, LINE_STYLE, type Layer, type Shape, type SiteObject } from '../geo/sitemap';
import { pitPoint, type Simulation } from '../sim';
import type { BuildingKind } from '../render3d/MineScene';
import { isLive, smoothTruck } from '../render/smooth';
import { TRUCK_COLOR } from '../ui/theme';
import { thingIds } from '../platform/twins';

interface Props {
  sim: Simulation;
  now: number;
  onOpenInside: (kind: BuildingKind) => void;
}

/** Границы схемы, м. */
const BOUNDS = { minX: -3300, maxX: 4500, minY: -2900, maxY: 2300 };

function center(s: Shape): [number, number] {
  if (s.kind === 'poly') return [s.pts.reduce((n, p) => n + p[0], 0) / s.pts.length, s.pts.reduce((n, p) => n + p[1], 0) / s.pts.length];
  return [s.x, s.y];
}

export function SiteMapPage({ sim, now, onOpenInside }: Props) {
  const { objects, lines } = useMemo(() => buildSiteMap(sim), [sim]);
  const [layers, setLayers] = useState<Record<Layer, boolean>>({ pit: true, process: true, waste: true, infra: true, utility: true, transport: true });
  const [view, setView] = useState({ x: (BOUNDS.minX + BOUNDS.maxX) / 2, y: (BOUNDS.minY + BOUNDS.maxY) / 2, w: BOUNDS.maxX - BOUNDS.minX });
  const [selId, setSelId] = useState<string | null>('pit');
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 1000, h: 640 });
  const drag = useRef<{ x: number; y: number; vx: number; vy: number; moved: boolean } | null>(null);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const aspect = size.h / Math.max(1, size.w);
  const vh = view.w * aspect;
  const px = view.w / Math.max(1, size.w); // метров на пиксель
  const vb = `${view.x - view.w / 2} ${view.y - vh / 2} ${view.w} ${vh}`;
  const sel = objects.find((o) => o.id === selId) ?? null;
  const ids = thingIds('smart') as Record<string, unknown>;

  const zoom = (k: number, cx = view.x, cy = view.y) =>
    setView((v) => {
      const w = Math.max(600, Math.min(BOUNDS.maxX - BOUNDS.minX + 2000, v.w * k));
      return { w, x: cx + (v.x - cx) * (w / v.w), y: cy + (v.y - cy) * (w / v.w) };
    });

  const toWorld = (clientX: number, clientY: number) => {
    const r = box.current!.getBoundingClientRect();
    return [view.x - view.w / 2 + ((clientX - r.left) / r.width) * view.w, view.y - vh / 2 + ((clientY - r.top) / r.height) * vh] as const;
  };

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const [wx, wy] = toWorld(e.clientX, e.clientY);
      zoom(e.deltaY > 0 ? 1.15 : 1 / 1.15, wx, wy);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  });

  const fs = 13 * px; // размер подписи в метрах, чтобы на экране было ~13 px
  const visible = (l: Layer) => layers[l];

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-hidden p-5">
      <PageHeader
        title="Карта ГОК"
        subtitle="Схема всего горно-обогатительного комбината. Карьер, техника, дробилка, склад, ОФ-1, выщелачивание, отвал и гараж — живые, по данным двойников; остальные объекты (ОФ-2, завод SX-EW, хвостохранилище, подстанция, склады, посёлок) — условная схема по открытым данным: состав реальный, расположение нет."
        now={now}
      />
      <div className="flex flex-wrap items-center gap-1.5">
        {LAYERS.map((l) => (
          <button
            key={l.key}
            onClick={() => setLayers((s) => ({ ...s, [l.key]: !s[l.key] }))}
            className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[12.5px] ${layers[l.key] ? 'border-line bg-panel-2 text-ink' : 'border-line/50 text-ink-3 line-through'}`}
          >
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: l.color }} />
            {l.label}
          </button>
        ))}
        <span className="ml-auto flex gap-1">
          <button onClick={() => zoom(1 / 1.4)} className="rounded-md border border-line px-2.5 py-1 text-[13px]">+</button>
          <button onClick={() => zoom(1.4)} className="rounded-md border border-line px-2.5 py-1 text-[13px]">−</button>
          <button onClick={() => setView({ x: (BOUNDS.minX + BOUNDS.maxX) / 2, y: (BOUNDS.minY + BOUNDS.maxY) / 2, w: BOUNDS.maxX - BOUNDS.minX })} className="rounded-md border border-line px-2.5 py-1 text-[12.5px]">
            Весь ГОК
          </button>
        </span>
      </div>

      <div className="grid min-h-0 flex-1 gap-3 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div
          ref={box}
          className="relative min-h-[420px] cursor-grab overflow-hidden rounded-[10px] border border-line active:cursor-grabbing"
          style={{ background: '#1a1712' }}
          onPointerDown={(e) => {
            drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, moved: false };
            (e.target as Element).setPointerCapture?.(e.pointerId);
          }}
          onPointerMove={(e) => {
            const d = drag.current;
            if (!d) return;
            const r = box.current!.getBoundingClientRect();
            const mx = ((e.clientX - d.x) / r.width) * view.w;
            const my = ((e.clientY - d.y) / r.height) * vh;
            if (Math.abs(e.clientX - d.x) + Math.abs(e.clientY - d.y) > 4) d.moved = true;
            setView((v) => ({ ...v, x: d.vx - mx, y: d.vy - my }));
          }}
          onPointerUp={() => {
            drag.current = null;
          }}
        >
          <svg viewBox={vb} className="absolute inset-0 h-full w-full select-none" preserveAspectRatio="xMidYMid meet">
            <defs>
              <pattern id="sand" width="400" height="400" patternUnits="userSpaceOnUse">
                <rect width="400" height="400" fill="#211d16" />
                <circle cx="80" cy="120" r="3" fill="#2b261d" />
                <circle cx="300" cy="60" r="4" fill="#2b261d" />
                <circle cx="220" cy="310" r="3" fill="#2b261d" />
              </pattern>
            </defs>
            <rect x={BOUNDS.minX - 3000} y={BOUNDS.minY - 3000} width={BOUNDS.maxX - BOUNDS.minX + 6000} height={BOUNDS.maxY - BOUNDS.minY + 6000} fill="url(#sand)" />
            {/* Граница промплощадки */}
            <rect x={BOUNDS.minX + 150} y={BOUNDS.minY + 150} width={BOUNDS.maxX - BOUNDS.minX - 300} height={BOUNDS.maxY - BOUNDS.minY - 300} fill="none" stroke="#4b4334" strokeWidth={6 * px} strokeDasharray={`${20 * px} ${10 * px}`} />

            {/* Линии: дороги снизу, затем коммуникации */}
            {lines
              .filter((l) => visible(l.layer))
              .sort((a, b) => (a.kind === 'road' ? -1 : 0) - (b.kind === 'road' ? -1 : 0))
              .map((l) => {
                const st = LINE_STYLE[l.kind];
                return (
                  <polyline
                    key={l.id}
                    points={l.pts.map((p) => p.join(',')).join(' ')}
                    fill="none"
                    stroke={st.color}
                    strokeOpacity={l.kind === 'road' ? 0.45 : 0.9}
                    strokeWidth={l.kind === 'road' ? Math.max(40, 3 * px) : st.width * px * 0.6}
                    strokeDasharray={st.dash ? st.dash.split(' ').map((v) => Number(v) * px * 0.6).join(' ') : undefined}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <title>{l.name}</title>
                  </polyline>
                );
              })}

            {/* Дороги карьера из модели */}
            {visible('transport') && <PitRoads sim={sim} px={px} />}

            {/* Карьер: контуры уступов */}
            {visible('pit') && <PitContours sim={sim} px={px} onPick={() => setSelId('pit')} selected={selId === 'pit'} />}

            {/* Охранная зона склада ВМ */}
            {visible('infra') &&
              objects
                .filter((o) => o.id === 'magazine')
                .map((o) => {
                  const [cx, cy] = center(o.shape);
                  return <circle key="zone" cx={cx} cy={cy} r={450} fill="#7f1d1d" fillOpacity={0.08} stroke="#ef4444" strokeOpacity={0.5} strokeDasharray="30 18" strokeWidth={4 * px} />;
                })}

            {/* Объекты */}
            {objects
              .filter((o) => o.id !== 'pit' && visible(o.layer))
              .map((o) => (
                <ObjectShape key={o.id} o={o} px={px} selected={o.id === selId} onPick={() => !drag.current?.moved && setSelId(o.id)} />
              ))}

            {/* Живая техника */}
            {visible('pit') && <Vehicles sim={sim} px={px} />}

            {/* Подписи */}
            {objects
              .filter((o) => visible(o.layer))
              .map((o) => {
                const [cx, cy] = o.id === 'pit' ? [0, -sim.cfg.pit.semiMinorM * 0.55] : center(o.shape);
                const r = o.shape.kind === 'circle' ? o.shape.r : o.shape.kind === 'rect' ? o.shape.h / 2 : 0;
                const below = !!o.labelBelow;
                return (
                  <text
                    key={`l${o.id}`}
                    x={cx}
                    y={below ? cy + r + fs * 1.2 : cy - r - fs * 0.5}
                    textAnchor="middle"
                    fontSize={fs}
                    fontWeight={700}
                    fill={o.live ? '#fde68a' : '#e5e7eb'}
                    stroke="#0b0d10"
                    strokeWidth={fs * 0.28}
                    paintOrder="stroke"
                    style={{ pointerEvents: 'none' }}
                  >
                    {o.label ?? o.name}
                    {o.live ? ' ●' : ''}
                  </text>
                );
              })}
          </svg>

          {/* Масштабная линейка и легенда */}
          <div className="pointer-events-none absolute bottom-2 left-2 rounded-md bg-black/60 px-2 py-1 text-[11.5px] text-white/80">
            <ScaleBar px={px} />
          </div>
          <div className="pointer-events-none absolute bottom-2 right-2 max-w-[360px] rounded-md bg-black/60 px-2 py-1.5 text-[11px] text-white/80">
            <div className="flex flex-wrap gap-x-3 gap-y-1">
              {Object.entries(LINE_STYLE).map(([k, s]) => (
                <span key={k} className="flex items-center gap-1">
                  <svg width="22" height="6">
                    <line x1="0" y1="3" x2="22" y2="3" stroke={s.color} strokeWidth="3" strokeDasharray={s.dash ? '5 3' : undefined} />
                  </svg>
                  {s.label}
                </span>
              ))}
              <span className="text-amber-200">● — живые данные модели</span>
            </div>
          </div>
        </div>

        <aside className="min-h-0 overflow-y-auto">
          {sel ? (
            <section className="panel px-4 py-3">
              <div className="flex items-center gap-2">
                <span className={`rounded px-1.5 py-0.5 text-[10.5px] font-semibold uppercase tracking-wider ${sel.live ? 'bg-amber-500/20 text-amber-300' : 'bg-panel-2 text-ink-3'}`}>
                  {sel.live ? 'живые данные' : 'схема'}
                </span>
                <span className="text-[11.5px] text-ink-3">{LAYERS.find((l) => l.key === sel.layer)?.label}</span>
              </div>
              <h3 className="mt-1.5 text-[16px] font-semibold leading-snug">{sel.name}</h3>
              <p className="mt-1.5 text-[13px] leading-relaxed text-ink-2">{sel.about}</p>
              {sel.metrics && (
                <div className="mt-3 space-y-1 rounded-md border border-line bg-panel-2 px-3 py-2 text-[13px]">
                  {sel.metrics(sim).map(([k, v]) => (
                    <div key={k} className="flex justify-between gap-3">
                      <span className="text-ink-3">{k}</span>
                      <b className="num">{v}</b>
                    </div>
                  ))}
                </div>
              )}
              {sel.facts.length > 0 && (
                <ul className="mt-3 list-disc space-y-1 pl-4 text-[12.5px] text-ink-3">
                  {sel.facts.map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                </ul>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                {sel.building && (
                  <button onClick={() => onOpenInside(sel.building!)} className="rounded-md bg-amber-500 px-3 py-1.5 text-[13px] font-semibold text-black hover:bg-amber-400">
                    ▣ Что внутри
                  </button>
                )}
                {sel.twin && typeof ids[sel.twin === 'heap-leach' ? 'leach' : sel.twin === 'waste-dump' ? 'waste' : sel.twin] === 'string' && (
                  <a
                    href={`#/twins/${encodeURIComponent(String(ids[sel.twin === 'heap-leach' ? 'leach' : sel.twin === 'waste-dump' ? 'waste' : sel.twin]))}`}
                    className="rounded-md border border-line px-3 py-1.5 text-[13px] text-ink-2 hover:text-ink"
                  >
                    Двойник в Ditto ›
                  </a>
                )}
              </div>
            </section>
          ) : (
            <section className="panel px-4 py-3 text-[13px] text-ink-3">Нажмите на объект на карте.</section>
          )}
          <section className="panel mt-3 px-4 py-3">
            <h3 className="text-[13px] font-semibold">Объекты комбината</h3>
            <div className="mt-2 space-y-0.5">
              {objects.map((o) => (
                <button key={o.id} onClick={() => setSelId(o.id)} className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left text-[12.5px] ${o.id === selId ? 'bg-amber-500/15 text-amber-200' : 'text-ink-2 hover:bg-panel-2'}`}>
                  <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: LAYERS.find((l) => l.key === o.layer)?.color }} />
                  <span className="flex-1 truncate">{o.name}</span>
                  {o.live && <span className="text-[10px] text-amber-300">●</span>}
                </button>
              ))}
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}

function ObjectShape({ o, px, selected, onPick }: { o: SiteObject; px: number; selected: boolean; onPick: () => void }) {
  const stroke = selected ? '#fbbf24' : o.live ? '#fcd34d' : '#9ca3af';
  const sw = (selected ? 4 : 2) * px;
  const common = { fill: o.fill, fillOpacity: o.live ? 0.9 : 0.75, stroke, strokeWidth: sw, style: { cursor: 'pointer' }, onClick: onPick } as const;
  const s = o.shape;
  if (s.kind === 'circle') return <circle cx={s.x} cy={s.y} r={s.r} {...common}><title>{o.name}</title></circle>;
  if (s.kind === 'poly') return <polygon points={s.pts.map((p) => p.join(',')).join(' ')} {...common}><title>{o.name}</title></polygon>;
  return (
    <rect x={s.x - s.w / 2} y={s.y - s.h / 2} width={s.w} height={s.h} rx={8} transform={s.rot ? `rotate(${s.rot} ${s.x} ${s.y})` : undefined} {...common}>
      <title>{o.name}</title>
    </rect>
  );
}

function PitContours({ sim, px, onPick, selected }: { sim: Simulation; px: number; onPick: () => void; selected: boolean }) {
  const rings = useMemo(() => {
    const out: string[] = [];
    const n = sim.cfg.pit.benchCount;
    for (let k = 0; k <= n; k++) {
      const s = 1 - (k / n) * (1 - sim.cfg.pit.bottomScale);
      const pts: string[] = [];
      for (let i = 0; i <= 120; i++) {
        const p = pitPoint(sim.cfg, s, (i / 120) * Math.PI * 2);
        pts.push(`${p.x.toFixed(0)},${p.y.toFixed(0)}`);
      }
      out.push(pts.join(' '));
    }
    return out;
  }, [sim]);
  return (
    <g onClick={onPick} style={{ cursor: 'pointer' }}>
      <polygon points={rings[0]} fill="#3a2f22" stroke={selected ? '#fbbf24' : '#d6a35c'} strokeWidth={(selected ? 4 : 3) * px} />
      {rings.slice(1).map((r, k) => (
        <polygon key={k} points={r} fill={k === rings.length - 2 ? '#1f5f6b' : `rgb(${58 - k * 2},${47 - k * 2},${34 - k})`} stroke="#8a6f4d" strokeOpacity={0.55} strokeWidth={1.2 * px} />
      ))}
    </g>
  );
}

function PitRoads({ sim, px }: { sim: Simulation; px: number }) {
  const d = useMemo(() => {
    const g = sim.layout.graph;
    return g.edges
      .filter((e) => e.kind !== 'lot' && e.kind !== 'park')
      .map((e) => `M${g.nodes[e.a].x.toFixed(0)},${g.nodes[e.a].y.toFixed(0)}L${g.nodes[e.b].x.toFixed(0)},${g.nodes[e.b].y.toFixed(0)}`)
      .join('');
  }, [sim]);
  return <path d={d} stroke="#e3d0a6" strokeOpacity={0.55} strokeWidth={Math.max(40, 2.5 * px)} fill="none" strokeLinecap="round" />;
}

/** Самосвалы, экскаваторы и буровые — свой цикл анимации, без перерисовки всей схемы. */
function Vehicles({ sim, px }: { sim: Simulation; px: number }) {
  const g = useRef<SVGGElement>(null);
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const el = g.current;
      if (el) {
        const trucks = el.querySelectorAll<SVGCircleElement>('[data-t]');
        sim.trucks.forEach((t, i) => {
          const c = trucks[i];
          if (!c) return;
          const p = isLive(sim) ? smoothTruck(sim, i, t.x, t.y) : { x: t.px + (t.x - t.px) * sim.alpha, y: t.py + (t.y - t.py) * sim.alpha };
          c.setAttribute('cx', p.x.toFixed(1));
          c.setAttribute('cy', p.y.toFixed(1));
          c.setAttribute('fill', TRUCK_COLOR[t.state]);
        });
        const rigs = el.querySelectorAll<SVGRectElement>('[data-d]');
        sim.drill.rigs.forEach((r, i) => {
          const q = rigs[i];
          if (!q) return;
          q.setAttribute('x', (r.x - 22).toFixed(0));
          q.setAttribute('y', (r.y - 22).toFixed(0));
        });
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [sim]);
  const r = Math.max(18, 5 * px);
  return (
    <g ref={g} style={{ pointerEvents: 'none' }}>
      {sim.excavators.map((e) => (
        <g key={`e${e.id}`}>
          <circle cx={e.x} cy={e.y} r={r * 1.5} fill="#0f172a" stroke={e.material === 'sulfide' ? '#facc15' : e.material === 'oxide' ? '#2dd4bf' : '#a3a3a3'} strokeWidth={r * 0.45} />
          <text x={e.x + r * 2} y={e.y + r * 0.5} fontSize={r * 1.6} fill="#fff" fontWeight={700} stroke="#000" strokeWidth={r * 0.3} paintOrder="stroke">
            {e.name}
          </text>
        </g>
      ))}
      {sim.drill.rigs.map((d) => (
        <rect key={`d${d.id}`} data-d={d.id} x={d.x - 22} y={d.y - 22} width={44} height={44} fill="#ef4444" stroke="#000" strokeWidth={6} />
      ))}
      {sim.trucks.map((t) => (
        <circle key={`t${t.id}`} data-t={t.id} cx={t.x} cy={t.y} r={r} stroke="#000" strokeWidth={r * 0.3} fill={TRUCK_COLOR[t.state]} />
      ))}
    </g>
  );
}

function ScaleBar({ px }: { px: number }) {
  const target = px * 120;
  const steps = [100, 200, 500, 1000, 2000];
  const m = steps.find((s) => s >= target) ?? 2000;
  return (
    <span className="flex items-center gap-2">
      <span className="inline-block h-[3px] bg-white/80" style={{ width: `${m / px}px` }} />
      {m >= 1000 ? `${m / 1000} км` : `${m} м`}
    </span>
  );
}
