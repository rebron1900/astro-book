/* 运动地图用到的常量与图层 id（原 exercise-map.ts 顶部） */
import type { FilterSpecification } from 'mapbox-gl';

export const SOURCE_ID = 'ex-routes';
export const LAYER_BASE = 'ex-routes-base';
export const LAYER_FOCUS_GLOW = 'ex-routes-focus-glow';
export const LAYER_FOCUS = 'ex-routes-focus';
export const LAYER_HALO = 'ex-routes-hover-halo';
export const LAYER_HOVER = 'ex-routes-hover';

/** 单条轨迹重播：单独的 source / layer，画完后整体移除，不影响正常路线图层 */
export const REPLAY_SOURCE = 'ex-replay';
export const REPLAY_HEAD_SOURCE = 'ex-replay-head';
export const REPLAY_GLOW_LAYER = 'ex-replay-glow';
export const REPLAY_LAYER = 'ex-replay';
export const REPLAY_HEAD_LAYER = 'ex-replay-head';

export const REPLAY_TRANSPARENT = 'rgba(0, 0, 0, 0)';
/** 重播时隐藏的正常路线图层（画完恢复） */
export const REPLAY_HIDDEN_LAYERS = [LAYER_BASE, LAYER_FOCUS_GLOW, LAYER_FOCUS, LAYER_HALO, LAYER_HOVER];

/** 用户操作地图后自动旋转暂停的时长；重播结束后稍晚一点恢复 */
export const ROTATE_PAUSE_MS = 4200;
export const ROTATE_RESUME_AFTER_REPLAY_MS = 1200;

/**
 * 自动旋转的节流参数。
 * 每帧 setBearing 会逼 Mapbox 整张 3D 地形图重绘一次（60 次/秒），
 * 实测把运动页的常驻帧率压到 40 上下；改成每 ROTATE_STEP_MS 转一次、
 * 角度按实际经过时间补，肉眼速度不变（3.6°/s），重绘次数少一半以上。
 */
export const ROTATE_STEP_MS = 40;
/** 每毫秒转多少度：0.06°/帧 @60fps ≈ 3.6°/s */
export const ROTATE_DEG_PER_MS = 0.0036;

/** 第一视角重播：镜头压低、朝行进方向看，并稍微看向前方 */
export const REPLAY_PITCH = 66;
export const REPLAY_ZOOM = 13.6;
/** 镜头中心比绘制点再往前一点，画出来的轨迹落在画面下半部 */
export const REPLAY_CENTER_AHEAD_METERS = 120;
/** 计算镜头朝向时用更长的前后窗口，避免 GPS 小抖动让镜头左右摆 */
export const REPLAY_HEADING_BEHIND_METERS = 80;
export const REPLAY_HEADING_AHEAD_METERS = 160;
/** 朝向低通的等效时间常数，以及单帧最大转角（防止过弯时猛甩） */
export const REPLAY_BEARING_TAU_MS = 700;
export const REPLAY_MAX_TURN_PER_FRAME = 0.5;
export const REPLAY_INTRO_MS = 1100;
export const REPLAY_OUTRO_MS = 1000;

/** 可以点击 / 悬停出 pointer 的路线图层 */
export const ROUTE_LAYERS = [LAYER_BASE, LAYER_FOCUS, LAYER_HOVER];

/** 用不到任何路线的 filter，用来清空某一层（比 setFilter(null) 更符合「保持过滤」的语义） */
export const NO_MATCH: FilterSpecification = ['==', ['get', 'id'], '__ex-map-no-route__'];

/**
 * 需要隐私过滤的城市：命中后地图会隐藏路名、道路、门牌、POI 与建筑等细节。
 * bounds = [minLng, minLat, maxLng, maxLat]，用轨迹范围判断，避免个别记录没有城市字段。
 */
export const PRIVACY_CITIES: Array<{ name: string; bounds: [number, number, number, number] }> = [{ name: '自贡市', bounds: [104.6, 29.2, 105.0, 29.5] }];

/** 3D 地形（单条轨迹视角） */
export const DEM_SOURCE = 'ex-terrain-dem';
export const HILLSHADE_LAYER = 'ex-terrain-hillshade';

export const MAP_STYLES = {
    light: 'mapbox://styles/mapbox/light-v11',
    dark: 'mapbox://styles/mapbox/dark-v11'
} as const;

export type MapTheme = keyof typeof MAP_STYLES;

export const INITIAL_CENTER: [number, number] = [108.14, 33.87];
export const INITIAL_ZOOM = 3.2;

/** 单条轨迹的最小跨度（约 60 米），避免极短轨迹在 fitBounds 时算出极端缩放 */
export const MIN_BOUNDS_SPAN = 0.0006;
