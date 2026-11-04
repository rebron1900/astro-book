/**
 * 运动页面地图控制器（与框架无关）。
 *
 * 职责：
 * - 创建 / 销毁 Mapbox 实例，容器尺寸变化时 resize；
 * - 首次加载轨迹数据（模块级缓存，同页多个实例共享一次请求），解码成 GeoJSON；
 * - 按 scope 过滤 / 聚焦路线，按 hoverId 高亮单条路线；
 * - 跟随站点深浅色主题切换底图样式；
 * - 出错时通过 onStatus 回调把提示交给组件，不影响页面其它部分。
 *
 * SSR 安全：模块顶层只声明常量与函数，不访问 window / document；
 * 只有 createExerciseMap() 被调用（Solid 的 onMount）之后才会操作 DOM 与地图。
 */
import mapboxgl from 'mapbox-gl/dist/mapbox-gl.js';
import MapboxLanguage from '@mapbox/mapbox-gl-language';
import 'mapbox-gl/dist/mapbox-gl.css';

import type { ExerciseRecord, ExerciseScope } from '../exercise';
import { SPORT_META, decodeRoute, recordsInScope, scopeKey } from '../exercise';

/* ------------------------------------------------------------------ */
/* 常量                                                                */
/* ------------------------------------------------------------------ */

const SOURCE_ID = 'ex-routes';
const LAYER_BASE = 'ex-routes-base';
const LAYER_FOCUS_GLOW = 'ex-routes-focus-glow';
const LAYER_FOCUS = 'ex-routes-focus';
const LAYER_HALO = 'ex-routes-hover-halo';
const LAYER_HOVER = 'ex-routes-hover';

/** 单条轨迹重播：单独的 source / layer，画完后整体移除，不影响正常路线图层 */
const REPLAY_SOURCE = 'ex-replay';
const REPLAY_HEAD_SOURCE = 'ex-replay-head';
const REPLAY_GLOW_LAYER = 'ex-replay-glow';
const REPLAY_LAYER = 'ex-replay';
const REPLAY_HEAD_LAYER = 'ex-replay-head';

const REPLAY_TRANSPARENT = 'rgba(0, 0, 0, 0)';
/** 重播时隐藏的正常路线图层（画完恢复） */
const REPLAY_HIDDEN_LAYERS = [LAYER_BASE, LAYER_FOCUS_GLOW, LAYER_FOCUS, LAYER_HALO, LAYER_HOVER];

/** 用户操作地图后自动旋转暂停的时长；重播结束后稍晚一点恢复 */
const ROTATE_PAUSE_MS = 4200;
const ROTATE_RESUME_AFTER_REPLAY_MS = 1200;

/** 第一视角重播：镜头压低、朝行进方向看，并稍微看向前方 */
const REPLAY_PITCH = 66;
const REPLAY_ZOOM = 13.6;
/** 镜头中心比绘制点再往前一点，画出来的轨迹落在画面下半部 */
const REPLAY_CENTER_AHEAD_METERS = 120;
/** 计算镜头朝向时用更长的前后窗口，避免 GPS 小抖动让镜头左右摆 */
const REPLAY_HEADING_BEHIND_METERS = 80;
const REPLAY_HEADING_AHEAD_METERS = 160;
/** 朝向低通的等效时间常数，以及单帧最大转角（防止过弯时猛甩） */
const REPLAY_BEARING_TAU_MS = 700;
const REPLAY_MAX_TURN_PER_FRAME = 0.5;
const REPLAY_INTRO_MS = 1100;
const REPLAY_OUTRO_MS = 1000;

/** 可以点击 / 悬停出 pointer 的路线图层 */
const ROUTE_LAYERS = [LAYER_BASE, LAYER_FOCUS, LAYER_HOVER];

/** 用不到任何路线的 filter，用来清空某一层（比 setFilter(null) 更符合「保持过滤」的语义） */
const NO_MATCH: mapboxgl.FilterSpecification = ['==', ['get', 'id'], '__ex-map-no-route__'];

/**
 * 需要隐私过滤的城市：命中后地图会隐藏路名、道路、门牌、POI 与建筑等细节。
 * bounds = [minLng, minLat, maxLng, maxLat]，用轨迹范围判断，避免个别记录没有城市字段。
 */
export const PRIVACY_CITIES: Array<{ name: string; bounds: [number, number, number, number] }> = [{ name: '自贡市', bounds: [104.6, 29.2, 105.0, 29.5] }];

/** 3D 地形（单条轨迹视角） */
const DEM_SOURCE = 'ex-terrain-dem';
const HILLSHADE_LAYER = 'ex-terrain-hillshade';

const MAP_STYLES = {
    light: 'mapbox://styles/mapbox/light-v11',
    dark: 'mapbox://styles/mapbox/dark-v11'
} as const;

type MapTheme = keyof typeof MAP_STYLES;

const INITIAL_CENTER: [number, number] = [108.14, 33.87];
const INITIAL_ZOOM = 3.2;

/** 单条轨迹的最小跨度（约 60 米），避免极短轨迹在 fitBounds 时算出极端缩放 */
const MIN_BOUNDS_SPAN = 0.0006;

/** 地图容器不可见（display:none / 宽度为 0）时，把视野操作挂起，等可见后再执行 */
interface PendingFit {
    ids: string[];
    duration: number;
    maxZoom: number;
}

/* ------------------------------------------------------------------ */
/* 轨迹数据                                                            */
/* ------------------------------------------------------------------ */

type RouteFeatureProperties = {
    id: string;
    sport: string;
    color: string;
    date: string;
    month: string;
    year: number;
};

type Bounds = [[number, number], [number, number]];

interface RouteData {
    collection: GeoJSON.FeatureCollection<GeoJSON.LineString, RouteFeatureProperties>;
    /** 有轨迹的记录 id */
    ids: Set<string>;
    /** 每条轨迹的 bbox（含最小跨度），切换 scope 时只用祖先 135 个包围盒 */
    bounds: Map<string, Bounds>;
}

/** url -> 轨迹数据（成功和失败都缓存：只请求一次，失败也不反复重试） */
const routeCache = new Map<string, Promise<RouteData>>();

function boundsOfCoordinates(coordinates: Array<[number, number]>): Bounds {
    let minLng = Number.POSITIVE_INFINITY;
    let minLat = Number.POSITIVE_INFINITY;
    let maxLng = Number.NEGATIVE_INFINITY;
    let maxLat = Number.NEGATIVE_INFINITY;

    for (const [lng, lat] of coordinates) {
        if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
        if (lng < minLng) minLng = lng;
        if (lng > maxLng) maxLng = lng;
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
    }

    if (!Number.isFinite(minLng) || !Number.isFinite(minLat))
        return [
            [0, 0],
            [0, 0]
        ];

    const centerLng = (minLng + maxLng) / 2;
    const centerLat = (minLat + maxLat) / 2;
    const halfLng = Math.max((maxLng - minLng) / 2, MIN_BOUNDS_SPAN / 2);
    const halfLat = Math.max((maxLat - minLat) / 2, MIN_BOUNDS_SPAN / 2);

    return [
        [centerLng - halfLng, centerLat - halfLat],
        [centerLng + halfLng, centerLat + halfLat]
    ];
}

function buildRouteData(raw: Record<string, string>, records: ExerciseRecord[]): RouteData {
    const byId = new Map(records.map((record) => [record.id, record]));
    const features: Array<GeoJSON.Feature<GeoJSON.LineString, RouteFeatureProperties>> = [];
    const bounds = new Map<string, Bounds>();

    for (const [id, encoded] of Object.entries(raw ?? {})) {
        if (typeof encoded !== 'string' || encoded.length < 2) continue;
        const record = byId.get(id);
        // 只画页面上有对应记录的轨迹，保证点击路线能选中时间线里的那一条
        if (!record) continue;

        let coordinates: Array<[number, number]>;
        try {
            coordinates = decodeRoute(encoded);
        } catch {
            continue;
        }
        if (coordinates.length < 2) continue;

        features.push({
            type: 'Feature',
            properties: {
                id: record.id,
                sport: record.sport,
                color: SPORT_META[record.sport].color,
                date: record.date,
                month: record.month,
                year: record.year
            },
            geometry: { type: 'LineString', coordinates }
        });
        bounds.set(record.id, boundsOfCoordinates(coordinates));
    }

    return {
        collection: { type: 'FeatureCollection', features },
        ids: new Set(bounds.keys()),
        bounds
    };
}

function loadRoutes(url: string, records: ExerciseRecord[]): Promise<RouteData> {
    const cached = routeCache.get(url);
    if (cached) return cached;

    const request = fetch(url)
        .then((response) => {
            if (!response.ok) throw new Error(`轨迹数据请求失败：${response.status}`);
            return response.json() as Promise<Record<string, string>>;
        })
        .then((raw) => buildRouteData(raw ?? {}, records));

    routeCache.set(url, request);
    return request;
}

/* ------------------------------------------------------------------ */
/* 主题                                                                */
/* ------------------------------------------------------------------ */

/** 站点主题类型存在 localStorage.themetype（'light' | 'dark'），兜底看 html 的 class */
function readTheme(): MapTheme {
    try {
        const stored = window.localStorage.getItem('themetype');
        if (stored === 'light' || stored === 'dark') return stored;
    } catch {
        // 隐私模式等 localStorage 不可用的场景，直接看 class
    }
    return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
}

/** 视野动画时长；用户开了「减少动态效果」时直接跳过去 */
function motionDuration(duration: number): number {
    if (!duration) return 0;
    try {
        return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : duration;
    } catch {
        return duration;
    }
}

/** 从 a 到 b 的行进方向（度，正北为 0，顺时针） */
function bearingBetween(a: [number, number], b: [number, number]): number {
    const rad = Math.PI / 180;
    const dLng = (b[0] - a[0]) * Math.cos(((a[1] + b[1]) / 2) * rad);
    const dLat = b[1] - a[1];
    return (Math.atan2(dLng, dLat) * (180 / Math.PI) + 360) % 360;
}

/** 角度插值：走最短的一边，跨过 0° / 360° 时不会突然转一圈 */
function lerpAngle(from: number, to: number, amount: number): number {
    const delta = ((to - from + 540) % 360) - 180;
    return (from + delta * amount + 360) % 360;
}

function easeInOutCubic(value: number): number {
    return value < 0.5 ? 4 * value * value * value : 1 - Math.pow(-2 * value + 2, 3) / 2;
}

/** 给镜头用的轻度平滑轨迹：只压掉 GPS 的横向小抖动，不改绘制用的原始线 */
function smoothCoordinates(coordinates: Array<[number, number]>, radius: number): Array<[number, number]> {
    if (coordinates.length < 3 || radius < 1) return coordinates.map(([lng, lat]) => [lng, lat]);
    return coordinates.map((_, index) => {
        let lng = 0;
        let lat = 0;
        let weight = 0;
        for (let offset = -radius; offset <= radius; offset += 1) {
            const point = coordinates[Math.min(coordinates.length - 1, Math.max(0, index + offset))];
            const pointWeight = radius + 1 - Math.abs(offset);
            lng += point[0] * pointWeight;
            lat += point[1] * pointWeight;
            weight += pointWeight;
        }
        return [lng / weight, lat / weight];
    });
}

/** 两点间的大圆距离（米），用于按轨迹实际长度计算重播速度 */
function distanceMeters(a: [number, number], b: [number, number]): number {
    const rad = Math.PI / 180;
    const dLat = (b[1] - a[1]) * rad;
    const dLng = (b[0] - a[0]) * rad;
    const lat = ((a[1] + b[1]) / 2) * rad;
    const x = dLng * Math.cos(lat);
    return Math.hypot(x, dLat) * 6371008.8;
}

/**
 * 轨迹重播的 `line-gradient`：progress 之前的部分用运动颜色，之后透明，
 * 视觉上就是一条线从起点被慢慢「画」出来。
 */
function replayGradient(color: string, progress: number): unknown {
    const stop = Math.min(0.9999, Math.max(0.0004, progress));
    return ['step', ['line-progress'], color, stop, REPLAY_TRANSPARENT];
}

/* ------------------------------------------------------------------ */
/* 对外接口                                                            */
/* ------------------------------------------------------------------ */

export interface ExerciseMapStatus {
    /** 卡片底部提示条文案；null 表示隐藏 */
    message: string | null;
    /** 地图 / 轨迹数据不可用（卡片进入淡化态） */
    unavailable: boolean;
}

export interface ExerciseMapOptions {
    /** 地图挂载的容器（必须是已经渲染到 DOM 里的元素；吸顶时高度不变，只被外层裁切） */
    container: HTMLElement;
    /** 外层可视窗口：吸顶时比容器矮，会以中线为轴裁切；fitBounds 需要把裁掉的部分补进 padding */
    viewport?: HTMLElement;
    /** Mapbox public token */
    token: string;
    /** 轨迹数据接口，返回 { [记录 id]: encodedPolyline } */
    routesUrl: string;
    /** 页面内的精简运动记录 */
    records: ExerciseRecord[];
    /** 点击地图上的路线 */
    onSelectRoute: (id: string) => void;
    /** 地图状态变化（提示文案 / 是否可用） */
    onStatus: (status: ExerciseMapStatus) => void;
    /** 当前范围是否可以重播（单条记录且有轨迹） */
    onReplayAvailable?: (available: boolean) => void;
    /** 重播开始 / 结束 */
    onReplayChange?: (replaying: boolean) => void;
    /** 重播是否在自动播放（暂停 / 拖动进度后会变成 false） */
    onReplayPlayback?: (playing: boolean) => void;
    /** 当前绘制进度 0~1 */
    onReplayProgress?: (progress: number) => void;
}

export interface ExerciseMapController {
    /** 创建地图并加载轨迹；重复调用无副作用 */
    start(): Promise<void>;
    /** 更新当前选中范围 */
    setScope(scope: ExerciseScope): void;
    /** 更新悬停的记录（null 取消高亮） */
    setHover(id: string | null): void;
    /** 地图是否处于吸顶的紧凑状态（2D 范围需要在高度过渡结束后重新取景） */
    setCompact(compact: boolean): void;
    /** 重播当前单条记录的轨迹；正在重播时再次调用会停止并恢复 */
    replay(): void;
    /** 暂停自动绘制，保留当前进度和镜头 */
    pauseReplay(): void;
    /** 从当前进度继续绘制 */
    resumeReplay(): void;
    /** 跳到任意绘制进度（0~1），并同步第一视角镜头 */
    seekReplay(progress: number): void;
    /** 停止重播并恢复地图原有图层与自动旋转 */
    stopReplay(restoreCamera?: boolean): void;
    /** 销毁地图，之后所有方法都变成空操作 */
    destroy(): void;
}

/* ------------------------------------------------------------------ */
/* 图层样式                                                            */
/* ------------------------------------------------------------------ */

function baseLayerSpecification(): mapboxgl.LineLayerSpecification {
    return {
        id: LAYER_BASE,
        type: 'line',
        source: SOURCE_ID,
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
            'line-color': ['get', 'color'],
            'line-width': ['interpolate', ['linear'], ['zoom'], 3, 1.7, 8, 2.1, 13, 2.6],
            'line-opacity': 0.3
        }
    };
}

function focusGlowLayerSpecification(): mapboxgl.LineLayerSpecification {
    return {
        id: LAYER_FOCUS_GLOW,
        type: 'line',
        source: SOURCE_ID,
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
            'line-color': ['get', 'color'],
            'line-width': ['interpolate', ['linear'], ['zoom'], 3, 6.5, 8, 7, 15, 8],
            'line-opacity': 0.2,
            'line-blur': 1.6
        }
    };
}

function focusLayerSpecification(): mapboxgl.LineLayerSpecification {
    return {
        id: LAYER_FOCUS,
        type: 'line',
        source: SOURCE_ID,
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
            'line-color': ['get', 'color'],
            'line-width': ['interpolate', ['linear'], ['zoom'], 3, 2.6, 8, 3, 15, 3.4],
            'line-opacity': 0.94
        }
    };
}

function hoverHaloLayerSpecification(): mapboxgl.LineLayerSpecification {
    return {
        id: LAYER_HALO,
        type: 'line',
        source: SOURCE_ID,
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
            'line-color': ['get', 'color'],
            'line-width': ['interpolate', ['linear'], ['zoom'], 3, 6, 10, 7, 15, 8],
            'line-opacity': 0.2,
            'line-blur': 1.5
        }
    };
}

function hoverLayerSpecification(): mapboxgl.LineLayerSpecification {
    return {
        id: LAYER_HOVER,
        type: 'line',
        source: SOURCE_ID,
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
            'line-color': ['get', 'color'],
            'line-width': ['interpolate', ['linear'], ['zoom'], 3, 3, 10, 3.6, 15, 4.2],
            'line-opacity': 1
        }
    };
}

/* ------------------------------------------------------------------ */
/* 控制器                                                              */
/* ------------------------------------------------------------------ */

class ExerciseMapInstance implements ExerciseMapController {
    private readonly options: ExerciseMapOptions;
    private map: mapboxgl.Map | null = null;
    private data: RouteData | null = null;

    private scope: ExerciseScope = { kind: 'all' };
    private scopeSignature = scopeKey({ kind: 'all' });
    private hoverId: string | null = null;

    private theme: MapTheme = 'light';
    private styleReady = false;
    private layersBound = false;
    private didInitialFit = false;
    private destroyed = false;
    private started = false;

    private unavailable = false;
    private statusSignature = '';

    private sizeWasZero = false;
    private pendingFit: PendingFit | null = null;
    private dragging = false;
    private reducedMotion = false;
    /** 吸顶紧凑状态；非 3D 范围在高度过渡结束后会重新取景 */
    private compact = false;
    private compactTimer: ReturnType<typeof setTimeout> | null = null;

    /** 3D 视角只对「单条轨迹」生效：镜头俯仰 + 自动旋转的计时器 */
    private cameraTimer: ReturnType<typeof setTimeout> | null = null;
    private rotateTimer: ReturnType<typeof setTimeout> | null = null;
    private rotateFrame: number | null = null;
    /** 用户操作地图后，自动旋转的恢复计时器 */
    private rotateResumeTimer: ReturnType<typeof setTimeout> | null = null;

    /** 单条轨迹重播动画状态 */
    private replaying = false;
    private replayAvailable = false;
    private replayFrame: number | null = null;
    private replayFinishTimer: ReturnType<typeof setTimeout> | null = null;
    private replayStart = 0;
    private replayDuration = 0;
    private replayPlaying = false;
    private replayProgress = 0;
    private replayIntroElapsed = 0;
    private replayResumeAt = 0;
    private replayProgressEmitAt = 0;
    private replayRoute: {
        coordinates: Array<[number, number]>;
        cumulative: number[];
        total: number;
        color: string;
        /** 只给镜头用的平滑轨迹，避免高差大 / GPS 抖动时镜头左右摆 */
        cameraCoordinates: Array<[number, number]>;
        cameraCumulative: number[];
        cameraTotal: number;
    } | null = null;
    /** 第一视角镜头：进入前的相机和平滑后的朝向 */
    private replaySavedCamera: { center: [number, number]; zoom: number; bearing: number; pitch: number } | null = null;
    private replayBearing: number | null = null;
    private replayLastFrame = 0;

    /** 当前范围是否命中隐私城市 */
    private privacyEnabled = false;

    private resizeObserver: ResizeObserver | null = null;
    private themeObserver: MutationObserver | null = null;
    private readyTimer: ReturnType<typeof setTimeout> | null = null;

    constructor(options: ExerciseMapOptions) {
        this.options = options;
    }

    /* ------------------------------ 生命周期 ------------------------------ */

    async start(): Promise<void> {
        if (this.started || this.destroyed) return;
        this.started = true;

        if (!this.options.token?.trim()) {
            this.fail();
            return;
        }

        try {
            this.reducedMotion = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
            // 触屏设备上关闭单指拖动：手指下滑应该滚页面，而不是把预览地图拖走
            const touchPrimary =
                typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(hover: none), (pointer: coarse)').matches;
            mapboxgl.accessToken = this.options.token.trim();
            this.theme = readTheme();
            this.map = new mapboxgl.Map({
                container: this.options.container,
                style: MAP_STYLES[this.theme],
                center: INITIAL_CENTER,
                zoom: INITIAL_ZOOM,
                minZoom: 2,
                maxZoom: 18,
                // 自己用 ResizeObserver 控制 resize 时机（悬浮过渡期间要暂停，避免地图闪白）
                trackResize: false,
                // 预览地图可以直接用滚轮 / 触控板缩放；触屏上仍按 cooperativeGestures 走双指手势
                scrollZoom: true,
                // 触屏上单指滑动留给页面滚动，双指手势才拖动 / 缩放地图（提示条在样式里收掉）
                cooperativeGestures: touchPrimary,
                locale: { 'TouchPanBlocker.Message': '用两根手指拖动地图' },
                dragRotate: false,
                pitchWithRotate: false,
                // 自动旋转会从很小的角度慢慢转起来；不设 0 的话，开始拖动时会被「回正」吸到正北
                bearingSnap: 0,
                doubleClickZoom: true,
                // 右下角的版权信息不需要显示
                attributionControl: false
            });
        } catch {
            this.map = null;
            this.fail();
            return;
        }

        const map = this.map;
        // 中文地名，和 /map/ 页保持一致
        map.addControl(new MapboxLanguage({ defaultLanguage: 'zh-Hans' }));
        map.on('style.load', this.handleStyleLoad);
        map.on('error', this.handleMapError);
        map.on('dragstart', this.handleDragStart);
        map.on('dragend', this.handleDragEnd);
        // 自动旋转每帧调用 setBearing，而 setBearing 会调用 map.stop()：
        // 不先停掉旋转的话，用户按下鼠标开始拖动会被下一帧立刻取消。
        map.on('mousedown', this.handleUserInteract);
        map.on('touchstart', this.handleUserInteract);
        map.on('wheel', this.handleUserInteract);

        this.observeSize();
        this.observeTheme();

        // 样式一直加载不出来（token 无效、网络不通）时兜底提示，避免一直空白
        this.readyTimer = setTimeout(() => {
            this.readyTimer = null;
            if (!this.styleReady) this.fail();
        }, 12000);

        try {
            this.data = await loadRoutes(this.options.routesUrl, this.options.records);
        } catch {
            this.data = null;
            this.fail();
            return;
        }

        if (this.destroyed) return;
        this.sync();
    }

    destroy(): void {
        if (this.destroyed) return;
        this.destroyed = true;

        if (this.readyTimer !== null) {
            clearTimeout(this.readyTimer);
            this.readyTimer = null;
        }
        if (this.cameraTimer !== null) {
            clearTimeout(this.cameraTimer);
            this.cameraTimer = null;
        }
        if (this.compactTimer !== null) {
            clearTimeout(this.compactTimer);
            this.compactTimer = null;
        }
        if (this.rotateResumeTimer !== null) {
            clearTimeout(this.rotateResumeTimer);
            this.rotateResumeTimer = null;
        }
        if (this.replayFinishTimer !== null) {
            clearTimeout(this.replayFinishTimer);
            this.replayFinishTimer = null;
        }
        if (this.replayFrame !== null) {
            cancelAnimationFrame(this.replayFrame);
            this.replayFrame = null;
        }
        this.replaying = false;
        this.replayRoute = null;
        this.replaySavedCamera = null;
        this.replayBearing = null;
        this.stopAutoRotate();
        if (this.resizeObserver) {
            this.resizeObserver.disconnect();
            this.resizeObserver = null;
        }
        if (this.themeObserver) {
            this.themeObserver.disconnect();
            this.themeObserver = null;
        }

        const map = this.map;
        this.map = null;
        this.data = null;
        this.pendingFit = null;
        if (!map) return;

        try {
            // remove() 会一并拆掉 canvas、事件与 WebGL 上下文
            map.remove();
        } catch {
            // 销毁阶段的异常无需处理
        }
    }

    /* ------------------------------ 对外方法 ------------------------------ */

    setScope(scope: ExerciseScope): void {
        if (this.destroyed) return;
        const signature = scopeKey(scope);
        if (signature === this.scopeSignature) return;
        // 重播属于上一条记录：先停掉并恢复图层，再切范围
        this.stopReplay();
        if (this.compactTimer !== null) {
            clearTimeout(this.compactTimer);
            this.compactTimer = null;
        }
        this.scopeSignature = signature;
        this.scope = scope;
        this.updateReplayAvailability();
        if (!this.map || !this.data) return;
        this.setPrivacyMode(this.shouldUsePrivacy());
        this.applyFilters();
        if (!this.didInitialFit) return;
        this.focusOnScope(true);
        this.updateStatus();
    }

    setHover(id: string | null): void {
        if (this.destroyed || id === this.hoverId) return;
        this.hoverId = id;
        this.applyFilters();
    }

    setCompact(compact: boolean): void {
        if (this.destroyed || compact === this.compact) return;
        this.compact = compact;
        // 单条轨迹是 3D 视角：吸顶只裁切画面，保留镜头角度与缩放；2D 范围则等高度过渡结束后
        // 按可见区域重新取景，避免路线被上下裁掉。
        if (this.compactTimer !== null) {
            clearTimeout(this.compactTimer);
            this.compactTimer = null;
        }
        const duration = motionDuration(300);
        this.compactTimer = setTimeout(() => {
            this.compactTimer = null;
            if (this.destroyed || this.scope.kind === 'record') return;
            this.focusOnScope(true);
        }, duration + 40);
    }

    /** 重播接口：播放中再次调用等于停止并回到进入前的镜头 */
    replay(): void {
        if (this.replaying) {
            this.stopReplay(true);
            return;
        }
        this.startReplay();
    }

    pauseReplay(): void {
        if (!this.replaying || !this.replayPlaying) return;
        this.replayPlaying = false;
        if (this.replayFrame !== null) {
            cancelAnimationFrame(this.replayFrame);
            this.replayFrame = null;
        }
        if (this.replayFinishTimer !== null) {
            clearTimeout(this.replayFinishTimer);
            this.replayFinishTimer = null;
        }
        const now = performance.now();
        this.replayIntroElapsed = Math.min(1, this.replayIntroElapsed + (now - this.replayResumeAt) / REPLAY_INTRO_MS);
        this.options.onReplayPlayback?.(false);
    }

    resumeReplay(): void {
        if (!this.replaying || this.replayPlaying || this.replayDuration <= 0) return;
        if (this.replayFinishTimer !== null) {
            clearTimeout(this.replayFinishTimer);
            this.replayFinishTimer = null;
        }
        const now = performance.now();
        // 播到 100% 后再次点播放：从头再画一遍
        if (this.replayProgress >= 0.999) {
            this.replayProgress = 0;
            this.replayIntroElapsed = 1;
            this.replayBearing = null;
            this.replayLastFrame = now;
            this.setReplayProgress(0.0004);
            this.applyReplayCamera(0.0004, 1, now);
            this.emitReplayProgress(0, true);
        }
        this.replayPlaying = true;
        this.replayStart = now - this.replayProgress * this.replayDuration;
        this.replayResumeAt = now;
        this.replayLastFrame = now;
        this.options.onReplayPlayback?.(true);
        this.replayFrame = requestAnimationFrame(this.replayStep);
    }

    seekReplay(progress: number): void {
        if (!this.replaying) return;
        const value = Math.min(1, Math.max(0, progress));
        const wasPlaying = this.replayPlaying;
        this.replayPlaying = false;
        if (this.replayFrame !== null) {
            cancelAnimationFrame(this.replayFrame);
            this.replayFrame = null;
        }
        if (this.replayFinishTimer !== null) {
            clearTimeout(this.replayFinishTimer);
            this.replayFinishTimer = null;
        }
        const now = performance.now();
        this.replayProgress = value;
        this.replayIntroElapsed = 1;
        this.replayStart = now - value * this.replayDuration;
        this.replayResumeAt = now;
        this.replayLastFrame = now;
        // 拖动进度时相机直接站到对应位置，不要带着上一段的方向慢慢转过去
        this.replayBearing = null;
        this.setReplayProgress(value);
        this.applyReplayCamera(value, 1, now);
        this.emitReplayProgress(value, true);
        if (wasPlaying) this.options.onReplayPlayback?.(false);
    }

    private emitReplayProgress(progress: number, force = false): void {
        const now = performance.now();
        if (!force && now - this.replayProgressEmitAt < 70) return;
        this.replayProgressEmitAt = now;
        this.options.onReplayProgress?.(Math.min(1, Math.max(0, progress)));
    }

    /**
     * 停止重播并恢复普通图层。
     * restoreCamera = true 时把镜头缓动回进入第一视角前的状态（用户手动停止 / 正常播完）；
     * 切换 scope 时传 false，让 focusOnScope 自己取景。
     */
    stopReplay(restoreCamera = false): void {
        if (!this.replaying && this.replayRoute === null) return;
        this.replaying = false;
        this.replayPlaying = false;
        this.replayProgress = 0;
        this.replayIntroElapsed = 0;
        if (this.replayFrame !== null) {
            cancelAnimationFrame(this.replayFrame);
            this.replayFrame = null;
        }
        if (this.replayFinishTimer !== null) {
            clearTimeout(this.replayFinishTimer);
            this.replayFinishTimer = null;
        }
        this.replayRoute = null;

        const map = this.map;
        const savedCamera = restoreCamera ? this.replaySavedCamera : null;
        this.replaySavedCamera = null;
        this.replayBearing = null;

        if (map) {
            for (const layer of [REPLAY_HEAD_LAYER, REPLAY_GLOW_LAYER, REPLAY_LAYER]) {
                try {
                    if (map.getLayer(layer)) map.removeLayer(layer);
                } catch {
                    // 样式切换 / 销毁中忽略
                }
            }
            for (const source of [REPLAY_HEAD_SOURCE, REPLAY_SOURCE]) {
                try {
                    if (map.getSource(source)) map.removeSource(source);
                } catch {
                    // 样式切换 / 销毁中忽略
                }
            }
            this.setRouteLayersVisibility('visible');
        }

        this.options.onReplayPlayback?.(false);
        this.options.onReplayChange?.(false);
        if (this.destroyed) return;

        if (savedCamera && map) {
            // 画完先让完整轨迹显示一瞬，再把镜头缓缓拉回原来的全局视角
            const duration = motionDuration(REPLAY_OUTRO_MS);
            try {
                map.easeTo({ center: savedCamera.center, zoom: savedCamera.zoom, bearing: savedCamera.bearing, pitch: savedCamera.pitch, duration });
            } catch {
                // 地图销毁 / 样式切换中忽略
            }
            if (this.scope.kind === 'record') this.startAutoRotate(duration + 320);
            return;
        }
        if (this.scope.kind === 'record') this.startAutoRotate(ROTATE_RESUME_AFTER_REPLAY_MS);
    }

    /* ------------------------------ 单条轨迹重播 ------------------------------ */

    /** 只在「单条记录 + 有轨迹 + 样式已就绪」时提供重播按钮 */
    private updateReplayAvailability(): void {
        const next = !this.destroyed && !this.unavailable && this.styleReady && this.scope.kind === 'record' && Boolean(this.data?.ids.has(this.scope.id));
        if (next === this.replayAvailable) return;
        this.replayAvailable = next;
        if (!next) this.stopReplay();
        this.options.onReplayAvailable?.(next);
    }

    private setRouteLayersVisibility(visibility: 'visible' | 'none'): void {
        const map = this.map;
        if (!map || this.destroyed) return;
        for (const layer of REPLAY_HIDDEN_LAYERS) {
            try {
                if (map.getLayer(layer)) map.setLayoutProperty(layer, 'visibility', visibility);
            } catch {
                // 样式切换 / 销毁中忽略
            }
        }
    }

    /** 当前绘制进度对应的第一视角镜头：朝行进方向、稍微看向前方 */
    private replayCameraTarget(progress: number, now: number): { center: [number, number]; bearing: number; zoom: number; pitch: number } | null {
        const route = this.replayRoute;
        if (!route) return null;
        const headDistance = Math.min(route.cameraTotal, Math.max(0, progress * route.cameraTotal));
        const center = this.replayCameraPointAtDistance(headDistance + REPLAY_CENTER_AHEAD_METERS) ?? this.replayCameraPointAtDistance(headDistance);
        if (!center) return null;

        // 用较长的前后窗口估算方向，再按时间做低通；GPS 的厘米级抖动不会直接传到镜头上
        const from = this.replayCameraPointAtDistance(Math.max(0, headDistance - REPLAY_HEADING_BEHIND_METERS));
        const to = this.replayCameraPointAtDistance(Math.min(route.cameraTotal, headDistance + REPLAY_HEADING_AHEAD_METERS));
        let bearing = this.replayBearing;
        if (from && to && distanceMeters(from, to) > 1) {
            const target = bearingBetween(from, to);
            if (bearing === null) {
                bearing = target;
            } else {
                const delta = ((target - bearing + 540) % 360) - 180;
                if (Math.abs(delta) > 0.3) {
                    const dt = Math.min(120, Math.max(0, now - this.replayLastFrame));
                    const alpha = 1 - Math.exp(-dt / REPLAY_BEARING_TAU_MS);
                    const maxStep = Math.min(REPLAY_MAX_TURN_PER_FRAME, (dt / 16.67) * REPLAY_MAX_TURN_PER_FRAME);
                    const step = Math.max(-maxStep, Math.min(maxStep, delta * alpha));
                    bearing = (bearing + step + 360) % 360;
                }
            }
            this.replayBearing = bearing;
        }
        this.replayLastFrame = now;
        return { center, bearing: bearing ?? 0, zoom: REPLAY_ZOOM, pitch: REPLAY_PITCH };
    }

    /** 把保存的全局 3D 镜头和当前第一视角按缓动混合，进入 / 跟随都走这里 */
    private applyReplayCamera(progress: number, introFraction: number, now: number): void {
        const map = this.map;
        const saved = this.replaySavedCamera;
        if (!map || !saved) return;
        const target = this.replayCameraTarget(progress, now);
        if (!target) return;
        const amount = easeInOutCubic(Math.min(1, Math.max(0, introFraction)));
        const center: [number, number] = [
            saved.center[0] + (target.center[0] - saved.center[0]) * amount,
            saved.center[1] + (target.center[1] - saved.center[1]) * amount
        ];
        const bearing = lerpAngle(saved.bearing, target.bearing, amount);
        map.jumpTo({
            center,
            zoom: saved.zoom + (target.zoom - saved.zoom) * amount,
            bearing,
            pitch: saved.pitch + (target.pitch - saved.pitch) * amount
        });
    }

    private startReplay(): void {
        const map = this.map;
        const data = this.data;
        const scope = this.scope;
        if (this.destroyed || this.replaying || !map || !data || !this.styleReady || scope.kind !== 'record') return;

        const feature = data.collection.features.find((item) => item.properties.id === scope.id);
        const source = feature?.geometry.coordinates;
        if (!feature || !source || source.length < 2) return;

        const coordinates: Array<[number, number]> = source.map(([lng, lat]) => [lng, lat]);
        const cumulative = [0];
        for (let index = 1; index < coordinates.length; index += 1) {
            cumulative.push(cumulative[index - 1] + distanceMeters(coordinates[index - 1], coordinates[index]));
        }
        const total = cumulative[cumulative.length - 1];
        if (!(total > 0)) return;

        // 镜头单独走一条轻度平滑的轨迹：高差大时 GPS 的小折线不会直接让画面左右抖
        const cameraCoordinates = smoothCoordinates(coordinates, 3);
        const cameraCumulative = [0];
        for (let index = 1; index < cameraCoordinates.length; index += 1) {
            cameraCumulative.push(cameraCumulative[index - 1] + distanceMeters(cameraCoordinates[index - 1], cameraCoordinates[index]));
        }
        const cameraTotal = cameraCumulative[cameraCumulative.length - 1];

        this.stopAutoRotate();
        if (this.rotateResumeTimer !== null) {
            clearTimeout(this.rotateResumeTimer);
            this.rotateResumeTimer = null;
        }

        // 保存进入前的全局视角；减少动态效果时不做镜头运动，只把路线完整显示一下
        const animateCamera = !this.reducedMotion;
        const center = map.getCenter();
        this.replaySavedCamera = animateCamera
            ? { center: [center.lng, center.lat], zoom: map.getZoom(), bearing: map.getBearing(), pitch: map.getPitch() }
            : null;
        this.replayBearing = null;

        this.replaying = true;
        this.replayPlaying = true;
        this.replayProgress = 0;
        this.replayIntroElapsed = 0;
        this.replayRoute = {
            coordinates,
            cumulative,
            total,
            color: feature.properties.color,
            cameraCoordinates,
            cameraCumulative,
            cameraTotal: cameraTotal > 0 ? cameraTotal : total
        };
        this.setRouteLayersVisibility('none');

        try {
            map.addSource(REPLAY_SOURCE, {
                type: 'geojson',
                lineMetrics: true,
                data: { type: 'Feature', properties: { color: feature.properties.color }, geometry: { type: 'LineString', coordinates } }
            });
            map.addSource(REPLAY_HEAD_SOURCE, {
                type: 'geojson',
                data: { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: coordinates[0] } }
            });
            const gradient = replayGradient(feature.properties.color, 0.0004);
            map.addLayer({
                id: REPLAY_GLOW_LAYER,
                type: 'line',
                source: REPLAY_SOURCE,
                layout: { 'line-join': 'round', 'line-cap': 'round' },
                paint: {
                    'line-width': ['interpolate', ['linear'], ['zoom'], 3, 6.5, 8, 7, 15, 8],
                    'line-opacity': 0.22,
                    'line-blur': 1.5,
                    'line-gradient': gradient
                }
            } as mapboxgl.LineLayerSpecification);
            map.addLayer({
                id: REPLAY_LAYER,
                type: 'line',
                source: REPLAY_SOURCE,
                layout: { 'line-join': 'round', 'line-cap': 'round' },
                paint: {
                    'line-width': ['interpolate', ['linear'], ['zoom'], 3, 2.8, 8, 3.2, 15, 3.6],
                    'line-opacity': 0.96,
                    'line-gradient': gradient
                }
            } as mapboxgl.LineLayerSpecification);
            map.addLayer({
                id: REPLAY_HEAD_LAYER,
                type: 'circle',
                source: REPLAY_HEAD_SOURCE,
                paint: {
                    'circle-radius': 4.4,
                    'circle-color': '#ffffff',
                    'circle-stroke-width': 2.4,
                    'circle-stroke-color': feature.properties.color,
                    'circle-pitch-alignment': 'map',
                    'circle-pitch-scale': 'map'
                }
            } as mapboxgl.CircleLayerSpecification);
        } catch {
            this.stopReplay(false);
            return;
        }

        this.options.onReplayChange?.(true);

        // 第一视角的速度按轨迹长度调整：短距离不拖沓，长距离也有时间看路（4s ~ 14s）
        const duration = animateCamera ? Math.round(Math.min(14000, Math.max(4000, 2600 + (total / 1000) * 620))) : 0;
        this.replayDuration = duration;
        if (!duration) {
            this.replayPlaying = false;
            this.replayProgress = 1;
            this.setReplayProgress(1);
            this.options.onReplayPlayback?.(false);
            this.emitReplayProgress(1, true);
            this.replayFinishTimer = setTimeout(() => {
                this.replayFinishTimer = null;
                this.stopReplay(false);
            }, 950);
            return;
        }

        this.replayStart = performance.now();
        this.replayResumeAt = this.replayStart;
        this.replayLastFrame = this.replayStart;
        this.options.onReplayPlayback?.(true);
        this.setReplayProgress(0.0004);
        this.applyReplayCamera(0.0004, 0, this.replayStart);
        this.emitReplayProgress(0, true);
        this.replayFrame = requestAnimationFrame(this.replayStep);
    }

    private replayStep = (now: number): void => {
        this.replayFrame = null;
        if (!this.replaying || !this.replayRoute) return;
        const elapsed = this.replayDuration > 0 ? (now - this.replayStart) / this.replayDuration : 1;
        const progress = Math.min(1, Math.max(0.0004, elapsed));
        this.replayProgress = progress;
        this.setReplayProgress(progress);
        const intro = Math.min(1, this.replayIntroElapsed + (now - this.replayResumeAt) / REPLAY_INTRO_MS);
        this.applyReplayCamera(progress, intro, now);
        this.emitReplayProgress(progress);
        if (elapsed < 1) {
            this.replayFrame = requestAnimationFrame(this.replayStep);
            return;
        }
        // 画完后停留半秒，让整条路线完整显示，再缓动回原来的全局视角
        this.replayPlaying = false;
        this.options.onReplayPlayback?.(false);
        this.emitReplayProgress(1, true);
        this.replayFinishTimer = setTimeout(() => {
            this.replayFinishTimer = null;
            this.stopReplay(true);
        }, 560);
    };

    private setReplayProgress(progress: number): void {
        const map = this.map;
        const route = this.replayRoute;
        if (!map || !route || this.destroyed) return;
        const value = Math.min(1, Math.max(0.0004, progress));
        const gradient = replayGradient(route.color, value);
        for (const layer of [REPLAY_GLOW_LAYER, REPLAY_LAYER]) {
            try {
                if (map.getLayer(layer)) map.setPaintProperty(layer, 'line-gradient', gradient);
            } catch {
                // 样式切换中忽略
            }
        }
        const point = this.replayPointAt(value);
        const head = map.getSource(REPLAY_HEAD_SOURCE) as unknown as { setData?: (data: GeoJSON.GeoJSON) => void } | undefined;
        if (point && head?.setData) {
            head.setData({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: point } });
        }
    }

    /** 按累计距离取当前应画到的坐标，让移动的圆点和线头保持同步 */
    private replayPointAt(progress: number): [number, number] | null {
        const route = this.replayRoute;
        if (!route) return null;
        return this.replayPointAtDistance(route.total * progress);
    }

    private replayPointAtDistance(distance: number): [number, number] | null {
        const route = this.replayRoute;
        if (!route) return null;
        return this.pointAtDistance(route.coordinates, route.cumulative, route.total, distance);
    }

    private replayCameraPointAtDistance(distance: number): [number, number] | null {
        const route = this.replayRoute;
        if (!route) return null;
        return this.pointAtDistance(route.cameraCoordinates, route.cameraCumulative, route.cameraTotal, distance);
    }

    private pointAtDistance(coordinates: Array<[number, number]>, cumulative: number[], total: number, distance: number): [number, number] | null {
        if (!coordinates.length) return null;
        const target = Math.min(total, Math.max(0, distance));
        let low = 0;
        let high = cumulative.length - 1;
        while (low < high) {
            const mid = (low + high) >> 1;
            if (cumulative[mid] < target) low = mid + 1;
            else high = mid;
        }
        const index = Math.max(1, low);
        const from = cumulative[index - 1];
        const to = cumulative[index];
        const ratio = to > from ? (target - from) / (to - from) : 0;
        const start = coordinates[index - 1];
        const end = coordinates[index];
        return [start[0] + (end[0] - start[0]) * ratio, start[1] + (end[1] - start[1]) * ratio];
    }

    /* ------------------------------ 同步逻辑 ------------------------------ */

    /** 样式 / 数据任一就绪后调用：幂等，负责补图层、补过滤、补首次视野 */
    private sync(): void {
        if (this.destroyed || !this.map || !this.data) return;
        try {
            this.setPrivacyMode(this.shouldUsePrivacy());
            this.ensureLayers();
            this.applyFilters();
            if (this.styleReady && !this.didInitialFit) {
                this.didInitialFit = true;
                this.focusOnScope(false);
            }
            this.updateStatus();
            this.updateReplayAvailability();
        } catch {
            // 样式切换 / 销毁过程中地图可能短暂不可写，忽略这一次同步
        }
    }

    private ensureLayers(): void {
        const map = this.map;
        const data = this.data;
        if (!map || !data || this.destroyed || !this.styleReady) return;

        try {
            if (!map.getSource(SOURCE_ID)) {
                map.addSource(SOURCE_ID, { type: 'geojson', data: data.collection });
            }
            let added = false;
            if (!map.getLayer(LAYER_BASE)) {
                map.addLayer(baseLayerSpecification());
                added = true;
            }
            if (!map.getLayer(LAYER_FOCUS_GLOW)) {
                map.addLayer(focusGlowLayerSpecification());
                added = true;
            }
            if (!map.getLayer(LAYER_FOCUS)) {
                map.addLayer(focusLayerSpecification());
                added = true;
            }
            if (!map.getLayer(LAYER_HALO)) {
                map.addLayer(hoverHaloLayerSpecification());
                added = true;
            }
            if (!map.getLayer(LAYER_HOVER)) {
                map.addLayer(hoverLayerSpecification());
                added = true;
            }
            if (added || !this.layersBound) this.bindLayerEvents();
        } catch {
            // 样式还没稳时 addSource/addLayer 可能失败，下一次 style.load 会再试
        }
    }

    private applyFilters(): void {
        const map = this.map;
        if (!map || this.destroyed || !this.styleReady) return;

        const ids = this.idsInScope(this.scope);
        const focusFilter: mapboxgl.FilterSpecification = ids.length ? ['in', ['get', 'id'], ['literal', ids]] : NO_MATCH;
        const hoverFilter: mapboxgl.FilterSpecification = this.hoverId ? ['==', ['get', 'id'], this.hoverId] : NO_MATCH;

        this.setLayerFilter(LAYER_BASE, this.baseFilter());
        this.setLayerFilter(LAYER_FOCUS_GLOW, focusFilter);
        this.setLayerFilter(LAYER_FOCUS, focusFilter);
        this.setLayerFilter(LAYER_HALO, hoverFilter);
        this.setLayerFilter(LAYER_HOVER, hoverFilter);
    }

    private setLayerFilter(layer: string, filter: mapboxgl.FilterSpecification | null): void {
        const map = this.map;
        if (!map || this.destroyed) return;
        try {
            if (!map.getLayer(layer)) return;
            map.setFilter(layer, filter);
        } catch {
            // 样式切换中忽略
        }
    }

    /** base 层：all / 年月周日显示全部路线做淡淡的底图，单条记录时只显示同月路线作上下文 */
    /* ------------------------------ 3D 视角 ------------------------------ */

    /** 没有可对焦的轨迹时，回到正俯视并停止旋转 */
    private resetCamera(animate: boolean): void {
        this.stopAutoRotate();
        if (this.styleReady) {
            try {
                this.map?.setTerrain(null as unknown as undefined);
            } catch {
                // 忽略
            }
        }
        try {
            this.map?.easeTo({ pitch: 0, bearing: 0, duration: motionDuration(animate ? 500 : 0) });
        } catch {
            // 相机动画失败不影响浏览
        }
    }

    private startAutoRotate(delay: number): void {
        this.stopAutoRotate();
        if (this.rotateResumeTimer !== null) {
            clearTimeout(this.rotateResumeTimer);
            this.rotateResumeTimer = null;
        }
        if (this.destroyed || this.reducedMotion || typeof requestAnimationFrame === 'undefined' || this.replaying) return;
        this.rotateTimer = setTimeout(() => {
            this.rotateTimer = null;
            const step = () => {
                this.rotateFrame = null;
                const map = this.map;
                if (this.destroyed || !map) return;
                if (this.scope.kind === 'record' && !this.dragging) {
                    try {
                        map.setBearing((map.getBearing() + 0.06) % 360);
                    } catch {
                        // 地图销毁过程中的最后几帧，忽略
                    }
                }
                this.rotateFrame = requestAnimationFrame(step);
            };
            this.rotateFrame = requestAnimationFrame(step);
        }, delay);
    }

    private stopAutoRotate(): void {
        if (this.rotateTimer !== null) {
            clearTimeout(this.rotateTimer);
            this.rotateTimer = null;
        }
        if (this.rotateFrame !== null) {
            cancelAnimationFrame(this.rotateFrame);
            this.rotateFrame = null;
        }
    }

    /**
     * 用户一开始操作地图，就先停掉自动旋转，过几秒再恢复。
     * 自动旋转是每帧 setBearing 实现的，而 setBearing 内部会 map.stop()，
     * 如果不停，用户刚按下的拖动会被下一帧取消（表现为地图完全拖不动）。
     */
    private pauseAutoRotate(delay: number): void {
        this.stopAutoRotate();
        if (this.destroyed || this.replaying || this.scope.kind !== 'record') return;
        if (this.rotateResumeTimer !== null) clearTimeout(this.rotateResumeTimer);
        this.rotateResumeTimer = setTimeout(() => {
            this.rotateResumeTimer = null;
            if (!this.destroyed && !this.replaying && this.scope.kind === 'record') this.startAutoRotate(0);
        }, delay);
    }

    private handleUserInteract = (): void => {
        if (this.destroyed) return;
        this.pauseAutoRotate(ROTATE_PAUSE_MS);
    };

    /* ------------------------------ 隐私 / 地形 ------------------------------ */

    /** 当前范围里的记录是否来自需要隐私过滤的城市（优先看名称，没有名称就按轨迹范围判断） */
    private shouldUsePrivacy(): boolean {
        if (!PRIVACY_CITIES.length) return false;
        const bounds = this.data?.bounds;
        const scoped = recordsInScope(this.options.records, this.scope);
        return scoped.some((record) => {
            if (PRIVACY_CITIES.some((city) => record.location.includes(city.name))) return true;
            const box = bounds?.get(record.id);
            if (!box) return false;
            return PRIVACY_CITIES.some((city) => {
                const [minLng, minLat] = box[0];
                const [maxLng, maxLat] = box[1];
                return maxLng >= city.bounds[0] && minLng <= city.bounds[2] && maxLat >= city.bounds[1] && minLat <= city.bounds[3];
            });
        });
    }

    private setPrivacyMode(enabled: boolean): void {
        if (enabled === this.privacyEnabled) return;
        this.privacyEnabled = enabled;
        this.applyPrivacyLayers();
    }

    /** 隐私模式下隐藏文字标签、道路、门牌、POI 与建筑，只保留地形/水系和轨迹 */
    private applyPrivacyLayers(): void {
        const map = this.map;
        if (!map || this.destroyed || !this.styleReady) return;
        const layers = map.getStyle()?.layers ?? [];
        for (const layer of layers) {
            if (layer.id.startsWith('ex-')) continue;
            const hidden =
                this.privacyEnabled &&
                (layer.type === 'symbol' || layer.type === 'fill-extrusion' || /road|street|bridge|tunnel|building|housenum|poi/i.test(layer.id));
            try {
                map.setLayoutProperty(layer.id, 'visibility', hidden ? 'none' : 'visible');
            } catch {
                // 个别图层不支持 visibility，忽略
            }
        }
    }

    /** 单条轨迹时开启 3D 地形，其余范围恢复平面 */
    private applyTerrain(): void {
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
            const enabled = this.scope.kind === 'record';
            map.setLayoutProperty(HILLSHADE_LAYER, 'visibility', enabled ? 'visible' : 'none');
            map.setTerrain(enabled ? { source: DEM_SOURCE, exaggeration: 1.4 } : (null as unknown as undefined));
        } catch {
            // 样式不支持地形时退化为纯俯仰视角
        }
    }

    private baseFilter(): mapboxgl.FilterSpecification | null {
        const scope = this.scope;
        if (scope.kind !== 'record') return null;
        const record = this.options.records.find((item) => item.id === scope.id);
        if (!record) return null;
        return ['==', ['get', 'month'], record.month];
    }

    /** 把视野对到 scope 内的轨迹上；没有轨迹时退回到「该月 / 该年」的轨迹，再没有就保持原视野 */
    private focusOnScope(animate: boolean): void {
        const data = this.data;
        if (!data) return;

        const ids = this.idsInScope(this.scope);
        const target = ids.length ? ids : this.contextIds(this.scope);
        if (!target.length) {
            this.resetCamera(animate);
            return;
        }

        const maxZoom = ids.length ? 15 : 13;
        const duration = motionDuration(animate ? 700 : 0);

        if (!this.hasSize()) {
            this.pendingFit = { ids: target, duration, maxZoom };
            return;
        }
        // 旋转是靠每帧 setBearing 实现的，而 setBearing 会取消进行中的相机动画（fitBounds 就白做了），
        // 所以每次重新取景前先停旋转，等镜头落位后再继续。
        this.stopAutoRotate();
        this.applyTerrain();
        this.fitTo(target, duration, maxZoom);
        if (this.scope.kind === 'record') this.startAutoRotate(duration + 180);
    }

    private fitTo(ids: string[], duration: number, maxZoom: number): void {
        const map = this.map;
        const data = this.data;
        if (!map || !data) return;

        const bounds = this.boundsFor(ids);
        if (!bounds) return;

        // 单条轨迹用 3D 俯仰视角，fitBounds 时就把 pitch 算进去，避免先平视 fit 再抬角度把路线挤出画面
        const pitched = this.scope.kind === 'record';
        const base = pitched ? { top: 44, bottom: 52, left: 40, right: 40 } : { top: 18, bottom: 28, left: 18, right: 18 };
        // 吸顶时地图容器保持完整高度、外面只做居中裁切：把裁掉的上下部分补进 padding，
        // 这样路线仍然完整落在可见区域里，而不是贴着被裁掉的边缘。
        const fullHeight = this.options.container.clientHeight;
        const visibleHeight = this.options.viewport?.clientHeight ?? fullHeight;
        const crop = visibleHeight > 0 && visibleHeight < fullHeight ? Math.round((fullHeight - visibleHeight) / 2) : 0;
        const padding = { top: base.top + crop, bottom: base.bottom + crop, left: base.left, right: base.right };
        try {
            // 底部多留一点：Mapbox logo / attribution / 提示条都在下沿，避免压住路线
            map.fitBounds(bounds, { padding, duration, maxZoom, pitch: pitched ? 50 : 0, bearing: 0 });
        } catch {
            // 容器尺寸异常时 fitBounds 可能抛错，忽略即可
        }
    }

    private boundsFor(ids: string[]): Bounds | null {
        const data = this.data;
        if (!data) return null;

        let minLng = Number.POSITIVE_INFINITY;
        let minLat = Number.POSITIVE_INFINITY;
        let maxLng = Number.NEGATIVE_INFINITY;
        let maxLat = Number.NEGATIVE_INFINITY;
        let found = false;

        for (const id of ids) {
            const box = data.bounds.get(id);
            if (!box) continue;
            found = true;
            minLng = Math.min(minLng, box[0][0]);
            minLat = Math.min(minLat, box[0][1]);
            maxLng = Math.max(maxLng, box[1][0]);
            maxLat = Math.max(maxLat, box[1][1]);
        }

        return found
            ? [
                  [minLng, minLat],
                  [maxLng, maxLat]
              ]
            : null;
    }

    /** scope 内（且有轨迹的）记录 id */
    private idsInScope(scope: ExerciseScope): string[] {
        const data = this.data;
        if (!data) return [];
        const ids: string[] = [];
        for (const record of recordsInScope(this.options.records, scope)) {
            if (data.ids.has(record.id)) ids.push(record.id);
        }
        return ids;
    }

    /** scope 没有轨迹时的上下文范围：单条记录 -> 同月，周/日 -> 当月，年 -> 全年 */
    private contextIds(scope: ExerciseScope): string[] {
        const data = this.data;
        if (!data) return [];

        let month: string | null = null;
        let year: number | null = null;

        if (scope.kind === 'record') {
            const record = this.options.records.find((item) => item.id === scope.id);
            month = record ? record.month : null;
        } else if (scope.kind === 'week' || scope.kind === 'day') {
            month = scope.date.slice(0, 7);
        } else if (scope.kind === 'year') {
            year = scope.year;
        }
        if (month === null && year === null) return [];

        const ids: string[] = [];
        for (const record of this.options.records) {
            if (!data.ids.has(record.id)) continue;
            if (month !== null && record.month !== month) continue;
            if (year !== null && record.year !== year) continue;
            ids.push(record.id);
        }
        return ids;
    }

    /* ------------------------------ 状态提示 ------------------------------ */

    private updateStatus(): void {
        if (this.destroyed || this.unavailable || !this.data) return;

        let message: string | null = null;
        if (this.data.ids.size === 0 || this.idsInScope(this.scope).length === 0) {
            message = this.scope.kind === 'record' ? '该记录没有轨迹' : '这段时间没有轨迹';
        }
        this.emit(message);
    }

    private emit(message: string | null): void {
        const signature = `${this.unavailable ? 'unavailable' : 'ready'}:${message ?? ''}`;
        if (signature === this.statusSignature) return;
        this.statusSignature = signature;
        this.options.onStatus({ message, unavailable: this.unavailable });
    }

    private fail(): void {
        if (this.destroyed) return;
        this.unavailable = true;
        this.emit('地图暂时不可用');
    }

    /* ------------------------------ 主题 / 尺寸 ------------------------------ */

    private observeTheme(): void {
        if (typeof MutationObserver === 'undefined') return;
        this.themeObserver = new MutationObserver(() => this.applyTheme());
        this.themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme'] });
    }

    private applyTheme(): void {
        if (this.destroyed) return;
        const next = readTheme();
        if (next === this.theme) return;
        this.theme = next;

        const map = this.map;
        if (!map) return;

        // setStyle 会清掉所有 source / layer，style.load 之后由 sync() 重新加回来
        this.styleReady = false;
        this.layersBound = false;
        try {
            map.setStyle(MAP_STYLES[next]);
        } catch {
            // 样式切换失败就保持现状，下一次主题变化再试
        }
    }

    private observeSize(): void {
        if (typeof ResizeObserver === 'undefined') return;
        this.resizeObserver = new ResizeObserver(() => this.handleResize());
        this.resizeObserver.observe(this.options.container);
    }

    private handleResize = (): void => {
        if (this.destroyed || !this.map) return;
        if (!this.hasSize()) {
            // 移动端 / 桌面端各挂一个实例，隐藏的那个宽度为 0，等可见后再处理
            this.sizeWasZero = true;
            return;
        }
        try {
            this.map.resize();
        } catch {
            return;
        }
        if (!this.sizeWasZero) return;
        this.sizeWasZero = false;
        const pending = this.pendingFit;
        if (!pending) return;
        this.pendingFit = null;
        this.stopAutoRotate();
        this.fitTo(pending.ids, pending.duration, pending.maxZoom);
        if (this.scope.kind === 'record') this.startAutoRotate(pending.duration + 180);
    };

    private hasSize(): boolean {
        const container = this.options.container;
        return container.clientWidth > 2 && container.clientHeight > 2;
    }

    /* ------------------------------ 交互 ------------------------------ */

    private bindLayerEvents(): void {
        const map = this.map;
        if (!map) return;
        for (const layer of ROUTE_LAYERS) {
            if (!map.getLayer(layer)) continue;
            map.off('click', layer, this.handleLayerClick);
            map.off('mouseenter', layer, this.handleLayerEnter);
            map.off('mouseleave', layer, this.handleLayerLeave);
            map.on('click', layer, this.handleLayerClick);
            map.on('mouseenter', layer, this.handleLayerEnter);
            map.on('mouseleave', layer, this.handleLayerLeave);
        }
        this.layersBound = true;
    }

    private handleLayerClick = (event: mapboxgl.MapLayerMouseEvent): void => {
        if (this.destroyed) return;
        const id = event.features?.[0]?.properties?.id;
        if (id === undefined || id === null) return;
        this.options.onSelectRoute(String(id));
    };

    private handleLayerEnter = (): void => {
        if (this.destroyed || !this.map) return;
        if (this.dragging) return;
        this.map.getCanvas().style.cursor = 'pointer';
    };

    private handleLayerLeave = (): void => {
        if (this.destroyed || !this.map) return;
        this.map.getCanvas().style.cursor = '';
    };

    private handleDragStart = (): void => {
        this.dragging = true;
    };

    private handleDragEnd = (): void => {
        this.dragging = false;
    };

    private handleStyleLoad = (): void => {
        if (this.destroyed || !this.map) return;
        this.styleReady = true;
        this.layersBound = false;
        // 浅色/深色底图自带的大气雾在俯仰视角下会在画面底部糊出一层白雾，关掉后 3D 视角才干净
        try {
            this.map.setFog(null as unknown as undefined);
        } catch {
            // 样式没有 fog 配置时忽略
        }
        if (this.readyTimer !== null) {
            clearTimeout(this.readyTimer);
            this.readyTimer = null;
        }
        // 之前因为「样式迟迟没加载」而提示不可用的，现在样式好了就恢复正常
        if (this.unavailable && this.data) this.unavailable = false;
        // 换主题会重建 source / layer：重播中的自定义图层一并清掉，并回到进入前的镜头
        if (this.replaying) this.stopReplay(true);
        this.sync();
        this.applyPrivacyLayers();
        this.applyTerrain();
    };

    private handleMapError = (): void => {
        // 初次样式加载失败（token 无效 / 网络不通）才提示为不可用；之后的瓦片错误不打扰用户
        if (this.destroyed || this.styleReady) return;
        this.fail();
    };
}

export function createExerciseMap(options: ExerciseMapOptions): ExerciseMapController {
    return new ExerciseMapInstance(options);
}
