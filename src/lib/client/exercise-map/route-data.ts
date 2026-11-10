/* 轨迹数据：解码、包围盒与按需加载（模块级缓存） */
import type { ExerciseRecord } from '../../exercise';
import { SPORT_META, decodeRoute } from '../../exercise';
import { MIN_BOUNDS_SPAN } from './constants';
import type { Bounds, RouteData, RouteFeatureProperties } from './types';

/** url -> 轨迹数据（成功和失败都缓存：只请求一次，失败也不反复重试） */
export const routeCache = new Map<string, Promise<RouteData>>();

export function boundsOfCoordinates(coordinates: Array<[number, number]>): Bounds {
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

export function buildRouteData(raw: Record<string, string>, records: ExerciseRecord[]): RouteData {
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

export function loadRoutes(url: string, records: ExerciseRecord[]): Promise<RouteData> {
    const cached = routeCache.get(url);
    if (cached) return cached;

    const request = fetch(url)
        .then((response) => {
            if (!response.ok) throw new Error(`轨迹数据请求失败：${response.status}`);
            return response.json() as Promise<Record<string, string>>;
        })
        .then((raw) => buildRouteData(raw ?? {}, records));

    routeCache.set(url, request);
    // 失败时移出缓存，下次挂载还能重试
    request.catch(() => {
        if (routeCache.get(url) === request) routeCache.delete(url);
    });
    return request;
}
