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
 * 具体实现拆在同目录：
 * - `exercise-map/constants.ts` 常量与图层 id
 * - `exercise-map/types.ts`     公开类型与内部数据结构
 * - `exercise-map/route-data.ts` 轨迹解码 / 包围盒 / 加载
 * - `exercise-map/geometry.ts`  几何与动画数学
 * - `exercise-map/layers.ts`    路线图层样式
 *
 * SSR 安全：模块顶层只声明常量与函数，不访问 window / document；
 * 只有 createExerciseMap() 被调用（Solid 的 onMount）之后才会操作 DOM 与地图。
 */
import mapboxgl from 'mapbox-gl/dist/mapbox-gl.js';
import MapboxLanguage from '@mapbox/mapbox-gl-language';
import 'mapbox-gl/dist/mapbox-gl.css';

import type { ExerciseScope } from '../exercise';
import { recordsInScope, scopeKey } from '../exercise';

import {
    DEM_SOURCE,
    HILLSHADE_LAYER,
    INITIAL_CENTER,
    INITIAL_ZOOM,
    LAYER_BASE,
    LAYER_FOCUS,
    LAYER_FOCUS_GLOW,
    LAYER_HALO,
    LAYER_HOVER,
    MAP_STYLES,
    MIN_BOUNDS_SPAN,
    NO_MATCH,
    PRIVACY_CITIES,
    REPLAY_BEARING_TAU_MS,
    REPLAY_CENTER_AHEAD_METERS,
    REPLAY_GLOW_LAYER,
    REPLAY_HEAD_LAYER,
    REPLAY_HEADING_AHEAD_METERS,
    REPLAY_HEADING_BEHIND_METERS,
    REPLAY_HEAD_SOURCE,
    REPLAY_HIDDEN_LAYERS,
    REPLAY_INTRO_MS,
    REPLAY_LAYER,
    REPLAY_MAX_TURN_PER_FRAME,
    REPLAY_OUTRO_MS,
    REPLAY_PITCH,
    REPLAY_SOURCE,
    REPLAY_TRANSPARENT,
    REPLAY_ZOOM,
    ROTATE_DEG_PER_MS,
    ROTATE_PAUSE_MS,
    ROTATE_RESUME_AFTER_REPLAY_MS,
    ROTATE_STEP_MS,
    ROUTE_LAYERS,
    SOURCE_ID
} from './exercise-map/constants';
import type { MapTheme } from './exercise-map/constants';
import type { Bounds, ExerciseMapController, ExerciseMapOptions, ExerciseMapStatus, PendingFit, RouteData } from './exercise-map/types';
import { loadRoutes } from './exercise-map/route-data';
import {
    bearingBetween,
    distanceMeters,
    easeInOutCubic,
    lerpAngle,
    motionDuration,
    readTheme,
    replayGradient,
    smoothCoordinates
} from './exercise-map/geometry';
import {
    baseLayerSpecification,
    focusGlowLayerSpecification,
    focusLayerSpecification,
    hoverHaloLayerSpecification,
    hoverLayerSpecification
} from './exercise-map/layers';

export type { ExerciseMapController, ExerciseMapOptions, ExerciseMapStatus } from './exercise-map/types';
export { PRIVACY_CITIES } from './exercise-map/constants';


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
    /** 上一次真正改 bearing 的时间戳：旋转按时间节流，不是每帧都动相机 */
    private rotateLast = 0;
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
            this.rotateLast = 0;
            const step = (now: number) => {
                this.rotateFrame = null;
                const map = this.map;
                if (this.destroyed || !map) return;
                // 每帧 setBearing = 每帧整图重绘；按时间节流，角度按经过时间补偿
                if (this.rotateLast === 0) this.rotateLast = now;
                const elapsed = now - this.rotateLast;
                if (this.scope.kind === 'record' && !this.dragging && elapsed >= ROTATE_STEP_MS) {
                    this.rotateLast = now;
                    try {
                        map.setBearing((map.getBearing() + ROTATE_DEG_PER_MS * elapsed) % 360);
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

    /** 当前范围里的记录是否来自需要隐私过滤的城市（按轨迹范围判断；intervals.icu 不提供城市名） */
    private shouldUsePrivacy(): boolean {
        if (!PRIVACY_CITIES.length) return false;
        const bounds = this.data?.bounds;
        const scoped = recordsInScope(this.options.records, this.scope);
        return scoped.some((record) => {
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
