#!/usr/bin/env node
/**
 * Emby 观看记录 → 时间线「阅读与影视」数据。
 *
 * 只在 GitHub Actions 的定时同步里跑（不在 Astro 构建时联网）：
 * - 列表接口不返回 LastPlayedDate / PlayCount（4.10 实测全是 0），所以先拿
 *   Items（只挑已看/有播放进度的）+ Resume，再逐条取详情拿真实观看时间；
 * - 剧集评分/简介优先取 Series 的 CommunityRating / Overview（分集常常没有）；
 * - 封面按「剧=SeriesId、电影=影片 Id」下载到 public/emby-cover/，卡片只引本地路径；
 * - 只输出最近 90 天，避免时间线无限长。
 *
 * 服务器地址、用户 Id、密钥全部只从环境变量读（EMBY_BASE_URL / EMBY_USER_ID / EMBY_API_KEY），
 * 仓库里不写死内网域名；三者缺一个就跳过本轮（保留已有 emby.json），不影响其它源。
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const COVER_DIR = path.join(ROOT, 'public', 'emby-cover');
// 由 syncEmby() 从传入的 env 填入（读取 env 参数而不是 process.env，便于测试注入）
let BASE = '';
let USER_ID = '';
const WINDOW_DAYS = 90;
const FIELDS = 'Overview,RunTimeTicks,CommunityRating,UserData,SeriesName,ParentIndexNumber,IndexNumber,ProductionYear,Genres,ImageTags';

const TICKS_PER_MINUTE = 600_000_000;

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

async function embyGet(key, urlPath) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    try {
        const res = await fetch(`${BASE}${urlPath}`, {
            headers: { 'X-Emby-Token': key, Accept: 'application/json' },
            signal: controller.signal
        });
        if (!res.ok) throw new Error(`Emby ${res.status}: ${urlPath.split('?')[0]}`);
        return await res.json();
    } finally {
        clearTimeout(timer);
    }
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

async function downloadCover(key, coverKey) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    try {
        const res = await fetch(`${BASE}/Items/${encodeURIComponent(coverKey)}/Images/Primary?maxWidth=320&quality=85`, {
            headers: { 'X-Emby-Token': key },
            signal: controller.signal
        });
        if (!res.ok) return false;
        const bytes = Buffer.from(await res.arrayBuffer());
        if (!bytes.length) return false;
        mkdirSync(COVER_DIR, { recursive: true });
        writeFileSync(path.join(COVER_DIR, `${coverKey}.jpg`), bytes);
        return true;
    } catch {
        return false;
    } finally {
        clearTimeout(timer);
    }
}

/** 返回可直接写进 src/data/emby.json 的数组；封面写入 public/emby-cover/。 */
export async function syncEmby(env = process.env) {
    const key = env.EMBY_API_KEY;
    if (!key) throw new Error('未设置 EMBY_API_KEY，跳过 Emby 同步（保留已有数据）');
    BASE = (env.EMBY_BASE_URL || '').replace(/\/+$/, '');
    USER_ID = env.EMBY_USER_ID || '';
    if (!BASE || !USER_ID) throw new Error('未设置 EMBY_BASE_URL / EMBY_USER_ID，跳过 Emby 同步（保留已有数据）');

    // 全量列表只用来拿候选 Id；观看时间必须逐条取详情。
    const list = await embyGet(
        key,
        `/Users/${USER_ID}/Items?Recursive=true&IncludeItemTypes=Movie,Episode&Fields=${encodeURIComponent(FIELDS)}&SortBy=DatePlayed&SortOrder=Descending&ImageTypeLimit=0`
    );
    const candidates = (list.Items || []).filter(
        (item) => item.UserData?.Played || item.UserData?.PlaybackPositionTicks
    );
    const ids = [...new Set(candidates.map((item) => item.Id))];
    console.log(`[emby] 候选 ${ids.length} 条，逐条取观看时间…`);

    const cutoff = Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000;
    const details = (
        await mapLimit(ids, 6, async (id) => {
            try {
                return await embyGet(key, `/Users/${USER_ID}/Items/${encodeURIComponent(id)}`);
            } catch (error) {
                console.warn(`[emby] 详情失败 ${id.slice(0, 8)}…: ${error.message}`);
                return null;
            }
        })
    ).filter(Boolean);

    const recent = details.filter((item) => {
        const playedAt = item.UserData?.LastPlayedDate ? new Date(item.UserData.LastPlayedDate).getTime() : NaN;
        return Number.isFinite(playedAt) && playedAt >= cutoff;
    });
    if (!recent.length) return [];

    // 剧的评分/简介：分集常常没有，统一按 SeriesId 补一次。
    const seriesIds = [...new Set(recent.filter((item) => item.Type === 'Episode' && item.SeriesId).map((item) => String(item.SeriesId)))];
    const seriesMeta = new Map();
    if (seriesIds.length) {
        const meta = await embyGet(
            key,
            `/Users/${USER_ID}/Items?Ids=${encodeURIComponent(seriesIds.join(','))}&Fields=Overview,CommunityRating`
        );
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
        coverOk.set(coverKey, await downloadCover(key, coverKey));
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
    console.log(`[emby] 最近 ${WINDOW_DAYS} 天 ${entries.length} 条，封面 ${[...coverOk.values()].filter(Boolean).length} 张`);
    return entries;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
    syncEmby(process.env)
        .then((entries) => {
            console.log(`[emby] 完成，${entries.length} 条（JSON 由 sync-data 统一写入）`);
        })
        .catch((error) => {
            console.error(`[emby] ${error.message}`);
            process.exitCode = 1;
        });
}
