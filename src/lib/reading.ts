/**
 * modureader 阅读数据聚合（纯函数，不碰网络 / 文件 / document）。
 *
 * 数据来源：modureader（Flutter 阅读器）把记录级数据分片同步到用户自己的 WebDAV：
 * `<WebDAV 根>/modu/record-log-v1/<首字符 0-9a-f>/<sha256>.db`，每个都是标准 SQLite，
 * 表结构相同（`modu_sync_records(kind, sync_id, clock, revision, deleted, payload, …)`）。
 * 注意：不存在 `database8.db`；每次都必须枚举分片目录，新书会新建分片。
 *
 * 记录形态（真实数据核过）：
 * - kind='time'     `{ book_id: "md5:<file_md5>", date: "YYYY-MM-DD", reading_time: <秒>, round }`
 * - kind='book'     `{ title, author, cover_path, file_md5, … }`，其 sync_id 就是 `md5:<file_md5>`
 * - kind='position' `{ last_read_position, reading_percentage }`，payload 里没有 book_id，靠 sync_id 关联
 * - kind='note'     `{ book_id, chapter, content, reader_note, color, create_time }`；note 的 sync_id 不是书 id
 *
 * 口径（写死）：
 * - `reading_time` 单位秒；同一 (date, book) 的多个 round 全部相加。
 * - `date` 必须是合理自然日：≥2000-01-01 且 ≤北京时间今天 + 1 天，越界丢弃并计入 warnings。
 * - 只统计 deleted=0 的记录；book 的墓碑会连带剔除其 time/note。
 *
 * 输出是**公开白名单**——这个仓库是公开的，reading.json 会进版本库：
 * 只留书名 / 作者 / 封面键 / 日期 / 当日秒数 / 划线正文、章节、批注 / 每本累计。
 * 绝不输出 file_md5、file_path、cover_path、cfi、last_read_position、reading_percentage、
 * clock、revision、deleted、原始 db 路径。
 */

export interface ModuSyncRecord {
    kind: string;
    sync_id: string;
    local_id?: number | string | null;
    clock: number | string | null;
    revision: number | string | null;
    deleted: number | string | null;
    payload: string | null;
    narration?: string | null;
}

export interface ModuSyncRow {
    db: string;
    record: ModuSyncRecord;
}

/** 一条划线（tooltip 用）。 */
export interface ReadingHighlight {
    chapter: string;
    content: string;
    readerNote: string;
}

export interface ReadingDayBook {
    title: string;
    author?: string;
    seconds: number;
    /** 封面键：sha256(file_md5) 前 12 位，不是 file_md5 本身。取不到就省略。 */
    cover?: string;
    highlights: ReadingHighlight[];
}

export interface ReadingDay {
    date: string;
    seconds: number;
    books: ReadingDayBook[];
}

export interface ReadingBookSummary {
    title: string;
    author?: string;
    seconds: number;
    days: number;
    cover?: string;
}

export interface ReadingData {
    generatedAt: string;
    source: string;
    totals: { seconds: number; days: number; books: number };
    books: ReadingBookSummary[];
    days: ReadingDay[];
    warnings: string[];
}

export const READING_SOURCE = 'modureader-webdav';

/** 单卡最多带多少条划线（超出只留计数文字，不进 DOM）。 */
export const MAX_HIGHLIGHTS = 30;

const KIND_TIME = 'time';
const KIND_BOOK = 'book';
const KIND_NOTE = 'note';

function asText(value: unknown): string {
    if (value === null || value === undefined) return '';
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    if (value instanceof Uint8Array) return new TextDecoder().decode(value);
    if (typeof value === 'object' && value !== null && 'data' in value) {
        const data = (value as { data?: unknown }).data;
        if (data instanceof Uint8Array) return new TextDecoder().decode(data);
        if (Array.isArray(data)) return new TextDecoder().decode(Uint8Array.from(data as number[]));
    }
    return String(value);
}

function asNumber(value: unknown, fallback = 0): number {
    if (value === null || value === undefined || value === '') return fallback;
    const n = typeof value === 'number' ? value : Number(asText(value));
    return Number.isFinite(n) ? n : fallback;
}

/** 只有明确的「未删除」才算存活；其余一律当已删（宁可少算）。 */
function isDeleted(value: unknown): boolean {
    if (value === null || value === undefined || value === '') return false;
    const text = asText(value).trim().toLowerCase();
    if (text === '0' || text === 'false') return false;
    const n = Number(text);
    if (Number.isFinite(n)) return n !== 0;
    return true;
}

function parsePayload(raw: unknown): Record<string, unknown> | null {
    const text = asText(raw).trim();
    if (!text) return null;
    try {
        const parsed = JSON.parse(text);
        return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
    } catch {
        return null;
    }
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function isIsoDate(value: string): boolean {
    const m = DATE_RE.exec(value);
    if (!m) return false;
    const [, y, mo, d] = m;
    const dt = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
    return dt.getUTCFullYear() === Number(y) && dt.getUTCMonth() === Number(mo) - 1 && dt.getUTCDate() === Number(d);
}

export const EARLY_DATE_FLOOR = '2000-01-01';

/** 北京时间（UTC+8）的今天。 */
export function beijingToday(now: Date = new Date()): string {
    return new Date(now.getTime() + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

function shiftIsoDate(isoDate: string, offsetDays: number): string {
    return new Date(Date.parse(`${isoDate}T00:00:00Z`) + offsetDays * 86400000).toISOString().slice(0, 10);
}

/** 合理区间：≥2000-01-01 且 ≤北京时间今天 + 1 天。 */
export function isPlausibleDate(date: string, todayIso: string = beijingToday()): boolean {
    if (!isIsoDate(date)) return false;
    if (date < EARLY_DATE_FLOOR) return false;
    return date <= shiftIsoDate(todayIso, 1);
}

export interface VersionKey {
    clock: number;
    revision: number | null;
    deleted: boolean;
}

export function versionOf(record: ModuSyncRecord): VersionKey {
    const revisionRaw = asText(record.revision).trim();
    return {
        clock: asNumber(record.clock),
        revision: revisionRaw === '' ? null : asNumber(revisionRaw, NaN),
        deleted: isDeleted(record.deleted)
    };
}

/**
 * 版本比较，>0 表示 b 更新：clock 大者胜 → clock 相等比 revision → 再相等取 deleted。
 * 墓碑与活记录 clock 撞车时取删除（少算优于多算）。只告警，不中断同步。
 */
export function compareVersion(a: VersionKey, b: VersionKey): number {
    if (a.clock !== b.clock) return a.clock - b.clock;
    const ar = a.revision === null || !Number.isFinite(a.revision) ? -1 : a.revision;
    const br = b.revision === null || !Number.isFinite(b.revision) ? -1 : b.revision;
    if (ar !== br) return ar - br;
    if (a.deleted !== b.deleted) return a.deleted ? 1 : -1;
    return 0;
}

function sameVersion(a: ModuSyncRecord, b: ModuSyncRecord): boolean {
    return compareVersion(versionOf(a), versionOf(b)) === 0 && asText(a.payload) === asText(b.payload);
}

/**
 * 多分片合并：按 (kind, sync_id) 分区，逐条比版本。
 * 真实数据里同一个 position 会在多个分片重复出现，必须去重。
 */
export function mergeSyncRows(rows: ModuSyncRow[], log?: (line: string) => void): { records: ModuSyncRecord[]; conflicts: number } {
    const best = new Map<string, { record: ModuSyncRecord; db: string }>();
    let conflicts = 0;
    for (const { db, record } of rows) {
        if (!record || !record.kind) continue;
        if (record.sync_id === null || record.sync_id === undefined) continue;
        const key = `${record.kind}\u0000${String(record.sync_id)}`;
        const prev = best.get(key);
        if (!prev) {
            best.set(key, { record, db });
            continue;
        }
        const cmp = compareVersion(versionOf(prev.record), versionOf(record));
        if (cmp > 0) continue;
        if (cmp < 0) {
            best.set(key, { record, db });
            continue;
        }
        if (sameVersion(prev.record, record)) continue;
        conflicts += 1;
        log?.(`[reading] 冲突 ${record.kind}/${String(record.sync_id)}：${prev.db} 与 ${db} 版本相同但内容不同，沿用先出现者`);
    }
    return { records: [...best.values()].map((v) => v.record), conflicts };
}

/** 线性同余式的稳定短摘要：不引 crypto，浏览器/Node 结果一致；只用于封面键。 */
function coverKeyOf(fileMd5: string): string {
    let h1 = 0x811c9dc5;
    let h2 = 0x1000193;
    for (let i = 0; i < fileMd5.length; i += 1) {
        const c = fileMd5.charCodeAt(i);
        h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
        h2 = Math.imul(h2 + c, 0x85ebca6b) >>> 0;
    }
    return `${h1.toString(16).padStart(8, '0')}${h2.toString(16).padStart(8, '0')}`.slice(0, 12);
}

/** 笔记的日期：`payload.create_time` 可能是秒/毫秒时间戳，也可能是 ISO 字符串，统一按北京时间取日期。 */
function noteDate(payload: Record<string, unknown>): string {
    const raw = payload.create_time ?? payload.created_at ?? payload.date;
    const text = asText(raw).trim();
    if (!text) return '';
    if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
    const n = Number(text);
    if (!Number.isFinite(n) || n <= 0) return '';
    const ms = n > 1e11 ? n : n * 1000;
    return new Date(ms + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

/** 「32 分钟」/「1 小时 12 分」；页面直接用，避免各算一遍。 */
export function formatDuration(seconds: number): string {
    const total = Math.max(0, Math.round(seconds));
    const minutes = Math.round(total / 60);
    if (minutes < 60) return `${minutes} 分钟`;
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return rest === 0 ? `${hours} 小时` : `${hours} 小时 ${rest} 分`;
}

/** 作者是这些占位值时整行不渲染（真实数据里 2 本为 Unknown）。 */
const UNKNOWN_AUTHOR = /^(unknown|未知|佚名|n\/?a|null|none|-+)$/i;

function authorOrEmpty(raw: string): string {
    const text = raw.trim();
    if (!text || UNKNOWN_AUTHOR.test(text)) return '';
    return text;
}

/** 取不到书名时的占位：不用 md5，避免把标识写进公开 JSON。 */
const UNTITLED = '未命名书籍';

/**
 * 聚合。只输出公开白名单字段。
 *
 * @param records 已按 (kind, sync_id) 合并好的行
 * @param options.now 生成时间（测试里固定）
 * @param options.titleOverrides 人工映射表（key 为 sync_id 或书名），见 scripts/lib/book-title.mjs
 */
export function buildReadingData(
    records: ModuSyncRecord[],
    options: { now?: Date; titleOverrides?: Record<string, { title?: string; author?: string; hide?: boolean }> } = {}
): ReadingData {
    const now = options.now ?? new Date();
    const todayIso = beijingToday(now);
    const overrides = options.titleOverrides ?? {};
    const warnings: string[] = [];
    let droppedDates = 0;
    let unmappedNotes = 0;

    const overrideFor = (syncId: string, title: string) => overrides[syncId] ?? overrides[title] ?? null;

    // 1) 书名表：sync_id → { title, author, cover }
    const bookById = new Map<string, { title: string; author: string; cover?: string; clock: number }>();
    const deletedBooks = new Set<string>();
    for (const record of records) {
        if (record.kind !== KIND_BOOK) continue;
        const syncId = asText(record.sync_id).trim();
        if (!syncId) continue;
        if (isDeleted(record.deleted)) {
            deletedBooks.add(syncId);
            continue;
        }
        const payload = parsePayload(record.payload);
        if (!payload) continue;
        const clock = asNumber(record.clock);
        const prev = bookById.get(syncId);
        if (prev && prev.clock > clock) continue;

        const rawTitle = asText(payload.title).trim();
        const fileMd5 = asText(payload.file_md5).trim();
        const override = overrideFor(syncId, rawTitle);
        if (override?.hide) {
            deletedBooks.add(syncId);
            continue;
        }
        const authorRaw = asText(payload.author).trim();
        const coverPath = asText(payload.cover_path).trim();
        bookById.set(syncId, {
            title: override?.title || rawTitle || UNTITLED,
            author: authorOrEmpty(override?.author ?? authorRaw),
            cover: coverPath && fileMd5 ? coverKeyOf(fileMd5) : undefined,
            clock
        });
    }

    // 2) 划线：按 (日期, 书) 归组，note 用 payload.book_id 关联
    const notesByDayBook = new Map<string, { chapter: string; content: string; readerNote: string; created: number }[]>();
    for (const record of records) {
        if (record.kind !== KIND_NOTE || isDeleted(record.deleted)) continue;
        const payload = parsePayload(record.payload);
        if (!payload) continue;
        const bookId = asText(payload.book_id).trim();
        if (!bookId) {
            unmappedNotes += 1;
            continue;
        }
        if (deletedBooks.has(bookId)) continue;
        const date = noteDate(payload);
        if (!isPlausibleDate(date, todayIso)) {
            droppedDates += 1;
            continue;
        }
        const content = asText(payload.content).trim();
        if (!content) continue;
        const key = `${date}\u0000${bookId}`;
        const list = notesByDayBook.get(key) ?? [];
        list.push({
            chapter: asText(payload.chapter).trim(),
            content,
            readerNote: asText(payload.reader_note).trim(),
            created: asNumber(payload.create_time ?? payload.created_at)
        });
        notesByDayBook.set(key, list);
    }

    // 3) time：按 (日期, 书) 累加秒数
    const dayMap = new Map<string, Map<string, number>>();
    for (const record of records) {
        if (record.kind !== KIND_TIME || isDeleted(record.deleted)) continue;
        const payload = parsePayload(record.payload);
        if (!payload) continue;
        const date = asText(payload.date).trim();
        if (!isPlausibleDate(date, todayIso)) {
            droppedDates += 1;
            continue;
        }
        const bookId = asText(payload.book_id).trim();
        if (!bookId || deletedBooks.has(bookId)) continue;
        const seconds = Math.max(0, Math.round(asNumber(payload.reading_time)));
        if (seconds === 0) continue;
        const booksOfDay = dayMap.get(date) ?? new Map<string, number>();
        booksOfDay.set(bookId, (booksOfDay.get(bookId) ?? 0) + seconds);
        dayMap.set(date, booksOfDay);
    }

    // 4) 组装 days（日期倒序，当日书目按时长降序）
    let totalSeconds = 0;
    const perBook = new Map<string, { seconds: number; days: Set<string> }>();
    const days: ReadingDay[] = [...dayMap.entries()]
        .map(([date, booksOfDay]) => {
            const books: ReadingDayBook[] = [...booksOfDay.entries()]
                .map(([bookId, seconds]) => {
                    const meta = bookById.get(bookId);
                    const title = meta?.title ?? UNTITLED;
                    const stat = perBook.get(bookId) ?? { seconds: 0, days: new Set<string>() };
                    stat.seconds += seconds;
                    stat.days.add(date);
                    perBook.set(bookId, stat);

                    // 不在这里截断：卡片要显示「还有 N 条」，截断在渲染层做（renderHighlights）
                    const highlights = (notesByDayBook.get(`${date}\u0000${bookId}`) ?? [])
                        .sort((a, b) => a.created - b.created)
                        .map(({ chapter, content, readerNote }) => ({ chapter, content, readerNote }));
                    const entry: ReadingDayBook = { title, seconds, highlights };
                    if (meta?.author) entry.author = meta.author;
                    if (meta?.cover) entry.cover = meta.cover;
                    return entry;
                })
                .sort((a, b) => b.seconds - a.seconds || a.title.localeCompare(b.title));
            const daySeconds = books.reduce((sum, b) => sum + b.seconds, 0);
            totalSeconds += daySeconds;
            return { date, seconds: daySeconds, books };
        })
        .filter((day) => day.books.length > 0)
        .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

    // 5) 每本累计（时长降序）
    const books: ReadingBookSummary[] = [...perBook.entries()]
        .map(([bookId, stat]) => {
            const meta = bookById.get(bookId);
            const row: ReadingBookSummary = {
                title: meta?.title ?? UNTITLED,
                seconds: stat.seconds,
                days: stat.days.size
            };
            if (meta?.author) row.author = meta.author;
            if (meta?.cover) row.cover = meta.cover;
            return row;
        })
        .sort((a, b) => b.seconds - a.seconds || a.title.localeCompare(b.title));

    if (droppedDates > 0) warnings.push(`丢弃 ${droppedDates} 条日期越界或缺少日期的记录`);
    if (unmappedNotes > 0) warnings.push(`${unmappedNotes} 条笔记没有 payload.book_id，未进划线`);

    return {
        generatedAt: now.toISOString(),
        source: READING_SOURCE,
        totals: { seconds: totalSeconds, days: days.length, books: books.length },
        books,
        days,
        warnings
    };
}

/** 空结构哨兵：reading.json 缺失或同步失败时页面显示空态，不让构建挂。 */
export function emptyReadingData(now: Date = new Date()): ReadingData {
    return {
        generatedAt: now.toISOString(),
        source: READING_SOURCE,
        totals: { seconds: 0, days: 0, books: 0 },
        books: [],
        days: [],
        warnings: []
    };
}

/** 连续阅读天数（按北京时间；最近一天是今天或昨天都能接上）。 */
export function readingStreak(days: ReadingDay[], today = new Date()): number {
    if (days.length === 0) return 0;
    const todayIso = beijingToday(today);
    const first = days[0].date;
    let cursor: string | null = first === todayIso ? todayIso : first === shiftIsoDate(todayIso, -1) ? first : null;
    if (!cursor) return 0;
    let streak = 0;
    for (const day of days) {
        if (day.date !== cursor) break;
        streak += 1;
        cursor = shiftIsoDate(cursor, -1);
    }
    return streak;
}
