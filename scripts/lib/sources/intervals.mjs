/**
 * intervals.icu 运动记录 → src/data/activities.json（运动页 / 时间线）。
 *
 * 迁移自 scripts/sync-data.mjs 的 syncIntervals / fetchIntervalsMap，行为逐行保留：
 * 按自然年窗口全量拉活动（limit=500，按 id 去重，达到 500 告警）、
 * 轨迹用上一版 activities.json 做增量缓存（SYNC_FULL 全重拉）、空结果拒写、
 * 单条 /map 失败只计数、ROUTE_CONCURRENCY 并发与上游节流不变，输出按 start_date_local 升序。
 * 映射与排序仍在 src/lib/intervals.ts（未改）。
 */
import { applyRouteCache, pendingRouteIds, polylineFromMap, sortActivities, toActivity, yearWindows } from '../../../src/lib/intervals.ts';

const INTERVALS_BASE = 'https://intervals.icu/api/v1';
// 从这一年开始拉取活动；更早的活动即使账号里有也不会出现在页面上。
const INTERVALS_FIRST_YEAR = 2015;
const INTERVALS_ACTIVITY_FIELDS =
    'id,name,type,sub_type,start_date,start_date_local,distance,moving_time,elapsed_time,average_heartrate,average_speed,total_elevation_gain,source,external_id';
// 地图请求用小并发，避免被上游限流；单个失败只 warn，不中断整次同步。
const ROUTE_CONCURRENCY = 5;

export const meta = {
    id: 'intervals',
    optional: false,
    credentials: ['INTERVALS_ICU_API_KEY'],
    optionalCredentials: ['INTERVALS_ICU_ATHLETE_ID', 'SYNC_FULL'],
    sensitiveHeaders: ['authorization'],
    datasets: ['intervals.activities'],
    datasetVersions: { 'intervals.activities': 1 },
    description: 'intervals.icu 全量活动 + 轨迹增量缓存，按 start_date_local 升序'
};

/** 拉取单个活动的轨迹；返回 { polyline } 或 { error }，两者都没有表示上游确实没有 GPS 数据。 */
async function fetchIntervalsMap(ctx, id, authorization) {
    try {
        const data = await ctx.fetchJson(`${INTERVALS_BASE}/activity/${encodeURIComponent(id)}/map`, { headers: { Authorization: authorization } }, 20000);
        return { polyline: polylineFromMap(data) };
    } catch (error) {
        ctx.log.warn(`[intervals] 活动 ${id} 地图获取失败: ${error.message}`);
        return { error: error.message };
    }
}

export async function collect(ctx) {
    const apiKey = ctx.env.INTERVALS_ICU_API_KEY;
    const athleteId = ctx.env.INTERVALS_ICU_ATHLETE_ID || '0';
    const fullSync = ctx.env.SYNC_FULL === '1';
    const authorization = `Basic ${Buffer.from(`API_KEY:${apiKey}`).toString('base64')}`;

    const rawById = new Map();
    const windowSummary = [];
    let rawTotal = 0;
    const thisYear = new Date().getUTCFullYear();
    for (const { oldest, newest } of yearWindows(INTERVALS_FIRST_YEAR, thisYear)) {
        const params = new URLSearchParams({ oldest, newest, limit: '500', fields: INTERVALS_ACTIVITY_FIELDS });
        const url = `${INTERVALS_BASE}/athlete/${encodeURIComponent(athleteId)}/activities?${params}`;
        const data = await ctx.fetchJson(url, { headers: { Authorization: authorization } }, 30000);
        if (!Array.isArray(data)) throw new Error(`[intervals] ${oldest} ~ ${newest} 返回了非数组活动数据`);
        if (data.length >= 500) ctx.log.warn(`[intervals] ${oldest} ~ ${newest} 达到单次 500 条上限，可能有活动被截断`);
        for (const activity of data) {
            if (activity?.id) rawById.set(String(activity.id), activity);
        }
        rawTotal += data.length;
        windowSummary.push(`${oldest.slice(0, 4)}:${data.length}`);
    }
    // 空结果多半是认证/上游异常：拒绝写入，避免用空数组覆盖线上数据。
    if (rawById.size === 0) throw new Error('[intervals] intervals.icu 返回 0 条活动，拒绝覆盖已有数据');
    ctx.log(`[intervals] 分年拉取 ${windowSummary.join(' ')} → 合计 ${rawTotal} 条，按 id 去重后 ${rawById.size} 条`);
    if (rawTotal !== rawById.size) ctx.log.warn(`[intervals] 分年窗口有 ${rawTotal - rawById.size} 条重复活动（已按 id 去重）`);

    const previous = ctx.previous('intervals.activities');
    const cachedRoutes = new Map(
        (Array.isArray(previous) ? previous : [])
            .filter((item) => item?.id && typeof item.polyline === 'string' && item.polyline.length > 0)
            .map((item) => [String(item.id), item.polyline])
    );
    const activities = applyRouteCache(
        [...rawById.values()].map((activity) => toActivity(activity)),
        cachedRoutes,
        fullSync
    );
    const total = activities.length;
    const reused = activities.filter((activity) => activity.polyline).length;

    const pending = pendingRouteIds(activities);
    const byId = new Map(activities.map((activity) => [activity.id, activity]));
    let fetched = 0;
    let empty = 0;
    let failed = 0;
    for (let index = 0; index < pending.length; index += ROUTE_CONCURRENCY) {
        const batch = pending.slice(index, index + ROUTE_CONCURRENCY);
        const results = await Promise.all(batch.map(async (id) => ({ id, ...(await fetchIntervalsMap(ctx, id, authorization)) })));
        for (const result of results) {
            if (result.polyline) {
                byId.get(result.id).polyline = result.polyline;
                fetched += 1;
            } else if (result.error) {
                failed += 1;
            } else {
                // 上游这条活动本身没有 GPS（室内跑步/器械等），不算失败，下次同步也拉不到。
                empty += 1;
            }
        }
        if (pending.length > ROUTE_CONCURRENCY) ctx.log(`[intervals] 轨迹进度 ${Math.min(index + batch.length, pending.length)}/${pending.length}`);
    }

    const withRoute = activities.filter((activity) => activity.polyline).length;
    ctx.log(
        `[intervals] 活动 ${total} 条（${fullSync ? '全量' : '全量活动 + 增量轨迹'}），复用轨迹 ${reused} 条，新拉轨迹 ${fetched} 条，上游无轨迹 ${empty} 条，失败 ${failed} 条，有轨迹 ${withRoute} 条`
    );
    return { outputs: [{ dataset: 'intervals.activities', data: sortActivities(activities), complete: true }] };
}
