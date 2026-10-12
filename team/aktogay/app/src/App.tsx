import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Charts } from './components/Charts';
import { InfoCard } from './components/InfoCard';
import { DiagnosticsPanel } from './components/DiagnosticsPanel';
import { KpiPanel } from './components/KpiPanel';
import { Mine3D } from './components/Mine3D';
import { MineCanvas } from './components/MineCanvas';
import { PlatformBridge } from './platform/bridge';
import type { Selection } from './render/drawMine';
import { computeEffect, computeKpis, deltaPct, MATERIAL_SHORT, Simulation, STRATEGY_LABEL, type StrategyName } from './sim';
import { fmtClock, fmtDelta, fmtInt, fmtKzt } from './ui/format';
import { MATERIAL_COLOR, STATE_GROUPS, STRATEGY_COLOR } from './ui/theme';

type Mode = 'compare' | 'single';
type View = '3d' | '2d';
type Speed = 1 | 5 | 20 | 50 | 'max';

/** Секунд смены за 1 секунду реального времени при скорости x1. */
const BASE_RATE = 10;
const SPEEDS: Speed[] = [1, 5, 20, 50, 'max'];

export default function App() {
  const [mode, setMode] = useState<Mode>('compare');
  const [view, setView] = useState<View>('3d');
  const [strategy, setStrategy] = useState<StrategyName>('smart');
  const [seed, setSeed] = useState(42);
  const [trucks, setTrucks] = useState(20);
  const [speed, setSpeed] = useState<Speed>(20);
  const [running, setRunning] = useState(false);
  const [selection, setSelection] = useState<{ sim: number; sel: Selection } | null>(null);
  const [epoch, setEpoch] = useState(0);
  const [, setFrame] = useState(0);
  const [toast, setToast] = useState<string | null>(null);

  const simsRef = useRef<Simulation[]>([]);
  /** Подключение к OpenEgiz: если интерфейс открыт со Стенда, данные берутся из двойников Ditto. */
  const [bridge, setBridge] = useState<PlatformBridge | null>(null);
  const bridgeRef = useRef<PlatformBridge | null>(null);
  const runningRef = useRef(running);
  const speedRef = useRef(speed);
  const breakIdx = useRef(0);
  const closeIdx = useRef(0);
  const blastIdx = useRef(1);
  runningRef.current = running;
  speedRef.current = speed;

  const createSims = useCallback(() => {
    const strategies: StrategyName[] = mode === 'compare' ? ['fixed', 'smart'] : [strategy];
    simsRef.current = strategies.map((s) => new Simulation({ seed, truckCount: trucks, strategy: s }));
    breakIdx.current = 0;
    closeIdx.current = 0;
    setSelection(null);
    setEpoch((e) => e + 1);
  }, [mode, strategy, seed, trucks]);

  useEffect(createSims, [createSims]);

  useEffect(() => {
    let alive = true;
    void PlatformBridge.detect().then((b) => {
      if (!alive || !b) return;
      b.onReset = () => {
        setSelection(null);
        setEpoch((e) => e + 1);
      };
      bridgeRef.current = b;
      setBridge(b);
    });
    return () => {
      alive = false;
    };
  }, []);

  // Главный цикл: продвигаем все симуляции синхронно на одно и то же модельное время.
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let lastUi = 0;
    const loop = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const b = bridgeRef.current;
      if (b) {
        // Режим платформы: модель считает сервис-симулятор, здесь только применяем данные двойников.
        b.pump(now);
        if (b.sims) for (const s of Object.values(b.sims)) s.alphaOverride = b.alpha(now);
      }
      const sims = simsRef.current;
      if (!b && runningRef.current && sims.length > 0) {
        const sp = speedRef.current;
        if (sp === 'max') {
          const deadline = performance.now() + 14;
          while (performance.now() < deadline && !sims.every((s) => s.finished)) for (const s of sims) s.advance(120);
        } else {
          const simSec = dt * BASE_RATE * sp;
          for (const s of sims) s.advance(simSec);
        }
        if (sims.every((s) => s.finished)) setRunning(false);
      }
      if (now - lastUi > 200) {
        lastUi = now;
        setFrame((f) => f + 1);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  const flash = (text: string) => {
    setToast(text);
    window.setTimeout(() => setToast((t) => (t === text ? null : t)), 3500);
  };

  const triggerBreakdown = useCallback(() => {
    const b = bridgeRef.current;
    if (b?.sims) {
      const n = b.sims.smart.excavators.length;
      const exId = selection?.sel?.kind === 'excavator' ? selection.sel.id : breakIdx.current++ % n;
      void b.send('breakdown', exId);
      flash(`⚠ Сценарий отправлен в OpenEgiz: поломка ${b.sims.smart.excavators[exId].name}`);
      return;
    }
    const sims = simsRef.current;
    if (!sims.length) return;
    const n = sims[0].excavators.length;
    let exId: number;
    if (selection?.sel?.kind === 'excavator') exId = selection.sel.id;
    else {
      exId = breakIdx.current % n;
      breakIdx.current++;
    }
    for (const s of sims) s.injectExcavatorBreakdown(exId, 50 * 60);
    const ex = sims[0].excavators[exId];
    flash(`⚠ Поломка экскаватора ${ex.name} (${MATERIAL_SHORT[ex.material]}) на 50 мин`);
    if (!runningRef.current) setRunning(true);
  }, [selection]);

  const triggerBlast = useCallback(() => {
    const b = bridgeRef.current;
    if (b?.sims) {
      const n = b.sims.smart.excavators.length;
      const exId = selection?.sel?.kind === 'excavator' ? selection.sel.id : blastIdx.current++ % n;
      void b.send('blast', exId);
      flash(`💥 Сценарий отправлен в OpenEgiz: взрыв у ${b.sims.smart.excavators[exId].name} через ${b.sims.smart.cfg.blasting.warnMin} мин`);
      return;
    }
    const sims = simsRef.current;
    if (!sims.length) return;
    const n = sims[0].excavators.length;
    let exId: number;
    if (selection?.sel?.kind === 'excavator') exId = selection.sel.id;
    else {
      exId = blastIdx.current % n;
      blastIdx.current++;
    }
    const warn = sims[0].cfg.blasting.warnMin;
    for (const s of sims) s.scheduleBlast(exId, warn * 60);
    flash(`💥 Взрывные работы у ${sims[0].excavators[exId].name} через ${warn} мин — вывод техники`);
    if (!runningRef.current) setRunning(true);
  }, [selection]);

  const triggerClosure = useCallback(() => {
    const b = bridgeRef.current;
    if (b?.sims) {
      const groups = b.sims.smart.layout.closureGroups;
      const g = closeIdx.current++ % groups.length;
      void b.send('close_road', g);
      flash(`⛔ Сценарий отправлен в OpenEgiz: перекрыт ${groups[g].label}`);
      return;
    }
    const sims = simsRef.current;
    if (!sims.length) return;
    const groups = sims[0].layout.closureGroups;
    for (let k = 0; k < groups.length; k++) {
      const g = (closeIdx.current + k) % groups.length;
      if (sims.every((s) => s.injectRoadClosure(g, 40 * 60))) {
        closeIdx.current = g + 1;
        flash(`⛔ Перекрыт участок: ${groups[g].label} на 40 мин`);
        return;
      }
    }
    flash('Нельзя перекрыть: сеть дорог разорвётся');
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'INPUT') return;
      if (e.code === 'Space') {
        e.preventDefault();
        if (bridgeRef.current) {
          const st = bridgeRef.current.status;
          void bridgeRef.current.send(st?.value === 'running' ? 'pause' : 'resume');
        } else setRunning((r) => !r);
      } else if (e.code === 'KeyB') triggerBreakdown();
      else if (e.code === 'KeyC') triggerClosure();
      else if (e.code === 'KeyE') triggerBlast();
      else if (e.code === 'KeyR') createSims();
    };
    // Пробел на сфокусированной кнопке иначе «нажмёт» её при отпускании клавиши.
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space' && (e.target as HTMLElement).tagName === 'BUTTON') e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [triggerBreakdown, triggerClosure, triggerBlast, createSims]);

  const platformSims = bridge?.sims ?? null;
  const sims = platformSims ? (mode === 'compare' ? [platformSims.fixed, platformSims.smart] : [platformSims[strategy]]) : simsRef.current;
  const kpis = sims.map((s) => bridge?.kpis[s.strategyName] ?? computeKpis(s));
  const pStatus = bridge?.status ?? null;
  const isRunning = bridge ? pStatus?.value === 'running' : running;
  const toggleRun = () => {
    if (bridge) void bridge.send(isRunning ? 'pause' : 'resume');
    else if (finished) {
      createSims();
      setRunning(true);
    } else setRunning((r) => !r);
  };
  const chooseSpeed = (s: Speed) => {
    setSpeed(s);
    if (bridge) void bridge.send('speed', s === 'max' ? 2000 : BASE_RATE * s);
  };
  const doReset = () => {
    if (bridge) {
      void bridge.send('reset', 0, { seed, trucks });
      flash(`↺ Новая смена в OpenEgiz: seed ${seed}, ${trucks} самосвалов`);
    } else createSims();
  };
  // Эффект показываем после первого часа: раньше экстраполяция на смену слишком шумная.
  const effect = sims.length === 2 && sims[1].now >= 3600 ? computeEffect(kpis[0], kpis[1], sims[1]) : null;
  const main = sims[sims.length - 1];
  const finished = sims.length > 0 && sims.every((s) => s.finished);
  const progress = main ? main.now / main.cfg.shift.durationSec : 0;
  const log = useMemo(() => (main ? [...main.log].reverse().slice(0, 7) : []), [main, main?.log.length, epoch]);

  if (!main) return null;

  return (
    <div className="scanlines flex h-full flex-col gap-2 p-3">
      {/* Заголовок */}
      <header className="flex items-center gap-4">
        <div className="flex items-center gap-3">
          <img src="./favicon.svg" alt="" className="h-9 w-9" />
          <div>
            <h1 className="text-[22px] font-bold leading-tight tracking-tight">Цифровой двойник карьера Актогай</h1>
            <div className="text-[12px] text-ink-3">Интеллектуальная диспетчеризация самосвалов · медь · Восточный Казахстан</div>
          </div>
        </div>
        <div className="ml-auto flex items-center gap-4">
          <div className="text-right">
            <div className="text-[11px] uppercase tracking-wider text-ink-3">Время смены</div>
            <div className="num text-[26px] font-bold leading-none text-amber-400">
              {fmtClock(main.now)}
              <span className="text-[16px] text-ink-3"> / 12:00</span>
            </div>
          </div>
          <div className="h-2.5 w-48 overflow-hidden rounded-full bg-panel-2">
            <div className="h-full rounded-full bg-gradient-to-r from-amber-600 to-amber-400" style={{ width: `${progress * 100}%` }} />
          </div>
          <span
            className={`rounded-md px-2 py-1 text-[11.5px] font-semibold ${bridge ? (bridge.connected ? 'bg-emerald-500/15 text-emerald-300' : 'bg-amber-500/15 text-amber-300') : 'bg-panel-2 text-ink-3'}`}
            title={bridge ? 'Данные берутся из двойников Eclipse Ditto платформы OpenEgiz' : 'Модель считается в браузере (OpenEgiz не найден)'}
          >
            {bridge ? `● OpenEgiz · Ditto${bridge.connected ? '' : ' (переподключение…)'}` : '○ автономный режим'}
          </span>
          <div className="flex overflow-hidden rounded-lg border border-line">
            {(['3d', '2d'] as View[]).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`px-3 py-1.5 text-[13px] font-semibold ${view === v ? 'bg-sky-500 text-black' : 'bg-panel text-ink-2 hover:bg-panel-2'}`}
              >
                {v === '3d' ? '3D' : '2D схема'}
              </button>
            ))}
          </div>
          <div className="flex overflow-hidden rounded-lg border border-line">
            {(['compare', 'single'] as Mode[]).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`px-3 py-1.5 text-[13px] font-semibold ${mode === m ? 'bg-amber-500 text-black' : 'bg-panel text-ink-2 hover:bg-panel-2'}`}
              >
                {m === 'compare' ? 'Сравнение' : 'Один карьер'}
              </button>
            ))}
          </div>
        </div>
      </header>

      {/* Панель управления */}
      <div className="panel flex flex-wrap items-center gap-x-5 gap-y-2 px-3 py-2 text-[13px]">
        <button
          onClick={toggleRun}
          className={`min-w-[112px] rounded-md px-3 py-1.5 font-bold ${isRunning ? 'bg-panel-2 text-amber-300 ring-1 ring-amber-500/50' : 'bg-amber-500 text-black hover:bg-amber-400'}`}
          title="Пробел"
        >
          {isRunning ? '❚❚ Пауза' : finished && !bridge ? '↻ Заново' : '▶ Старт'}
        </button>
        <div className="flex items-center gap-1">
          <span className="mr-1 text-ink-3">Скорость</span>
          {SPEEDS.map((s) => (
            <button
              key={s}
              onClick={() => chooseSpeed(s)}
              title={s === 'max' ? 'Максимально быстро — промотать смену' : `1 с = ${BASE_RATE * s} с смены`}
              className={`num rounded px-2 py-1 font-semibold ${speed === s ? 'bg-amber-500 text-black' : 'bg-panel-2 text-ink-2 hover:text-ink'}`}
            >
              {s === 'max' ? '⏩ МАКС' : `x${s}`}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2">
          <span className="text-ink-3">Seed</span>
          <input
            type="number"
            value={seed}
            onChange={(e) => setSeed(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
            className="num w-20 rounded border border-line bg-panel-2 px-2 py-1 text-ink outline-none focus:border-amber-500"
          />
          <button onClick={() => setSeed(Math.floor(Math.random() * 10000))} className="rounded bg-panel-2 px-2 py-1 text-ink-2 hover:text-ink" title="Случайный seed">
            🎲
          </button>
        </label>
        <label className="flex items-center gap-2">
          <span className="text-ink-3">Самосвалов</span>
          <input type="range" min={10} max={30} value={trucks} onChange={(e) => setTrucks(Number(e.target.value))} className="w-28" />
          <span className="num w-6 font-semibold">{trucks}</span>
        </label>
        {mode === 'single' && (
          <div className="flex overflow-hidden rounded-md border border-line">
            {(['fixed', 'smart'] as StrategyName[]).map((s) => (
              <button
                key={s}
                onClick={() => setStrategy(s)}
                className="px-2.5 py-1 font-semibold"
                style={strategy === s ? { background: STRATEGY_COLOR[s], color: '#fff' } : { color: '#a9b0ba' }}
              >
                {STRATEGY_LABEL[s]}
              </button>
            ))}
          </div>
        )}
        <div className="ml-auto flex items-center gap-2">
          <button onClick={triggerBreakdown} className="rounded-md bg-red-600/90 px-3 py-1.5 font-bold text-white hover:bg-red-500" title="Клавиша B. Если выбран экскаватор — ломается он.">
            ⚠ Вызвать поломку
          </button>
          <button onClick={triggerBlast} className="rounded-md bg-orange-600/90 px-3 py-1.5 font-bold text-white hover:bg-orange-500" title="Клавиша E. Если выбран экскаватор — взрыв у него.">
            💥 Взрыв
          </button>
          <button onClick={triggerClosure} className="rounded-md bg-panel-2 px-3 py-1.5 font-semibold text-red-300 ring-1 ring-red-500/40 hover:bg-red-500/10" title="Клавиша C">
            ⛔ Перекрыть съезд
          </button>
          {bridge && (
            <button
              onClick={() => {
                void bridge.send('cancel_all');
                flash('↶ Все сценарии «что если» отменены');
              }}
              className="rounded-md bg-panel-2 px-3 py-1.5 font-semibold text-emerald-300 ring-1 ring-emerald-500/40 hover:bg-emerald-500/10"
              title="Отменить все активные сценарии (поломки, закрытия, взрывы)"
            >
              ↶ Отменить сценарии
            </button>
          )}
          <button onClick={doReset} className="rounded-md bg-panel-2 px-3 py-1.5 font-semibold text-ink-2 hover:text-ink" title="Клавиша R">
            ↺ Сброс
          </button>
        </div>
      </div>

      {/* Основная область */}
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_370px] gap-3 2xl:grid-cols-[minmax(0,1fr)_440px]">
        <div className="flex min-h-0 flex-col gap-3">
          <div className={`grid min-h-0 flex-1 gap-3 ${sims.length === 2 ? 'grid-cols-2' : 'grid-cols-1'}`}>
            {sims.map((s, i) => (
              <div key={`${epoch}-${i}-${view}`} className="panel relative min-h-0 overflow-hidden" style={{ borderColor: `${STRATEGY_COLOR[s.strategyName]}66` }}>
                {(() => {
                  const overlay = (
                    <>
                  <div className="pointer-events-none absolute left-3 top-3 flex items-center gap-2">
                    <span className="rounded-md px-2.5 py-1 text-[13px] font-bold uppercase tracking-wider text-white" style={{ background: STRATEGY_COLOR[s.strategyName] }}>
                      {s.strategyName === 'smart' ? 'Умная диспетчеризация' : 'Фиксированное закрепление'}
                    </span>
                    <span className="num rounded-md bg-black/60 px-2 py-1 text-[13px] text-ink">
                      {fmtInt(kpis[i].minedTotal)} т · {fmtInt(kpis[i].tph)} т/ч
                    </span>
                  </div>
                  {i === sims.length - 1 && <Legend />}
                  {selection?.sim === i && <InfoCard sim={s} selection={selection.sel} onClose={() => setSelection(null)} />}
                    </>
                  );
                  const props = {
                    sim: s,
                    selection: selection?.sim === i ? selection.sel : null,
                    onSelect: (sel: Selection) => setSelection(sel ? { sim: i, sel } : null),
                  };
                  return view === '3d' ? <Mine3D {...props}>{overlay}</Mine3D> : <MineCanvas {...props}>{overlay}</MineCanvas>;
                })()}
              </div>
            ))}
          </div>
          <div className="h-[190px] shrink-0 2xl:h-[250px]">
            <Charts sims={sims} />
          </div>
        </div>

        <div className="flex min-h-0 flex-col gap-3">
          <div className="min-h-0 flex-1">
            <KpiPanel labels={sims.map((s) => s.strategyName)} kpis={kpis} effect={effect} pending={sims.length === 2 && !effect} />
          </div>
          {main.predictive && (
            <DiagnosticsPanel sim={main} onPick={(id) => setSelection({ sim: sims.length - 1, sel: { kind: 'truck', id } })} />
          )}
          <div className="panel h-[130px] shrink-0 overflow-hidden px-3 py-2 2xl:h-[168px]">
            <div className="mb-1 text-[12px] font-semibold uppercase tracking-wider text-ink-2">Журнал событий</div>
            {log.length === 0 && <div className="text-[13px] text-ink-3">Событий пока нет. Нажмите «▶ Старт».</div>}
            {log.map((l, k) => (
              <div key={`${l.t}-${k}`} className="flex gap-2 py-0.5 text-[12.5px]">
                <span className="num text-ink-3">{fmtClock(l.t)}</span>
                <span className={l.level === 'alarm' ? 'text-red-400' : l.level === 'warn' ? 'text-amber-300' : 'text-ink-2'}>{l.text}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <footer className="flex items-center justify-between text-[11px] text-ink-3">
        <span>Модель построена по открытым данным. Операционные данные смоделированы. Проект не связан с KAZ Minerals.</span>
        <span>
          seed {seed} · {trucks} самосвалов · Пробел — пауза, B — поломка, E — взрыв, C — перекрыть съезд, R — сброс
        </span>
      </footer>

      {toast && (
        <div className="fixed left-1/2 top-24 z-40 -translate-x-1/2 rounded-lg border border-red-500/50 bg-[#1a0d0d]/95 px-4 py-2 text-[15px] font-semibold text-red-200 shadow-2xl">
          {toast}
        </div>
      )}

      {finished && sims.length === 2 && effect && (
        <div className="fixed left-1/2 top-1/3 z-40 w-[560px] -translate-x-1/2 rounded-xl border border-amber-500/50 bg-[#0b0d10]/95 p-5 text-center shadow-2xl">
          <div className="text-[13px] uppercase tracking-widest text-ink-3">Смена завершена · seed {seed}</div>
          <div className="mt-2 text-[20px] font-semibold">Умная диспетчеризация против фиксированной</div>
          <div className="mt-3 grid grid-cols-3 gap-3">
            <Summary label="Добыча" value={fmtDelta(deltaPct(kpis[0].minedTotal, kpis[1].minedTotal))} good={kpis[1].minedTotal >= kpis[0].minedTotal} />
            <Summary
              label="Простой дробилки"
              value={fmtDelta(deltaPct(kpis[0].crusherIdleMin, kpis[1].crusherIdleMin))}
              good={kpis[1].crusherIdleMin <= kpis[0].crusherIdleMin}
            />
            <Summary label="Очереди" value={fmtDelta(deltaPct(kpis[0].avgQueueMin, kpis[1].avgQueueMin))} good={kpis[1].avgQueueMin <= kpis[0].avgQueueMin} />
          </div>
          <div className="num mt-4 text-[34px] font-extrabold text-amber-300">{fmtKzt(effect.perYearKzt)} / год</div>
          <div className="mt-3 flex justify-center gap-2">
            <button onClick={createSims} className="rounded-md bg-panel-2 px-3 py-1.5 font-semibold text-ink-2 hover:text-ink">
              ↺ Новая смена
            </button>
            <button
              onClick={() => setSeed((s) => s + 1)}
              className="rounded-md bg-amber-500 px-3 py-1.5 font-bold text-black hover:bg-amber-400"
            >
              Следующий seed →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Summary({ label, value, good }: { label: string; value: string; good: boolean }) {
  return (
    <div className="rounded-lg bg-panel-2 px-2 py-2">
      <div className="text-[12px] text-ink-3">{label}</div>
      <div className={`num text-[24px] font-bold ${good ? 'text-green-400' : 'text-red-400'}`}>{value}</div>
    </div>
  );
}

function Legend() {
  return (
    <div className="pointer-events-none absolute bottom-2 left-1/2 flex -translate-x-1/2 flex-wrap items-center justify-center gap-x-3 gap-y-0.5 rounded-md bg-black/65 px-2.5 py-1 text-[11.5px] text-ink-2">
      {STATE_GROUPS.map((g) => (
        <span key={g.key} className="flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: g.color }} />
          {g.label}
        </span>
      ))}
      <span className="h-3 border-l border-line" />
      {(['sulfide', 'oxide', 'waste'] as const).map((m) => (
        <span key={m} className="flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: MATERIAL_COLOR[m] }} />
          {MATERIAL_SHORT[m]}
        </span>
      ))}
    </div>
  );
}
