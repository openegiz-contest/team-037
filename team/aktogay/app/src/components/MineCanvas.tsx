import { useEffect, useRef } from 'react';
import type { Simulation } from '../sim';
import { drawDynamic, drawStatic, hitTest, makeView, type Selection, type View } from '../render/drawMine';

interface Props {
  sim: Simulation;
  selection: Selection;
  onSelect: (s: Selection) => void;
  children?: React.ReactNode;
}

/** Карта карьера. Сама перерисовывается в requestAnimationFrame, читая состояние симуляции напрямую. */
export function MineCanvas({ sim, selection, onSelect, children }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewRef = useRef<View | null>(null);
  const selRef = useRef<Selection>(selection);
  selRef.current = selection;

  useEffect(() => {
    const canvas = canvasRef.current!;
    const wrap = wrapRef.current!;
    const ctx = canvas.getContext('2d')!;
    let staticLayer: HTMLCanvasElement | null = null;
    let raf = 0;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = wrap.clientWidth;
      const h = wrap.clientHeight;
      if (w === 0 || h === 0) return;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      const view = makeView(sim, w, h);
      viewRef.current = view;
      staticLayer = document.createElement('canvas');
      staticLayer.width = canvas.width;
      staticLayer.height = canvas.height;
      const sctx = staticLayer.getContext('2d')!;
      sctx.scale(dpr, dpr);
      drawStatic(sctx, sim, view);
    };

    const frame = (now: number) => {
      const view = viewRef.current;
      if (view && staticLayer) {
        const dpr = window.devicePixelRatio || 1;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.drawImage(staticLayer, 0, 0);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        drawDynamic(ctx, sim, view, { now, alpha: sim.finished ? 1 : sim.alpha, selection: selRef.current });
      }
      raf = requestAnimationFrame(frame);
    };

    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    resize();
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [sim]);

  const onClick = (e: React.MouseEvent) => {
    const view = viewRef.current;
    if (!view) return;
    const rect = canvasRef.current!.getBoundingClientRect();
    onSelect(hitTest(sim, view, e.clientX - rect.left, e.clientY - rect.top));
  };

  return (
    <div ref={wrapRef} className="relative h-full w-full overflow-hidden rounded-[10px]">
      <canvas ref={canvasRef} onClick={onClick} className="block cursor-crosshair" />
      {children}
    </div>
  );
}
