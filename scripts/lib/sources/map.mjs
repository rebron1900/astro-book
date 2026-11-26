/**
 * 足迹 KMZ → src/data/geojson.json（足迹地图标点）。
 *
 * 迁移自 scripts/sync-data.mjs 的 syncMap，行为逐行保留：
 * - If-Modified-Since 基于产物 mtime（这里用 ctx.fileStat，不自己 stat）、304 直接复用本地不写盘；
 * - KMZ 空文件报错；下载失败报错；features 不是数组报错。
 *
 * 转换不再调 python3/C 进程：scripts/map/kmz-to-geojson.mjs 是纯函数版（零依赖），
 * 响应字节直接交给它，因此也不再需要临时目录与清理，写盘仍只由执行器负责。
 */
import { convertKmzToGeojson } from '../../map/kmz-to-geojson.mjs';

export const meta = {
    id: 'map',
    optional: false,
    // KMZ 地址必需：缺了没法同步（执行器按 auth 分类）
    credentials: ['MAP_KMZ_URL'],
    optionalCredentials: ['SYNC_FULL'],
    datasets: ['map.geojson'],
    datasetVersions: { 'map.geojson': 1 },
    description: '足迹 KMZ 转换出的 GeoJSON（FeatureCollection）'
};

export async function collect(ctx) {
    const url = ctx.env.MAP_KMZ_URL;
    const headers = { 'User-Agent': 'astro-book-map-sync' };
    const stat = ctx.fileStat('geojson.json');
    if (ctx.env.SYNC_FULL !== '1' && stat) headers['If-Modified-Since'] = new Date(stat.mtime).toUTCString();

    const response = await ctx.fetchBinary(url, { headers }, 30000);
    if (response.status === 304) {
        const previous = ctx.previous('map.geojson');
        if (previous) {
            ctx.log('[map] 未修改，复用本地 geojson.json');
            return { outputs: [{ dataset: 'map.geojson', data: previous, complete: true }] };
        }
        throw new Error('[map] KMZ 下载失败: HTTP 304');
    }
    // fetchBinary 的 ok 表示「拿到了非空字节」，这里要按旧实现分开判断：先看 HTTP 状态，再看内容是否为空
    if (response.status >= 400) {
        throw new Error(`[map] KMZ 下载失败: HTTP ${response.status}`);
    }
    if (!response.bytes || response.bytes.length === 0) throw new Error('[map] KMZ 文件为空');

    const geojson = convertKmzToGeojson(response.bytes);
    if (!Array.isArray(geojson.features)) throw new Error('[map] 转换结果缺少 features');
    return { outputs: [{ dataset: 'map.geojson', data: geojson, complete: true }] };
}
