/**
 * modureader 阅读汇总 → src/data/reading.json（阅读页、时间线阅读卡片）。
 *
 * 数据源在用户自己的 WebDAV（modu/record-log-v1 分片库），拉取/合并/清洗全部沿用
 * scripts/sync-reading.mjs 的 syncReading —— 本轮只把它接进模块层，不重写逻辑，
 * 因此 `scripts/sync-reading.mjs` 仍导出 syncReading（既有调用不必改）。
 *
 * optional: true 是硬要求：WebDAV 打盹不能把整轮同步/发布拖下水，失败只告警并保留旧文件。
 *
 * 封面：syncReading 会把封面压到 src/assets/reading-cover/<key>.webp，页面用 import.meta.glob 消费
 * （前端契约）。执行器的附属产物通道只支持 public/，改成 public 会打断前端，因此这里保留原目录：
 * 不新增写盘机制，只是沿用既有封面路径。
 */
export const meta = {
    id: 'reading',
    optional: true,
    credentials: ['MODU_WEBDAV_URL'],
    optionalCredentials: ['MODU_WEBDAV_USER', 'MODU_WEBDAV_PASS'],
    // WebDAV 基本认证；跨源跳转时由执行器剥掉
    sensitiveHeaders: ['authorization'],
    datasets: ['reading.digest'],
    datasetVersions: { 'reading.digest': 1 },
    description: '每日阅读汇总（modureader WebDAV 分片库），可选源'
};

export async function collect(ctx) {
    const { syncReading } = await import('../../sync-reading.mjs');
    const data = await syncReading(ctx.env, { projectRoot: ctx.projectRoot, log: ctx.log.log });
    return { outputs: [{ dataset: 'reading.digest', data, complete: true }] };
}
