import type { APIRoute } from 'astro';
import { loadFootprintData } from '../lib/footprint-data';

/**
 * 足迹模式的数据（标点 + 游记）：不再内嵌进页面 HTML。
 *
 * 足迹是 /activity/ 里默认隐藏的那一栏，它的 SSR 标记有 84KB（34 个省分组、
 * 上百张卡片），首屏根本看不到却要一起下载、解析、建 DOM。现在改成打开足迹时
 * 由页面拉这一次（构建期算好的同一份数据），页面 HTML 里只留骨架。
 */
export const GET: APIRoute = () => {
    const body = JSON.stringify(loadFootprintData());
    return new Response(body, {
        headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'public, max-age=3600'
        }
    });
};
