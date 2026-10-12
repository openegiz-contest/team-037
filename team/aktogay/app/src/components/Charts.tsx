import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ReferenceArea, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { STRATEGY_LABEL, type Simulation, type TruckState } from '../sim';
import { fmt1, fmtInt } from '../ui/format';
import { EXCAVATOR_SERIES, STATE_GROUPS, STRATEGY_COLOR } from '../ui/theme';

const AXIS = { stroke: '#6f7782', fontSize: 11, tickLine: false };
const GRID = <CartesianGrid stroke="#2a313a" strokeDasharray="2 4" vertical={false} />;
const TOOLTIP = {
  contentStyle: { background: '#0b0d10', border: '1px solid #2a313a', borderRadius: 8, fontSize: 12 },
  labelStyle: { color: '#e8eaed', marginBottom: 4 },
  itemStyle: { padding: 0 },
  cursor: { stroke: '#a9b0ba', strokeWidth: 1, fill: 'rgba(255,255,255,0.04)' },
};
const LEGEND = { wrapperStyle: { fontSize: 12, color: '#a9b0ba' }, iconSize: 10 };

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="panel flex min-w-0 flex-col px-3 pb-1 pt-2">
      <div className="mb-1 text-[12px] font-semibold uppercase tracking-wider text-ink-2">{title}</div>
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );
}

export function Charts({ sims }: { sims: Simulation[] }) {
  const compare = sims.length === 2;

  // 1. Темп добычи (скользящее окно 1 ч).
  const tphData = sims[0].history.map((h, i) => {
    const row: Record<string, number> = { t: h.tMin / 60 };
    sims.forEach((s) => {
      const p = s.history[i];
      if (p) row[s.strategyName] = Math.round(p.tph);
    });
    return row;
  });

  // Содержание меди в питании фабрики + целевой коридор.
  const gc = sims[0].cfg.grade;
  const gradeData = sims[0].history.map((h, i) => {
    const row: Record<string, number | null> = { t: h.tMin / 60 };
    sims.forEach((s) => {
      const p = s.history[i];
      row[s.strategyName] = p && p.feedGrade !== null ? +p.feedGrade.toFixed(3) : null;
    });
    return row;
  });

  // 2. Очереди по экскаваторам: средняя за смену (и текущая в одиночном режиме).
  const queueData = sims[0].excavators.map((e) => {
    const row: Record<string, number | string> = { name: e.name };
    sims.forEach((s) => {
      const ex = s.excavators[e.id];
      row[s.strategyName] = s.now > 0 ? +(ex.queueIntegral / s.now).toFixed(2) : 0;
    });
    if (!compare) row.current = sims[0].excavators[e.id].queue.length;
    return row;
  });

  // 3. Распределение времени самосвалов по состояниям.
  const share = (sec: Record<TruckState, number>) => {
    const total = Object.values(sec).reduce((a, b) => a + b, 0) || 1;
    const row: Record<string, number> = {};
    for (const g of STATE_GROUPS) row[g.key] = +((g.states.reduce((a, s) => a + sec[s], 0) / total) * 100).toFixed(1);
    return row;
  };
  const stateData = compare
    ? sims.map((s) => {
        const sum = Object.fromEntries(STATE_GROUPS.flatMap((g) => g.states).map((st) => [st, 0])) as Record<TruckState, number>;
        for (const t of s.trucks) for (const st of Object.keys(sum) as TruckState[]) sum[st] += t.stateSec[st];
        return { name: STRATEGY_LABEL[s.strategyName], ...share(sum) };
      })
    : sims[0].trucks.map((t) => ({ name: t.name.replace('№', ''), ...share(t.stateSec) }));

  return (
    <div className="grid h-full grid-cols-4 gap-3">
      <ChartCard title="Темп добычи, т/ч (скользящий час)">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={tphData} margin={{ top: 4, right: 8, left: -8, bottom: 0 }}>
            {GRID}
            <XAxis dataKey="t" type="number" domain={[0, 12]} ticks={[0, 2, 4, 6, 8, 10, 12]} unit=" ч" {...AXIS} />
            <YAxis {...AXIS} tickFormatter={(v) => fmtInt(v)} width={56} />
            <Tooltip {...TOOLTIP} labelFormatter={(v) => `Время смены: ${fmt1(Number(v))} ч`} formatter={(v: number) => `${fmtInt(v)} т/ч`} />
            {compare && <Legend {...LEGEND} />}
            {sims.map((s) => (
              <Line
                key={s.strategyName}
                dataKey={s.strategyName}
                name={STRATEGY_LABEL[s.strategyName]}
                stroke={STRATEGY_COLOR[s.strategyName]}
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title={`Медь в руде на фабрику, % (цель ${gc.targetPct} ± ${gc.bandPct})`}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={gradeData} margin={{ top: 4, right: 8, left: -8, bottom: 0 }}>
            {GRID}
            <ReferenceArea y1={gc.targetPct - gc.bandPct} y2={gc.targetPct + gc.bandPct} fill="#22c55e" fillOpacity={0.08} stroke="none" />
            <XAxis dataKey="t" type="number" domain={[0, 12]} ticks={[0, 2, 4, 6, 8, 10, 12]} unit=" ч" {...AXIS} />
            <YAxis {...AXIS} domain={[0.25, 0.45]} tickFormatter={(v) => Number(v).toFixed(2)} width={48} />
            <Tooltip {...TOOLTIP} labelFormatter={(v) => `Время смены: ${fmt1(Number(v))} ч`} formatter={(v: number) => `${v.toFixed(3)}% Cu`} />
            {compare && <Legend {...LEGEND} />}
            {sims.map((s) => (
              <Line
                key={s.strategyName}
                dataKey={s.strategyName}
                name={STRATEGY_LABEL[s.strategyName]}
                stroke={STRATEGY_COLOR[s.strategyName]}
                strokeWidth={2}
                dot={false}
                connectNulls={false}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title={compare ? 'Средняя очередь у экскаваторов, самосвалов' : 'Очередь у экскаваторов, самосвалов'}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={queueData} margin={{ top: 4, right: 8, left: -18, bottom: 0 }} barGap={2}>
            {GRID}
            <XAxis dataKey="name" {...AXIS} />
            <YAxis {...AXIS} allowDecimals />
            <Tooltip {...TOOLTIP} formatter={(v: number) => fmt1(v)} />
            <Legend {...LEGEND} />
            {sims.map((s) => (
              <Bar
                key={s.strategyName}
                dataKey={s.strategyName}
                name={compare ? STRATEGY_LABEL[s.strategyName] : 'Средняя за смену'}
                fill={compare ? STRATEGY_COLOR[s.strategyName] : EXCAVATOR_SERIES[0]}
                radius={[4, 4, 0, 0]}
                isAnimationActive={false}
              />
            ))}
            {!compare && <Bar dataKey="current" name="Сейчас" fill={EXCAVATOR_SERIES[1]} radius={[4, 4, 0, 0]} isAnimationActive={false} />}
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title="Время самосвалов по состояниям, %">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={stateData}
            layout={compare ? 'vertical' : 'horizontal'}
            margin={{ top: 4, right: 8, left: compare ? 4 : -18, bottom: 0 }}
            barCategoryGap={compare ? '28%' : '12%'}
          >
            {GRID}
            {compare ? (
              <>
                <XAxis type="number" domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} allowDataOverflow unit="%" {...AXIS} />
                <YAxis type="category" dataKey="name" width={96} {...AXIS} />
              </>
            ) : (
              <>
                <XAxis dataKey="name" {...AXIS} interval={0} fontSize={9} />
                <YAxis domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} allowDataOverflow {...AXIS} />
              </>
            )}
            <Tooltip {...TOOLTIP} formatter={(v: number) => `${fmt1(v)}%`} />
            <Legend {...LEGEND} />
            {STATE_GROUPS.map((g) => (
              <Bar
                key={g.key}
                dataKey={g.key}
                name={g.label}
                stackId="s"
                fill={g.color}
                stroke="#14181d"
                strokeWidth={1}
                isAnimationActive={false}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>
    </div>
  );
}
