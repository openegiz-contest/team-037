/** Граф дорог карьера и поиск кратчайшего пути (Dijkstra). */

export type NodeKind = 'ramp' | 'ring' | 'face' | 'site' | 'junction' | 'slot';
/** lot — проезды стоянки, park — заезд на место. */
export type EdgeKind = 'ramp' | 'ring' | 'rim' | 'surface' | 'spur' | 'lot' | 'park';

export interface GNode {
  id: number;
  x: number;
  y: number;
  kind: NodeKind;
}

export interface GEdge {
  id: number;
  a: number;
  b: number;
  len: number;
  kind: EdgeKind;
}

export interface ShortestPaths {
  dist: Float64Array;
  prev: Int32Array;
}

export class RoadGraph {
  readonly nodes: GNode[] = [];
  readonly edges: GEdge[] = [];
  readonly adj: { to: number; edge: number }[][] = [];
  private readonly pair = new Map<number, number>();

  addNode(x: number, y: number, kind: NodeKind): number {
    const id = this.nodes.length;
    this.nodes.push({ id, x, y, kind });
    this.adj.push([]);
    return id;
  }

  addEdge(a: number, b: number, kind: EdgeKind, len?: number): number {
    const existing = this.edgeBetween(a, b);
    if (existing !== undefined) return existing;
    const na = this.nodes[a];
    const nb = this.nodes[b];
    const id = this.edges.length;
    const length = len ?? Math.hypot(na.x - nb.x, na.y - nb.y);
    this.edges.push({ id, a, b, len: length, kind });
    this.adj[a].push({ to: b, edge: id });
    this.adj[b].push({ to: a, edge: id });
    this.pair.set(a * 1_000_003 + b, id);
    this.pair.set(b * 1_000_003 + a, id);
    return id;
  }

  edgeBetween(a: number, b: number): number | undefined {
    return this.pair.get(a * 1_000_003 + b);
  }

  dijkstra(src: number, closed?: ReadonlySet<number>): ShortestPaths {
    const n = this.nodes.length;
    const dist = new Float64Array(n).fill(Infinity);
    const prev = new Int32Array(n).fill(-1);
    dist[src] = 0;
    const heap = new MinHeap();
    heap.push(src, 0);
    while (heap.size > 0) {
      const [u, du] = heap.pop();
      if (du > dist[u]) continue;
      for (const { to, edge } of this.adj[u]) {
        if (closed?.has(edge)) continue;
        const nd = du + this.edges[edge].len;
        if (nd < dist[to]) {
          dist[to] = nd;
          prev[to] = u;
          heap.push(to, nd);
        }
      }
    }
    return { dist, prev };
  }

  /** Кратчайший путь src → dst; null, если недостижимо. */
  path(src: number, dst: number, closed?: ReadonlySet<number>): { nodes: number[]; length: number } | null {
    return pathFrom(this.dijkstra(src, closed), src, dst);
  }

  /** Длина маршрута по списку узлов. */
  pathLength(nodes: readonly number[]): number {
    let len = 0;
    for (let i = 0; i + 1 < nodes.length; i++) {
      const e = this.edgeBetween(nodes[i], nodes[i + 1]);
      if (e === undefined) throw new Error(`Нет ребра ${nodes[i]}→${nodes[i + 1]}`);
      len += this.edges[e].len;
    }
    return len;
  }

  /** Достижимы ли все узлы targets из src при закрытых рёбрах. */
  allReachable(src: number, targets: readonly number[], closed?: ReadonlySet<number>): boolean {
    const sp = this.dijkstra(src, closed);
    return targets.every((t) => Number.isFinite(sp.dist[t]));
  }
}

export function pathFrom(sp: ShortestPaths, src: number, dst: number): { nodes: number[]; length: number } | null {
  if (!Number.isFinite(sp.dist[dst])) return null;
  const nodes: number[] = [];
  for (let v = dst; v !== -1; v = sp.prev[v]) {
    nodes.push(v);
    if (v === src) break;
  }
  nodes.reverse();
  return { nodes, length: sp.dist[dst] };
}

/** Маршрутизатор с кэшем деревьев кратчайших путей; кэш сбрасывается при изменении закрытий. */
export class Router {
  readonly closed = new Set<number>();
  private cache = new Map<number, ShortestPaths>();
  version = 0;

  constructor(readonly graph: RoadGraph) {}

  from(src: number): ShortestPaths {
    let sp = this.cache.get(src);
    if (!sp) {
      sp = this.graph.dijkstra(src, this.closed);
      this.cache.set(src, sp);
    }
    return sp;
  }

  route(src: number, dst: number): number[] | null {
    return pathFrom(this.from(src), src, dst)?.nodes ?? null;
  }

  distance(src: number, dst: number): number {
    return this.from(src).dist[dst];
  }

  setClosed(edges: Iterable<number>): void {
    this.closed.clear();
    for (const e of edges) this.closed.add(e);
    this.cache.clear();
    this.version++;
  }
}

class MinHeap {
  private ids: number[] = [];
  private keys: number[] = [];

  get size(): number {
    return this.ids.length;
  }

  push(id: number, key: number): void {
    this.ids.push(id);
    this.keys.push(key);
    let i = this.ids.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.keys[p] <= this.keys[i]) break;
      this.swap(i, p);
      i = p;
    }
  }

  pop(): [number, number] {
    const top: [number, number] = [this.ids[0], this.keys[0]];
    const lastId = this.ids.pop()!;
    const lastKey = this.keys.pop()!;
    if (this.ids.length > 0) {
      this.ids[0] = lastId;
      this.keys[0] = lastKey;
      let i = 0;
      const n = this.ids.length;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < n && this.keys[l] < this.keys[m]) m = l;
        if (r < n && this.keys[r] < this.keys[m]) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return top;
  }

  private swap(i: number, j: number): void {
    [this.ids[i], this.ids[j]] = [this.ids[j], this.ids[i]];
    [this.keys[i], this.keys[j]] = [this.keys[j], this.keys[i]];
  }
}
