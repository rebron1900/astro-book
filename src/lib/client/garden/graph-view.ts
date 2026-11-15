/**
 * 花园关系图谱的 canvas 视图（局部图与全站图共用）。
 *
 * 行为对齐 Quartz 的 graph.inline.ts（对照规格见
 * `docs/research/2026-11-13-quartz-reusable-map.md` §5.2）：
 * - 半径 `2 + √degree`；hover 时邻边/邻居高亮，非邻居 200ms 淡到 0.2，被 hover 节点标签放大；
 * - 模拟常驻但**初始 alpha 为 0**（首屏直接用构建期坐标，不花帧）；拖拽时 `alphaTarget(0.3)`
 *   重新加热，松手只把 `fx/fy` 放开并让 alpha 自然衰减——所以拖完会重新排布，不会压住邻居；
 * - 补 `forceCollide`（Quartz 没有，hub 拖到中心会压住邻居）：半径按节点度数算；
 * - 弱回中 `forceX/forceY(0.03)`，避免拖几次整图漂出画布；
 * - 全站图支持滚轮缩放 `[0.25, 4]`（光标锚点）、空白处按住左键平移与双击放大 2×，局部图不抢滚轮；
 * - 拖拽节点的位置按**画布像素**夹紧（而非数据坐标 20..980），缩放/fit 变化后也不会拖出窗口；
 * - 点击跳转（4px 阈值区分拖拽）；当前笔记强调色 + 外圈；visited 用次要色；
 * - 主题变化监听 `theme-changed` 事件重新取色；`prefers-reduced-motion` 时不做过渡插值。
 */
import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY } from 'd3-force';
import { gardenHrefOf } from '../../garden/path';

export interface GraphNode {
    id: string;
    title: string;
    degree: number;
    x: number;
    y: number;
}

export interface GraphEdge {
    source: string;
    target: string;
}

export interface GraphViewOptions {
    canvas: HTMLCanvasElement;
    nodes: GraphNode[];
    edges: GraphEdge[];
    currentId?: string;
    /** 全站图：允许滚轮缩放 + 平移 */
    zoomable?: boolean;
    /** 局部图：小尺寸，标签少 */
    compact?: boolean;
    /** 点击节点的跳转地址；默认 `/garden/<id>/` */
    hrefOf?: (id: string) => string;
}

export interface GraphView {
    destroy: () => void;
    refreshTheme: () => void;
}

const VISITED_KEY = 'garden:graph-visited';

const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const readVisited = (): Set<string> => {
    try {
        const raw = localStorage.getItem(VISITED_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        return new Set(Array.isArray(parsed) ? parsed.filter((item) => typeof item === 'string') : []);
    } catch {
        return new Set();
    }
};

const rememberVisited = (id: string) => {
    try {
        const visited = readVisited();
        visited.add(id);
        localStorage.setItem(VISITED_KEY, JSON.stringify([...visited]));
    } catch {
        // 隐私模式不可写时忽略
    }
};

const paletteOf = () => {
    const styles = getComputedStyle(document.documentElement);
    const read = (name: string, fallback: string) => styles.getPropertyValue(name).trim() || fallback;
    return {
        link: read('--color-link', '#0055bb'),
        ink: read('--body-font-color', '#222222'),
        /** 边：常态 / hover 邻居 / 拖拽淡出 */
        edge: read('--gray-300', '#d1d5db'),
        edgeHover: read('--gray-500', '#6b7280'),
        faint: read('--gray-300', '#c8ccd0'),
        background: read('--body-background', '#ffffff'),
        // 站里没有 --color-accent，当前页用链接色的 hover 档（每个主题都有），比常态亮一档
        accent: read('--color-hover-link', read('--color-link', '#0055bb')),
        /** visited 用次要灰，和「没去过」区分开 */
        visited: read('--gray-500', '#6b7280'),
        // canvas 的 font 不接受 CSS 变量，这里取一次实际字体族
        font: getComputedStyle(document.body).fontFamily || 'system-ui, sans-serif'
    };
};

/** d3-force 的泛型签名很啰嗦，这里只声明实际用到的方法 */
type RunningSimulation = {
    on(event: string, listener: () => void): RunningSimulation;
    alpha(value: number): RunningSimulation;
    alphaTarget(value: number): RunningSimulation;
    restart(): RunningSimulation;
    tick(iterations?: number): RunningSimulation;
    stop(): RunningSimulation;
};

export function createGraphView(options: GraphViewOptions): GraphView {
    const { canvas, edges, compact = false, zoomable = false } = options;
    const context = canvas.getContext('2d');
    const container = canvas.parentElement ?? document.body;

    const nodes: Array<GraphNode & { vx?: number; vy?: number; fx?: number | null; fy?: number | null }> = options.nodes.map((node) => ({ ...node }));
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const adjacency = new Map<string, Set<string>>();
    for (const edge of edges) {
        if (!adjacency.has(edge.source)) adjacency.set(edge.source, new Set());
        if (!adjacency.has(edge.target)) adjacency.set(edge.target, new Set());
        adjacency.get(edge.source)!.add(edge.target);
        adjacency.get(edge.target)!.add(edge.source);
    }

    const visited = readVisited();
    let colors = paletteOf();
    let dpr = Math.min(window.devicePixelRatio || 1, 2);
    let width = 0;
    let height = 0;
    let scale = 1;
    let offsetX = 0;
    let offsetY = 0;
    let hovered: string | null = null;
    let pointerDown: { id: string; moved: boolean; startX: number; startY: number } | null = null;
    /** 空白处按住左键平移（全站图）：记录起点与按下时的偏移 */
    let panDown: { pointerId: number; startX: number; startY: number; offsetX: number; offsetY: number } | null = null;
    let raf = 0;
    let highlight = 0; // 0..1，hover 淡出进度
    let simulation: RunningSimulation | null = null;
    let disposed = false;

    const reduced = prefersReducedMotion();

    /**
     * 数据坐标（0..1000）→ 画布坐标；按短边等比缩放并居中，避免拉伸变形。
     * 全站图始终把整块 0..1000 的布局空间收进画布（构建期已归一化到 40..960），
     * 不再按 p95 放大——否则边缘/离群点一打开就在窗口外。
     */
    const fitFactor = () => (compact ? 0.9 : 0.94);
    const baseSize = () => Math.min(width, height) * scale * fitFactor();

    const project = (node: { x: number; y: number }) => {
        const base = baseSize();
        return {
            x: offsetX + (width - base) / 2 + (node.x / 1000) * base,
            y: offsetY + (height - base) / 2 + (node.y / 1000) * base
        };
    };

    /** 画布坐标 → 数据坐标（project 的逆运算，供拖拽时把像素位置换回数据坐标） */
    const unproject = (px: number, py: number) => {
        const base = baseSize() || 1;
        return {
            x: ((px - offsetX - (width - base) / 2) / base) * 1000,
            y: ((py - offsetY - (height - base) / 2) / base) * 1000
        };
    };

    const radiusOf = (degree: number) => {
        const base = 2 + Math.sqrt(Math.max(0, degree));
        return compact ? base * 0.85 : base * 1.25;
    };

    /** 画布像素 → 数据单位（布局里所有距离都按它换算，缩放不影响布局） */
    const layoutUnit = () => 1000 / Math.max(1, Math.min(width, height));

    const resize = () => {
        const rect = container.getBoundingClientRect();
        const nextWidth = Math.max(1, Math.round(rect.width));
        const nextHeight = Math.max(1, Math.round(rect.height));
        if (nextWidth === width && nextHeight === height) return;
        width = nextWidth;
        height = nextHeight;
        dpr = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;
        context?.setTransform(dpr, 0, 0, dpr, 0, 0);
        draw();
    };

    const withAlpha = (color: string, alpha: number) => {
        const value = Math.max(0, Math.min(1, alpha));
        if (color.startsWith('#') && (color.length === 7 || color.length === 4)) {
            const hex = color.length === 4 ? `#${color[1]}${color[1]}${color[2]}${color[2]}${color[3]}${color[3]}` : color;
            const r = parseInt(hex.slice(1, 3), 16);
            const g = parseInt(hex.slice(3, 5), 16);
            const b = parseInt(hex.slice(5, 7), 16);
            return `rgba(${r}, ${g}, ${b}, ${value})`;
        }
        if (color.startsWith('rgb(')) return color.replace('rgb(', 'rgba(').replace(')', `, ${value})`);
        return color;
    };

    const draw = () => {
        if (!context || disposed) return;
        context.clearRect(0, 0, width, height);

        const hasHover = hovered !== null;
        const neighborSet = hasHover ? adjacency.get(hovered!) ?? new Set<string>() : new Set<string>();
        const dimFactor = 1 - highlight * 0.8;
        // 连线默认就画（Quartz 的 --lightgray 观感）；只有很大的图压一档，避免糊成一片
        const edgeAlpha = edges.length > 250 ? 0.45 : 0.8;

        // 边
        for (const edge of edges) {
            const source = byId.get(edge.source);
            const target = byId.get(edge.target);
            if (!source || !target) continue;
            const isNeighborEdge = hasHover && (edge.source === hovered || edge.target === hovered);
            const a = project(source);
            const b = project(target);
            context.strokeStyle =
                hasHover && !isNeighborEdge ? withAlpha(colors.faint, dimFactor * 0.5) : withAlpha(isNeighborEdge ? colors.edgeHover : colors.edge, edgeAlpha);
            context.lineWidth = isNeighborEdge ? 1.4 : 1;
            context.beginPath();
            context.moveTo(a.x, a.y);
            context.lineTo(b.x, b.y);
            context.stroke();
        }

        // 标签随缩放渐显（Quartz 平时不显示标签）：k=1 时 0，k=2 时 0.5，封顶 0.85
        const zoomLabelAlpha = compact ? 0 : Math.min(0.85, Math.max(0, (scale - 1) / 2));

        const drawNode = (node: GraphNode & { x: number; y: number }) => {
            const point = project(node);
            const isHovered = node.id === hovered;
            const isNeighbor = neighborSet.has(node.id);
            const isCurrent = node.id === options.currentId;
            const isVisited = visited.has(node.id);
            const alpha = hasHover && !isHovered && !isNeighbor ? dimFactor : 1;

            const radius = radiusOf(node.degree);
            context.beginPath();
            context.arc(point.x, point.y, radius, 0, Math.PI * 2);
            const fill = isCurrent ? colors.accent : isVisited ? colors.visited : colors.link;
            const fillAlpha = isCurrent ? 1 : isVisited ? 0.5 : 0.85;
            context.fillStyle = withAlpha(fill, alpha * fillAlpha);
            context.fill();
            // 节点描边：用背景色描一圈（lineWidth 2），和邻居、边线分开；暗色主题跟着 --body-background
            context.strokeStyle = withAlpha(colors.background, alpha);
            context.lineWidth = 2;
            context.stroke();

            if (isCurrent) {
                context.beginPath();
                context.arc(point.x, point.y, radius + 2.5, 0, Math.PI * 2);
                context.strokeStyle = withAlpha(colors.accent, 0.55);
                context.lineWidth = 1;
                context.stroke();
            }

            // 局部图只标 hover：当前页标题正文顶上已经有了，再画在中心会压住一圈邻居
            // 全站图 hover 强制 1、邻居 0.9，其余随缩放渐显
            const labelAlpha = compact ? (isHovered ? 1 : 0) : isHovered ? 1 : isNeighbor ? 0.9 : zoomLabelAlpha;
            if (labelAlpha > 0.02 && node.title) {
                const fontSize = (compact ? 9 : 11) * (isHovered ? 1.5 : 1) * Math.min(1.4, Math.max(0.8, scale));
                context.font = `${isHovered ? 600 : 400} ${fontSize}px ${colors.font}`;
                context.textAlign = 'center';
                context.textBaseline = 'top';
                const label = node.title.length > 18 ? `${node.title.slice(0, 17)}…` : node.title;
                const textWidth = context.measureText(label).width;
                const padX = 3.5;
                const boxX = point.x - textWidth / 2 - padX;
                const boxY = point.y + radius + 2;
                // 圆角底框：标签压住节点/边线时也能读清
                context.beginPath();
                if (typeof context.roundRect === 'function') context.roundRect(boxX, boxY, textWidth + padX * 2, fontSize + 4, 4);
                else context.rect(boxX, boxY, textWidth + padX * 2, fontSize + 4);
                context.fillStyle = withAlpha(colors.background, alpha * labelAlpha * 0.85);
                context.fill();
                context.fillStyle = withAlpha(colors.ink, alpha * labelAlpha * 0.9);
                context.fillText(label, point.x, boxY + 2);
            }
        };

        // 被 hover 的节点最后画，压在邻居上面（Quartz 的 raise()）
        for (const node of nodes) if (node.id !== hovered) drawNode(node);
        if (hovered) {
            const node = byId.get(hovered);
            if (node) drawNode(node);
        }
    };

    /** hover 变化时用 rAF 把淡出进度插值到目标值（reduced-motion 直接切） */
    const animateHighlight = (target: number) => {
        if (reduced) {
            highlight = target;
            draw();
            return;
        }
        if (raf) cancelAnimationFrame(raf);
        const step = () => {
            const delta = target - highlight;
            if (Math.abs(delta) < 0.02) {
                highlight = target;
                raf = 0;
                draw();
                return;
            }
            highlight += delta * 0.22;
            draw();
            raf = requestAnimationFrame(step);
        };
        raf = requestAnimationFrame(step);
    };

    const hitTest = (clientX: number, clientY: number): GraphNode | null => {
        const rect = canvas.getBoundingClientRect();
        const x = clientX - rect.left;
        const y = clientY - rect.top;
        let best: GraphNode | null = null;
        let bestDistance = Infinity;
        for (const node of nodes) {
            const point = project(node);
            const distance = Math.hypot(point.x - x, point.y - y);
            if (distance <= radiusOf(node.degree) + 6 && distance < bestDistance) {
                best = node;
                bestDistance = distance;
            }
        }
        return best;
    };

    const onPointerMove = (event: PointerEvent) => {
        if (panDown) {
            offsetX = panDown.offsetX + (event.clientX - panDown.startX);
            offsetY = panDown.offsetY + (event.clientY - panDown.startY);
            draw();
            return;
        }

        if (pointerDown) {
            const node = byId.get(pointerDown.id);
            if (!node) return;
            const rect = canvas.getBoundingClientRect();
            const dx = event.clientX - pointerDown.startX;
            const dy = event.clientY - pointerDown.startY;
            if (!pointerDown.moved && Math.hypot(dx, dy) > 4) pointerDown.moved = true;
            if (pointerDown.moved) {
                // 在**画布像素**里 clamp（扣掉节点自身半径），再反投影回数据坐标：
                // 直接 clamp 数据坐标 20..980 在 fit≠1 或缩放后会落到画布外。
                const radius = radiusOf(node.degree) + 2;
                const px = Math.max(radius, Math.min(width - radius, event.clientX - rect.left));
                const py = Math.max(radius, Math.min(height - radius, event.clientY - rect.top));
                const point = unproject(px, py);
                node.fx = point.x;
                node.fy = point.y;
                // 拖拽期间持续加热，节点跟手；松手后 alpha 自然衰减，整图重新排布
                simulation?.alphaTarget(0.3).restart();
                draw();
            }
            return;
        }

        const hit = hitTest(event.clientX, event.clientY);
        const id = hit?.id ?? null;
        if (id !== hovered) {
            hovered = id;
            animateHighlight(id ? 1 : 0);
        }
        canvas.style.cursor = hit ? 'pointer' : zoomable ? 'grab' : 'default';
    };

    const onPointerDown = (event: PointerEvent) => {
        // 只响应左键（触屏的 pointerType 是 touch，button 恒为 0）
        if (event.button !== 0) return;
        const hit = hitTest(event.clientX, event.clientY);
        if (!hit) {
            // 空白处按住左键拖动整图（仅全站图）
            if (!zoomable) return;
            canvas.setPointerCapture?.(event.pointerId);
            panDown = {
                pointerId: event.pointerId,
                startX: event.clientX,
                startY: event.clientY,
                offsetX,
                offsetY
            };
            canvas.style.cursor = 'grabbing';
            return;
        }
        canvas.setPointerCapture?.(event.pointerId);
        pointerDown = { id: hit.id, moved: false, startX: event.clientX, startY: event.clientY };
    };

    const onPointerUp = (event: PointerEvent) => {
        if (panDown) {
            panDown = null;
            canvas.releasePointerCapture?.(event.pointerId);
            canvas.style.cursor = hovered ? 'pointer' : 'grab';
            return;
        }
        const state = pointerDown;
        pointerDown = null;
        canvas.releasePointerCapture?.(event.pointerId);
        if (!state) return;
        const node = byId.get(state.id);
        if (!state.moved) {
            rememberVisited(state.id);
            const href = (options.hrefOf ?? gardenHrefOf)(state.id);
            if (href) window.location.href = href;
            return;
        }
        // 松手：解除 pin 但不 stop()，让拖拽期间加热的模拟把整图重排一遍
        if (node) {
            node.fx = null;
            node.fy = null;
        }
        simulation?.alphaTarget(0);
        draw();
    };

    /** 触控被系统取消/指针丢失时复位，避免下一次 move 还带着旧状态 */
    const onPointerCancel = (event: PointerEvent) => {
        if (panDown) {
            panDown = null;
            canvas.style.cursor = hovered ? 'pointer' : 'grab';
        }
        if (pointerDown) {
            const node = byId.get(pointerDown.id);
            pointerDown = null;
            if (node) {
                node.fx = null;
                node.fy = null;
            }
            simulation?.alphaTarget(0);
        }
        canvas.releasePointerCapture?.(event.pointerId);
        draw();
    };

    const zoomAt = (clientX: number, clientY: number, next: number) => {
        const rect = canvas.getBoundingClientRect();
        const mx = clientX - rect.left;
        const my = clientY - rect.top;
        // 以指针为锚点缩放
        offsetX = mx - ((mx - offsetX) / scale) * next;
        offsetY = my - ((my - offsetY) / scale) * next;
        scale = next;
        draw();
    };

    const onWheel = (event: WheelEvent) => {
        if (!zoomable) return;
        event.preventDefault();
        zoomAt(event.clientX, event.clientY, Math.min(4, Math.max(0.25, scale * (event.deltaY > 0 ? 0.9 : 1.1))));
    };

    /** 双击放大 2×：点在节点上留给点击跳转，只有空白处才缩放 */
    const onDoubleClick = (event: MouseEvent) => {
        if (!zoomable) return;
        if (hitTest(event.clientX, event.clientY)) return;
        event.preventDefault();
        zoomAt(event.clientX, event.clientY, Math.min(4, scale * 2));
    };

    const onPointerLeave = () => {
        if (pointerDown || panDown) return;
        hovered = null;
        canvas.style.cursor = zoomable ? 'grab' : 'default';
        animateHighlight(0);
    };

    const onKeydown = (event: KeyboardEvent) => {
        if (event.key === 'Escape') {
            hovered = null;
            animateHighlight(0);
        }
    };

    const onThemeChanged = () => {
        colors = paletteOf();
        draw();
    };

    /** 局部图的初始布局：中心节点固定，邻居按度数从近到远排成同心圆 */
    const layoutCompactRadial = () => {
        const center = nodes.find((node) => node.id === options.currentId) ?? nodes[0];
        center.x = 500;
        center.y = 500;
        center.fx = 500;
        center.fy = 500;

        const others = nodes.filter((node) => node !== center).sort((a, b) => b.degree - a.degree);
        const unit = layoutUnit();
        const hubRadius = radiusOf(center.degree) * unit;
        const ringGap = 26 * unit;
        let index = 0;
        let ring = 1;
        while (index < others.length) {
            const radius = hubRadius + ringGap * ring * 1.35;
            const circumference = 2 * Math.PI * radius;
            const slot = (radiusOf(2) + 5) * unit * 2;
            const capacity = Math.max(6, Math.floor(circumference / slot));
            const count = Math.min(others.length - index, capacity);
            const offset = ring * 0.45;
            for (let i = 0; i < count; i += 1) {
                const angle = offset + (i / count) * Math.PI * 2;
                const node = others[index + i];
                node.x = 500 + Math.cos(angle) * radius;
                node.y = 500 + Math.sin(angle) * radius;
            }
            index += count;
            ring += 1;
        }

        // 最外环也收进 8% 内边距（半径 ≤ 420），否则外圈邻居会被画布裁掉
        let maxRadius = 0;
        for (const node of others) {
            maxRadius = Math.max(maxRadius, Math.hypot(node.x - 500, node.y - 500));
        }
        if (maxRadius > 420) {
            const factor = 420 / maxRadius;
            for (const node of others) {
                node.x = 500 + (node.x - 500) * factor;
                node.y = 500 + (node.y - 500) * factor;
            }
        }
    };

    /**
     * 软边界：越靠近画布边缘回推越强（绝不逐点硬夹，硬夹会把点排成边缘竖线）。
     * 0..1000 在 fit=0.94 下整块落在画布内，所以边界取 12..988 就能保证点不跑出窗口。
     */
    const boundary = (alpha: number) => {
        const margin = 12;
        const spring = 0.6 * alpha;
        for (const node of nodes) {
            if (node.fx != null || node.fy != null) continue;
            if (node.x < margin) node.vx = (node.vx ?? 0) + (margin - node.x) * spring;
            if (node.x > 1000 - margin) node.vx = (node.vx ?? 0) - (node.x - (1000 - margin)) * spring;
            if (node.y < margin) node.vy = (node.vy ?? 0) + (margin - node.y) * spring;
            if (node.y > 1000 - margin) node.vy = (node.vy ?? 0) - (node.y - (1000 - margin)) * spring;
        }
    };

    /** 布局用的模拟：常驻但初始 alpha=0，首屏仍用构建期坐标 */
    const buildSimulation = (): RunningSimulation => {
        const linkData = edges.map((edge) => ({ source: edge.source, target: edge.target }));
        const unit = layoutUnit();
        const simulationInstance = forceSimulation(nodes as never[])
            .force(
                'link',
                forceLink(linkData as never[])
                    .id((datum: unknown) => (datum as GraphNode).id)
                    .distance(compact ? 90 : 30 * unit)
                    .strength(compact ? 0.05 : 0.35)
            )
            .force('charge', forceManyBody().strength(compact ? -30 : -140))
            .force('center', forceCenter(500, 500).strength(0.3))
            // Quartz 缺的那块：按度数算碰撞半径，保证拖完不重叠
            .force('collide', forceCollide((datum: unknown) => (radiusOf((datum as GraphNode).degree) + 2) * unit).strength(0.9))
            .force('x', forceX(500).strength(compact ? 0 : 0.03))
            .force('y', forceY(500).strength(compact ? 0 : 0.03))
            .force('bounds', boundary)
            .alpha(0)
            .stop();
        simulationInstance.on('tick', () => draw());
        return simulationInstance as unknown as RunningSimulation;
    };

    const resizeObserver = new ResizeObserver(() => resize());
    resizeObserver.observe(container);
    // 先量出画布尺寸：碰撞半径要按「像素 → 数据单位」换算，宽高为 0 时会算成天量
    resize();

    if (compact) {
        // 孤立/无链接的笔记也把当前节点钉在画布中心
        layoutCompactRadial();
    }

    if (nodes.length > 1) {
        simulation = buildSimulation();

        if (compact) {
            // 局部图：当前笔记钉在画布中心，邻居按度数从近到远绕成同心圆（不靠力导向随机铺）
            // 模拟只做微调：几 tick 收一下环上的微小重叠
            simulation.tick(6);
            draw();
        } else {
            // 全站图：孤立点没有力，会被 center 吸到中间；把它们钉在构建期算好的外环上
            for (const node of nodes) {
                if (node.degree > 0) continue;
                node.fx = node.x;
                node.fy = node.y;
            }
            // 用构建期坐标直接画；只有拖拽才加热模拟（配合软边界，不会把点排到边上）
            draw();
        }
    }

    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerCancel);
    canvas.addEventListener('pointerleave', onPointerLeave);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('dblclick', onDoubleClick);
    document.addEventListener('keydown', onKeydown);
    document.addEventListener('theme-changed', onThemeChanged);
    // 离开页面时把模拟停掉（Quartz 不管这件事，我们补上）
    const onPageHide = () => simulation?.stop();
    window.addEventListener('pagehide', onPageHide);

    draw();

    return {
        destroy() {
            disposed = true;
            if (raf) cancelAnimationFrame(raf);
            resizeObserver.disconnect();
            canvas.removeEventListener('pointermove', onPointerMove);
            canvas.removeEventListener('pointerdown', onPointerDown);
            canvas.removeEventListener('pointerup', onPointerUp);
            canvas.removeEventListener('pointercancel', onPointerCancel);
            canvas.removeEventListener('pointerleave', onPointerLeave);
            canvas.removeEventListener('wheel', onWheel);
            canvas.removeEventListener('dblclick', onDoubleClick);
            document.removeEventListener('keydown', onKeydown);
            document.removeEventListener('theme-changed', onThemeChanged);
            window.removeEventListener('pagehide', onPageHide);
            simulation?.stop();
            simulation = null;
        },
        refreshTheme() {
            colors = paletteOf();
            draw();
        }
    };
}
