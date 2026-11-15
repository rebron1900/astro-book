import { describe, expect, it } from 'vitest';
import { buildGardenGraph, gardenHrefOf, layoutGardenGraph, subgraphAround } from '../../src/lib/garden/graph';

const notes = [
    { id: 'a', title: 'A', links: ['b', 'c', 'a', 'missing'] },
    { id: 'b', title: 'B', links: ['a', 'c'] },
    { id: 'c', title: 'C', links: [] },
    { id: 'd', title: 'D', links: [] }
];

describe('构图', () => {
    it('无向边去重、自链与未知目标丢弃', () => {
        const graph = buildGardenGraph(notes);
        expect(graph.nodes).toHaveLength(4);
        expect(graph.edges).toHaveLength(3); // a-b, a-c, b-c
        expect(graph.edges.map((e) => `${e.source}|${e.target}`)).toEqual(['a|b', 'a|c', 'b|c']);
    });

    it('度数按无向边算，孤立点为 0', () => {
        const graph = buildGardenGraph(notes);
        const degree = Object.fromEntries(graph.nodes.map((node) => [node.id, node.degree]));
        expect(degree).toEqual({ a: 2, b: 2, c: 2, d: 0 });
    });

    it('根笔记映射到 /garden/，其余映射到 /garden/<id>/', () => {
        expect(gardenHrefOf('index')).toBe('/garden/');
        expect(gardenHrefOf('22-knowledge/ai')).toBe('/garden/22-knowledge/ai/');
    });
});

describe('布局', () => {
    it('坐标落在画布内且确定性（两次布局一致）', () => {
        const first = buildGardenGraph(notes);
        layoutGardenGraph(first, { size: 400, ticks: 60 });
        const second = buildGardenGraph(notes);
        layoutGardenGraph(second, { size: 400, ticks: 60 });
        expect(second.nodes.map((node) => [node.x, node.y])).toEqual(first.nodes.map((node) => [node.x, node.y]));
        for (const node of first.nodes) {
            expect(node.x).toBeGreaterThanOrEqual(0);
            expect(node.x).toBeLessThanOrEqual(400);
            expect(node.y).toBeGreaterThanOrEqual(0);
            expect(node.y).toBeLessThanOrEqual(400);
        }
    });

    it('孤立点固定在外环，不会被力导向堆到中心', () => {
        const graph = buildGardenGraph(notes);
        layoutGardenGraph(graph, { size: 400, ticks: 60 });
        const isolated = graph.nodes.find((node) => node.id === 'd')!;
        const dist = Math.hypot(isolated.x - 200, isolated.y - 200);
        expect(dist).toBeGreaterThan(120);
    });
});

describe('局部子图', () => {
    const graph = (() => {
        const built = buildGardenGraph([
            { id: 'hub', title: 'Hub', links: ['n1', 'n2', 'n3'] },
            { id: 'n1', title: 'N1', links: ['hub', 'n2'] },
            { id: 'n2', title: 'N2', links: [] },
            { id: 'n3', title: 'N3', links: [] },
            { id: 'far', title: 'Far', links: [] }
        ]);
        layoutGardenGraph(built, { size: 300, ticks: 30 });
        return built;
    })();

    it('1 跳拿自身与直接邻居，不跨到二跳', () => {
        const sub = subgraphAround(graph, 'n1', 1);
        expect(sub.nodes.map((node) => node.id).sort()).toEqual(['hub', 'n1', 'n2']);
        expect(sub.truncated).toBe(0);
    });

    it('2 跳扩一层', () => {
        const sub = subgraphAround(graph, 'n1', 2);
        expect(sub.nodes.map((node) => node.id).sort()).toEqual(['hub', 'n1', 'n2', 'n3']);
        expect(sub.nodes.some((node) => node.id === 'far')).toBe(false);
    });

    it('超出上限时按度裁剪并报告 truncated，边不会指向被裁掉的节点', () => {
        const sub = subgraphAround(graph, 'hub', 1, 2);
        expect(sub.nodes).toHaveLength(2);
        expect(sub.truncated).toBe(2); // n1 保留（度最高），n2、n3 被裁
        const kept = new Set(sub.nodes.map((node) => node.id));
        for (const edge of sub.edges) {
            expect(kept.has(edge.source)).toBe(true);
            expect(kept.has(edge.target)).toBe(true);
        }
    });

    it('中心不存在时返回空子图', () => {
        expect(subgraphAround(graph, 'nope', 1).nodes).toEqual([]);
    });
});
