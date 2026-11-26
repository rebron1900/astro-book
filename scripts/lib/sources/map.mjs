/**
 * 足迹 KMZ → src/data/geojson.json（足迹地图标点）。
 *
 * 迁移自 scripts/sync-data.mjs 的 syncMap，行为逐行保留：
 * - If-Modified-Since 基于产物 mtime（这里用 ctx.fileStat，不自己 stat）、304 直接复用本地不写盘；
 * - KMZ 空文件报错；下载失败报错；
 * - 转换仍调 python3 scripts/map/convert_kmz_to_geojson.py。
 *
 * 与旧实现的唯一差别：转换输出先写系统临时目录，再由执行器统一原子写入 src/data，
 * 这样「执行器是唯一写盘者」成立；临时 KMZ 与临时输出成功失败都会删。
 * 这是本轮唯一允许模块直接用子进程的地方（转换脚本本身是既有能力，不改）。
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CONVERT_SCRIPT = fileURLToPath(new URL('../../../scripts/map/convert_kmz_to_geojson.py', import.meta.url));

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

    const workDir = mkdtempSync(path.join(tmpdir(), 'astro-book-map-'));
    const tempKmz = path.join(workDir, 'input.kmz');
    const tempOut = path.join(workDir, 'output.json');
    try {
        writeFileSync(tempKmz, response.bytes);
        execFileSync(process.env.PYTHON || 'python3', [CONVERT_SCRIPT, tempKmz, tempOut], { stdio: 'inherit' });
        if (!existsSync(tempOut)) throw new Error('[map] 转换脚本没有产出 GeoJSON');
        const geojson = JSON.parse(readFileSync(tempOut, 'utf8'));
        if (!Array.isArray(geojson.features)) throw new Error('[map] 转换结果缺少 features');
        return { outputs: [{ dataset: 'map.geojson', data: geojson, complete: true }] };
    } finally {
        // 临时文件成功失败都要清；清理失败不掩盖原始错误
        rmSync(workDir, { recursive: true, force: true });
    }
}
