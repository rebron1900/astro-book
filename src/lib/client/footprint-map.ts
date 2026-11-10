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
import { DEM_SOURCE, HILLSHADE_LAYER, INITIAL_CENTER, INITIAL_ZOOM, MAP_STYLES } from './exercise-map/constants';
import type { MapTheme } from './exercise-map/constants';
import { motionDuration, readTheme } from './exercise-map/geometry';
import { prefersReducedMotion } from './dom';

/** 单个标点的 tooltip 补充信息（由岛从游记数据里算好传进来） */
export interface FootprintPlaceInfo {
    /** 关联游记数 */
    count: number;
    /** 最近一篇的展示日期（2026.11.02），没有游记时为 null */
    latest: string | null;
    /** 关联游记，按时间从新到旧；tooltip 里渲染成真链接 */
    articles: ReadonlyArray<{ title: string; url: string; dateLabel: string }>;
}

/** 地图视角：平面 / 3D（pitch），唯一来源在控制器里 */
export type FootprintPitchMode = 'flat' | 'tilt';

export interface FootprintMapState {
    pitchMode: FootprintPitchMode;
    /** 当前激活的标点，null 表示没有激活（卡片、地图点、气泡都从它派生） */
    activePlaceId: string | null;
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
    /** 视角或激活态变化：组件只用它来驱动按钮/高亮的视觉，不另存状态 */
    onStateChange?: (state: FootprintMapState) => void;
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
    /** 3D / 平面 切换（按钮用） */
    togglePitch(): void;
    /** 取消激活：回平面并清高亮 */
    clearActive(): void;
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
/** 3D 视角参数：卡片激活和按钮切换共用同一套，保证两种入口视觉一致 */
const TILT_PITCH = 55;
const TILT_BEARING = -20;
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
    /** 视角唯一来源：焦点动画、按钮、卡片高亮都从它派生 */
    private pitchMode: FootprintPitchMode = 'flat';

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
    /** 气泡标题 id：aria-labelledby 指过去 */
    private tipHeadId = `ex-fp-tip-head-${++tipSeq}`;
    /** 焦点从气泡还给标点的那一下不要再弹开气泡 */
    private suppressOwnerFocus: HTMLElement | null = null;
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
        this.selectedId = null;
        this.pitchMode = 'flat';
        this.tooltip?.remove();
        this.tooltip = null;

        this.resizeObserver?.disconnect();
        this.resizeObserver = null;
        this.themeObserver?.disconnect();
        this.themeObserver = null;

        this.clearMarkers();
        const map = this.map;
        // 退出足迹必须把地形收掉，否则地图层级会留给下一次进入
        if (map) {
            try {
                map.setTerrain(null as unknown as undefined);
                if (map.getLayer(HILLSHADE_LAYER)) map.removeLayer(HILLSHADE_LAYER);
                if (map.getSource(DEM_SOURCE)) map.removeSource(DEM_SOURCE);
            } catch {
                // 样式已销毁时忽略
            }
        }
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
        // 再次点同一张卡 = 取消激活，回平面
        if (this.selectedId === placeId) {
            this.clearActive();
            return;
        }
        this.select(placeId);
        // 先取消在途动画，避免连续点两张卡时 pitch/bearing 互相当作起点而跳变
        this.map.stop();
        this.setPitchMode('tilt');
        this.map.easeTo({
            center: [place.lng, place.lat],
            zoom: this.zoomForSinglePlace(place),
            pitch: TILT_PITCH,
            bearing: TILT_BEARING,
            // 带一点上移：pitch 55° 时点会掉到视口下缘，抬到中上部才看得出「聚焦」的是它
            offset: this.focusOffset(),
            duration: prefersReducedMotion() ? 0 : 700,
            essential: true
        });
    }

    /**
     * 聚焦点在屏幕上的纵向偏移。俯仰到 55° 后，正中的目标会被地形和透视推到画面下缘，
     * 这里按容器高度往上抬 12%（offset 的 y 为负 = 让目标落在容器中心上方），
     * 窄屏和桌面用同一比例，避免写死像素在 390 上过头。
     */
    private focusOffset(): [number, number] {
        const height = this.map?.getContainer().clientHeight ?? 0;
        return [0, -Math.round(height * 0.12)];
    }

    togglePitch(): void {
        this.map?.stop();
        this.setPitchMode(this.pitchMode === 'tilt' ? 'flat' : 'tilt');
        if (!this.map) return;
        const active = this.selectedId ? this.placeById.get(this.selectedId) : null;
        // 手动开关和聚焦共用同一份 pitchMode：开着激活点时切回 3D，仍要落在那个点上
        if (this.pitchMode === 'tilt' && active) {
            this.map.easeTo({
                center: [active.lng, active.lat],
                zoom: this.zoomForSinglePlace(active),
                pitch: TILT_PITCH,
                bearing: TILT_BEARING,
                offset: this.focusOffset(),
                duration: prefersReducedMotion() ? 0 : 650
            });
            return;
        }
        this.map.easeTo({
            pitch: this.pitchMode === 'tilt' ? TILT_PITCH : 0,
            bearing: this.pitchMode === 'tilt' ? TILT_BEARING : 0,
            offset: [0, 0],
            duration: prefersReducedMotion() ? 0 : 650
        });
    }

    /** 取消激活：清选中/高亮，回平面。点空白、Esc、「全部」、同一张卡再点都走这里 */
    clearActive(): void {
        const hadSelection = this.selectedId !== null;
        this.selectedId = null;
        this.applySelection();
        this.options.onSelect?.(null);
        if (hadSelection) this.emitState();
        this.setPitchMode('flat');
        // 地形收掉的同时把镜头放回平面，否则只关了地形、俯仰还停在 3D
        this.map?.stop();
        this.map?.easeTo({
            pitch: 0,
            bearing: 0,
            // 清掉聚焦时的上移偏移，否则回平面后画面仍偏向一边
            offset: [0, 0],
            duration: prefersReducedMotion() ? 0 : 650
        });
    }

    /** 改视角模式并同步按钮视觉；只在这里改 pitchMode，别处一律调它 */
    private setPitchMode(mode: FootprintPitchMode): void {
        this.options.container.dataset.pitch = mode;
        if (this.pitchMode === mode) return;
        this.pitchMode = mode;
        this.emitState();
        // 3D = 真切地形（和运动地图聚焦单条轨迹一致），按钮和卡片激活共用这一份状态
        this.applyTerrain(mode === 'tilt');
    }

    /**
     * 开/关真地形：raster-dem + hillshade + setTerrain，参数与运动地图的 applyTerrain 一致，
     * 常量直接复用 exercise-map/constants，不在足迹里重写字面量。样式不支持时静默退化成纯俯仰。
     */
    private applyTerrain(on: boolean): void {
        const map = this.map;
        if (!map || this.destroyed || !this.styleReady) return;
        try {
            if (!map.getSource(DEM_SOURCE)) {
                map.addSource(DEM_SOURCE, {
                    type: 'raster-dem',
                    url: 'mapbox://mapbox.mapbox-terrain-dem-v1',
                    tileSize: 512,
                    maxzoom: 14
                });
            }
            if (!map.getLayer(HILLSHADE_LAYER)) {
                map.addLayer({
                    id: HILLSHADE_LAYER,
                    type: 'hillshade',
                    source: DEM_SOURCE,
                    layout: { visibility: 'none' },
                    paint: { 'hillshade-exaggeration': 0.35, 'hillshade-shadow-color': '#4a4a4a' }
                });
            }
            map.setLayoutProperty(HILLSHADE_LAYER, 'visibility', on ? 'visible' : 'none');
            map.setTerrain(on ? { source: DEM_SOURCE, exaggeration: 1.4 } : (null as unknown as undefined));
        } catch {
            // 样式不支持地形时退化为纯俯仰视角
        }
    }

    /** 样式（含主题切换）重新加载后，地形和图层都会丢，按当前模式补回来 */
    private restoreTerrain(): void {
        this.applyTerrain(this.pitchMode === 'tilt');
    }

    private emitState(): void {
        this.options.onStateChange?.({ pitchMode: this.pitchMode, activePlaceId: this.selectedId });
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
        // 3D 状态下只换目标点：focusPlace 会保持 tilt，不会回平面
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
        // 主题切换会重放 style，但 setStyle 本身不动相机：有激活点时只要不 fitAll，
        // 镜头和聚焦点就原样保留。别再补一次 easeTo，否则会把用户手动缩放的 zoom 夹回去
        const active = this.selectedId ? this.placeById.get(this.selectedId) : null;
        this.restoreTerrain();
        if (active) {
            this.applySelection();
            return;
        }
        this.fitAll();
    };

    private handleError = (): void => {
        // 底图 tile 偶发失败不打断交互；只有完全没加载出来时才会走到这里
        if (!this.styleReady) this.options.onError?.();
    };

    private handleMapClick = (): void => {
        this.returnFocusToOwner();
        this.hideTooltip();
        this.clearActive();
    };

    private select(placeId: string): void {
        this.selectedId = placeId;
        this.applySelection();
        this.options.onSelect?.(placeId);
        this.emitState();
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
        element.setAttribute('aria-haspopup', 'dialog');
        element.setAttribute('aria-expanded', 'false');

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
        // 和 /map 页同一个聚合点样式：.marker.cluster，数字由 .cluster:after 读 data-cardinality
        element.className = 'marker cluster ex-fp-point';
        element.setAttribute('aria-label', '聚合点，展开查看');
        element.setAttribute('aria-haspopup', 'dialog');
        element.setAttribute('aria-expanded', 'false');

        const entry: MarkerEntry = {
            marker: null as unknown as mapboxgl.Marker,
            element,
            kind: 'cluster',
            lngLat: coordinates,
            clusterId,
            count: 0,
            leaves: []
        };

        const build = () => this.buildClusterTooltip(entry.count ?? 0, entry.leaves ?? []);
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
        element.addEventListener('focus', () => {
            if (this.suppressOwnerFocus === element) return;
            this.showTooltip(element, build);
        });
        element.addEventListener('blur', () => this.scheduleHide());
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
        const changed = this.tooltipOwner !== owner;
        if (changed) {
            tip.replaceChildren(...build());
            this.tooltipOwner = owner;
        }
        // 放进 DOM 顺序里紧跟在标点之后：从标点按一下 Tab 就能进气泡
        if (changed) {
            owner.insertAdjacentElement('afterend', tip);
            tip.setAttribute('aria-labelledby', this.tipHeadId);
        }
        tip.hidden = false;
        tip.setAttribute('aria-labelledby', this.tipHeadId);
        owner.setAttribute('aria-expanded', 'true');
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
            // 移回地图容器末尾：标点重建/销毁时气泡不会跟着没了
            if (this.tooltip.parentElement !== this.options.container) this.options.container.append(this.tooltip);
        }
        if (this.tooltipOwner) {
            this.tooltipOwner.setAttribute('aria-expanded', 'false');
            this.tooltipOwner = null;
        }
    };

    /** 把焦点还给当前气泡的触发标点（Esc、点外部关闭时用） */
    private returnFocusToOwner(): void {
        const owner = this.tooltipOwner;
        if (!owner) return;
        const active = document.activeElement;
        if (!active || !this.tooltip?.contains(active)) return;
        // 焦点回标点时会触发 focus → 重新打开气泡：用一次性标记跳过这次
        this.suppressOwnerFocus = owner;
        owner.focus({ preventScroll: true });
        this.suppressOwnerFocus = null;
    }

    private ensureTooltip(): HTMLDivElement {
        if (this.tooltip) return this.tooltip;
        const tip = document.createElement('div');
        tip.className = 'ex-fp-tip';
        tip.id = `ex-fp-tip-${++tipSeq}`;
        // 气泡里有链接和按钮：按 dialog 处理，标题由 aria-labelledby 指向气泡内的 .ex-fp-tip-head。
        // 不做 aria-modal、打开也不抢焦点（hover 时焦点留在标点上）。
        tip.setAttribute('role', 'dialog');
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
        // Esc 关气泡并把焦点还给标点；stopPropagation 免得同一次 Esc 又去退足迹
        tip.addEventListener('keydown', (event) => {
            if (event.key !== 'Escape') return;
            event.preventDefault();
            event.stopPropagation();
            this.returnFocusToOwner();
            this.hideTooltip();
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
        const gap = 12;
        const spaceAbove = rect.top - host.top;
        const spaceBelow = host.bottom - rect.bottom;
        const spaceLeft = rect.left - host.left;
        const spaceRight = host.right - rect.right;

        // 四向择一：优先上下（箭头指得准），上下都放不下再看左右；
        // 气泡被边界钳制时，箭头位置由 --tip-arrow 跟随标点，不会指错方向
        let placement: 'top' | 'bottom' | 'left' | 'right';
        if (spaceAbove >= box.height + gap) placement = 'top';
        else if (spaceBelow >= box.height + gap) placement = 'bottom';
        else if (spaceRight >= box.width + gap) placement = 'right';
        else if (spaceLeft >= box.width + gap) placement = 'left';
        else placement = spaceAbove >= spaceBelow ? 'top' : 'bottom';

        let left: number;
        let top: number;
        if (placement === 'top' || placement === 'bottom') {
            const centerX = rect.left - host.left + rect.width / 2;
            left = Math.min(Math.max(centerX - box.width / 2, margin), Math.max(margin, host.width - box.width - margin));
            top = placement === 'top' ? rect.top - host.top - box.height - gap : rect.bottom - host.top + gap;
            const arrowX = Math.min(Math.max(centerX - left, 14), box.width - 14);
            tip.style.setProperty('--tip-arrow', `${Math.round(arrowX)}px`);
        } else {
            const centerY = rect.top - host.top + rect.height / 2;
            top = Math.min(Math.max(centerY - box.height / 2, margin), Math.max(margin, host.height - box.height - margin));
            left = placement === 'right' ? rect.right - host.left + gap : rect.left - host.left - box.width - gap;
            const arrowY = Math.min(Math.max(centerY - top, 14), box.height - 14);
            tip.style.setProperty('--tip-arrow', `${Math.round(arrowY)}px`);
        }

        tip.dataset.placement = placement;
        tip.style.left = `${Math.round(left)}px`;
        tip.style.top = `${Math.round(top)}px`;
    }

    private buildPlaceTooltip(place: FootprintPlace): Node[] {
        const info = this.options.placeInfo?.(place);
        const head = createNode('p', 'ex-fp-tip-head', place.name);
        head.id = this.tipHeadId;
        const nodes: Node[] = [head];
        const meta = !info || info.count === 0 ? '还没有写游记' : `${info.count} 篇游记${info.latest ? ` · 最近 ${info.latest}` : ''}`;
        nodes.push(createNode('p', 'ex-fp-tip-meta', meta));

        if (info && info.articles.length > 0) {
            const list = createNode('ul', 'ex-fp-tip-list');
            for (const article of info.articles.slice(0, 6)) {
                const item = createNode('li');
                // 真锚点：中键新开、右键复制、键盘回车都是浏览器原生行为
                const link = createNode('a', 'ex-fp-tip-article', article.title);
                link.href = article.url;
                // 气泡不是页面过渡的命名元素，不需要额外处理；点击别穿透到地图（会清选中态）
                link.addEventListener('click', (event) => event.stopPropagation());
                item.append(link);
                list.append(item);
            }
            nodes.push(list);
            if (info.articles.length > 6) nodes.push(createNode('p', 'ex-fp-tip-more', `还有 ${info.articles.length - 6} 篇`));
        }
        return nodes;
    }

    private buildClusterTooltip(count: number, leaves: readonly string[]): Node[] {
        const head = createNode('p', 'ex-fp-tip-head', `${count} 个地点`);
        head.id = this.tipHeadId;
        const nodes: Node[] = [head];
        const matched = leaves.filter((id) => {
            const place = this.placeById.get(id);
            return place ? (this.options.placeInfo?.(place)?.count ?? 0) > 0 : false;
        }).length;
        nodes.push(createNode('p', 'ex-fp-tip-meta', matched > 0 ? `${matched} 个写过游记 · 点地名飞过去` : '这些地方还没有游记'));

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
