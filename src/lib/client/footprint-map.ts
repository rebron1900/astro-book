/**
 * 足迹地图控制器（与框架无关）。
 *
 * 和运动页的预览地图完全独立：自己的 Mapbox 实例、自己的标点聚合，
 * 只负责「把一个地点标点画出来、点一下能聚焦」，不做轨迹重播那套东西。
 *
 * 生命周期：足迹模式第一次打开时才调用 start()（此时容器才有尺寸），
 * 关闭模式不销毁，页面卸载时由岛统一 destroy()。
 *
 * SSR 安全：模块顶层只声明常量与函数，只有 createFootprintMap() 被调用之后才碰 DOM。
 */
import mapboxgl from 'mapbox-gl/dist/mapbox-gl.js';
import MapboxLanguage from '@mapbox/mapbox-gl-language';
import Supercluster from 'supercluster';
import 'mapbox-gl/dist/mapbox-gl.css';

import type { FootprintPlace } from '../footprint';
import { INITIAL_CENTER, INITIAL_ZOOM, MAP_STYLES } from './exercise-map/constants';
import type { MapTheme } from './exercise-map/constants';
import { motionDuration, readTheme } from './exercise-map/geometry';

/** 单个标点的 tooltip 补充信息（由岛从游记数据里算好传进来） */
export interface FootprintPlaceInfo {
    /** 关联游记数 */
    count: number;
    /** 最近一篇的展示日期（2026.11.02），没有游记时为 null */
    latest: string | null;
    /** 游记标题，按时间从新到旧 */
    titles: readonly string[];
}

export interface FootprintMapOptions {
    container: HTMLElement;
    token: string;
    places: readonly FootprintPlace[];
    /** 取某个标点关联的游记信息，用于地图 tooltip */
    placeInfo?: (place: FootprintPlace) => FootprintPlaceInfo;
    /** 用户点了地图上的标点 / 聚合点之外的空地 */
    onSelect?: (placeId: string | null) => void;
    /** 底图加载失败（token 无效、网络不通）时通知页面 */
    onError?: () => void;
    /** 底图就绪（用于清掉之前的失败提示） */
    onReady?: () => void;
}

export interface FootprintMapController {
    start(): void;
    destroy(): void;
    resize(): void;
    /** 缩放到全部地点 */
    fitAll(): void;
    /** 飞到某个地点并选中 */
    focusPlace(placeId: string): void;
    /** 按已选地名压暗标点（不删点）；空集合表示不过滤 */
    setFilter(selectedNames: ReadonlySet<string>): void;
    /** 卡片悬停时高亮一组地点 */
    highlight(placeIds: readonly string[]): void;
    clearHighlight(): void;
    /** 随机去一个没被看过的地点 */
    random(): void;
}

interface FootprintPointFeature {
    type: 'Feature';
    properties: {
        placeId?: string;
        name?: string;
        cover?: string | null;
        cluster?: boolean;
        cluster_id?: number;
        point_count?: number;
    };
    geometry: {
        type: 'Point';
        coordinates: [number, number];
    };
}

/** 一个已渲染的标点实例：缩放时按 key 复用，不整片清空重建 */
interface MarkerEntry {
    marker: mapboxgl.Marker;
    element: HTMLButtonElement;
    kind: 'place' | 'cluster';
    /** 当前经纬度：聚合点展开时直接用，不依赖 Marker.getLngLat() */
    lngLat: [number, number];
    placeId?: string;
    clusterId?: number;
    count?: number;
    leaves?: string[];
}

/** 聚合半径：118 个点在全国尺度下要稍微松一点，避免一开始就挤成两个球 */
const CLUSTER_RADIUS = 46;
const CLUSTER_MAX_ZOOM = 15;
/** tooltip 悬停延迟：进得快一点，出得慢一点，鼠标扫过一排标点不会闪 */
const TIP_SHOW_DELAY = 70;
const TIP_HIDE_DELAY = 150;

let tipSeq = 0;

function createNode<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

class FootprintMapInstance implements FootprintMapController {
    private readonly options: FootprintMapOptions;
    private map: mapboxgl.Map | null = null;
    private cluster = new Supercluster({ radius: CLUSTER_RADIUS, maxZoom: CLUSTER_MAX_ZOOM });
    private readonly placeById = new Map<string, FootprintPlace>();
    private readonly markerElements = new Map<string, HTMLButtonElement>();
    /** 聚合点元素 + 它包含的标点 id：卡片悬停时即使目标被聚合了也能给出反馈 */
    private readonly clusterElements = new Map<number, { element: HTMLButtonElement; leaves: string[] }>();
    /** 已渲染实例：`p:<placeId>` / `c:<clusterId>`，缩放中按 key 增量更新 */
    private readonly entries = new Map<string, MarkerEntry>();
    private highlighted = new Set<string>();
    private selectedId: string | null = null;
    /** 按地名筛选：null 表示不过滤；中标点保持原样，其余压暗到 13% */
    private filterNames: ReadonlySet<string> | null = null;

    private theme: MapTheme = 'light';
    private started = false;
    private destroyed = false;
    private styleReady = false;
    private updateFrame: number | null = null;

    private resizeObserver: ResizeObserver | null = null;
    private themeObserver: MutationObserver | null = null;
    /** 样式一直加载不出来（token 无效、网络不通）时的兜底提示 */
    private readyTimer: ReturnType<typeof setTimeout> | null = null;

    /** 地图 tooltip：单点显示地名 + 游记摘要，聚合点列出它包含的所有标点 */
    private tooltip: HTMLDivElement | null = null;
    private tooltipOwner: HTMLElement | null = null;
    private tipShowTimer: ReturnType<typeof setTimeout> | null = null;
    private tipHideTimer: ReturnType<typeof setTimeout> | null = null;
    /** 上一次按下时是鼠标还是触摸：触屏没有 hover，点击要能点开 tooltip */
    private pointerType: string = 'mouse';

    constructor(options: FootprintMapOptions) {
        this.options = options;
        for (const place of options.places) this.placeById.set(place.id, place);

        const features: FootprintPointFeature[] = options.places.map((place) => ({
            type: 'Feature',
            properties: { placeId: place.id, name: place.name, cover: place.cover },
            geometry: { type: 'Point', coordinates: [place.lng, place.lat] }
        }));
        this.cluster.load(features as unknown as unknown[]);
    }

    start(): void {
        if (this.started || this.destroyed) return;
        this.started = true;

        if (!this.options.token?.trim()) {
            this.options.onError?.();
            return;
        }

        try {
            mapboxgl.accessToken = this.options.token.trim();
            this.theme = readTheme();
            this.map = new mapboxgl.Map({
                container: this.options.container,
                style: MAP_STYLES[this.theme],
                center: INITIAL_CENTER,
                zoom: INITIAL_ZOOM,
                minZoom: 2,
                maxZoom: 18,
                trackResize: false,
                dragRotate: false,
                pitchWithRotate: false,
                attributionControl: false,
                // 足迹地图是主内容，不做「按住按键才能缩放」的协作手势：滚轮直接缩放，单指直接拖动
                cooperativeGestures: false,
                scrollZoom: true
            });
        } catch {
            this.map = null;
            this.options.onError?.();
            return;
        }

        const map = this.map;
        map.addControl(new MapboxLanguage({ defaultLanguage: 'zh-Hans' }));
        map.on('style.load', this.handleStyleLoad);
        map.on('error', this.handleError);
        // 缩放/平移过程中就要重排标点：只在 moveend 更新会让标签「停稳才跳」。
        // scheduleMarkerUpdate 内部是 rAF 节流，一帧最多算一次。
        map.on('zoom', this.scheduleMarkerUpdate);
        map.on('move', this.scheduleMarkerUpdate);
        // 地图一移动，标点像素位置就变了：tooltip 直接收起，避免跟着旧坐标飘
        map.on('movestart', this.hideTooltip);
        map.on('zoomstart', this.hideTooltip);
        map.on('click', this.handleMapClick);

        this.observeSize();
        this.observeTheme();

        this.readyTimer = setTimeout(() => {
            this.readyTimer = null;
            if (!this.styleReady) this.options.onError?.();
        }, 12000);
    }

    destroy(): void {
        if (this.destroyed) return;
        this.destroyed = true;

        if (this.updateFrame !== null) {
            cancelAnimationFrame(this.updateFrame);
            this.updateFrame = null;
        }
        if (this.readyTimer !== null) {
            clearTimeout(this.readyTimer);
            this.readyTimer = null;
        }
        this.hideTooltip();
        this.clearTimers();
        this.tooltip?.remove();
        this.tooltip = null;

        this.resizeObserver?.disconnect();
        this.resizeObserver = null;
        this.themeObserver?.disconnect();
        this.themeObserver = null;

        this.clearMarkers();
        const map = this.map;
        this.map = null;
        if (!map) return;
        try {
            map.remove();
        } catch {
            // 销毁阶段的异常无需处理
        }
    }

    resize(): void {
        this.map?.resize();
    }

    fitAll(): void {
        if (!this.map || !this.styleReady) return;
        const places = this.options.places;
        if (places.length === 0) return;

        let minLng = Infinity;
        let minLat = Infinity;
        let maxLng = -Infinity;
        let maxLat = -Infinity;
        for (const place of places) {
            minLng = Math.min(minLng, place.lng);
            maxLng = Math.max(maxLng, place.lng);
            minLat = Math.min(minLat, place.lat);
            maxLat = Math.max(maxLat, place.lat);
        }
        this.map.fitBounds(
            [
                [minLng, minLat],
                [maxLng, maxLat]
            ],
            { padding: 56, maxZoom: 6.4, duration: motionDuration(560) }
        );
    }

    focusPlace(placeId: string): void {
        const place = this.placeById.get(placeId);
        if (!place || !this.map) return;
        this.select(placeId);
        this.map.flyTo({
            center: [place.lng, place.lat],
            zoom: this.zoomForSinglePlace(place),
            duration: motionDuration(900),
            essential: true
        });
    }

    /**
     * 飞到某个点之前，先算出它所在聚合桶的展开层级，保证落地时它是单点：
     * 固定 12.6 在重庆/海南这种密集省仍会被聚成一簇，点完看不到那个点，is-active 也挂不上。
     * 保底 15（Supercluster 的 maxZoom），超过它不会再聚合。
     */
    private zoomForSinglePlace(place: FootprintPlace): number {
        let zoom = Math.max(Math.ceil(this.map?.getZoom() ?? 4), 3);
        for (let guard = 0; guard < 6; guard += 1) {
            const clusterId = this.clusterIdAt(place, zoom);
            if (clusterId === null) break;
            let next = zoom + 2;
            try {
                next = this.cluster.getClusterExpansionZoom(clusterId);
            } catch {
                // 没有这个簇时用 +2 兜底
            }
            if (!Number.isFinite(next) || next <= zoom) {
                zoom = CLUSTER_MAX_ZOOM + 1;
                break;
            }
            zoom = Math.ceil(next) + 1;
        }
        return Math.min(Math.max(zoom, 15, 12.6), 17);
    }

    /** 某个点在指定缩放层级下落在哪个聚合桶里；已经是单点返回 null */
    private clusterIdAt(place: FootprintPlace, zoom: number): number | null {
        const features = this.cluster.getClusters([-180, -90, 180, 90], zoom) as unknown as FootprintPointFeature[];
        for (const feature of features) {
            const clusterId = feature.properties.cluster_id;
            if (!feature.properties.cluster || clusterId === undefined) continue;
            if (this.leavesOf(clusterId).includes(place.id)) return clusterId;
        }
        return null;
    }

    private leavesOf(clusterId: number): string[] {
        return (this.cluster.getLeaves(clusterId, Infinity) as unknown as FootprintPointFeature[])
            .map((leaf) => leaf.properties.placeId)
            .filter((id): id is string => Boolean(id));
    }

    setFilter(selectedNames: ReadonlySet<string>): void {
        this.filterNames = selectedNames.size > 0 ? new Set(selectedNames) : null;
        this.applyFilter();
    }

    /** 把当前筛选状态应用到已存在的标点上（不重建 Marker，避免闪一下） */
    private applyFilter(): void {
        const names = this.filterNames;
        for (const [id, element] of this.markerElements) {
            const place = this.placeById.get(id);
            element.classList.toggle('is-dimmed', Boolean(names && place && !names.has(place.name)));
        }
        for (const entry of this.clusterElements.values()) {
            if (!names) {
                entry.element.classList.remove('is-dimmed');
                continue;
            }
            const hasActive = entry.leaves.some((id) => {
                const place = this.placeById.get(id);
                return place ? names.has(place.name) : false;
            });
            entry.element.classList.toggle('is-dimmed', !hasActive);
        }
    }

    private isPlaceDimmed(place: FootprintPlace): boolean {
        return Boolean(this.filterNames && !this.filterNames.has(place.name));
    }

    highlight(placeIds: readonly string[]): void {
        const next = new Set(placeIds);
        if (next.size === this.highlighted.size && [...next].every((id) => this.highlighted.has(id))) return;
        this.clearHighlightElements();
        this.highlighted = next;
        this.applyHighlight();
    }

    clearHighlight(): void {
        this.clearHighlightElements();
        this.highlighted = new Set();
    }

    private clearHighlightElements(): void {
        for (const element of this.markerElements.values()) element.classList.remove('is-highlighted');
        for (const entry of this.clusterElements.values()) entry.element.classList.remove('is-highlighted');
    }

    /** 还没缩放到单个标点时，把包含目标地点的聚合点也一起点亮 */
    private applyHighlight(): void {
        for (const id of this.highlighted) this.markerElements.get(id)?.classList.add('is-highlighted');
        for (const entry of this.clusterElements.values()) {
            const hit = entry.leaves.some((id) => this.highlighted.has(id));
            entry.element.classList.toggle('is-highlighted', hit);
        }
    }

    random(): void {
        const places = this.options.places;
        if (places.length === 0) return;
        const pool = places.length > 1 ? places.filter((place) => place.id !== this.selectedId) : places;
        const place = pool[Math.floor(Math.random() * pool.length)];
        if (place) this.focusPlace(place.id);
    }

    /* ------------------------------ 内部实现 ------------------------------ */

    private handleStyleLoad = (): void => {
        this.styleReady = true;
        if (this.readyTimer !== null) {
            clearTimeout(this.readyTimer);
            this.readyTimer = null;
        }
        this.options.onReady?.();
        this.updateMarkers();
        this.fitAll();
    };

    private handleError = (): void => {
        // 底图 tile 偶发失败不打断交互；只有完全没加载出来时才会走到这里
        if (!this.styleReady) this.options.onError?.();
    };

    private handleMapClick = (): void => {
        this.selectedId = null;
        this.applySelection();
        this.hideTooltip();
        this.options.onSelect?.(null);
    };

    private select(placeId: string): void {
        this.selectedId = placeId;
        this.applySelection();
        this.options.onSelect?.(placeId);
    }

    private applySelection(): void {
        for (const [id, element] of this.markerElements) element.classList.toggle('is-active', id === this.selectedId);
    }

    private scheduleMarkerUpdate = (): void => {
        if (this.updateFrame !== null) return;
        this.updateFrame = requestAnimationFrame(() => {
            this.updateFrame = null;
            this.updateMarkers();
        });
    };

    private updateMarkers(): void {
        const map = this.map;
        if (!map || !this.styleReady) return;

        const zoom = Math.floor(map.getZoom());
        const features = this.cluster.getClusters([-180, -90, 180, 90], zoom) as unknown as FootprintPointFeature[];
        const alive = new Set<string>();

        for (const feature of features) {
            const [lng, lat] = feature.geometry.coordinates;
            const properties = feature.properties;

            if (properties.cluster) {
                const clusterId = properties.cluster_id ?? 0;
                const key = `c:${clusterId}`;
                alive.add(key);
                let entry = this.entries.get(key);
                if (!entry) {
                    entry = this.createClusterEntry(clusterId, [lng, lat]);
                    this.entries.set(key, entry);
                }
                // 缩放过程中位置和计数每帧都可能变：复用元素，只改位置和数字
                entry.lngLat = [lng, lat];
                entry.marker.setLngLat([lng, lat]);
                this.syncCluster(entry, properties.point_count ?? 0, this.leavesOf(clusterId));
                continue;
            }

            const placeId = properties.placeId;
            if (!placeId) continue;
            const place = this.placeById.get(placeId);
            if (!place) continue;
            const key = `p:${placeId}`;
            alive.add(key);
            let entry = this.entries.get(key);
            if (!entry) {
                entry = this.createPlaceEntry(place, [lng, lat]);
                this.entries.set(key, entry);
            }
            entry.lngLat = [lng, lat];
            entry.marker.setLngLat([lng, lat]);
        }

        // 这一帧已经不在聚合结果里的实例才移除，其余全部原地复用
        for (const [key, entry] of this.entries) {
            if (alive.has(key)) continue;
            entry.marker.remove();
            this.entries.delete(key);
        }

        this.reindex();
        this.applySelection();
        this.applyHighlight();
        this.applyFilter();
    }

    /** 把 entries 投影回按 地名 / 聚合 id 索引的两张表（选中、高亮、筛选都走这两张表） */
    private reindex(): void {
        this.markerElements.clear();
        this.clusterElements.clear();
        for (const entry of this.entries.values()) {
            if (entry.kind === 'place' && entry.placeId) this.markerElements.set(entry.placeId, entry.element);
            else if (entry.kind === 'cluster' && entry.clusterId !== undefined) {
                this.clusterElements.set(entry.clusterId, { element: entry.element, leaves: entry.leaves ?? [] });
            }
        }
    }

    private createPlaceEntry(place: FootprintPlace, coordinates: [number, number]): MarkerEntry {
        const element = document.createElement('button');
        element.type = 'button';
        // 几何完全复用 /map 页的 `.marker` / `.img-post` / `.no-post`（_custom.scss），
        // 足迹只挂状态修饰类 `.ex-fp-point`，不再自己画一套尺寸
        element.className = `marker ex-fp-point ${place.cover ? 'img-post' : 'no-post'}`;
        element.classList.toggle('is-dimmed', this.isPlaceDimmed(place));
        element.dataset.placeId = place.id;

        const info = this.options.placeInfo?.(place);
        const count = info?.count ?? 0;
        element.setAttribute('aria-label', count > 0 ? `${place.name}，${count} 篇游记` : `${place.name}，还没有游记`);

        // `.marker::before` 用 --photo 铺封面：不改元素尺寸，锚点就不会漂
        if (place.cover) element.style.setProperty('--photo', `url("${place.cover}")`);

        this.bindTooltip(element, () => this.buildPlaceTooltip(place));
        element.addEventListener('pointerdown', this.trackPointerType);
        element.addEventListener('click', (event) => {
            event.stopPropagation();
            this.select(place.id);
            // 触屏没有 hover：点一下开信息，再点同一个点收起（键盘回车 detail 为 0，走焦点态）
            if (event.detail > 0 && this.pointerType === 'touch') {
                if (this.tooltipOwner === element) this.hideTooltip();
                else this.showTooltip(element, () => this.buildPlaceTooltip(place));
            }
        });

        const marker = new mapboxgl.Marker({ element, anchor: 'center' }).setLngLat(coordinates).addTo(this.map!);
        return { marker, element, kind: 'place', placeId: place.id, lngLat: coordinates };
    }

    private createClusterEntry(clusterId: number, coordinates: [number, number]): MarkerEntry {
        const element = document.createElement('button');
        element.type = 'button';
        element.className = 'ex-fp-cluster';
        element.setAttribute('aria-label', '聚合点，展开查看');

        const entry: MarkerEntry = {
            marker: null as unknown as mapboxgl.Marker,
            element,
            kind: 'cluster',
            lngLat: coordinates,
            clusterId,
            count: 0,
            leaves: []
        };

        const build = () => this.buildClusterTooltip(entry.count ?? 0, entry.leaves ?? [], () => this.expandClusterEntry(entry));
        this.bindTooltip(element, build);
        element.addEventListener('pointerdown', this.trackPointerType);
        element.addEventListener('click', (event) => {
            event.stopPropagation();
            // 触屏第一次点开列表，第二次才缩放
            if (event.detail > 0 && this.pointerType === 'touch' && this.tooltipOwner !== element) {
                this.showTooltip(element, build);
                return;
            }
            this.expandClusterEntry(entry);
        });

        entry.marker = new mapboxgl.Marker({ element, anchor: 'center' }).setLngLat(coordinates).addTo(this.map!);
        return entry;
    }

    /** 聚合点复用元素时只改数字/无障碍文案/筛选态 */
    private syncCluster(entry: MarkerEntry, count: number, leaves: string[]): void {
        entry.count = count;
        entry.leaves = leaves;
        const label = String(count);
        if (entry.element.textContent !== label) entry.element.textContent = label;
        entry.element.dataset.cardinality = String(Math.min(99, count));
        entry.element.setAttribute('aria-label', `${count} 个地点，展开查看`);

        const names = this.filterNames;
        if (!names) {
            entry.element.classList.remove('is-dimmed');
            return;
        }
        const hasActive = leaves.some((id) => {
            const place = this.placeById.get(id);
            return place ? names.has(place.name) : false;
        });
        entry.element.classList.toggle('is-dimmed', !hasActive);
    }

    private expandClusterEntry(entry: MarkerEntry): void {
        if (!this.map || entry.clusterId === undefined) return;
        let zoom = this.map.getZoom();
        try {
            zoom = this.cluster.getClusterExpansionZoom(entry.clusterId);
        } catch {
            zoom += 1.5;
        }
        this.hideTooltip();
        this.map.easeTo({ center: entry.lngLat, zoom, duration: motionDuration(420) });
    }

    private clearMarkers(): void {
        this.hideTooltip();
        for (const entry of this.entries.values()) entry.marker.remove();
        this.entries.clear();
        this.markerElements.clear();
        this.clusterElements.clear();
    }

    /* ------------------------------ tooltip ------------------------------ */

    private trackPointerType = (event: PointerEvent): void => {
        this.pointerType = event.pointerType || 'mouse';
    };

    /** 统一绑定 hover / focus / 点击的行为，单点和聚合点共用 */
    private bindTooltip(element: HTMLButtonElement, build: () => Node[]): void {
        element.addEventListener('pointerenter', (event) => {
            if (event.pointerType !== 'mouse' && event.pointerType !== 'pen') return;
            this.scheduleShow(element, build);
        });
        element.addEventListener('pointerleave', () => this.scheduleHide());
        // 键盘 Tab 到标点时也要能看到信息
        element.addEventListener('focus', () => this.showTooltip(element, build));
        element.addEventListener('blur', () => this.scheduleHide());
        // tooltip 挂在容器末尾，Tab 顺序到不了里面：从标点按 Tab 时直接把焦点交给
        // tooltip 里第一个可操作元素（聚合点的地名按钮），键盘用户才能真正用上
        element.addEventListener('keydown', (event) => {
            if (event.key !== 'Tab' || event.shiftKey) return;
            if (this.tooltipOwner !== element) return;
            const first = this.tooltip?.querySelector<HTMLElement>('button');
            if (!first) return;
            event.preventDefault();
            first.focus();
        });
    }

    private scheduleShow(owner: HTMLElement, build: () => Node[]): void {
        this.clearShowTimer();
        if (this.tipHideTimer !== null) {
            clearTimeout(this.tipHideTimer);
            this.tipHideTimer = null;
        }
        // 已经在看同一个标点（比如从 tooltip 里把鼠标移回标点）就不要再重建内容
        if (this.tooltipOwner === owner && this.tooltip && !this.tooltip.hidden) return;
        this.tipShowTimer = setTimeout(() => {
            this.tipShowTimer = null;
            this.showTooltip(owner, build);
        }, TIP_SHOW_DELAY);
    }

    private scheduleHide = (): void => {
        this.clearShowTimer();
        if (this.tipHideTimer !== null) clearTimeout(this.tipHideTimer);
        this.tipHideTimer = setTimeout(() => {
            this.tipHideTimer = null;
            this.hideTooltip();
        }, TIP_HIDE_DELAY);
    };

    /**
     * 显示 tooltip。内容只在「换了个标点」时重建，同一个标点再次显示时保留列表的滚动位置。
     * 触屏也不自动收：点地图空白、点另一个标点或再点一次同一个标点才收起。
     */
    private showTooltip(owner: HTMLElement, build: () => Node[]): void {
        if (this.destroyed) return;
        this.clearShowTimer();
        if (this.tipHideTimer !== null) {
            clearTimeout(this.tipHideTimer);
            this.tipHideTimer = null;
        }
        const tip = this.ensureTooltip();
        if (this.tooltipOwner !== owner) {
            tip.replaceChildren(...build());
            if (this.tooltipOwner) this.tooltipOwner.removeAttribute('aria-describedby');
            owner.setAttribute('aria-describedby', tip.id);
            this.tooltipOwner = owner;
        }
        tip.hidden = false;
        this.positionTooltip(owner);
    }

    private hideTooltip = (): void => {
        this.clearShowTimer();
        if (this.tipHideTimer !== null) {
            clearTimeout(this.tipHideTimer);
            this.tipHideTimer = null;
        }
        if (this.tooltip) {
            this.tooltip.hidden = true;
            this.tooltip.replaceChildren();
        }
        if (this.tooltipOwner) {
            this.tooltipOwner.removeAttribute('aria-describedby');
            this.tooltipOwner = null;
        }
    };

    private ensureTooltip(): HTMLDivElement {
        if (this.tooltip) return this.tooltip;
        const tip = document.createElement('div');
        tip.className = 'ex-fp-tip';
        tip.id = `ex-fp-tip-${++tipSeq}`;
        tip.setAttribute('role', 'tooltip');
        tip.hidden = true;
        // 鼠标从标点挪进 tooltip 时不要收起来（聚合列表可能要在里面滚动）
        tip.addEventListener('pointerenter', () => {
            this.clearShowTimer();
            if (this.tipHideTimer !== null) {
                clearTimeout(this.tipHideTimer);
                this.tipHideTimer = null;
            }
        });
        tip.addEventListener('pointerleave', () => this.scheduleHide());
        // 键盘用户 Tab 进 tooltip 时标点会 blur：必须由 tooltip 自己接管保活，
        // 否则 150ms 后收起，地名按钮对键盘等于不存在
        tip.addEventListener('focusin', () => {
            if (this.tipHideTimer !== null) {
                clearTimeout(this.tipHideTimer);
                this.tipHideTimer = null;
            }
        });
        tip.addEventListener('focusout', () => this.scheduleHide());
        tip.addEventListener('keydown', (event) => {
            if (event.key !== 'Tab' || !event.shiftKey) return;
            if (!this.tooltipOwner) return;
            const first = tip.querySelector<HTMLElement>('button');
            if (!first || document.activeElement !== first) return;
            event.preventDefault();
            this.tooltipOwner.focus({ preventScroll: true });
        });
        this.options.container.append(tip);
        this.tooltip = tip;
        return tip;
    }

    private positionTooltip(owner: HTMLElement): void {
        const tip = this.tooltip;
        if (!tip || tip.hidden) return;
        const host = this.options.container.getBoundingClientRect();
        const rect = owner.getBoundingClientRect();
        const box = tip.getBoundingClientRect();
        if (box.width === 0 || box.height === 0) return;

        const margin = 8;
        let left = rect.left - host.left + rect.width / 2 - box.width / 2;
        left = Math.min(Math.max(left, margin), Math.max(margin, host.width - box.width - margin));
        // 默认在标点上方；上方放不下就翻到下方
        let top = rect.top - host.top - box.height - 10;
        if (top < margin) top = rect.bottom - host.top + 10;

        tip.style.left = `${Math.round(left)}px`;
        tip.style.top = `${Math.round(top)}px`;
    }

    private buildPlaceTooltip(place: FootprintPlace): Node[] {
        const info = this.options.placeInfo?.(place);
        const nodes: Node[] = [createNode('p', 'ex-fp-tip-head', place.name)];
        const meta = !info || info.count === 0 ? '还没有写游记' : `${info.count} 篇游记${info.latest ? ` · 最近 ${info.latest}` : ''}`;
        nodes.push(createNode('p', 'ex-fp-tip-meta', meta));

        if (info && info.titles.length > 0) {
            const list = createNode('ul', 'ex-fp-tip-list');
            for (const title of info.titles.slice(0, 6)) list.append(createNode('li', undefined, title));
            nodes.push(list);
        }
        return nodes;
    }

    private buildClusterTooltip(count: number, leaves: readonly string[], onExpand: () => void): Node[] {
        const nodes: Node[] = [createNode('p', 'ex-fp-tip-head', `${count} 个地点`)];
        const matched = leaves.filter((id) => {
            const place = this.placeById.get(id);
            return place ? (this.options.placeInfo?.(place)?.count ?? 0) > 0 : false;
        }).length;
        nodes.push(createNode('p', 'ex-fp-tip-meta', matched > 0 ? `${matched} 个写过游记 · 点两下放大` : '这些地方还没有游记'));

        const list = createNode('ul', 'ex-fp-tip-list is-scroll');
        for (const id of leaves) {
            const place = this.placeById.get(id);
            if (!place) continue;
            const item = createNode('li');
            // 点地名直接飞到那个标点，不用先放大再找
            const button = createNode('button', 'ex-fp-tip-place');
            button.type = 'button';
            button.dataset.placeId = place.id;
            button.setAttribute('aria-label', `飞到 ${place.name}`);
            button.append(createNode('span', 'ex-fp-tip-name', place.name));
            const articleCount = this.options.placeInfo?.(place)?.count ?? 0;
            if (articleCount > 0) button.append(createNode('span', 'ex-fp-tip-count', `${articleCount} 篇`));
            button.addEventListener('click', (event) => {
                event.stopPropagation();
                this.focusPlace(place.id);
            });
            item.append(button);
            list.append(item);
        }
        nodes.push(list);

        const action = createNode('button', 'ex-fp-tip-action', '放大这一片');
        action.type = 'button';
        action.addEventListener('click', (event) => {
            event.stopPropagation();
            onExpand();
        });
        nodes.push(action);
        return nodes;
    }

    private clearShowTimer(): void {
        if (this.tipShowTimer !== null) {
            clearTimeout(this.tipShowTimer);
            this.tipShowTimer = null;
        }
    }

    private clearTimers(): void {
        this.clearShowTimer();
        if (this.tipHideTimer !== null) {
            clearTimeout(this.tipHideTimer);
            this.tipHideTimer = null;
        }
    }

    private observeSize(): void {
        if (typeof ResizeObserver === 'undefined') return;
        this.resizeObserver = new ResizeObserver(() => {
            if (!this.map) return;
            this.map.resize();
        });
        this.resizeObserver.observe(this.options.container);
    }

    private observeTheme(): void {
        if (typeof MutationObserver === 'undefined') return;
        this.themeObserver = new MutationObserver(() => {
            if (!this.map) return;
            const theme = readTheme();
            if (theme === this.theme) return;
            this.theme = theme;
            this.map.setStyle(MAP_STYLES[theme]);
        });
        this.themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme'] });
    }
}

export function createFootprintMap(options: FootprintMapOptions): FootprintMapController {
    return new FootprintMapInstance(options);
}
