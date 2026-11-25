import { describe, expect, it } from 'vitest';
import { buildReadingData, compareVersion, emptyReadingData, formatDuration, isPlausibleDate, mergeSyncRows, progressTier, readingStreak, showsProgressBadge, MAX_HIGHLIGHTS, MIN_DAY_SECONDS, type ModuSyncRecord } from '../../src/lib/reading';

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
        row('time', 'tx-note-day', { book_id: BOOK_A, date: NOTE_DAY_ISO, reading_time: 120 })
    ];
}

describe('buildReadingData', () => {
    const data = buildReadingData(fixture(), { now: NOW });

    it('同日同书多轮相加，字符串秒数也认', () => {
        // 11-21：夜航西飞 60+120、人类简史 900；11-22：夜航西飞 180；NOTE_DAY_ISO：夜航西飞 120（为划线那条补的日期）
        expect(data.totals.seconds).toBe(60 + 120 + 900 + 180 + 120);
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
        expect(book.highlights[0]).toEqual({ chapter: '第一章', content: '海面像一块锡纸。', readerNote: '', date: NOTE_DAY_ISO });
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
            // 夜航西飞：11-21 的 180 + 11-22 的 180 + NOTE_DAY_ISO 的 120，跨 3 天
            ['人类简史', 900, 1],
            ['夜航西飞', 480, 3]
        ]);
    });

    it('划线带日期（取 note 的 create_time，按北京时间），可跨日区分', () => {
        const rows = [
            row('book', BOOK_A, { title: '夜航西飞', author: '柏瑞尔·马卡姆' }),
            row('note', 'd1', { book_id: BOOK_A, chapter: '第一章', content: '昨天划的', create_time: D_NOTE - 86400 }),
            row('note', 'd2', { book_id: BOOK_A, chapter: '第一章', content: '今天划的', create_time: D_NOTE }),
            row('time', 'dx', { book_id: BOOK_A, date: NOTE_DAY_ISO, reading_time: 120 }),
            row('time', 'dy', { book_id: BOOK_A, date: '2026-09-22', reading_time: 120 })
        ];
        const built = buildReadingData(rows, { now: NOW });
        expect(built.days.map((d) => d.date)).toEqual([NOTE_DAY_ISO, '2026-09-22']);
        // 划线日期取自 note 自己的 create_time，不是卡片日期；两天各归自己那张卡片
        expect(built.days[0].books[0].highlights.map((h) => [h.content, h.date])).toEqual([['今天划的', NOTE_DAY_ISO]]);
        expect(built.days[1].books[0].highlights.map((h) => [h.content, h.date])).toEqual([['昨天划的', '2026-09-22']]);
    });

    it('简介只来自人工 book-meta，按书名匹配，没填就整个字段不出现', () => {
        const withMeta = buildReadingData(fixture(), { now: NOW, bookMeta: { 夜航西飞: { description: '一个人独自飞越大西洋。' }, 人类简史: { description: '   ' } } });
        const day = withMeta.days.find((d) => d.date === '2026-11-21')!;
        expect(day.books.find((b) => b.title === '夜航西飞')!.description).toBe('一个人独自飞越大西洋。');
        // 空白简介当没填
        expect('description' in day.books.find((b) => b.title === '人类简史')!).toBe(false);
        expect(withMeta.books.find((b) => b.title === '夜航西飞')!.description).toBe('一个人独自飞越大西洋。');
        // 不传 bookMeta 时公开 JSON 里根本没有 description 键
        expect(JSON.stringify(buildReadingData(fixture(), { now: NOW }))).not.toContain('description');
    });
});

describe('阅读进度 position', () => {
    it('按 sync_id 取 clock 最新的一条，reading_percentage × 100 取整', () => {
        const data = buildReadingData(
            [
                row('book', BOOK_A, { title: '进度书' }),
                row('position', BOOK_A, { last_read_position: 'epubcfi(/6/10!/4)', reading_percentage: 0.18176 }, { clock: 100 }),
                row('position', BOOK_A, { last_read_position: 'epubcfi(/6/20!/4)', reading_percentage: 0.555 }, { clock: 200 }),
                row('time', 't', { book_id: BOOK_A, date: '2026-11-21', reading_time: 600 })
            ],
            { now: NOW }
        );
        expect(data.days[0].books[0].progress).toBe(56);
        expect(data.books[0].progress).toBe(56);
    });

    it('没开始读（last_read_position 为空 + 0.0）不输出进度；百分比缺失同样省略', () => {
        const data = buildReadingData(
            [
                row('book', BOOK_A, { title: '没开始' }),
                row('position', BOOK_A, { last_read_position: '', reading_percentage: 0 }),
                row('book', BOOK_B, { title: '没记录' }),
                row('time', 'a', { book_id: BOOK_A, date: '2026-11-21', reading_time: 300 }),
                row('time', 'b', { book_id: BOOK_B, date: '2026-11-21', reading_time: 300 })
            ],
            { now: NOW }
        );
        // 0% 进度条不出现，整个 progress 字段省略
        expect('progress' in data.days[0].books.find((b) => b.title === '没开始')!).toBe(false);
        expect('progress' in data.books.find((b) => b.title === '没记录')!).toBe(false);
    });

    it('真正读到 0%（位置非空）保留 0，不误判成未开始', () => {
        const data = buildReadingData(
            [
                row('book', BOOK_A, { title: '刚开头' }),
                row('position', BOOK_A, { last_read_position: 'epubcfi(/6/2!/4)', reading_percentage: 0 }),
                row('time', 'a', { book_id: BOOK_A, date: '2026-11-21', reading_time: 300 })
            ],
            { now: NOW }
        );
        expect(data.days[0].books[0].progress).toBe(0);
    });

    it('同名书多个 sync_id：取 clock 最新的那条进度', () => {
        const data = buildReadingData(
            [
                row('book', BOOK_A, { title: '同名书' }),
                row('book', BOOK_B, { title: '同名书' }),
                row('position', BOOK_A, { last_read_position: 'epubcfi(/6/8!/4)', reading_percentage: 0.1 }, { clock: 100 }),
                row('position', BOOK_B, { last_read_position: 'epubcfi(/6/12!/4)', reading_percentage: 0.3 }, { clock: 200 }),
                row('time', 'a', { book_id: BOOK_A, date: '2026-11-21', reading_time: 200 }),
                row('time', 'b', { book_id: BOOK_B, date: '2026-11-21', reading_time: 200 })
            ],
            { now: NOW }
        );
        expect(data.days[0].books).toHaveLength(1);
        expect(data.days[0].books[0].progress).toBe(30);
        expect(data.books[0].progress).toBe(30);
    });
});

describe('每日推算进度 progressEst', () => {
    const rows = () => [
        row('book', BOOK_A, { title: '进度书' }),
        row('position', BOOK_A, { last_read_position: 'epubcfi(/6/10!/4)', reading_percentage: 0.42 }),
        row('time', 'a', { book_id: BOOK_A, date: '2026-11-20', reading_time: 300 }),
        row('time', 'b', { book_id: BOOK_A, date: '2026-11-21', reading_time: 600 }),
        row('time', 'c', { book_id: BOOK_A, date: '2026-11-22', reading_time: 300 })
    ];
    const data = buildReadingData(rows(), { now: NOW });
    const byDate = (date: string) => data.days.find((day) => day.date === date)!.books[0];

    it('按「最终 pct × 截至当天累计秒数 ÷ 总秒数」线性分摊，四舍五入', () => {
        // 总 1200 秒（每天都不低于 2 分钟门槛），最终 42%：300s → 10.5 → 11；900s → 31.5 → 32；1200s → 42
        expect(byDate('2026-11-20').progressEst).toBe(11);
        expect(byDate('2026-11-21').progressEst).toBe(32);
        expect(byDate('2026-11-22').progressEst).toBe(42);
    });

    it('最后一天必然等于真实 progress（推算的边界性质）', () => {
        const ascending = [...data.days].sort((a, b) => (a.date < b.date ? -1 : 1));
        const last = ascending[ascending.length - 1].books[0];
        expect(last.progressEst).toBe(last.progress);
        expect(last.progressEst).toBe(42);
    });

    it('真实 progress 字段保持原义：每天都是最终快照值，不被推算值覆盖', () => {
        expect(byDate('2026-11-20').progress).toBe(42);
        expect(byDate('2026-11-21').progress).toBe(42);
        expect(byDate('2026-11-22').progress).toBe(42);
    });

    it('不足 2 分钟被滤除的碎片不计入分母，最后一天仍等于真实值', () => {
        const withDropped = buildReadingData([...rows(), row('time', 'dropped', { book_id: BOOK_A, date: '2026-11-19', reading_time: 60 })], { now: NOW });
        expect(withDropped.days.some((day) => day.date === '2026-11-19')).toBe(false);
        const last = withDropped.days.find((day) => day.date === '2026-11-22')!.books[0];
        // 若把 60 秒算进分母，会得到 round(42*1200/1260)=40，这里断言分母是 1200
        expect(last.progressEst).toBe(42);
        expect(withDropped.days.find((day) => day.date === '2026-11-21')!.books[0].progressEst).toBe(32);
    });

    it('没有 position 的书不输出 progressEst', () => {
        const noPosition = buildReadingData([row('book', BOOK_B, { title: '没进度' }), row('time', 'x', { book_id: BOOK_B, date: '2026-11-21', reading_time: 300 })], { now: NOW });
        expect('progressEst' in noPosition.days[0].books[0]).toBe(false);
    });
});

describe('当日不足 MIN_DAY_SECONDS 的卡片', () => {
    it('119 秒过滤、120 秒保留，整天被滤掉则日期整个消失', () => {
        const data = buildReadingData(
            [
                row('book', BOOK_A, { title: '长读' }),
                row('book', BOOK_B, { title: '短读' }),
                row('time', 'only-short', { book_id: BOOK_B, date: '2026-11-20', reading_time: 119 }),
                row('time', 'kept', { book_id: BOOK_A, date: '2026-11-21', reading_time: MIN_DAY_SECONDS }),
                row('time', 'dropped', { book_id: BOOK_B, date: '2026-11-21', reading_time: 119 })
            ],
            { now: NOW }
        );
        expect(MIN_DAY_SECONDS).toBe(120);
        expect(data.days.map((d) => d.date)).toEqual(['2026-11-21']);
        expect(data.days[0].books.map((b) => b.title)).toEqual(['长读']);
        expect(data.totals.days).toBe(1);
        expect(data.warnings.join()).toContain('不足 2 分钟');
    });

    it('过滤后当日合计 / 书籍累计 / 页头总计同一口径', () => {
        const data = buildReadingData(
            [
                row('book', BOOK_A, { title: '甲' }),
                row('book', BOOK_B, { title: '乙' }),
                row('time', 'a1', { book_id: BOOK_A, date: '2026-11-20', reading_time: 300 }),
                row('time', 'a2', { book_id: BOOK_A, date: '2026-11-21', reading_time: 119 }),
                row('time', 'b1', { book_id: BOOK_B, date: '2026-11-21', reading_time: 400 }),
                row('time', 'b2', { book_id: BOOK_B, date: '2026-11-22', reading_time: 119 })
            ],
            { now: NOW }
        );
        const sumDays = data.days.reduce((sum, day) => sum + day.seconds, 0);
        expect(sumDays).toBe(data.totals.seconds);
        expect(data.totals.seconds).toBe(300 + 400);
        // 卡片加总必须等于当日合计
        for (const day of data.days) expect(day.books.reduce((sum, b) => sum + b.seconds, 0)).toBe(day.seconds);
        // 书籍累计只算留下的卡片
        expect(data.books.find((b) => b.title === '甲')!.seconds).toBe(300);
        expect(data.books.find((b) => b.title === '乙')!.seconds).toBe(400);
        expect(data.totals.books).toBe(2);
    });
});

describe('日期合理区间', () => {
    it('1970 之类假时间被丢弃并计数告警，不毒化连续天数', () => {
        const data = buildReadingData(
            [
                row('book', BOOK_A, { title: 'X' }),
                row('time', 'a', { book_id: BOOK_A, date: '1970-01-01', reading_time: 600 }),
                row('time', 'b', { book_id: BOOK_A, date: '2026-11-24', reading_time: 120 })
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
                row('time', 'a', { book_id: BOOK_A, date: '2026-11-21', reading_time: 120 }),
                row('time', 'b', { book_id: BOOK_B, date: '2026-11-21', reading_time: 5000 }),
                row('note', 'n', { book_id: BOOK_B, chapter: '', content: '不该出现', create_time: D_NOTE })
            ],
            { now: NOW }
        );
        expect(data.totals.seconds).toBe(120);
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
        const warn = data.warnings.find((w) => w.includes('同名书归并'))!;
        // 告警要能看出并了哪一份：带日期、被并走那份的秒数，不是两条同名字段相撞
        expect(warn).toContain(NOTE_DAY_ISO);
        expect(warn).toContain('46 秒');

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
        // 只清 z-library 尾巴：DIRTY 与两个 Steve Jobs 各算一本；但 Steve Jobs in Exile（仅 2 秒）
        // 不足当天 2 分钟阈值，被过滤后只剩两本。
        expect(data.totals.books).toBe(2);
        const dirty = data.books.find((b) => b.title === DIRTY)!;
        expect(dirty.days).toBe(1);
        expect(data.books.find((b) => b.title === 'Steve Jobs in Exile 史蒂夫·乔布斯流放记')!.days).toBe(1);
        // 不做模糊匹配；且 2 秒的短读不进 books
        expect(data.books.some((b) => b.title === 'Steve Jobs in Exile')).toBe(false);

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
            row('time', 'p2', { book_id: BOOK_B, date: '2026-09-19', reading_time: 120 })
        ];
        const data = buildReadingData(rows, { now: NOW });
        expect(data.books).toHaveLength(1);
        expect(data.books[0]).toMatchObject({ title: DIRTY, seconds: 296, days: 2 });
    });
});


// 卡片进度条的分档与「读完不渲染」判据（模板只问这两个函数，颜色与显隐不会各写一份）。
describe('progressTier', () => {
    it('按 <34 / 34–66 / ≥67 三档取色名', () => {
        expect(progressTier(0)).toBe('danger');
        expect(progressTier(33)).toBe('danger');
        expect(progressTier(34)).toBe('warning');
        expect(progressTier(66)).toBe('warning');
        expect(progressTier(67)).toBe('info');
        expect(progressTier(100)).toBe('info');
    });

    it('越界值按最近的一端处理，不抛错', () => {
        expect(progressTier(-5)).toBe('danger');
        expect(progressTier(160)).toBe('info');
    });
});

describe('showsProgressBadge', () => {
    it('真实进度 100%（最后一天，推算值也是 100）不渲染任何文字节点', () => {
        expect(showsProgressBadge(100, 100)).toBe(false);
    });

    it('没读完的卡渲染气泡（含推算到 100 但真实值不足）', () => {
        expect(showsProgressBadge(93, 93)).toBe(true);
        expect(showsProgressBadge(12, 12)).toBe(true);
        expect(showsProgressBadge(100, 97)).toBe(true);
    });

    it('没有进度数据时不出气泡', () => {
        expect(showsProgressBadge(null, null)).toBe(false);
        expect(showsProgressBadge(null, 42)).toBe(false);
    });
});
