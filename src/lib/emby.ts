/**
 * Emby 观看记录 → 时间线「阅读与影视」卡片数据（纯映射 + 一个取数函数）。
 *
 * 本轮只跑 fixtures/emby-sample.json（不联网）；函数签名和字段映射按 Emby 4.10 真实结构写，
 * API key 到位后把 fixture 换成 `fetchEmbyTimelineFromEnv()` 即可，不用改卡片。
 *
 * 取数口径（Emby 官方接口）：
 * - `GET /Users/{userId}/Items?Recursive=true&IncludeItemTypes=Movie,Episode&SortBy=DatePlayed&SortOrder=Descending`
 *   拿到所有看过/在看的条目；
 * - `GET /Users/{userId}/Items/Resume` 拿到「继续观看」列表，带更准的 PlayedPercentage；
 * - 两路按 Id 去重，Resume 的数据优先（同一部片在 Resume 里才是真实进度）。
 *
 * 凭据只从环境变量读，绝不写进仓库：
 *   EMBY_BASE_URL=https://<host>:<port>
 *   EMBY_API_KEY=<Emby API key>
 *   EMBY_USER_ID=<可选，缺省时用 /Users/Me 解析>
 *
 * Items 不返回「看了多久」，所以卡片顶部展示片长（RunTimeTicks），不是观看时长。
 */

/** Emby 条目里本卡片用到的字段（其余字段忽略）。 */
export interface EmbyItem {
    Id: string;
    Name: string;
    Type: 'Movie' | 'Episode' | string;
    SeriesName?: string;
    ParentIndexNumber?: number;
    IndexNumber?: number;
    Overview?: string;
    RunTimeTicks?: number;
    CommunityRating?: number;
    /** 原型/离线预览用：剧集所在剧的 CommunityRating / Overview（正式取数需另取 Series）。 */
    SeriesRating?: number;
    SeriesOverview?: string;
    ProductionYear?: number;
    Genres?: string[];
    ImageTags?: { Primary?: string };
    /** 原型/离线预览用：本地缓存的封面路径（真实接口可填 Emby 图片地址）。 */
    CoverUrl?: string;
    UserData?: {
        Played?: boolean;
        PlayedPercentage?: number;
        LastPlayedDate?: string;
    };
}

/** 卡片直接消费的形状。 */
export interface EmbyEntry {
    id: string;
    type: 'movie' | 'episode';
    title: string;
    /** 剧集：S02E05（由 ParentIndexNumber / IndexNumber 拼）。 */
    episodeCode?: string;
    /** 剧集：该集自己的名字。 */
    episodeTitle?: string;
    /** 电影：年代 + 类型，例如「2024 · 剧情」；剧集不用。 */
    meta?: string;
    overview?: string;
    /** 片长（分钟，四舍五入）。RunTimeTicks 是 100 纳秒单位：ticks / 600_000_000。 */
    minutes: number | null;
    rating: number | null;
    /** 剧集所在剧的评分；电影为 null。 */
    seriesRating: number | null;
    /** 剧集所在剧的简介；电影为 null。 */
    seriesOverview: string | null;
    played: boolean;
    /** 0–100 整数。 */
    playedPercent: number;
    /** 毫秒时间戳；没有观看记录时为 null。 */
    lastPlayedAt: number | null;
    /** ImageTags.Primary 只作标识，卡片不使用 Emby 外链图片。 */
    imageTag?: string;
    /** 卡片封面地址；缺省时由页面回退到占位图。 */
    cover?: string;
}

export type EmbyWatchState = 'watched' | 'progress' | 'started' | 'unwatched';

export interface EmbyCardState {
    state: EmbyWatchState;
    /** 进度条填充比例（0–100）：看完固定 100，未看 0。 */
    barPercent: number;
    /** 气泡文字；null 表示不出气泡（看完）。 */
    bubble: string | null;
    /** 顶部角标文案。 */
    label: string;
}

export const EMBY_ITEMS_FIELDS = [
    'Overview',
    'RunTimeTicks',
    'CommunityRating',
    'UserData',
    'SeriesName',
    'ParentIndexNumber',
    'IndexNumber',
    'ProductionYear',
    'Genres'
].join(',');

const TICKS_PER_MINUTE = 600_000_000;

function toMinutes(ticks: number | undefined): number | null {
    if (typeof ticks !== 'number' || !Number.isFinite(ticks) || ticks <= 0) return null;
    return Math.max(1, Math.round(ticks / TICKS_PER_MINUTE));
}

function clampPercent(value: number | undefined): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
    return Math.min(100, Math.max(0, Math.round(value)));
}

function episodeCode(item: EmbyItem): string | undefined {
    if (item.Type !== 'Episode') return undefined;
    const season = item.ParentIndexNumber;
    const episode = item.IndexNumber;
    if (typeof season !== 'number' || typeof episode !== 'number') return undefined;
    return `S${String(season).padStart(2, '0')}E${String(episode).padStart(2, '0')}`;
}

function movieMeta(item: EmbyItem): string | undefined {
    if (item.Type !== 'Movie') return undefined;
    const parts: string[] = [];
    if (typeof item.ProductionYear === 'number') parts.push(String(item.ProductionYear));
    const firstGenre = item.Genres?.[0];
    if (firstGenre) parts.push(firstGenre);
    return parts.length ? parts.join(' · ') : undefined;
}

/** 单条 Emby 原始条目 → 卡片数据。 */
export function mapEmbyItem(item: EmbyItem): EmbyEntry {
    const played = Boolean(item.UserData?.Played);
    const code = episodeCode(item);
    const lastPlayed = item.UserData?.LastPlayedDate;
    const lastPlayedAt = lastPlayed ? new Date(lastPlayed).getTime() : null;
    return {
        id: item.Id,
        type: item.Type === 'Episode' ? 'episode' : 'movie',
        // 剧集卡片标题用剧名，集名单独放副标题；没有剧名时退回该集 Name。
        title: item.Type === 'Episode' ? item.SeriesName || item.Name : item.Name,
        episodeCode: code,
        episodeTitle: item.Type === 'Episode' ? item.Name : undefined,
        meta: movieMeta(item),
        overview: item.Overview?.trim() || undefined,
        minutes: toMinutes(item.RunTimeTicks),
        rating: typeof item.CommunityRating === 'number' ? item.CommunityRating : null,
        seriesRating: typeof item.SeriesRating === 'number' ? item.SeriesRating : null,
        seriesOverview: item.SeriesOverview?.trim() || null,
        played,
        playedPercent: played ? 100 : clampPercent(item.UserData?.PlayedPercentage),
        lastPlayedAt: Number.isFinite(lastPlayedAt) ? lastPlayedAt : null,
        imageTag: item.ImageTags?.Primary,
        cover: item.CoverUrl
    };
}

/**
 * 八种展示状态归到四类，卡片只读这里的结果：
 * - watched：Played=true 或 ≥95%；满条、无气泡、不显示百分比
 * - progress：1%–94%；按实际百分比填充 + 气泡
 * - started：<1% 但有观看记录；0% 气泡，文案「刚开始」
 * - unwatched：入库未播（本轮不渲染）
 */
export function embyCardState(entry: EmbyEntry): EmbyCardState {
    const pct = entry.playedPercent;
    if (entry.played || pct >= 95) {
        const label = entry.type === 'episode' && entry.episodeCode ? `看完 · ${entry.episodeCode}` : '看过 · 电影';
        return { state: 'watched', barPercent: 100, bubble: null, label };
    }
    if (pct >= 1) {
        return { state: 'progress', barPercent: pct, bubble: `${pct}%`, label: `看到 ${pct}%` };
    }
    if (entry.lastPlayedAt) {
        return { state: 'started', barPercent: 0, bubble: '0%', label: '刚开始' };
    }
    return { state: 'unwatched', barPercent: 0, bubble: null, label: '未看' };
}

/** 两路结果合并：按 Id 去重，Resume 的进度/时间覆盖 Items。 */
export function mergeEmbyItems(items: EmbyItem[], resume: EmbyItem[]): EmbyItem[] {
    const byId = new Map<string, EmbyItem>();
    for (const item of items) byId.set(item.Id, item);
    for (const item of resume) {
        const previous = byId.get(item.Id);
        byId.set(item.Id, previous ? { ...previous, ...item, UserData: { ...previous.UserData, ...item.UserData } } : item);
    }
    return [...byId.values()];
}

export interface EmbyConfig {
    baseUrl: string;
    apiKey: string;
    /** 可选；缺省时用 /Users/Me 解析。 */
    userId?: string;
}

/** 从环境变量读配置；缺 key 时明确报错，不落默认域名。 */
export function embyConfigFromEnv(env: Record<string, string | undefined> = process.env): EmbyConfig {
    const baseUrl = env.EMBY_BASE_URL?.trim();
    const apiKey = env.EMBY_API_KEY?.trim();
    if (!baseUrl || !apiKey) {
        throw new Error('缺少 EMBY_BASE_URL / EMBY_API_KEY 环境变量');
    }
    return { baseUrl: baseUrl.replace(/\/+$/, ''), apiKey, userId: env.EMBY_USER_ID?.trim() || undefined };
}

async function embyGet<T>(config: EmbyConfig, path: string): Promise<T> {
    const response = await fetch(`${config.baseUrl}${path}`, {
        headers: {
            // Emby 同时支持 api_key 查询参数和 X-Emby-Token 头；用头避免 key 出现在日志/URL 里
            'X-Emby-Token': config.apiKey,
            Accept: 'application/json'
        }
    });
    if (!response.ok) {
        throw new Error(`Emby 请求失败 ${response.status}: ${path}`);
    }
    return (await response.json()) as T;
}

async function resolveUserId(config: EmbyConfig): Promise<string> {
    if (config.userId) return config.userId;
    const me = await embyGet<{ Id?: string }>(config, '/Users/Me');
    if (!me?.Id) throw new Error('无法解析 Emby 用户 Id，请设置 EMBY_USER_ID');
    return me.Id;
}

/** 真实接口：Items + Resume 合并 → 卡片数据（按最后观看时间倒序）。 */
export async function fetchEmbyTimeline(config: EmbyConfig): Promise<EmbyEntry[]> {
    const userId = await resolveUserId(config);
    const query = [
        'Recursive=true',
        'IncludeItemTypes=Movie,Episode',
        `Fields=${encodeURIComponent(EMBY_ITEMS_FIELDS)}`,
        'SortBy=DatePlayed',
        'SortOrder=Descending',
        'ImageTypeLimit=0'
    ].join('&');
    const [items, resume] = await Promise.all([
        embyGet<{ Items?: EmbyItem[] }>(config, `/Users/${userId}/Items?${query}`),
        embyGet<{ Items?: EmbyItem[] }>(config, `/Users/${userId}/Items/Resume?MediaTypes=Video`)
    ]);
    return mergeEmbyItems(items.Items ?? [], resume.Items ?? [])
        .map(mapEmbyItem)
        .sort((a, b) => (b.lastPlayedAt ?? 0) - (a.lastPlayedAt ?? 0));
}

/** 从环境变量取配置后直接拉取（上线时用这个替换 fixture）。 */
export function fetchEmbyTimelineFromEnv(env?: Record<string, string | undefined>): Promise<EmbyEntry[]> {
    return fetchEmbyTimeline(embyConfigFromEnv(env));
}
