import { FAILURE_LABEL, type Simulation } from '../sim';

/** Панель предиктивной диагностики: самосвалы с наибольшим риском отказа. */
export function DiagnosticsPanel({ sim, onPick }: { sim: Simulation; onPick: (truckId: number) => void }) {
  const st = sim.stats;
  const rows = sim.trucks
    .filter((t) => t.state === 'service' || t.health.alert || t.health.risk >= 15)
    .sort((a, b) => Number(b.state === 'service') - Number(a.state === 'service') || b.health.risk - a.health.risk)
    .slice(0, 3);
  return (
    <div className="panel shrink-0 px-3 py-2">
      <div className="mb-1 flex items-baseline justify-between">
        <span className="text-[12px] font-semibold uppercase tracking-wider text-cyan-300">⚡ Прогноз отказов</span>
        <span className="num text-[11.5px] text-ink-3">
          предотвращено <b className="text-cyan-300">{st.preventedFailures}</b> · аварийных <b className="text-red-400">{st.unplannedFailures}</b> · ложных{' '}
          <b className="text-ink-2">{st.falseAlarms}</b>
        </span>
      </div>
      {rows.length === 0 && <div className="text-[12.5px] text-ink-3">Все самосвалы в норме — признаков деградации нет.</div>}
      {rows.map((t) => {
        const h = t.health;
        const color = t.state === 'service' ? '#22d3ee' : h.risk >= 60 ? '#f87171' : h.risk >= 25 ? '#fbbf24' : '#a9b0ba';
        return (
          <button key={t.id} onClick={() => onPick(t.id)} className="flex w-full items-center gap-2 rounded px-1 py-0.5 text-left text-[12.5px] hover:bg-panel-2">
            <span className="num w-12 font-semibold">{t.name}</span>
            <span className="flex-1 truncate text-ink-2">
              {t.state === 'service' ? '🔧 на ППР' : h.sign ? FAILURE_LABEL[h.sign] : 'отклонение параметров'}
            </span>
            {t.state !== 'service' && h.etaMin !== null && <span className="num text-ink-3">~{Math.round(h.etaMin)} мин</span>}
            <span className="num w-10 text-right font-bold" style={{ color }}>
              {t.state === 'service' ? 'ППР' : `${h.risk}%`}
            </span>
          </button>
        );
      })}
    </div>
  );
}
