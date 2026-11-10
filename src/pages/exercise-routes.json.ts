import type { APIRoute } from 'astro';
import activitiesJson from '../data/activities.json';
import type { Activity } from '../lib/activity-types';
import { buildRecords, buildRouteIndex } from '../lib/exercise';

/**
 * 运动页面地图专用的轨迹接口：只包含 { 记录 id: 编码轨迹 }，
 * 页面 HTML 里不内嵌轨迹，地图初始化时再按需拉取一次。
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
