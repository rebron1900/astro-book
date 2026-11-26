/**
 * Emby 观看记录来源模块（模块化试点）。
 *
 * 约定（见 docs/specs/2026-11-26-data-ingest-spec.md）：
 * - 导入无副作用：不读 env、不建目录、不发请求；
 * - 只声明需要什么（meta.credentials），由执行器注入 ctx.env；
 * - 不自行写盘：封面通过 ctx.writeArtifact 写进 meta.artifacts 声明的目录；
 * - 返回 { outputs: [{ dataset: 'emby.viewing', data, complete: true }] }。
 *
 * 取数口径与原 scripts/sync-emby.mjs 保持一致：
 * - 列表接口不返回 LastPlayedDate / PlayCount，所以先挑「已看/有进度」的候选，再逐条取详情；
 * - 剧集评分/简介优先取 Series 的 CommunityRating / Overview；
 * - 封面按「剧=SeriesId、电影=影片 Id」下载到 public/emby-cover/，卡片只引本地路径；
 * - 只输出最近 90 天。
 */
const WINDOW_DAYS = 90;
const FIELDS = 'Overview,RunTimeTicks,CommunityRating,UserData,SeriesName,ParentIndexNumber,IndexNumber,ProductionYear,Genres,ImageTags';
const TICKS_PER_MINUTE = 600_000_000;
const COVER_KEY_PATTERN = /^[A-Za-z0-9_-]+$/;

export const meta = {
    id: 'emby',
    optional: true, // 自建服务打盹时只告警，保留已有 emby.json
    credentials: ['EMBY_BASE_URL', 'EMBY_USER_ID', 'EMBY_API_KEY'],
    // 显式声明：即使将来改头名，跨源跳转时也会被剥掉（通用模式已覆盖，这里是双保险）
    sensitiveHeaders: ['x-emby-token'],
    optionalCredentials: [],
    datasets: ['emby.viewing'],
    datasetVersions: { 'emby.viewing': 1 },
    artifacts: [{ dir: 'public/emby-cover', dataset: 'emby.viewing', description: '封面图，文件名由 Emby 稳定 ID 派生' }],
    description: '自建 Emby 观看记录（最近 90 天）'
};

function clampPercent(value) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
    return Math.min(100, Math.max(0, Math.round(value)));
}

function toMinutes(ticks) {
    if (typeof ticks !== 'number' || !Number.isFinite(ticks) || ticks <= 0) return null;
    return Math.max(1, Math.round(ticks / TICKS_PER_MINUTE));
}

function episodeCode(item) {
    if (item.Type !== 'Episode') return undefined;
    if (typeof item.ParentIndexNumber !== 'number' || typeof item.IndexNumber !== 'number') return undefined;
    return `S${String(item.ParentIndexNumber).padStart(2, '0')}E${String(item.IndexNumber).padStart(2, '0')}`;
}

function movieMeta(item) {
    if (item.Type !== 'Movie') return undefined;
    const parts = [];
    if (typeof item.ProductionYear === 'number') parts.push(String(item.ProductionYear));
    const genre = item.Genres?.[0];
    if (genre) parts.push(genre);
    return parts.length ? parts.join(' · ') : undefined;
}

async function mapLimit(list, limit, worker) {
    const out = [];
    let index = 0;
    async function run() {
        while (index < list.length) {
            const i = index++;
            out[i] = await worker(list[i], i);
        }
    }
    await Promise.all(Array.from({ length: Math.min(limit, list.length) }, run));
    return out;
}

export async function collect(ctx) {
    const base = String(ctx.env.EMBY_BASE_URL || '').replace(/\/+$/, '');
    const userId = String(ctx.env.EMBY_USER_ID || '');
    const key = String(ctx.env.EMBY_API_KEY || '');
    const headers = { 'X-Emby-Token': key, Accept: 'application/json' };

    const get = (urlPath) => ctx.fetchJson(`${base}${urlPath}`, { headers }, 20000);

    // 全量列表只用来拿候选 Id；观看时间必须逐条取详情。
    const list = await get(
        `/Users/${encodeURIComponent(userId)}/Items?Recursive=true&IncludeItemTypes=Movie,Episode&Fields=${encodeURIComponent(FIELDS)}&SortBy=DatePlayed&SortOrder=Descending&ImageTypeLimit=0`
    );
    const candidates = (list.Items || []).filter((item) => item.UserData?.Played || item.UserData?.PlaybackPositionTicks);
    const ids = [...new Set(candidates.map((item) => item.Id))];
    ctx.log(`[emby] 候选 ${ids.length} 条，逐条取观看时间…`);

    const cutoff = Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000;
    const details = (
        await mapLimit(ids, 6, async (id) => {
            try {
                return await get(`/Users/${encodeURIComponent(userId)}/Items/${encodeURIComponent(id)}`);
            } catch (error) {
                ctx.log.warn(`[emby] 详情失败 ${String(id).slice(0, 8)}…: ${error.message}`);
                return null;
            }
        })
    ).filter(Boolean);

    const recent = details.filter((item) => {
        const playedAt = item.UserData?.LastPlayedDate ? new Date(item.UserData.LastPlayedDate).getTime() : NaN;
        return Number.isFinite(playedAt) && playedAt >= cutoff;
    });
    if (!recent.length) {
        ctx.log('[emby] 最近窗口内没有观看记录');
        return { outputs: [{ dataset: 'emby.viewing', data: [], complete: true }] };
    }

    // 剧的评分/简介：分集常常没有，统一按 SeriesId 补一次。
    const seriesIds = [...new Set(recent.filter((item) => item.Type === 'Episode' && item.SeriesId).map((item) => String(item.SeriesId)))];
    const seriesMeta = new Map();
    if (seriesIds.length) {
        const meta = await get(`/Users/${encodeURIComponent(userId)}/Items?Ids=${encodeURIComponent(seriesIds.join(','))}&Fields=Overview,CommunityRating`);
        for (const item of meta.Items || []) {
            seriesMeta.set(String(item.Id), {
                rating: typeof item.CommunityRating === 'number' ? item.CommunityRating : null,
                overview: item.Overview?.trim() || null
            });
        }
    }

    // 封面：剧用 SeriesId，电影用影片 Id；同一张封面只下一次。
    const coverKeys = [...new Set(recent.map((item) => (item.Type === 'Episode' ? item.SeriesId : item.Id)).filter(Boolean).map(String))];
    const coverOk = new Map();
    await mapLimit(coverKeys, 4, async (coverKey) => {
        if (!COVER_KEY_PATTERN.test(coverKey)) {
            ctx.log.warn(`[emby] 跳过非常规 ID 的封面 ${coverKey.slice(0, 8)}…`);
            coverOk.set(coverKey, false);
            return;
        }
        try {
            const result = await ctx.fetchBinary(`${base}/Items/${encodeURIComponent(coverKey)}/Images/Primary?maxWidth=780&quality=90`, { headers: { 'X-Emby-Token': key } }, 20000);
            if (!result.ok) {
                coverOk.set(coverKey, false);
                return;
            }
            const artifact = ctx.writeArtifact(`emby-cover/${coverKey}.jpg`, result.bytes);
            coverOk.set(coverKey, true);
            ctx.log(`[emby] 封面 ${coverKey.slice(0, 8)}… → ${artifact.path}`);
        } catch (error) {
            coverOk.set(coverKey, false);
            ctx.log.warn(`[emby] 封面失败 ${coverKey.slice(0, 8)}…: ${error.message}`);
        }
    });

    const entries = recent.map((item) => {
        const played = Boolean(item.UserData?.Played);
        const lastPlayedAt = item.UserData?.LastPlayedDate ? new Date(item.UserData.LastPlayedDate).getTime() : null;
        const seriesId = item.SeriesId ? String(item.SeriesId) : null;
        const series = seriesId ? seriesMeta.get(seriesId) : null;
        const coverKey = item.Type === 'Episode' ? seriesId : String(item.Id);
        const hasCover = coverKey ? coverOk.get(coverKey) === true : false;
        return {
            id: String(item.Id),
            type: item.Type === 'Episode' ? 'episode' : 'movie',
            title: item.Type === 'Episode' ? item.SeriesName || item.Name : item.Name,
            episodeCode: episodeCode(item),
            episodeTitle: item.Type === 'Episode' ? item.Name : undefined,
            meta: movieMeta(item),
            overview: item.Overview?.trim() || undefined,
            minutes: toMinutes(item.RunTimeTicks),
            rating: typeof item.CommunityRating === 'number' ? item.CommunityRating : null,
            seriesRating: series?.rating ?? null,
            seriesOverview: series?.overview ?? null,
            played,
            playedPercent: played ? 100 : clampPercent(item.UserData?.PlayedPercentage),
            lastPlayedAt,
            imageTag: item.ImageTags?.Primary,
            cover: hasCover ? `/emby-cover/${coverKey}.jpg` : null
        };
    });

    entries.sort((a, b) => (b.lastPlayedAt ?? 0) - (a.lastPlayedAt ?? 0));
    ctx.log(`[emby] 最近 ${WINDOW_DAYS} 天 ${entries.length} 条，封面 ${[...coverOk.values()].filter(Boolean).length} 张`);
    return { outputs: [{ dataset: 'emby.viewing', data: entries, complete: true }] };
}
