/**
 * 友链/排名服务 → src/data/rank.json（任意 JSON 对象，页面自己解释字段）。
 *
 * 迁移自 scripts/sync-data.mjs 的 syncRank。**optional: true 是硬要求**：远端 worker 打盹在迁移前
 * 只告警、退出码 0，标成非可选会让一次网络抖动变成整轮同步失败。
 *
 * 失败语义保持原样：取不到就只告警，并且不覆盖已有 rank.json（旧实现是返回 null 交给 writeJson
 * 的空数据保护；这里直接复用上一版，效果相同且不会写 null）。
 */
export const meta = {
    id: 'rank',
    optional: true,
    credentials: [],
    optionalCredentials: [],
    datasets: ['rank.status'],
    datasetVersions: { 'rank.status': 1 },
    description: '远端排名/状态 JSON（结构由上游决定，未声明字段一律放行）'
};

const RANK_URL = 'https://divine-cell-831a.me-d1b.workers.dev/';

export async function collect(ctx) {
    try {
        const data = await ctx.fetchJson(RANK_URL, {}, 10000);
        return { outputs: [{ dataset: 'rank.status', data, complete: true }] };
    } catch (error) {
        ctx.log.warn(`[rank] 获取失败: ${error.message}`);
        const previous = ctx.previous('rank.status');
        if (previous) {
            // 复用上一版：执行器会判定「无变化」而不写盘
            return { outputs: [{ dataset: 'rank.status', data: previous, complete: true }] };
        }
        throw new Error(`[rank] 获取失败且没有可复用的旧数据: ${error.message}`);
    }
}
