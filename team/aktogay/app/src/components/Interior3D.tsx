import { useEffect, useRef } from 'react';
import type { Simulation } from '../sim';
import { InteriorScene, type InteriorKind } from '../render3d/InteriorScene';

/** 3D-цех внутри здания (дробилка, фабрика). ЛКМ — вращение, колесо — масштаб. */
export function Interior3D({ sim, kind, light }: { sim: Simulation; kind: InteriorKind; light: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const scene = new InteriorScene(host.current!, sim, kind, { light });
    return () => scene.dispose();
  }, [sim, kind, light]);
  return <div ref={host} className="relative h-full min-h-[320px] w-full cursor-grab overflow-hidden rounded-lg active:cursor-grabbing" />;
}
