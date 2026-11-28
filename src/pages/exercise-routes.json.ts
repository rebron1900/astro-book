import type { APIRoute } from 'astro';
import activitiesJson from '../data/activities.json';
import type { Activity } from '../lib/activity-types';
import { buildRecords, buildRouteIndex } from '../lib/exercise';

/**
 * 运动页面地图专用的轨迹接口：只包含 { 记录 id: 编码轨迹 }，
 * 页面 HTML 里不内嵌轨迹，地图初始化时再按需拉取一次。
 * 轨迹在构建期做 Douglas-Peucker 简化（`ROUTE_SIMPLIFY_TOLERANCE`），
 * 原始轨迹 340KB、每秒一个点，小地图和 3D 回放用不着那个密度。
 */
export const GET: APIRoute = () => {
    const records = buildRecords(activitiesJson as unknown as Activity[]);
    const body = JSON.stringify(buildRouteIndex(records));
    return new Response(body, {
        headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'public, max-age=3600'
        }
    });
};
