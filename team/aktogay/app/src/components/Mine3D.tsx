import { useEffect, useRef, useState } from 'react';
import type { Simulation } from '../sim';
import type { Selection } from '../render/drawMine';
import { MineScene, type BuildingKind, type CameraPreset, type FocusTarget } from '../render3d/MineScene';
import { EquipmentSearch } from './EquipmentSearch';

interface Props {
  sim: Simulation;
  selection: Selection;
  onSelect: (s: Selection) => void;
  /** Показывать кнопки камеры (в режиме сравнения — только на одной из карт). */
  showControls?: boolean;
  /** Лёгкая графика (без теней и свечения) — для машин без видеокарты. */
  light?: boolean;
  /** Сцена тормозит в полном качестве. */
  onSlow?: () => void;
  /** Клик по зданию — открыть его «внутренний двойник». */
  onBuilding?: (kind: BuildingKind) => void;
  children?: React.ReactNode;
}

const PRESETS: { key: CameraPreset; label: string }[] = [
  { key: 'overview', label: 'Общий вид' },
  { key: 'crusher', label: 'Дробилка' },
  { key: 'bottom', label: 'Дно карьера' },
  { key: 'side', label: 'Смотровая' },
];

/** 3D-вид карьера (Three.js). Камера: ЛКМ — вращение, ПКМ — сдвиг, колесо — масштаб. */
export function Mine3D({ sim, selection, onSelect, showControls = true, light = false, onSlow, onBuilding, children }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<MineScene | null>(null);
  const [orbit, setOrbit] = useState(false);
  /** Подписи на сцене: все сразу или только у объекта под курсором. */
  const [labelsAll, setLabelsAll] = useState(true);
  const [follow, setFollow] = useState(false);
  const [full, setFull] = useState(false);

  useEffect(() => {
    if (!full) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setFull(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [full]);

  const onSlowRef = useRef(onSlow);
  onSlowRef.current = onSlow;

  useEffect(() => {
    const scene = new MineScene(hostRef.current!, sim, { light, onSlow: () => onSlowRef.current?.() });
    sceneRef.current = scene;
    const el = scene.domElement;
    let down: { x: number; y: number } | null = null;
    const onDown = (e: PointerEvent) => {
      down = { x: e.clientX, y: e.clientY };
    };
    // Клик по зданию открывает его «внутренний двойник» с небольшой задержкой: двойной клик вместо этого подлетает к нему.
    let buildingTimer = 0;
    const onUp = (e: PointerEvent) => {
      if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 5) {
        const sel = scene.pick(e.clientX, e.clientY);
        const b = sel ? null : scene.pickBuilding(e.clientX, e.clientY);
        if (b && onBuildingRef.current) {
          window.clearTimeout(buildingTimer);
          buildingTimer = window.setTimeout(() => onBuildingRef.current?.(b), 280);
        } else onSelectRef.current(sel);
      }
      down = null;
    };
    const onDbl = (e: MouseEvent) => {
      window.clearTimeout(buildingTimer);
      const t = scene.pickFocus(e.clientX, e.clientY);
      if (t) focusRef.current(t);
    };
    el.addEventListener('dblclick', onDbl);
    // Над зданием — курсор «рука»: его можно открыть.
    let lastMove = 0;
    const onLeave = () => sceneRef.current?.setHover(null);
    const onMove = (e: PointerEvent) => {
      if (e.buttons || performance.now() - lastMove < 80) return;
      lastMove = performance.now();
      el.style.cursor = onBuildingRef.current && scene.pickBuilding(e.clientX, e.clientY) ? 'pointer' : '';
      scene.setHover(e.clientX, e.clientY);
    };
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerleave', onLeave);
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointerup', onUp);
    return () => {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerleave', onLeave);
      el.removeEventListener('dblclick', onDbl);
      window.clearTimeout(buildingTimer);
      scene.dispose();
      sceneRef.current = null;
    };
  }, [sim, light]);

  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const onBuildingRef = useRef(onBuilding);
  onBuildingRef.current = onBuilding;

  /** Найти объект: выделить (техника) и подлететь камерой. */
  const focus = (t: FocusTarget) => {
    const scene = sceneRef.current;
    if (!scene) return;
    setOrbit(false);
    onSelectRef.current(t.kind === 'truck' || t.kind === 'excavator' ? { kind: t.kind, id: t.id } : null);
    // Выделение применится в эффекте — подлетаем на следующем кадре, чтобы «Следовать» сработало.
    requestAnimationFrame(() => {
      scene.focusOn(t);
      setFollow(t.kind === 'truck');
    });
  };
  const focusRef = useRef(focus);
  focusRef.current = focus;

  useEffect(() => {
    sceneRef.current?.setSelection(selection);
    if (selection?.kind !== 'truck') setFollow(false);
  }, [selection]);

  useEffect(() => sceneRef.current?.setLabelMode(labelsAll ? 'all' : 'hover'), [labelsAll]);
  useEffect(() => sceneRef.current?.setAutoRotate(orbit), [orbit]);
  useEffect(() => sceneRef.current?.setFollow(follow), [follow]);

  const btn = 'rounded px-2 py-1 text-[12px] font-semibold backdrop-blur transition';
  return (
    <div className={full ? 'fixed inset-0 z-50 bg-bg' : 'relative h-full w-full overflow-hidden rounded-[10px]'}>
      <div ref={hostRef} className="absolute inset-0 cursor-grab active:cursor-grabbing" />
      {showControls && (
        <div className="absolute left-3 top-12 z-10 flex flex-wrap gap-1 pr-3">
          {PRESETS.map((p) => (
            <button key={p.key} onClick={() => sceneRef.current?.applyPreset(p.key)} className={`${btn} bg-black/55 text-ink-2 hover:bg-black/75 hover:text-ink`}>
              {p.label}
            </button>
          ))}
          <button
            onClick={() => setLabelsAll((v) => !v)}
            className={`${btn} ${labelsAll ? 'bg-black/55 text-ink-2 hover:text-ink' : 'bg-amber-500 text-black'}`}
            title={labelsAll ? 'Скрыть подписи — показывать только у объекта под курсором' : 'Показать все подписи'}
          >
            {labelsAll ? '◌ Скрыть подписи' : '◉ Подписи по наведению'}
          </button>
          <button onClick={() => setOrbit((o) => !o)} className={`${btn} ${orbit ? 'bg-amber-500 text-black' : 'bg-black/55 text-ink-2 hover:text-ink'}`}>
            ⟳ Облёт
          </button>
          <button onClick={() => setFull((f) => !f)} className={`${btn} bg-black/55 text-ink-2 hover:text-ink`} title="Во весь экран (Esc — выход)">
            {full ? '✕ Свернуть' : '⤢ Во весь экран'}
          </button>
          {selection?.kind === 'truck' && (
            <button onClick={() => setFollow((f) => !f)} className={`${btn} ${follow ? 'bg-amber-500 text-black' : 'bg-black/55 text-ink-2 hover:text-ink'}`}>
              ◎ Следовать
            </button>
          )}
        </div>
      )}
      {showControls && <EquipmentSearch sim={sim} onPick={focus} />}
      {children}
    </div>
  );
}
