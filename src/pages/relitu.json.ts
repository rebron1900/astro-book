import type { APIRoute } from 'astro';
import { timelineVisible } from '../api/store';
import { buildRelituPayload } from '../lib/relitu';

/**
 * 内容热力图的悬浮提示数据：全站一份，浏览器缓存。
 * 页面里只留空格子（日期 + 条数），提示 HTML 在悬浮时按这份数据现拼。
 */
export const GET: APIRoute = () => {
    const body = JSON.stringify(buildRelituPayload(timelineVisible as any));
    return new Response(body, {
        headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'public, max-age=600'
        }
    });
};