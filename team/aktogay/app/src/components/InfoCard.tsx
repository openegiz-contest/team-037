import { FAILURE_LABEL, gradeAt, MATERIAL_LABEL, TRUCK_STATE_LABEL, type Simulation, type Truck } from '../sim';
import type { Selection } from '../render/drawMine';
import { fmt1, fmtClock, fmtInt } from '../ui/format';
import { MATERIAL_COLOR, TRUCK_COLOR } from '../ui/theme';

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-0.5">
      <span className="text-ink-3">{k}</span>
      <span className="num text-right text-ink">{v}</span>
    </div>
  );
}

/** Мини-график последнего часа: измеренная температура против ожидаемой моделью двойника. */
function TempSpark({ log }: { log: [number, number, number][] }) {
  if (log.length < 2) return <div className="text-[11px] text-ink-3">накапливаем данные…</div>;
  const W = 250;
  const H = 46;
  const vals = log.flatMap(([a, b]) => [a, b]);
  const lo = Math.min(...vals) - 2;
  const hi = Math.max(...vals) + 2;
  const x = (i: number) => (i / 59) * W;
  const y = (v: number) => H - ((v - lo) / (hi - lo)) * H;
  const line = (k: 0 | 1) => log.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p[k]).toFixed(1)}`).join('');
  return (
    <svg width={W} height={H} className="mt-1 block">
      <path d={line(1)} fill="none" stroke="#6f7782" strokeWidth={2} strokeDasharray="4 3" />
      <path d={line(0)} fill="none" stroke="#f59e0b" strokeWidth={2} />
    </svg>
  );
}

function SensorBlock({ sim, t }: { sim: Simulation; t: Truck }) {
  const s = t.sensors;
  const h = t.health;
  const dT = s.tempC - s.expectedTempC;
  const riskColor = h.risk >= 60 ? '#f87171' : h.risk >= 25 ? '#fbbf24' : '#4ade80';
  return (
    <div className="mt-2 border-t border-line pt-2">
      <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-cyan-300">Датчики и диагностика</div>
      <Row
        k="Температура двигателя"
        v={
          <span>
            {s.tempC.toFixed(1)}°C{' '}
            <span className={Math.abs(dT) > 4 ? 'text-amber-300' : 'text-ink-3'}>
              ({dT >= 0 ? '+' : ''}
              {dT.toFixed(1)} к модели)
            </span>
          </span>
        }
      />
      <Row k="Вибрация рамы" v={`${s.vibration.toFixed(1)} мм/с`} />
      <Row k="Давление в шинах" v={`${s.tyreBar.toFixed(2)} бар`} />
      <TempSpark log={s.log} />
      <div className="flex gap-3 text-[10.5px] text-ink-3">
        <span>
          <span className="text-amber-400">━</span> датчик
        </span>
        <span>┄ ожидание модели</span>
        <span className="ml-auto">последний час</span>
      </div>
      {sim.predictive ? (
        <>
          <Row
            k="Риск отказа"
            v={
              <span className="inline-flex items-center gap-2">
                <span className="inline-block h-1.5 w-16 overflow-hidden rounded bg-panel-2">
                  <span className="block h-full" style={{ width: `${h.risk}%`, background: riskColor }} />
                </span>
                <span style={{ color: riskColor }}>{h.risk}%</span>
              </span>
            }
          />
          {h.alert && h.sign && <Row k="Признак" v={<span className="text-cyan-300">{FAILURE_LABEL[h.sign]}</span>} />}
          {h.etaMin !== null && h.score > 0.1 && <Row k="Прогноз до отказа" v={`~${Math.round(h.etaMin)} мин`} />}
          {t.serviceRequested && <Row k="Решение" v={<span className="text-cyan-300">ППР после разгрузки</span>} />}
        </>
      ) : (
        <div className="mt-1 text-[11px] text-ink-3">Прогноз отказов не используется (базовая стратегия)</div>
      )}
    </div>
  );
}

export function InfoCard({ sim, selection, onClose }: { sim: Simulation; selection: Selection; onClose: () => void }) {
  if (!selection) return null;
  let body: React.ReactNode;
  let title: string;
  let color: string;

  if (selection.kind === 'truck') {
    const t = sim.trucks[selection.id];
    title = `Самосвал ${t.name}`;
    color = TRUCK_COLOR[t.state];
    const fuelPct = (t.fuelL / sim.cfg.truck.fuelTankL) * 100;
    const dest =
      t.dest?.kind === 'excavator'
        ? `экскаватор ${sim.excavators[t.dest.id].name}`
        : t.dest?.kind === 'dump'
          ? sim.dumps[t.dest.id].name
          : t.dest?.kind === 'garage'
            ? t.dest.purpose === 'service'
              ? 'гараж — ППР по прогнозу'
              : 'гараж / АЗС'
            : '—';
    body = (
      <>
        <Row k="Состояние" v={<span style={{ color }}>{TRUCK_STATE_LABEL[t.state]}</span>} />
        <Row k="Класс" v={`${sim.cfg.truck.payloadT} т (БелАЗ-75306)`} />
        <Row
          k="Груз"
          v={
            t.loadT > 0 && t.material ? (
              <span style={{ color: MATERIAL_COLOR[t.material] }}>
                {fmtInt(t.loadT)} т · {MATERIAL_LABEL[t.material]}
              </span>
            ) : (
              'порожний'
            )
          }
        />
        <Row k="Цель" v={dest} />
        <Row
          k="Топливо"
          v={
            <span className="inline-flex items-center gap-2">
              <span className="inline-block h-1.5 w-16 overflow-hidden rounded bg-panel-2">
                <span
                  className="block h-full"
                  style={{ width: `${fuelPct}%`, background: fuelPct < 20 ? '#ef4444' : fuelPct < 40 ? '#f59e0b' : '#22c55e' }}
                />
              </span>
              {fmtInt(t.fuelL)} л
            </span>
          }
        />
        <Row k="Моточасы" v={fmt1(t.engineH)} />
        <Row k="До ТО" v={`${fmt1(Math.max(0, t.serviceInH))} мч`} />
        <Row k="Рейсов за смену" v={t.trips} />
        <Row k="Перевезено" v={`${fmtInt(t.tonnes)} т`} />
        <Row
          k={sim.strategyName === 'fixed' ? 'Закреплён за' : 'Текущая петля'}
          v={sim.excavators[sim.strategyName === 'fixed' ? t.fixedEx : t.homeEx].name}
        />
        {t.state === 'broken' && <Row k="Ремонт ещё" v={`${Math.ceil(t.timer / 60)} мин`} />}
        {t.state === 'service' && <Row k="ППР ещё" v={`${Math.ceil(t.timer / 60)} мин`} />}
        <SensorBlock sim={sim} t={t} />
      </>
    );
  } else {
    const e = sim.excavators[selection.id];
    title = `Экскаватор ${e.name}`;
    color = e.state === 'broken' ? '#ef4444' : e.state === 'blast' ? '#f97316' : e.state === 'working' ? '#22c55e' : '#9ca3af';
    const util = sim.now > 0 ? (e.busySec / sim.now) * 100 : 0;
    body = (
      <>
        <Row k="Состояние" v={<span style={{ color }}>{e.state === 'broken' ? 'Поломка' : e.state === 'blast' ? 'Оцепление (взрыв)' : e.state === 'working' ? 'Погрузка' : 'Ожидает самосвал'}</span>} />
        <Row k="Материал" v={<span style={{ color: MATERIAL_COLOR[e.material] }}>{MATERIAL_LABEL[e.material]}</span>} />
        <Row k="Производительность" v={`${e.rateTpm} т/мин`} />
        {e.gradeBase > 0 && <Row k="Содержание меди в забое" v={<span className="text-amber-300">{gradeAt(e, sim.now).toFixed(2)}% Cu</span>} />}
        {e.blastLeft > 0 && <Row k="Оцепление ещё" v={`${Math.ceil(e.blastLeft / 60)} мин`} />}
        <Row k="Очередь" v={`${e.queue.length} самосвалов`} />
        <Row k="Погрузок" v={e.loads} />
        <Row k="Отгружено" v={`${fmtInt(e.tonnes)} т`} />
        <Row k="Загрузка" v={`${fmt1(util)}%`} />
        <Row k="Простой (нет самосвалов)" v={`${fmt1(e.idleSec / 3600)} ч`} />
        <Row k="В ремонте" v={`${fmt1(e.brokenSec / 3600)} ч`} />
        {e.state === 'broken' && <Row k="Ремонт ещё" v={`${Math.ceil(e.brokenLeft / 60)} мин`} />}
      </>
    );
  }

  return (
    <div className="absolute right-3 top-[76px] z-20 max-h-[calc(100%-90px)] w-[290px] overflow-y-auto rounded-lg border border-line bg-[#0b0d10]/95 p-3 text-[13px] shadow-2xl backdrop-blur">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2 font-semibold">
          <span className="inline-block h-3 w-3 rounded-full" style={{ background: color }} />
          {title}
        </div>
        <button onClick={onClose} className="rounded px-1.5 text-ink-3 hover:bg-panel-2 hover:text-ink" aria-label="Закрыть">
          ✕
        </button>
      </div>
      {body}
      <div className="mt-2 border-t border-line pt-1.5 text-[11px] text-ink-3">
        {sim.strategyName === 'smart' ? 'Реальная работа' : 'Теневой расчёт без системы'} · {fmtClock(sim.now)}
      </div>
    </div>
  );
}
