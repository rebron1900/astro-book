import { describe, expect, it } from 'vitest';
import { escapeHtml, excerptOf, renderHighlights, shortDuration } from '../../src/lib/reading-highlights';
import type { ReadingHighlight } from '../../src/lib/reading';

/** 划线是电子书里的用户文本，这几条是最典型的注入面。 */
const XSS_CASES = ['<img src=x onerror=alert(1)>', '<script>alert(1)</script>', '[click](javascript:alert(1))', '<a href="javascript:alert(1)">x</a>', '<svg/onload=alert(1)>', '"><iframe src=//x>'];

const DAY = '2026-09-23';
const DAY2 = '2026-09-21';

function one(content: string): ReadingHighlight[] {
    return [{ chapter: `章 <${content}>`, content, readerNote: '批注 <b>x</b>', date: DAY }];
}

describe('escapeHtml', () => {
    it('把 < > & " \' 全部转成实体', () => {
        expect(escapeHtml(`<a href="x">&'`)).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&#39;');
    });
});

describe('renderHighlights 转义', () => {
    it('危险片段不得产生可执行标签或属性', () => {
        for (const bad of XSS_CASES) {
            const html = renderHighlights(one(bad));
            expect(html).not.toMatch(/<script/i);
            expect(html).not.toMatch(/<[^>]*\son\w+\s*=/i);
            expect(html).not.toMatch(/href\s*=\s*['"]javas?cript:/i);
            expect(html).not.toMatch(/<img/i);
            expect(html).not.toMatch(/<svg/i);
            expect(html).not.toMatch(/<iframe/i);
        }
    });

    it('正文里的换行保留，空行分段', () => {
        const html = renderHighlights([{ chapter: '', content: '第一段\n仍属第一段\n\n第二段', readerNote: '', date: DAY }]);
        expect(html).toContain('<br />');
        expect((html.match(/<p>/g) ?? []).length).toBeGreaterThanOrEqual(2);
    });
});

describe('renderHighlights 结构', () => {
    it('按章节分组，章节标题只出现一次', () => {
        const html = renderHighlights([
            { chapter: '第八章　动物并不凶猛', content: 'a', readerNote: '', date: DAY },
            { chapter: '第八章　动物并不凶猛', content: 'b', readerNote: '', date: DAY },
            { chapter: '第九章', content: 'c', readerNote: '', date: DAY }
        ]);
        expect((html.match(/rd-tip-chapter/g) ?? []).length).toBe(2);
        expect((html.match(/rd-tip-quote/g) ?? []).length).toBe(3);
    });

    it('有 readerNote 才输出批注，空的不输出', () => {
        expect(renderHighlights(one('正文'))).toContain('rd-tip-note');
        expect(renderHighlights([{ chapter: '', content: '正文', readerNote: '', date: DAY }])).not.toContain('rd-tip-note');
    });

    it('没有划线时给出明确空态，不留空白气泡', () => {
        expect(renderHighlights([])).toContain('当天没有划线');
    });

    it('超过 30 条只渲染最近 30 条并提示更早的条数', () => {
        const many: ReadingHighlight[] = Array.from({ length: 35 }, (_, i) => ({ chapter: '', content: `第 ${i} 条`, readerNote: '', date: DAY }));
        const html = renderHighlights(many);
        expect((html.match(/rd-tip-quote/g) ?? []).length).toBe(30);
        expect(html).toContain('还有较早的 5 条');
        // 面板里能读到卡片摘录引用的那条（最新一条）
        expect(html).toContain('第 34 条');
        expect(html).not.toContain('第 4 条');
    });

    it('按日期分组：日期新的在前，同一日期只出一个日期标签', () => {
        const html = renderHighlights([
            { chapter: '', content: '早一天划的', readerNote: '', date: DAY2 },
            { chapter: '', content: '当天划的第一条', readerNote: '', date: DAY },
            { chapter: '', content: '当天划的第二条', readerNote: '', date: DAY }
        ]);
        expect((html.match(/rd-tip-date/g) ?? []).length).toBe(2);
        expect((html.match(/rd-tip-day/g) ?? []).length).toBe(2);
        // 新的日期在前
        expect(html.indexOf('2026 年 9 月 23 日')).toBeLessThan(html.indexOf('2026 年 9 月 21 日'));
        expect(html).toContain('datetime="2026-09-23"');
    });

    it('卡片自己那天的日期头不渲染（面板直接从章节/第一条划线开始）', () => {
        const sameDay: ReadingHighlight[] = [
            { chapter: '第一章', content: '当天的划线', readerNote: '', date: DAY },
            { chapter: '第一章', content: '当天的第二条', readerNote: '', date: DAY }
        ];
        const html = renderHighlights(sameDay, DAY);
        expect(html).not.toContain('rd-tip-date');
        expect(html).not.toContain('2026 年 9 月 23 日');
        expect(html.trimStart().startsWith('<section class="rd-tip-day">')).toBe(true);
        expect(html.indexOf('rd-tip-chapter')).toBeGreaterThan(-1);
        // 章节 mdash 结构仍在，第一条划线仍在
        expect(html).toContain('当天的划线');
    });

    it('划线来自别的日子时，那一组仍带日期做区分', () => {
        const html = renderHighlights(
            [
                { chapter: '', content: '早一天划的', readerNote: '', date: DAY2 },
                { chapter: '', content: '当天划的', readerNote: '', date: DAY }
            ],
            DAY
        );
        expect((html.match(/rd-tip-date/g) ?? []).length).toBe(1);
        expect(html).toContain('2026 年 9 月 21 日');
        expect(html).not.toContain('2026 年 9 月 23 日');
    });

    it('划线没带日期时用卡片日期兜底，也不出日期头；连兜底都没有同样不出', () => {
        const withFallback = renderHighlights([{ chapter: '', content: '无日期的划线', readerNote: '', date: '' }], '2026-11-02');
        expect(withFallback).not.toContain('rd-tip-date');
        expect(withFallback).toContain('无日期的划线');

        const bare = renderHighlights([{ chapter: '', content: '无日期的划线', readerNote: '', date: '' }]);
        expect(bare).not.toContain('rd-tip-date');
        expect(bare).toContain('无日期的划线');
    });
});

describe('卡片辅助', () => {
    it('摘录取最近一条并加中文引号，超出 60 字截断', () => {
        expect(excerptOf([{ chapter: '', content: '早的', readerNote: '', date: DAY }, { chapter: '', content: '晚的', readerNote: '', date: DAY }])).toBe('“晚的”');
        const long = excerptOf([{ chapter: '', content: 'x'.repeat(80), readerNote: '', date: DAY }]);
        expect(long.endsWith('…”')).toBe(true);
        expect(excerptOf([])).toBe('');
    });

    it('短时长格式：25 min / 1h 20m', () => {
        expect(shortDuration(25 * 60)).toBe('25 分钟');
        expect(shortDuration(56)).toBe('1 分钟');
        expect(shortDuration(80 * 60)).toBe('1 小时 20 分钟');
        expect(shortDuration(60 * 60)).toBe('1 小时');
    });
});
