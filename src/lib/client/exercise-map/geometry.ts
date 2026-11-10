/* 几何 / 动画数学工具 */
import type { MapTheme } from './constants';
import { REPLAY_TRANSPARENT } from './constants';

/** 站点主题类型存在 localStorage.themetype（'light' | 'dark'），兜底看 html 的 class */
export function readTheme(): MapTheme {
    try {
        const stored = window.localStorage.getItem('themetype');
        if (stored === 'light' || stored === 'dark') return stored;
    } catch {
        // 隐私模式等 localStorage 不可用的场景，直接看 class
    }
    return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
}

/** 视野动画时长；用户开了「减少动态效果」时直接跳过去 */
export function motionDuration(duration: number): number {
    if (!duration) return 0;
    try {
        return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : duration;
    } catch {
        return duration;
    }
}

/** 从 a 到 b 的行进方向（度，正北为 0，顺时针） */
export function bearingBetween(a: [number, number], b: [number, number]): number {
    const rad = Math.PI / 180;
    const dLng = (b[0] - a[0]) * Math.cos(((a[1] + b[1]) / 2) * rad);
    const dLat = b[1] - a[1];
    return (Math.atan2(dLng, dLat) * (180 / Math.PI) + 360) % 360;
}

/** 角度插值：走最短的一边，跨过 0° / 360° 时不会突然转一圈 */
export function lerpAngle(from: number, to: number, amount: number): number {
    const delta = ((to - from + 540) % 360) - 180;
    return (from + delta * amount + 360) % 360;
}

export function easeInOutCubic(value: number): number {
    return value < 0.5 ? 4 * value * value * value : 1 - Math.pow(-2 * value + 2, 3) / 2;
}

/** 给镜头用的轻度平滑轨迹：只压掉 GPS 的横向小抖动，不改绘制用的原始线 */
export function smoothCoordinates(coordinates: Array<[number, number]>, radius: number): Array<[number, number]> {
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
export function distanceMeters(a: [number, number], b: [number, number]): number {
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
export function replayGradient(color: string, progress: number): unknown {
    const stop = Math.min(0.9999, Math.max(0.0004, progress));
    return ['step', ['line-progress'], color, stop, REPLAY_TRANSPARENT];
}
