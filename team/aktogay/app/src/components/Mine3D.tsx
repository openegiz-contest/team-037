import { useEffect, useRef, useState } from 'react';
import type { Simulation } from '../sim';
import type { Selection } from '../render/drawMine';
import { MineScene, type CameraPreset } from '../render3d/MineScene';

interface Props {
  sim: Simulation;
  selection: Selection;
  onSelect: (s: Selection) => void;
  /** Показывать кнопки камеры (в режиме сравнения — только на одной из карт). */
  showControls?: boolean;
  children?: React.ReactNode;
}

const PRESETS: { key: CameraPreset; label: string }[] = [
  { key: 'overview', label: 'Общий вид' },
  { key: 'crusher', label: 'Дробилка' },
  { key: 'bottom', label: 'Дно карьера' },
  { key: 'side', label: 'Разрез' },
];

/** 3D-вид карьера (Three.js). Камера: ЛКМ — вращение, ПКМ — сдвиг, колесо — масштаб. */
export function Mine3D({ sim, selection, onSelect, showControls = true, children }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<MineScene | null>(null);
  const [orbit, setOrbit] = useState(false);
  const [follow, setFollow] = useState(false);
  const [full, setFull] = useState(false);

  useEffect(() => {
    if (!full) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setFull(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [full]);

  useEffect(() => {
    const scene = new MineScene(hostRef.current!, sim);
    sceneRef.current = scene;
    const el = scene.domElement;
    let down: { x: number; y: number } | null = null;
    const onDown = (e: PointerEvent) => {
      down = { x: e.clientX, y: e.clientY };
    };
    const onUp = (e: PointerEvent) => {
      if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 5) onSelectRef.current(scene.pick(e.clientX, e.clientY));
      down = null;
    };
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointerup', onUp);
    return () => {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointerup', onUp);
      scene.dispose();
      sceneRef.current = null;
    };
  }, [sim]);

  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  useEffect(() => {
    sceneRef.current?.setSelection(selection);
    if (selection?.kind !== 'truck') setFollow(false);
  }, [selection]);

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
          <button onClick={() => setOrbit((o) => !o)} className={`${btn} ${orbit ? 'bg-amber-500 text-black' : 'bg-black/55 text-ink-2 hover:text-ink'}`}>
            ⟳ Облёт
          </button>
          <button onClick={() => setFull((f) => !f)} className={`${btn} bg-black/55 text-ink-2 hover:text-ink`} title="Во весь экран (Esc — выход)">
            {full ? '✕ Свернуть' : '⛶ Во весь экран'}
          </button>
          {selection?.kind === 'truck' && (
            <button onClick={() => setFollow((f) => !f)} className={`${btn} ${follow ? 'bg-amber-500 text-black' : 'bg-black/55 text-ink-2 hover:text-ink'}`}>
              🎥 Следовать
            </button>
          )}
        </div>
      )}
      {children}
    </div>
  );
}
