/**
 * Раздел «Двойники»: все объекты рудника как двойники Eclipse Ditto — дерево по иерархии
 * (_parents), паспорт (attributes) и живое состояние (features) выбранного двойника.
 * На стенде данные берутся из Ditto; без платформы те же двойники строятся из локальной модели.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { PageHeader, Sparkline } from '../components/PageHeader';
import type { PlatformBridge } from '../platform/bridge';
import { SENSORS_BY_KIND } from '../platform/sensors';
import { serializeMine, siteDefinitions, SITE_ID, thingDefinitions, thingIds, variantNs } from '../platform/twins';
import type { Selection } from '../render/drawMine';
import type { BuildingKind } from '../render3d/MineScene';
import { computeKpis, type Simulation, type StrategyName } from '../sim';
import { fmtClock } from '../ui/format';
import { STRATEGY_COLOR } from '../ui/theme';
import { FEATURE_LABEL, KIND_LABEL, stateTone, TONE_COLOR, UNIT_LABEL, VALUE_LABEL } from '../ui/twinLabels';

type Props = Record<string, unknown>;

interface TwinRecord {
  id: string;
  attrs: Props;
  features: Props;
  updatedAt: number | null;
}

interface Row {
  key: string;
  value: unknown;
  unit?: string;
}

type Variant = StrategyName;

const BOOL_KEYS = new Set(['finished', 'failure_alert', 'service_requested']);
const NO_SPARK = new Set(['x', 'y', 'edge_from', 'edge_to', 'node', 'seg_pos', 'dest_id', 'home_excavator', 'fixed_excavator', 'park_slot', 'loading', 'seed', 'trucks', 'timer']);

const KEY_METRICS: Record<string, string[]> = {
  'open-pit': ['mined_total', 'tph', 'crusher_idle_min', 'avg_queue_min', 'grade_in_band_pct'],
  'haul-truck': ['state', 'payload', 'fuel', 'engine_temp', 'failure_risk'],
  excavator: ['state', 'queue', 'face_grade', 'tonnes_total'],
  crusher: ['state', 'bin', 'bin_grade', 'starved'],
  concentrator: ['state', 'feed_rate', 'feed_grade', 'cu_concentrate'],
  'heap-leach': ['tonnes_total', 'queue'],
  'waste-dump': ['tonnes_total', 'queue'],
  garage: ['occupied', 'in_service', 'refueling'],
  'road-network': ['closed_count'],
  blasting: ['announced', 'active'],
  control: ['status.value', 'status.speed', 'status.sim_time', 'status.trucks'],
};

/** Тип двойника → «внутренний двойник» здания (мнемосхема на карте). */
const INSIDE: Record<string, BuildingKind> = { crusher: 'crusher', concentrator: 'plant', garage: 'garage', 'heap-leach': 'leach', 'waste-dump': 'waste' };

const GROUPS: { title: string; kinds: string[] }[] = [
  { title: 'Карьер', kinds: ['open-pit'] },
  { title: 'Экскаваторы', kinds: ['excavator'] },
  { title: 'Самосвалы', kinds: ['haul-truck'] },
  { title: 'Переработка', kinds: ['crusher', 'concentrator', 'heap-leach', 'waste-dump'] },
  { title: 'Инфраструктура', kinds: ['garage', 'road-network', 'blasting', 'shift-log'] },
];

// ───────────────────────────── данные ─────────────────────────────

function platformTwins(b: PlatformBridge): TwinRecord[] {
  const ids = new Set([...b.attrs.keys(), ...b.things.keys()]);
  return [...ids].map((id) => ({ id, attrs: b.attrs.get(id) ?? {}, features: b.things.get(id) ?? {}, updatedAt: b.updatedAt.get(id) ?? null }));
}

function localTwins(sims: Simulation[]): TwinRecord[] {
  const out: TwinRecord[] = [];
  for (const [id, body] of Object.entries(siteDefinitions())) out.push({ id, attrs: body.attributes, features: body.features as Props, updatedAt: null });
  for (const s of sims) {
    const v = s.strategyName;
    const defs = thingDefinitions(s, v);
    defs[thingIds(v).mine].features = serializeMine(s, computeKpis(s));
    for (const [id, body] of Object.entries(defs)) out.push({ id, attrs: body.attributes, features: body.features as Props, updatedAt: null });
  }
  return out;
}

/** Признаки → плоские строки. Признак { properties: { value, unit } } — одна строка, иначе по свойству. */
function rowsOf(features: Props): Row[] {
  const rows: Row[] = [];
  for (const [k, f] of Object.entries(features)) {
    const p = (f as { properties?: Props })?.properties;
    if (!p) continue;
    const keys = Object.keys(p);
    if ('value' in p && keys.every((x) => x === 'value' || x === 'unit')) rows.push({ key: k, value: p.value, unit: p.unit as string | undefined });
    else for (const [pk, pv] of Object.entries(p)) rows.push({ key: `${k}.${pk}`, value: pv });
  }
  return rows;
}

const rowMap = (r: TwinRecord | undefined) => new Map(rowsOf(r?.features ?? {}).map((x) => [x.key, x]));
const kindOf = (r: TwinRecord) => String(r.attrs.kind ?? '');
const nameOf = (r: TwinRecord) => String(r.attrs.name ?? r.id.split(':')[1]);
const variantOf = (id: string): Variant | null => (id.startsWith(variantNs('smart') + ':') ? 'smart' : id.startsWith(variantNs('fixed') + ':') ? 'fixed' : null);
const shortName = (r: TwinRecord) => nameOf(r).replace(/^Самосвал |^Экскаватор /, '');
const other = (v: Variant): Variant => (v === 'smart' ? 'fixed' : 'smart');
const counterpart = (id: string) => {
  const v = variantOf(id);
  return v ? id.replace(variantNs(v) + ':', variantNs(other(v)) + ':') : null;
};

function labelOf(key: string): string {
  const [f, p] = key.split('.');
  if (p) return `${FEATURE_LABEL[f] ?? f} · ${p}`;
  return FEATURE_LABEL[key] ?? key;
}

function fmtDur(sec: number): string {
  if (sec < 0) return '—';
  if (sec < 120) return `${Math.round(sec)} с`;
  const m = Math.round(sec / 60);
  return m < 60 ? `${m} мин` : `${Math.floor(m / 60)} ч ${String(m % 60).padStart(2, '0')} мин`;
}

function fmtValue(row: Row | undefined): { text: string; unit: string; json?: unknown[] | Props } {
  if (!row) return { text: '—', unit: '' };
  const { key, value, unit } = row;
  const base = key.split('.').pop() ?? key;
  // Стоянка: «-1,-1,4,…» → «место 3 — №105 · …» (номер самосвала = 101 + индекс).
  if (base === 'slots' && typeof value === 'string') {
    const taken = value
      .split(',')
      .map((v, i) => [i + 1, Number(v)] as const)
      .filter(([, t]) => Number.isFinite(t) && t >= 0)
      .map(([slot, t]) => `место ${slot} — №${101 + t}`);
    return { text: taken.length ? taken.join(' · ') : 'все места свободны', unit: '' };
  }
  if (typeof value === 'string') {
    const t = value.trim();
    if ((t.startsWith('[') || t.startsWith('{')) && t.length > 1) {
      try {
        const j = JSON.parse(t) as unknown[] | Props;
        const n = Array.isArray(j) ? j.length : Object.keys(j).length;
        return { text: n === 0 ? 'пусто' : `${n} ${Array.isArray(j) ? 'зап.' : 'полей'}`, unit: '', json: j };
      } catch {
        /* обычная строка */
      }
    }
    // Хронология смены: длинные строки по минутам — показываем длину и начало.
    if (value.length > 60) return { text: `${value.length} симв. · ${value.slice(0, 24)}…`, unit: '' };
    return { text: VALUE_LABEL[value] ?? (value === '' ? '—' : value), unit: '' };
  }
  if (Array.isArray(value)) return { text: value.length ? value.join(' · ') : 'нет', unit: '' };
  if (typeof value === 'boolean') return { text: value ? 'да' : 'нет', unit: '' };
  if (typeof value === 'number') {
    if (BOOL_KEYS.has(base)) return { text: value ? 'да' : 'нет', unit: '' };
    if (base === 'sim_time') return { text: fmtClock(value), unit: '' };
    if (unit === 's') return { text: fmtDur(value), unit: '' };
    if (base === 'failure_eta' && value < 0) return { text: '—', unit: '' };
    const digits = Math.abs(value) >= 100 ? 0 : Math.abs(value) >= 10 ? 1 : 3;
    return { text: value.toLocaleString('ru-RU', { maximumFractionDigits: digits }), unit: unit ? (UNIT_LABEL[unit] ?? unit) : '' };
  }
  if (value && typeof value === 'object') return { text: JSON.stringify(value), unit: '' };
  return { text: String(value ?? '—'), unit: '' };
}

/** Краткое состояние строки дерева: [текст, тон]. */
function summary(r: TwinRecord): [string, keyof typeof TONE_COLOR] {
  const m = rowMap(r);
  const v = (k: string) => m.get(k)?.value;
  const state = v('state') as string | undefined;
  switch (kindOf(r)) {
    case 'haul-truck':
      return [`${VALUE_LABEL[state ?? ''] ?? state ?? ''}${Number(v('failure_alert')) ? ' ⚡' : ''}`, Number(v('failure_alert')) ? 'bad' : stateTone(state)];
    case 'excavator':
      return [`${VALUE_LABEL[state ?? ''] ?? state} · очередь ${v('queue') ?? 0}`, stateTone(state)];
    case 'crusher':
      return [`${Math.round(Number(v('bin') ?? 0))} т`, stateTone(state)];
    case 'concentrator':
      return [`${Number(v('feed_grade') ?? 0).toFixed(3)} % Cu`, stateTone(state)];
    case 'open-pit':
      return [`${Math.round(Number(v('tph') ?? 0)).toLocaleString('ru-RU')} т/ч`, Number(v('finished')) ? 'idle' : 'ok'];
    case 'heap-leach':
    case 'waste-dump':
      return [`${Math.round(Number(v('tonnes_total') ?? 0)).toLocaleString('ru-RU')} т`, Number(v('queue')) > 1 ? 'warn' : 'ok'];
    case 'garage':
      return [`${v('occupied') ?? 0} на стоянке`, Number(v('in_service')) > 0 ? 'warn' : 'idle'];
    case 'road-network': {
      const n = Number(v('closed_count') ?? 0);
      return [n ? `закрыто ${n}` : 'всё открыто', n ? 'warn' : 'ok'];
    }
    case 'blasting': {
      const a = Number(v('active') ?? 0);
      const w = Number(v('announced') ?? 0);
      return [a ? 'оцепление' : w ? 'объявлен взрыв' : 'нет', a ? 'bad' : w ? 'warn' : 'idle'];
    }
    case 'control': {
      const s = m.get('status.value')?.value as string | undefined;
      return [s === 'running' ? 'смена идёт' : s === 'paused' ? 'пауза' : (s ?? '—'), s === 'running' ? 'ok' : 'warn'];
    }
    default:
      return ['', 'idle'];
  }
}

// ───────────────────────────── страница ─────────────────────────────

interface PageProps {
  bridge: PlatformBridge | null;
  localSims: Simulation[];
  version: number;
  now: number;
  running: boolean;
  onToggleRun: () => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onLocate: (variant: Variant, sel: Selection) => void;
  onOpenInside: (variant: Variant, kind: BuildingKind) => void;
}

export function TwinsPage({ bridge, localSims, version, now, running, onToggleRun, selectedId, onSelect, onLocate, onOpenInside }: PageProps) {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const twins = useMemo(() => (bridge ? platformTwins(bridge) : localTwins(localSims)), [bridge, localSims, version]);
  const byId = useMemo(() => new Map(twins.map((t) => [t.id, t])), [twins]);
  const variants = (['smart', 'fixed'] as Variant[]).filter((v) => twins.some((t) => variantOf(t.id) === v));

  const sel = (selectedId && byId.get(selectedId)) || byId.get(thingIds(variants[0] ?? 'smart').mine) || twins[0];
  const [variant, setVariant] = useState<Variant>(variantOf(sel?.id ?? '') ?? variants[0] ?? 'smart');
  const [query, setQuery] = useState('');
  const [compare, setCompare] = useState(false);
  const [fFilter, setFFilter] = useState('');
  /** Признаки выбранного датчика — точный фильтр таблицы. */
  const [sensorId, setSensorId] = useState<string | null>(null);
  const [openJson, setOpenJson] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const v = sel ? variantOf(sel.id) : null;
    if (v && v !== variant) setVariant(v);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel?.id]);

  // История числовых признаков выбранного двойника (и его пары) — для мини-графиков.
  const hist = useRef(new Map<string, { vals: number[]; last: unknown; changedAt: number }>());
  const wall = performance.now();
  useEffect(() => {
    const ids = [sel?.id, compare && sel ? counterpart(sel.id) : null].filter(Boolean) as string[];
    const t = performance.now();
    for (const id of ids) {
      for (const row of rowsOf(byId.get(id)?.features ?? {})) {
        const k = `${id}|${row.key}`;
        let h = hist.current.get(k);
        if (!h) hist.current.set(k, (h = { vals: [], last: row.value, changedAt: 0 }));
        else if (h.last !== row.value) {
          h.last = row.value;
          h.changedAt = t;
        }
        if (typeof row.value === 'number') {
          h.vals.push(row.value);
          if (h.vals.length > 90) h.vals.shift();
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, sel?.id, compare]);

  // Обновлений в секунду (только платформа).
  const rate = useRef({ t: performance.now(), n: bridge?.events ?? 0, perSec: 0 });
  if (bridge && wall - rate.current.t > 2000) {
    rate.current.perSec = ((bridge.events - rate.current.n) * 1000) / (wall - rate.current.t);
    rate.current = { t: wall, n: bridge.events, perSec: rate.current.perSec };
  }
  const lastUpdate = bridge ? Math.max(0, ...[...bridge.updatedAt.values()]) : 0;

  const kindCounts = useMemo(() => {
    const c = new Map<string, number>();
    for (const t of twins) c.set(kindOf(t), (c.get(kindOf(t)) ?? 0) + 1);
    return c;
  }, [twins]);

  const q = query.trim().toLowerCase();
  const match = (t: TwinRecord) => !q || t.id.toLowerCase().includes(q) || nameOf(t).toLowerCase().includes(q);
  const siteTwins = twins.filter((t) => !variantOf(t.id) && match(t));
  const varTwins = twins.filter((t) => variantOf(t.id) === variant && match(t));

  if (!sel) return <div className="p-6 text-ink-3">Двойники загружаются…</div>;

  const selKind = kindOf(sel);
  // Технические признаки (координаты на графе, номера) — в конец таблицы.
  const selRows = rowsOf(sel.features).sort((a, b) => Number(NO_SPARK.has(a.key)) - Number(NO_SPARK.has(b.key)));
  const pairId = counterpart(sel.id);
  const pairRows = compare && pairId ? rowMap(byId.get(pairId)) : null;
  const selMap = rowMap(sel);

  // Путь по _parents.
  const path: TwinRecord[] = [];
  for (let cur: TwinRecord | undefined = sel, guard = 0; cur && guard < 6; guard++) {
    path.unshift(cur);
    const p = cur.attrs._parents as string | undefined;
    cur = p ? byId.get(p) : undefined;
  }
  const children = twins.filter((t) => t.attrs._parents === sel.id);
  const feeds = sel.attrs.feeds ? byId.get(String(sel.attrs.feeds)) : undefined;
  const fedBy = twins.filter((t) => t.attrs.feeds === sel.id);
  const attrRows = Object.entries(sel.attrs).filter(([k]) => k !== 'name' && k !== '_parents' && k !== '_isType' && k !== 'sensors');

  const locIndex = (() => {
    const m = /:(excavator|truck)-(\d+)$/.exec(sel.id);
    if (!m) return null;
    return m[1] === 'truck' ? ({ kind: 'truck', id: Number(m[2]) - 101 } as const) : ({ kind: 'excavator', id: Number(m[2]) - 1 } as const);
  })();
  const selVariant = variantOf(sel.id);

  const fq = fFilter.trim().toLowerCase();
  const sensors = SENSORS_BY_KIND[selKind] ?? null;
  const sensorKeys = sensorId && sensors ? new Set(sensors.find((x) => x.id === sensorId)?.features ?? []) : null;
  const shownRows = selRows.filter((r) => (sensorKeys ? sensorKeys.has(r.key) : !fq || r.key.toLowerCase().includes(fq) || labelOf(r.key).toLowerCase().includes(fq)));

  const treeRow = (t: TwinRecord, indent = 0) => {
    const [txt, tone] = summary(t);
    const active = t.id === sel.id;
    const fresh = t.updatedAt !== null && wall - t.updatedAt < 900;
    return (
      <button
        key={t.id}
        onClick={() => onSelect(t.id)}
        className={`flex w-full items-center gap-2 rounded-md py-1.5 pr-2 text-left text-[13px] ${active ? 'bg-amber-500/12 text-ink ring-1 ring-amber-500/40' : 'text-ink-2 hover:bg-panel-2'}`}
        style={{ paddingLeft: 8 + indent * 14 }}
      >
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: TONE_COLOR[tone], boxShadow: fresh ? `0 0 0 3px ${TONE_COLOR[tone]}33` : undefined }} />
        <span className="min-w-0 flex-1 truncate">{shortName(t)}</span>
        <span className="shrink-0 truncate text-[11.5px] text-ink-3">{txt}</span>
      </button>
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-hidden p-5">
      <PageHeader
        title="Двойники"
        subtitle={
          <>
            Каждый объект рудника — двойник (thing) в Eclipse Ditto платформы OpenEgiz. <b className="text-ink-2">Атрибуты</b> — паспорт объекта и
            связи, <b className="text-ink-2">признаки</b> — живое состояние, которое симулятор присылает по MQTT каждую секунду.
          </>
        }
        now={now}
        running={running}
        onToggleRun={onToggleRun}
      />

      {/* Сводка */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Всего двойников" value={String(twins.length)} hint={`пространства имён org.aktogay, ${variants.map(variantNs).join(', ')}`} />
        <StatTile
          label="Источник"
          value={bridge ? 'Eclipse Ditto' : 'Локальная модель'}
          hint={bridge ? (bridge.connected ? 'поток изменений (SSE) активен' : 'переподключение…') : 'OpenEgiz не найден — двойники собраны в браузере'}
          tone={bridge ? (bridge.connected ? 'ok' : 'warn') : 'idle'}
        />
        <StatTile label="Изменений в секунду" value={bridge ? Math.round(rate.current.perSec).toLocaleString('ru-RU') : '—'} hint={bridge && lastUpdate ? `последнее ${((wall - lastUpdate) / 1000).toFixed(1)} с назад` : 'только на стенде'} />
        <div className="panel flex flex-wrap content-start gap-1.5 px-3 py-2.5">
          {[...kindCounts.entries()].map(([k, n]) => (
            <span key={k} className="rounded-md bg-panel-2 px-2 py-0.5 text-[11.5px] text-ink-2">
              {KIND_LABEL[k] ?? k} <b className="num text-ink">{n}</b>
            </span>
          ))}
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[300px_minmax(0,1fr)] gap-4 xl:grid-cols-[340px_minmax(0,1fr)]">
        {/* Дерево */}
        <div className="panel flex min-h-0 flex-col">
          <div className="flex flex-col gap-2 border-b border-line p-3">
            <div className="flex overflow-hidden rounded-lg border border-line text-[12.5px]">
              {variants.map((v) => (
                <button
                  key={v}
                  onClick={() => {
                    setVariant(v);
                    const pair = selVariant && selVariant !== v ? counterpart(sel.id) : null;
                    onSelect(pair && byId.has(pair) ? pair : thingIds(v).mine);
                  }}
                  className="flex-1 px-2 py-1.5 font-semibold"
                  style={variant === v ? { background: STRATEGY_COLOR[v], color: '#fff' } : { color: 'var(--color-ink-2)' }}
                >
                  {v === 'smart' ? 'Реальный карьер' : 'Теневой: без системы'}
                </button>
              ))}
            </div>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Поиск: имя или thingId"
              className="rounded-lg border border-line bg-panel-2 px-2.5 py-1.5 text-[13px] outline-none placeholder:text-ink-3 focus:border-amber-500"
            />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {siteTwins.map((t) => treeRow(t, t.id === SITE_ID ? 0 : 1))}
            {GROUPS.map((g) => {
              const items = varTwins.filter((t) => g.kinds.includes(kindOf(t)));
              if (!items.length) return null;
              const key = `${variant}-${g.title}`;
              const closed = collapsed[key] && !q;
              return (
                <div key={g.title} className="mt-2">
                  <button
                    onClick={() => setCollapsed((c) => ({ ...c, [key]: !c[key] }))}
                    className="flex w-full items-center gap-1.5 px-2 py-1 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-ink-3 hover:text-ink-2"
                  >
                    <span className={`transition-transform ${closed ? '' : 'rotate-90'}`}>›</span>
                    {g.title}
                    <span className="num ml-auto font-normal normal-case tracking-normal">{items.length}</span>
                  </button>
                  {!closed && items.map((t) => treeRow(t, 1))}
                </div>
              );
            })}
          </div>
        </div>

        {/* Карточка двойника */}
        <div className="flex min-h-0 flex-col gap-3 overflow-y-auto pr-1">
          <div className="panel p-4">
            <div className="flex flex-wrap items-center gap-1 text-[12px] text-ink-3">
              {path.map((p, i) => (
                <span key={p.id} className="flex items-center gap-1">
                  {i > 0 && <span>›</span>}
                  <button onClick={() => onSelect(p.id)} className={p.id === sel.id ? 'text-ink-2' : 'hover:text-amber-300'}>
                    {shortName(p)}
                  </button>
                </span>
              ))}
            </div>
            <div className="mt-2 flex flex-col gap-3 xl:flex-row xl:items-start">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="rounded-md bg-amber-500/15 px-2 py-0.5 text-[11.5px] font-semibold uppercase tracking-wider text-amber-300">
                    {KIND_LABEL[selKind] ?? selKind}
                  </span>
                  {selVariant && (
                    <span className="rounded-md px-2 py-0.5 text-[11.5px] font-semibold text-white" style={{ background: STRATEGY_COLOR[selVariant] }}>
                      {selVariant === 'smart' ? 'реальная работа' : 'теневой расчёт без системы'}
                    </span>
                  )}
                </div>
                <h2 className="mt-1.5 text-[21px] font-bold leading-tight">{nameOf(sel)}</h2>
                <div className="mt-1 flex items-center gap-2">
                  <code className="num rounded bg-panel-2 px-1.5 py-0.5 text-[12.5px] text-ink-2">{sel.id}</code>
                  <CopyButton text={sel.id} />
                  {sel.updatedAt !== null && <span className="text-[11.5px] text-ink-3">обновлён {((wall - sel.updatedAt) / 1000).toFixed(1)} с назад</span>}
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {selVariant && INSIDE[selKind] && (
                  <button onClick={() => onOpenInside(selVariant, INSIDE[selKind])} className="rounded-lg bg-amber-500 px-3 py-1.5 text-[13px] font-bold text-black hover:bg-amber-400">
                    ▣ Что внутри
                  </button>
                )}
                {locIndex && selVariant && (
                  <button onClick={() => onLocate(selVariant, locIndex)} className="rounded-lg bg-amber-500 px-3 py-1.5 text-[13px] font-bold text-black hover:bg-amber-400">
                    ◎ Показать на карте
                  </button>
                )}
                {pairId && byId.has(pairId) && (
                  <button
                    onClick={() => setCompare((c) => !c)}
                    className={`rounded-lg px-3 py-1.5 text-[13px] font-semibold ring-1 ${compare ? 'bg-sky-500/15 text-sky-200 ring-sky-500/50' : 'bg-panel-2 text-ink-2 ring-line hover:text-ink'}`}
                  >
                    ⇄ Сравнить {selVariant === 'smart' ? 'с расчётом без системы' : 'с реальным'}
                  </button>
                )}
                {bridge && (
                  <a href={`ditto/api/2/things/${sel.id}`} target="_blank" rel="noreferrer" className="rounded-lg bg-panel-2 px-3 py-1.5 text-[13px] font-semibold text-ink-2 ring-1 ring-line hover:text-ink">
                    JSON в Ditto ↗
                  </a>
                )}
              </div>
            </div>

            {/* Ключевые показатели */}
            <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-3 2xl:grid-cols-5">
              {(KEY_METRICS[selKind] ?? []).map((k) => {
                const row = selMap.get(k);
                const fv = fmtValue(row);
                const h = hist.current.get(`${sel.id}|${k}`);
                const isState = k.endsWith('state') || k === 'status.value';
                return (
                  <div key={k} className="rounded-lg border border-line bg-panel-2/60 px-3 py-2">
                    <div className="truncate text-[11.5px] text-ink-3">{labelOf(k)}</div>
                    <div className="mt-0.5 flex items-end justify-between gap-2">
                      <div className="num truncate text-[19px] font-bold" style={isState ? { color: TONE_COLOR[stateTone(String(row?.value ?? ''))] } : undefined}>
                        {fv.text}
                        {fv.unit && <span className="ml-1 text-[12px] font-normal text-ink-3">{fv.unit}</span>}
                      </div>
                      {!isState && h && h.vals.length > 1 && <Sparkline values={h.vals} width={60} height={20} />}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Датчики самосвала: какое оборудование заполняет признаки двойника */}
          {sensors && (
            <div className="panel">
              <div className="flex items-center gap-3 border-b border-line px-4 py-2.5">
                <div className="text-[13px] font-semibold">
                  Датчики {({ excavator: 'на экскаваторе', 'haul-truck': 'на самосвале', crusher: 'на дробилке', concentrator: 'на фабрике', 'heap-leach': 'на площадке выщелачивания', 'waste-dump': 'на отвале', garage: 'в гараже' } as Record<string, string>)[selKind]} <span className="font-normal text-ink-3">· {sensors.length} · attributes.sensors</span>
                </div>
                <span className="ml-auto text-[11.5px] text-ink-3">клик — показать признаки датчика в таблице ниже</span>
              </div>
              <div className="grid grid-cols-1 gap-2 p-3 md:grid-cols-2 2xl:grid-cols-4">
                {sensors.map((s) => {
                  const main = selMap.get(s.features[0]);
                  const fv =
                    s.id === 'gnss'
                      ? { text: `${Math.round(Number(selMap.get('x')?.value ?? 0))}; ${Math.round(Number(selMap.get('y')?.value ?? 0))}`, unit: 'м' }
                      : s.id === 'diag'
                        ? Number(selMap.get('repair_left')?.value ?? 0) > 0
                          ? { text: `ремонт ${Math.ceil(Number(selMap.get('repair_left')?.value) / 60)}`, unit: 'мин' }
                          : { text: 'норма', unit: '' }
                        : s.id === 'bucket_pos'
                        ? { text: sel.attrs.material === 'waste' ? 'вскрыша' : 'руда', unit: '' }
                        : fmtValue(main);
                  const h = hist.current.get(`${sel.id}|${s.features[0]}`);
                  const active = sensorId === s.id;
                  return (
                    <button
                      key={s.id}
                      onClick={() => setSensorId(active ? null : s.id)}
                      className={`flex flex-col gap-1 rounded-lg border px-3 py-2.5 text-left ${active ? 'border-amber-500 bg-amber-500/10' : 'border-line bg-panel-2/50 hover:border-ink-3'}`}
                      title={`Зачем: ${s.purpose}`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-[13px] font-semibold leading-tight">{s.name}</span>
                        <span className="num shrink-0 text-[14px] font-bold text-amber-300">
                          {fv.text}
                          {fv.unit && <span className="ml-0.5 text-[11px] font-normal text-ink-3">{fv.unit}</span>}
                        </span>
                      </div>
                      <span className="text-[11.5px] leading-snug text-ink-3">{s.hardware}</span>
                      <div className="mt-auto flex items-end justify-between gap-2 pt-1">
                        <span className="text-[11px] text-ink-3">
                          {s.location} · раз в {s.periodS} с ·{' '}
                          <span className="num text-ink-2">{s.features.join(', ')}</span>
                        </span>
                        {h && h.vals.length > 1 && typeof main?.value === 'number' && <Sparkline values={h.vals} width={56} height={18} />}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="grid min-h-0 grid-cols-1 gap-3 2xl:grid-cols-[minmax(0,1fr)_340px]">
            {/* Признаки */}
            <div className="panel min-w-0">
              <div className="flex items-center gap-3 border-b border-line px-4 py-2.5">
                <div className="text-[13px] font-semibold">
                  Признаки <span className="font-normal text-ink-3">(features) · {selRows.length}</span>
                </div>
                {sensorKeys && (
                  <button onClick={() => setSensorId(null)} className="rounded-md bg-amber-500/15 px-2 py-0.5 text-[12px] text-amber-200 hover:bg-amber-500/25">
                    датчик: {sensors?.find((x) => x.id === sensorId)?.name} ✕
                  </button>
                )}
                <input
                  value={fFilter}
                  onChange={(e) => {
                    setSensorId(null);
                    setFFilter(e.target.value);
                  }}
                  placeholder="фильтр"
                  className="ml-auto w-40 rounded-md border border-line bg-panel-2 px-2 py-1 text-[12.5px] outline-none placeholder:text-ink-3 focus:border-amber-500"
                />
              </div>
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wider text-ink-3">
                    <th className="px-4 py-2 font-medium">Признак</th>
                    <th className="px-2 py-2 text-right font-medium">Значение</th>
                    {pairRows && <th className="px-2 py-2 text-right font-medium" style={{ color: STRATEGY_COLOR[other(selVariant ?? 'smart')] }}>{selVariant === 'smart' ? 'Без системы' : 'Реальный'}</th>}
                    <th className="px-4 py-2 font-medium">Динамика</th>
                  </tr>
                </thead>
                <tbody>
                  {shownRows.map((r) => {
                    const fv = fmtValue(r);
                    const h = hist.current.get(`${sel.id}|${r.key}`);
                    const changed = h && wall - h.changedAt < 1200;
                    const jsonKey = `${sel.id}|${r.key}`;
                    const pv = pairRows ? fmtValue(pairRows.get(r.key)) : null;
                    const base = r.key.split('.').pop() ?? r.key;
                    return (
                      <FeatureRow
                        key={r.key}
                        label={labelOf(r.key)}
                        code={r.key}
                        value={fv}
                        pair={pv}
                        changed={!!changed}
                        spark={typeof r.value === 'number' && !NO_SPARK.has(base) && !BOOL_KEYS.has(base) && h ? h.vals : null}
                        open={openJson === jsonKey}
                        onToggle={() => setOpenJson((o) => (o === jsonKey ? null : jsonKey))}
                      />
                    );
                  })}
                  {shownRows.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-4 py-4 text-ink-3">
                        {selRows.length ? 'Ничего не найдено' : 'У этого двойника нет признаков: он объединяет другие объекты'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Атрибуты и связи */}
            <div className="flex flex-col gap-3">
              <div className="panel">
                <div className="border-b border-line px-4 py-2.5 text-[13px] font-semibold">
                  Атрибуты <span className="font-normal text-ink-3">(паспорт)</span>
                </div>
                <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5 px-4 py-3 text-[12.5px]">
                  {attrRows.map(([k, v]) => (
                    <div key={k} className="contents">
                      <dt className="num text-ink-3">{k}</dt>
                      <dd className="num break-words text-ink-2">{typeof v === 'object' ? JSON.stringify(v) : (VALUE_LABEL[String(v)] ?? String(v))}</dd>
                    </div>
                  ))}
                  <dt className="num text-ink-3">policyId</dt>
                  <dd className="num text-ink-2">default:basic_policy</dd>
                </dl>
              </div>
              <div className="panel">
                <div className="border-b border-line px-4 py-2.5 text-[13px] font-semibold">Связи</div>
                <div className="flex flex-col gap-2 px-4 py-3 text-[12.5px]">
                  <Relation label="Входит в" items={path.length > 1 ? [path[path.length - 2]] : []} onSelect={onSelect} />
                  <Relation label="Материал везут в" items={feeds ? [feeds] : []} onSelect={onSelect} />
                  <Relation label="Получает от" items={fedBy} onSelect={onSelect} />
                  <Relation label={`Состоит из (${children.length})`} items={children} onSelect={onSelect} />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatTile({ label, value, hint, tone }: { label: string; value: string; hint: string; tone?: keyof typeof TONE_COLOR }) {
  return (
    <div className="panel px-3 py-2.5">
      <div className="text-[11.5px] text-ink-3">{label}</div>
      <div className="mt-0.5 flex items-center gap-2 text-[20px] font-bold">
        {tone && <span className="h-2.5 w-2.5 rounded-full" style={{ background: TONE_COLOR[tone] }} />}
        <span className="num">{value}</span>
      </div>
      <div className="truncate text-[11.5px] text-ink-3" title={hint}>
        {hint}
      </div>
    </div>
  );
}

function FeatureRow({
  label,
  code,
  value,
  pair,
  changed,
  spark,
  open,
  onToggle,
}: {
  label: string;
  code: string;
  value: ReturnType<typeof fmtValue>;
  pair: ReturnType<typeof fmtValue> | null;
  changed: boolean;
  spark: number[] | null;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <tr className="border-t border-line/60 hover:bg-panel-2/60">
        <td className="px-4 py-1.5">
          <div className="text-ink-2">{label}</div>
          <div className="num text-[11px] text-ink-3">{code}</div>
        </td>
        <td className={`num px-2 py-1.5 text-right transition-colors duration-700 ${changed ? 'text-amber-300' : 'text-ink'}`}>
          {value.json ? (
            <button onClick={onToggle} className="rounded bg-panel-2 px-1.5 py-0.5 text-[12px] text-sky-300 hover:bg-sky-500/10">
              {value.text} {open ? '▴' : '▾'}
            </button>
          ) : (
            <>
              {value.text}
              {value.unit && <span className="ml-1 text-[11.5px] text-ink-3">{value.unit}</span>}
            </>
          )}
        </td>
        {pair && (
          <td className="num px-2 py-1.5 text-right text-ink-2">
            {pair.json ? pair.text : `${pair.text}${pair.unit ? ` ${pair.unit}` : ''}`}
          </td>
        )}
        <td className="px-4 py-1.5">{spark && spark.length > 1 && <Sparkline values={spark} />}</td>
      </tr>
      {open && value.json && (
        <tr>
          <td colSpan={pair ? 4 : 3} className="px-4 pb-2">
            <JsonView data={value.json} />
          </td>
        </tr>
      )}
    </>
  );
}

function JsonView({ data }: { data: unknown[] | Props }) {
  // Журнал событий: [время, уровень, текст].
  if (Array.isArray(data) && data.every((d) => Array.isArray(d) && d.length === 3)) {
    return (
      <div className="flex flex-col gap-0.5 rounded-md bg-panel-2 p-2 text-[12px]">
        {(data as [number, string, string][]).map(([t, lvl, text], i) => (
          <div key={i} className="flex gap-2">
            <span className="num text-ink-3">{fmtClock(t)}</span>
            <span className={lvl === 'alarm' ? 'text-red-400' : lvl === 'warn' ? 'text-amber-300' : 'text-ink-2'}>{text}</span>
          </div>
        ))}
      </div>
    );
  }
  return <pre className="num max-h-56 overflow-auto rounded-md bg-panel-2 p-2 text-[11.5px] leading-relaxed text-ink-2">{JSON.stringify(data, null, 1)}</pre>;
}

function Relation({ label, items, onSelect }: { label: string; items: TwinRecord[]; onSelect: (id: string) => void }) {
  if (!items.length) return null;
  return (
    <div>
      <div className="mb-1 text-[11px] uppercase tracking-wider text-ink-3">{label}</div>
      <div className="flex flex-wrap gap-1">
        {items.slice(0, 40).map((t) => (
          <button key={t.id} onClick={() => onSelect(t.id)} className="rounded-md bg-panel-2 px-2 py-0.5 text-[12px] text-ink-2 hover:bg-amber-500/15 hover:text-amber-200">
            {shortName(t)}
          </button>
        ))}
      </div>
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => {
          setDone(true);
          window.setTimeout(() => setDone(false), 1200);
        });
      }}
      className="rounded px-1.5 py-0.5 text-[11.5px] text-ink-3 hover:bg-panel-2 hover:text-ink"
      title="Скопировать thingId"
    >
      {done ? '✓ скопировано' : '⧉'}
    </button>
  );
}
