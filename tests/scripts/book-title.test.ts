import { describe, expect, it } from 'vitest';
import { applyOverride, cleanBookAuthor, cleanBookTitle } from '../../scripts/lib/book-title.mjs';

describe('cleanBookTitle', () => {
    const cases: Array<[string, string]> = [
        ['于谦动物园 (于谦) (z-library.sk, 1lib.sk, z-lib.sk)', '于谦动物园 (于谦)'],
        ['三十岁的成人礼_搭车去柏林_刘畅著,_刘畅,_author,_Liu_C_z_library_sk,_1lib_sk,', '三十岁的成人礼_搭车去柏林'],
        ['怀孕呵护指南【豆瓣评分9.3！超人气女性健康科普达人六层楼先生】', '怀孕呵护指南'],
        ['挽救计划(《火星救援》作者安迪·威尔全新力作,出版后连续16周）', '挽救计划'],
        ['高性价比人生指南', '高性价比人生指南'],
        ['夜航西飞', '夜航西飞'],
        // 正常书名不能被误伤
        ['Sapiens (Yuval Noah Harari)', 'Sapiens (Yuval Noah Harari)'],
        ['三体', '三体'],
        // 版本标记属于书名：全集 / 套装 / 年度版 不能被当营销语砍掉
        ['三体（全集）', '三体（全集）'],
        ['明朝那些事儿（套装）', '明朝那些事儿（套装）']
    ];

    for (const [input, expected] of cases) {
        it(`清洗 ${JSON.stringify(input.slice(0, 24))}…`, () => {
            expect(cleanBookTitle(input)).toBe(expected);
        });
    }

    it('截断的未闭合括号也能砍掉', () => {
        expect(cleanBookTitle('怀孕呵护指南【豆瓣评分9.3！超人气女性健康科普达人六层楼先生')).toBe('怀孕呵护指南');
    });

    it('空输入返回空串，不抛错', () => {
        expect(cleanBookTitle('')).toBe('');
        expect(cleanBookTitle(null as unknown as string)).toBe('');
    });
});

describe('cleanBookAuthor', () => {
    it('Unknown / 空 / 未知 一律不展示', () => {
        for (const raw of ['Unknown', 'unknown', '', '未知', '佚名', 'N/A', null as unknown as string]) {
            expect(cleanBookAuthor(raw)).toBe('');
        }
    });

    it('国别前缀原样保留', () => {
        expect(cleanBookAuthor('【美】史蒂文·普莱斯菲尔德')).toBe('【美】史蒂文·普莱斯菲尔德');
        expect(cleanBookAuthor('[德]埃克哈特·托利')).toBe('[德]埃克哈特·托利');
        expect(cleanBookAuthor('(日)东野圭吾')).toBe('(日)东野圭吾');
        expect(cleanBookAuthor('[日] 石田裕辅')).toBe('[日] 石田裕辅');
    });
});

describe('applyOverride', () => {
    const overrides = {
        'md5:abc': { title: '归一后的名字' },
        '清洗后的书名': { title: '按书名命中', author: '作者甲' },
        '重复书': { title: '保留项' },
        'md5:dup': { hide: true }
    };

    it('sync_id 命中优先', () => {
        expect(applyOverride({ title: '原名', author: '' }, 'md5:abc', overrides).title).toBe('归一后的名字');
    });

    it('书名命中时可用 author 覆盖', () => {
        const out = applyOverride({ title: '清洗后的书名', author: '' }, 'md5:none', overrides);
        expect(out).toMatchObject({ title: '按书名命中', author: '作者甲' });
    });

    it('hide 标记原样透出，供调用方剔除重复书', () => {
        expect(applyOverride({ title: 'x', author: '' }, 'md5:dup', overrides).hide).toBe(true);
    });

    it('没有命中时原样返回且 hide=false', () => {
        expect(applyOverride({ title: 'y', author: 'z' }, 'md5:none', overrides)).toEqual({ title: 'y', author: 'z', hide: false });
    });
});

describe('overrideOutputs（后处理跳过二次清洗）', () => {
    it('byTitle 与 byMd5 的产出名都算人工定稿', async () => {
        const { overrideOutputs } = await import('../../scripts/sync-reading.mjs');
        const fixed = overrideOutputs({
            byTitle: { 重复书: { title: '保留项' } },
            byMd5: { 'md5:abc': { title: '三体【全集】', author: '刘慈欣' } }
        });
        expect(fixed.titles.has('保留项')).toBe(true);
        expect(fixed.titles.has('三体【全集】')).toBe(true);
        expect(fixed.authors.has('刘慈欣')).toBe(true);
        expect(fixed.titles.has('重复书')).toBe(false);
    });

    it('人工定稿的书名不会再被规则改写', async () => {
        const { overrideOutputs } = await import('../../scripts/sync-reading.mjs');
        const { titles } = overrideOutputs({ byTitle: {}, byMd5: { 'md5:abc': { title: '三体【全集】' } } });
        const wouldClean = cleanBookTitle('三体【全集】');
        expect(titles.has('三体【全集】')).toBe(true);
        expect(wouldClean).not.toBe('三体【全集】');
    });
});
