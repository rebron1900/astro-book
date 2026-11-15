/**
 * 花园关系图谱的数据层（构建期与客户端共用）。
 *
 * 形状实测：269 节点 / 252 条无向边 / 最大度 206（只有一个 hub）/ 37 个孤立点，
 * 所以布局是「一个中心 + 一圈细枝 + 外环孤点」，不是均匀网状，力参数按这个调。
 *
 * 全站图坐标在构建期算好（`layoutGardenGraph`），客户端首屏不跑长模拟；
 * 右栏局部图节点少（≤60）时才在客户端跑一次短模拟。
 */
import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation } from 'd3-force';

export interface GardenGraphNode {
    id: string;
    title: string;
    folder: string;
    degree: number;
    x: number;
    y: number;
}

export interface GardenGraphEdge {
    source: string;
    target: string;
}

export interface GardenGraph {
    nodes: GardenGraphNode[];
    edges: GardenGraphEdge[];
}

export interface GardenGraphNote {
    id: string;
    title: string;
    links?: string[];
}

/** 笔记 id → 站内 URL；根笔记 index.md 的页面是 `/garden/` */
// URL 规则统一放在 path.ts，这里转出去保持既有 import 不变
export { gardenHrefOf } from './path';

const folderOf = (id: string): string => (id.includes('/') ? id.slice(0, id.lastIndexOf('/')) : '');

/**
 * 构图：边按无向去重（`a→b` 与 `b→a` 算一条），自链丢弃。
 * 孤立点保留在数据里（`degree === 0`），由页面决定默认隐藏。
 */
export function buildGardenGraph(notes: readonly GardenGraphNote[]): GardenGraph {
    const known = new Map(notes.map((note) => [note.id, note]));
    const degree = new Map<string, number>();
    const seen = new Set<string>();
    const edges: GardenGraphEdge[] = [];

    for (const note of notes) {
        for (const target of note.links ?? []) {
            if (target === note.id || !known.has(target)) continue;
            const key = note.id < target ? `${note.id}\u0000${target}` : `${target}\u0000${note.id}`;
            if (seen.has(key)) continue;
            seen.add(key);
            edges.push({ source: note.id < target ? note.id : target, target: note.id < target ? target : note.id });
            degree.set(note.id, (degree.get(note.id) ?? 0) + 1);
            degree.set(target, (degree.get(target) ?? 0) + 1);
        }
    }

    const nodes: GardenGraphNode[] = notes
        .map((note) => ({
            id: note.id,
            title: note.title,
            folder: folderOf(note.id),
            degree: degree.get(note.id) ?? 0,
            x: 0,
            y: 0
        }))
        .sort((a, b) => a.id.localeCompare(b.id));

    edges.sort((a, b) => (a.source === b.source ? a.target.localeCompare(b.target) : a.source.localeCompare(b.source)));

    return { nodes, edges };
}

/** 确定性 PRNG（mulberry32）：d3-force 的 jiggle 默认用 Math.random，固定种子才可复现 */
function mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

export interface LayoutOptions {
    size?: number;
    ticks?: number;
    padding?: number;
}

/**
 * 构建期布局：孤立点固定在外环（按 id 均匀分布，避免被力导向堆在中心），
 * 连通部分用 d3-force 跑固定 tick，最后归一化到 `[padding, size-padding]`。
 * 结果确定性：固定种子 + phyllotaxis 初值，两次构建坐标一致。
 */
export function layoutGardenGraph(graph: GardenGraph, options: LayoutOptions = {}): void {
    const size = options.size ?? 1000;
    const ticks = options.ticks ?? 300;
    const padding = options.padding ?? 40;
    const center = size / 2;

    const isolated = graph.nodes.filter((node) => node.degree === 0).sort((a, b) => a.id.localeCompare(b.id));
    const connected = graph.nodes.filter((node) => node.degree > 0);

    // 孤立点：半径固定的外环，收进 8% 内边距（不贴 0/1000 边界），和力导向区域拉开
    const ring = center - Math.max(padding, size * 0.08);
    isolated.forEach((node, index) => {
        const angle = (index / Math.max(1, isolated.length)) * Math.PI * 2 - Math.PI / 2;
        node.x = center + Math.cos(angle) * ring;
        node.y = center + Math.sin(angle) * ring;
    });

    // 连通部分：phyllotaxis 初值（确定、无随机、天然不自重合）
    const golden = Math.PI * (3 - Math.sqrt(5));
    connected.forEach((node, index) => {
        const radius = Math.sqrt(index + 0.5) * 14;
        node.x = center + Math.cos(index * golden) * radius;
        node.y = center + Math.sin(index * golden) * radius;
    });

    // 只有一个 hub（度 200+）时把它钉在中心，图才对称；否则力导向会把整团推到角落
    const hub = connected.length
        ? connected.reduce((best, node) => (node.degree > best.degree ? node : best), connected[0]!)
        : null;

    if (connected.length > 1) {
        if (hub && hub.degree >= connected.length * 0.3) {
            (hub as { x: number; y: number; fx?: number | null; fy?: number | null }).fx = center;
            (hub as { x: number; y: number; fx?: number | null; fy?: number | null }).fy = center;
        }

        const sim = forceSimulation(connected as never[])
            .force(
                'link',
                forceLink(
                    graph.edges.map((edge) => ({ source: edge.source, target: edge.target })) as never[]
                )
                    .id((datum: unknown) => (datum as GardenGraphNode).id)
                    .distance(110)
                    .strength(0.45)
            )
            .force('charge', forceManyBody().strength(-260).distanceMax(520))
            .force('center', forceCenter(center, center))
            .force('collide', forceCollide(9))
            .stop();
        sim.randomSource(mulberry32(42));
        for (let tick = 0; tick < ticks; tick += 1) sim.tick();

        // 清掉 pin，坐标已经固化
        for (const node of connected) {
            (node as { fx?: number | null; fy?: number | null }).fx = null;
            (node as { fx?: number | null; fy?: number | null }).fy = null;
        }
    }

    // 归一化：以 hub 为锚等比缩放，hub 永远落在画布中心（没有 hub 时用包围盒中心）。
    // 用 p95 而不是 max：几个离群点会把整团压成一小块，p95 让主体铺满画布（离群点由后面的
    // 边界 clamp 收进画布内，属于构建期静态处理，不是渲染层逐帧夹）。
    const anchor = hub ?? { x: center, y: center };
    const distances = connected
        .map((node) => Math.hypot(node.x - anchor.x, node.y - anchor.y))
        .sort((a, b) => a - b);
    const p95 = distances.length ? distances[Math.min(distances.length - 1, Math.floor(distances.length * 0.95))] : 1;
    const maxDistance = Math.max(p95, 1);
    const scale = (center - padding) / maxDistance;

    for (const node of connected) {
        node.x = Math.round(center + (node.x - anchor.x) * scale);
        node.y = Math.round(center + (node.y - anchor.y) * scale);
    }

    for (const node of graph.nodes) {
        node.x = Math.max(padding, Math.min(size - padding, node.x));
        node.y = Math.max(padding, Math.min(size - padding, node.y));
    }
}

export interface Subgraph {
    nodes: GardenGraphNode[];
    edges: GardenGraphEdge[];
    /** 因超出上限被裁掉的邻居数（>0 时页面要提示「仅显示 N 个邻居」） */
    truncated: number;
}

/**
 * 以某篇为中心取邻域。
 *
 * - `depth = 1`：自身 + 入/出邻居；
 * - `depth = 2`：再扩一层；
 * - 节点超过 `limit` 时按「度降序 + id」裁剪，并只在保留节点之间补边，避免边指向已裁掉的节点。
 */
export function subgraphAround(graph: GardenGraph, centerId: string, depth = 1, limit = 60): Subgraph {
    const byId = new Map(graph.nodes.map((node) => [node.id, node]));
    if (!byId.has(centerId)) return { nodes: [], edges: [], truncated: 0 };

    const adjacency = new Map<string, string[]>();
    for (const edge of graph.edges) {
        adjacency.set(edge.source, [...(adjacency.get(edge.source) ?? []), edge.target]);
        adjacency.set(edge.target, [...(adjacency.get(edge.target) ?? []), edge.source]);
    }

    const keep = new Set<string>([centerId]);
    let frontier = [centerId];
    for (let level = 0; level < depth; level += 1) {
        const next: string[] = [];
        for (const id of frontier) {
            for (const neighbor of adjacency.get(id) ?? []) {
                if (!keep.has(neighbor)) {
                    keep.add(neighbor);
                    next.push(neighbor);
                }
            }
        }
        frontier = next;
        if (!frontier.length) break;
    }

    let truncated = 0;
    if (keep.size > limit) {
        const others = [...keep]
            .filter((id) => id !== centerId)
            .map((id) => byId.get(id)!)
            .sort((a, b) => b.degree - a.degree || a.id.localeCompare(b.id));
        const allowed = new Set<string>([centerId, ...others.slice(0, Math.max(0, limit - 1)).map((node) => node.id)]);
        truncated = keep.size - allowed.size;
        for (const id of keep) if (!allowed.has(id)) keep.delete(id);
    }

    const nodes = [...keep].map((id) => byId.get(id)!).sort((a, b) => a.id.localeCompare(b.id));
    const edges = graph.edges.filter((edge) => keep.has(edge.source) && keep.has(edge.target));

    return { nodes, edges, truncated };
}
