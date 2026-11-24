import { describe, expect, it } from 'vitest';
import { buildReadingData, compareVersion, emptyReadingData, formatDuration, isPlausibleDate, mergeSyncRows, readingStreak, MAX_HIGHLIGHTS, type ModuSyncRecord } from '../../src/lib/reading';

const NOW = new Date('2026-11-24T06:00:00Z');
const BOOK_A = 'md5:aaaa1111bbbb2222';
const BOOK_B = 'md5:cccc3333dddd4444';
/** 2026-09-23 00:10 北京时间：划线时间戳，只影响「落在哪一天」，不影响归并逻辑。 */
const D_NOTE = 1790093400;
/** 划线时间戳对应的自然日（buildReadingData 按北京时间落天）。 */
const NOTE_DAY_ISO = '2026-09-23';

let clock = 0;
function row(kind: string, syncId: string, payload: unknown, extra: Partial<ModuSyncRecord> = {}): ModuSyncRecord {
    clock += 1;
    return {
        kind,
        sync_id: syncId,
        clock,
        revision: 1,
        deleted: 0,
        payload: typeof payload === 'string' ? payload : JSON.stringify(payload),
        ...extra
    };
}

/** 真实 payload 形状：book 带 title/author/cover_path/file_md5，note 用 book_id 关联。 */
function fixture(): ModuSyncRecord[] {
    return [
        row('book', BOOK_A, { title: '夜航西飞', author: '柏瑞尔·马卡姆', cover_path: '夜航西飞.png', file_md5: 'aaaa1111bbbb2222' }),
        row('book', BOOK_B, { title: '人类简史', author: 'Unknown', cover_path: '', file_md5: 'cccc3333dddd4444' }),
        row('time', 't1', { book_id: BOOK_A, date: '2026-11-21', reading_time: 60, round: 1 }),
        row('time', 't2', { book_id: BOOK_A, date: '2026-11-21', reading_time: 120, round: 2 }),
        row('time', 't3', { book_id: BOOK_A, date: '2026-11-22', reading_time: 180, round: 1 }),
        row('time', 't4', { book_id: BOOK_B, date: '2026-11-21', reading_time: '900', round: 1 }),
        row('note', 'note-x1', { book_id: BOOK_A, chapter: '第一章', content: '海面像一块锡纸。', reader_note: '', create_time: D_NOTE }),
        row('note', 'note-x2', { book_id: BOOK_A, chapter: '第二章', content: '他读完了坐标。', reader_note: '写得真好', create_time: D_NOTE + 300 }),
        row('position', BOOK_A, { last_read_position: '/body[1]/p[9]', reading_percentage: 0.42 }),
        // 划线落在 NOTE_DAY_ISO，那条 date 只为让该日进 days（划线本身不产日期）
        row('time', 'tx-note-day', { book_id: BOOK_A, date: NOTE_DAY_ISO, reading_time: 60 })
    ];
}

describe('buildReadingData', () => {
    const data = buildReadingData(fixture(), { now: NOW });

    it('同日同书多轮相加，字符串秒数也认', () => {
        // 11-21：夜航西飞 60+120、人类简史 900；11-22：夜航西飞 180；NOTE_DAY_ISO：夜航西飞 60（为划线那条补的日期）
        expect(data.totals.seconds).toBe(60 + 120 + 900 + 180 + 60);
        expect(data.totals.days).toBe(3);
        expect(data.totals.books).toBe(2);
    });

    it('每日总计 = 当日各书之和', () => {
        const d20 = data.days.find((d) => d.date === '2026-11-21')!;
        expect(d20.seconds).toBe(1080);
    });

    it('一本书一天一张卡，当日按秒数降序', () => {
        const d20 = data.days.find((d) => d.date === '2026-11-21')!;
        expect(d20.books.map((b) => [b.title, b.seconds])).toEqual([
            ['人类简史', 900],
            ['夜航西飞', 180]
        ]);
    });

    it('作者为 Unknown 时省略该字段', () => {
        const books = data.days.flatMap((d) => d.books);
        expect(books.find((b) => b.title === '人类简史')!.author).toBeUndefined();
        expect(books.find((b) => b.title === '夜航西飞')!.author).toBe('柏瑞尔·马卡姆');
    });

    it('划线按当天+该书归组，按时间升序，带 readerNote', () => {
        const book = data.days.find((d) => d.date === NOTE_DAY_ISO)!.books.find((b) => b.title === '夜航西飞')!;
        expect(book.highlights).toHaveLength(2);
        expect(book.highlights[0]).toEqual({ chapter: '第一章', content: '海面像一块锡纸。', readerNote: '' });
        expect(book.highlights[1].readerNote).toBe('写得真好');
    });

    it('输出是公开白名单：不含任何内部字段', () => {
        const json = JSON.stringify(data);
        for (const banned of ['sync_id', 'book_id', 'md5:', 'aaaa1111', 'file_md5', 'clock', 'revision', 'deleted', 'reading_percentage', 'last_read_position', 'cover_path', 'cfi', 'round', 'record-log']) {
            expect(json).not.toContain(banned);
        }
    });

    it('有 cover_path 的书给出封面键，键不是 file_md5', () => {
        const covered = data.books.find((b) => b.title === '夜航西飞')!;
        expect(covered.cover).toBeDefined();
        expect(covered.cover).not.toBe('aaaa1111bbbb2222');
        expect(covered.cover!.length).toBe(12);
        expect(data.books.find((b) => b.title === '人类简史')!.cover).toBeUndefined();
    });

    it('每本累计：时长升序倒排、天数正确', () => {
        expect(data.books.map((b) => [b.title, b.seconds, b.days])).toEqual([
            // 夜航西飞：11-21 的 180 + 11-22 的 180 + NOTE_DAY_ISO 的 60，跨 3 天
            ['人类简史', 900, 1],
            ['夜航西飞', 420, 3]
        ]);
    });
});

describe('日期合理区间', () => {
    it('1970 之类假时间被丢弃并计数告警，不毒化连续天数', () => {
        const data = buildReadingData(
            [
                row('book', BOOK_A, { title: 'X' }),
                row('time', 'a', { book_id: BOOK_A, date: '1970-01-01', reading_time: 600 }),
                row('time', 'b', { book_id: BOOK_A, date: '2026-11-24', reading_time: 60 })
            ],
            { now: NOW }
        );
        expect(data.days.map((d) => d.date)).toEqual(['2026-11-24']);
        expect(data.warnings.join()).toContain('日期越界');
        expect(readingStreak(data.days, NOW)).toBe(1);
    });

    it('未来超过 +1 天的记录也被丢弃', () => {
        const data = buildReadingData([row('book', BOOK_A, { title: 'X' }), row('time', 'a', { book_id: BOOK_A, date: '2027-01-01', reading_time: 60 })], { now: NOW });
        expect(data.days).toHaveLength(0);
    });

    it('isPlausibleDate 边界：下限前一天不合法，今天 +1 天合法', () => {
        expect(isPlausibleDate('1999-12-31', '2026-11-24')).toBe(false);
        expect(isPlausibleDate('2000-01-01', '2026-11-24')).toBe(true);
        expect(isPlausibleDate('2026-11-25', '2026-11-24')).toBe(true);
        expect(isPlausibleDate('2026-11-26', '2026-11-24')).toBe(false);
    });
});

describe('墓碑过滤', () => {
    it('已删除的书连同其阅读时长、划线一起剔除', () => {
        const data = buildReadingData(
            [
                row('book', BOOK_A, { title: '留着' }),
                row('book', BOOK_B, { title: '删掉' }, { deleted: 1 }),
                row('time', 'a', { book_id: BOOK_A, date: '2026-11-21', reading_time: 60 }),
                row('time', 'b', { book_id: BOOK_B, date: '2026-11-21', reading_time: 5000 }),
                row('note', 'n', { book_id: BOOK_B, chapter: '', content: '不该出现', create_time: D_NOTE })
            ],
            { now: NOW }
        );
        expect(data.totals.seconds).toBe(60);
        expect(data.days[0].books.map((b) => b.title)).toEqual(['留着']);
        expect(JSON.stringify(data)).not.toContain('不该出现');
    });

    it('已删除的 time 记录不计入', () => {
        const data = buildReadingData([row('book', BOOK_A, { title: 'X' }), row('time', 'a', { book_id: BOOK_A, date: '2026-11-21', reading_time: 60 }, { deleted: 1 })], { now: NOW });
        expect(data.totals.seconds).toBe(0);
    });
});

describe('mergeSyncRows 三级比较', () => {
    it('clock 大者胜', () => {
        const a = row('position', 'p1', { reading_percentage: 0.1 }, { clock: 100 });
        const b = row('position', 'p1', { reading_percentage: 0.9 }, { clock: 200 });
        expect(mergeSyncRows([{ db: 'a', record: a }, { db: 'b', record: b }]).records[0].payload).toContain('0.9');
    });

    it('clock 相等比 revision', () => {
        const a = row('position', 'p1', { reading_percentage: 0.1 }, { clock: 100, revision: 1 });
        const b = row('position', 'p1', { reading_percentage: 0.9 }, { clock: 100, revision: 2 });
        expect(mergeSyncRows([{ db: 'a', record: a }, { db: 'b', record: b }]).records[0].payload).toContain('0.9');
    });

    it('clock、revision 都相等且有删除分歧时取已删除，只告警不中断', () => {
        const alive = row('book', BOOK_A, { title: '活' }, { clock: 100, revision: 3, deleted: 0 });
        const dead = row('book', BOOK_A, { title: '活' }, { clock: 100, revision: 3, deleted: 1 });
        const merged = mergeSyncRows([{ db: 'a', record: alive }, { db: 'b', record: dead }]);
        expect(String(merged.records[0].deleted)).toBe('1');
    });

    it('墓碑 clock 更大时删除生效', () => {
        const alive = row('book', BOOK_A, { title: '活' }, { clock: 100 });
        const dead = row('book', BOOK_A, { title: '活' }, { clock: 150, deleted: 1 });
        expect(String(mergeSyncRows([{ db: 'a', record: alive }, { db: 'b', record: dead }]).records[0].deleted)).toBe('1');
    });

    it('多分片重复的 position 去重且不误报冲突', () => {
        const a = row('position', 'p1', { reading_percentage: 0.5 }, { clock: 100, revision: 1 });
        const b = { ...a };
        const merged = mergeSyncRows([{ db: 'a', record: a }, { db: 'b', record: b }]);
        expect(merged.conflicts).toBe(0);
        expect(merged.records).toHaveLength(1);
    });

    it('compareVersion 对同版本一死一活给出确定先后（已删除更晚）', () => {
        expect(compareVersion({ clock: 1, revision: 2, deleted: false }, { clock: 1, revision: 2, deleted: true })).toBeLessThan(0);
    });
});

describe('页面辅助', () => {
    it('时长格式：不足一小时显示分钟，超过显示小时分', () => {
        expect(formatDuration(32 * 60)).toBe('32 分钟');
        expect(formatDuration(72 * 60)).toBe('1 小时 12 分');
        expect(formatDuration(60 * 60)).toBe('1 小时');
    });

    it('数据层保留全部划线（30 条上限与「还有 N 条」在渲染层）', () => {
        const rows: ModuSyncRecord[] = [row('book', BOOK_A, { title: 'X' }), row('time', 't0', { book_id: BOOK_A, date: NOTE_DAY_ISO, reading_time: 600 })];
        for (let i = 0; i < 40; i += 1) rows.push(row('note', `n${i}`, { book_id: BOOK_A, chapter: '', content: `第 ${i} 条`, create_time: D_NOTE + i }));
        rows.push(row('time', 't', { book_id: BOOK_A, date: '2026-11-21', reading_time: 600 }));
        const built = buildReadingData(rows, { now: NOW });
        const highlights = built.days.find((d) => d.date === NOTE_DAY_ISO)!.books[0].highlights;
        expect(highlights).toHaveLength(40);
        // 最新的在最后，摘录取到的是最近一条
        expect(highlights[39].content).toBe('第 39 条');
        expect(MAX_HIGHLIGHTS).toBe(30);
    });

    it('overrides 的 hide 把整本书连同当天时长一起剔除', () => {
        const rows: ModuSyncRecord[] = [
            row('book', BOOK_A, { title: '重复书' }),
            row('book', BOOK_B, { title: '保留项' }),
            row('time', 'h1', { book_id: BOOK_A, date: '2026-11-21', reading_time: 500 }),
            row('time', 'h2', { book_id: BOOK_B, date: '2026-11-21', reading_time: 300 }),
            row('note', 'h3', { book_id: BOOK_A, content: '不该出现', create_time: D_NOTE })
        ];
        const data = buildReadingData(rows, { now: NOW, titleOverrides: { [BOOK_A]: { hide: true } } });
        expect(data.days[0].books.map((book) => book.title)).toEqual(['保留项']);
        expect(data.days[0].seconds).toBe(300);
        expect(data.totals.seconds).toBe(300);
    });

    it('空哨兵是完整可用的空结构', () => {
        const empty = emptyReadingData(NOW);
        expect(empty.days).toEqual([]);
        expect(empty.books).toEqual([]);
        expect(empty.totals).toEqual({ seconds: 0, days: 0, books: 0 });
    });
});

describe('同名书归并（同一本书被多次导入 → file_md5 不同 → 两个 sync_id）', () => {
    const BOOK_C = 'md5:eeee5555ffff6666';
    const DIRTY = '高性价比人生指南';

    it('同一本书同一天两条 → 并成一条，秒数相加、划线去重', () => {
        const rows: ModuSyncRecord[] = [
            row('book', BOOK_A, { title: DIRTY, author: '甲', file_md5: 'aaaa1111bbbb2222' }),
            row('book', BOOK_B, { title: DIRTY, author: '甲', file_md5: 'cccc3333dddd4444' }),
            row('time', 'm1', { book_id: BOOK_A, date: NOTE_DAY_ISO, reading_time: 176 }),
            row('time', 'm2', { book_id: BOOK_B, date: NOTE_DAY_ISO, reading_time: 46 }),
            row('note', 'm3', { book_id: BOOK_A, chapter: '第一章', content: '同一句划线', create_time: D_NOTE }),
            row('note', 'm4', { book_id: BOOK_B, chapter: '第一章', content: '同一句划线', create_time: D_NOTE + 300 }),
            row('note', 'm5', { book_id: BOOK_B, chapter: '第二章', content: '另一句划线', reader_note: '批注', create_time: D_NOTE + 600 })
        ];
        const data = buildReadingData(rows, { now: NOW });
        const day = data.days.find((d) => d.date === NOTE_DAY_ISO)!;
        expect(day.books).toHaveLength(1);
        expect(day.books[0].title).toBe(DIRTY);
        expect(day.books[0].seconds).toBe(222);
        expect(day.books[0].highlights.map((h) => h.content)).toEqual(['同一句划线', '另一句划线']);
        expect(day.books[0].highlights[1].readerNote).toBe('批注');
        expect(data.totals.books).toBe(1);
        expect(data.warnings.some((w) => w.includes('同名书归并'))).toBe(true);
    });

    it('跨日同名 → books 只 1 条，days 为并集；脏书名靠 titleMerger 归并', () => {
        const rows: ModuSyncRecord[] = [
            row('book', BOOK_A, { title: `${DIRTY} (z-library.sk, 1lib.sk)`, author: '甲', file_md5: 'aaaa1111bbbb2222' }),
            row('book', BOOK_B, { title: 'Steve Jobs in Exile 史蒂夫·乔布斯流放记', author: '乙', file_md5: 'cccc3333dddd4444' }),
            row('book', BOOK_C, { title: 'Steve Jobs in Exile', author: '乙', file_md5: 'eeee5555ffff6666' }),
            row('time', 'n1', { book_id: BOOK_A, date: '2026-09-18', reading_time: 176 }),
            row('time', 'n2', { book_id: BOOK_B, date: '2026-06-22', reading_time: 153 }),
            row('time', 'n3', { book_id: BOOK_C, date: '2026-06-22', reading_time: 2 })
        ];
        const data = buildReadingData(rows, {
            now: NOW,
            // 生产用 cleanBookTitle；这里给最小等价实现，验证「清洗后同名才归并」
            titleMerger: (title) => title.replace(/\s*\(z-library[^)]*\)/, '')
        });
        // 只清 z-library 尾巴：三本仍是三本（高性价比 + 带副标题 + 无副标题）
        expect(data.totals.books).toBe(3);
        const dirty = data.books.find((b) => b.title === DIRTY)!;
        expect(dirty.days).toBe(1);
        expect(data.books.find((b) => b.title === 'Steve Jobs in Exile 史蒂夫·乔布斯流放记')!.days).toBe(1);
        // 不做模糊匹配："Steve Jobs in Exile" 与带中文副标题的算两本
        expect(data.books.some((b) => b.title === 'Steve Jobs in Exile')).toBe(true);

        const merged = buildReadingData(rows, {
            now: NOW,
            titleMerger: (title) => title.replace(/\s*\(z-library[^)]*\)/, '').replace(/\s*史蒂夫·乔布斯流放记$/, '')
        });
        expect(merged.totals.books).toBe(2);
        const jobs = merged.books.find((b) => b.title === 'Steve Jobs in Exile')!;
        expect(jobs.days).toBe(1);
        expect(jobs.seconds).toBe(155);
    });

    it('跨日同名：days 为并集，秒数累加', () => {
        const rows: ModuSyncRecord[] = [
            row('book', BOOK_A, { title: DIRTY, file_md5: 'aaaa1111bbbb2222' }),
            row('book', BOOK_B, { title: DIRTY, file_md5: 'cccc3333dddd4444' }),
            row('time', 'p1', { book_id: BOOK_A, date: '2026-09-18', reading_time: 176 }),
            row('time', 'p2', { book_id: BOOK_B, date: '2026-09-19', reading_time: 46 })
        ];
        const data = buildReadingData(rows, { now: NOW });
        expect(data.books).toHaveLength(1);
        expect(data.books[0]).toMatchObject({ title: DIRTY, seconds: 222, days: 2 });
    });
});
