import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';

import {
    DEFAULT_MEMO_VISIBILITIES,
    filterPublishableMemos,
    isPublishableMemo,
    memoPlainText,
    memoTextFeature,
    normalizeMemoVisibility,
    parseMemoVisibilities
} from '../../src/lib/privacy';
import { countFeatureHits, countVisibilities, featuresOf, listTextFiles, referenceFeatures } from '../../scripts/check-public-data.mjs';
import { gtsStatusToMemo, trimMemos } from '../../scripts/sync-data.mjs';

/**
 * M1 隐私过滤：来源侧与消费者侧共用 src/lib/privacy.ts。
 * 这里覆盖过滤规则边界（缺字段 / 大小写 / 空内容 / 显式放开）与兜底检查脚本的检测逻辑。
 */
describe('Memos 可见性规则（src/lib/privacy.ts）', () => {
    it('默认只允许 PUBLIC', () => {
        expect(DEFAULT_MEMO_VISIBILITIES).toEqual(['PUBLIC']);
        expect(parseMemoVisibilities(undefined)).toEqual(['PUBLIC']);
        expect(parseMemoVisibilities('')).toEqual(['PUBLIC']);
        expect(parseMemoVisibilities('   ')).toEqual(['PUBLIC']);
    });

    it('显式配置才放开，且大小写/空格不敏感、去重', () => {
        expect(parseMemoVisibilities('public,unlisted')).toEqual(['PUBLIC', 'UNLISTED']);
        expect(parseMemoVisibilities(' PUBLIC , unlisted ,public ')).toEqual(['PUBLIC', 'UNLISTED']);
        expect(parseMemoVisibilities('private')).toEqual(['PRIVATE']);
        // 全是逗号/空白 → 回落默认，不因配置写错而放开
        expect(parseMemoVisibilities(', ,')).toEqual(['PUBLIC']);
    });

    it('可见性归一化：非字符串一律为空', () => {
        expect(normalizeMemoVisibility(' public ')).toBe('PUBLIC');
        expect(normalizeMemoVisibility(undefined)).toBe('');
        expect(normalizeMemoVisibility(null)).toBe('');
        expect(normalizeMemoVisibility(1)).toBe('');
        expect(normalizeMemoVisibility({})).toBe('');
    });

    it('缺 visibility 视为非公开（默认关闭）', () => {
        expect(isPublishableMemo({ visibility: 'PUBLIC' })).toBe(true);
        expect(isPublishableMemo({ visibility: 'public' })).toBe(true);
        expect(isPublishableMemo({})).toBe(false);
        expect(isPublishableMemo({ visibility: undefined })).toBe(false);
        expect(isPublishableMemo({ visibility: null })).toBe(false);
        expect(isPublishableMemo({ visibility: '' })).toBe(false);
        expect(isPublishableMemo(null)).toBe(false);
        expect(isPublishableMemo(undefined)).toBe(false);
    });

    it('UNLISTED / PRIVATE / DIRECT 默认全部拦下，显式放开才通过', () => {
        for (const visibility of ['UNLISTED', 'PRIVATE', 'DIRECT', 'unlisted']) {
            expect(isPublishableMemo({ visibility })).toBe(false);
            expect(isPublishableMemo({ visibility }, ['PUBLIC', 'UNLISTED'])).toBe(visibility.toUpperCase() === 'UNLISTED');
        }
    });

    it('过滤列表：空输入/非数组返回空数组，不抛错', () => {
        const memos = [{ visibility: 'PUBLIC', content: 'a' }, { visibility: 'PRIVATE', content: 'b' }, { content: 'c' }];
        expect(filterPublishableMemos(memos).map((m) => m.content)).toEqual(['a']);
        expect(filterPublishableMemos([])).toEqual([]);
        expect(filterPublishableMemos(null)).toEqual([]);
        expect(filterPublishableMemos(undefined)).toEqual([]);
    });

    it('空内容的特征返回空串（不产生假警报）', () => {
        expect(memoTextFeature('')).toBe('');
        expect(memoTextFeature('<p></p>')).toBe('');
        expect(memoTextFeature(undefined)).toBe('');
        expect(memoTextFeature('<p>短句</p>')).toBe('');
        expect(memoTextFeature('<p>这是一段足够长的非公开正文内容用于检测</p>')).toContain('这是一段足够长的非公开正文内容');
    });

    it('去标签：脚本/样式内容不参与特征提取', () => {
        const html = '<p>正文<b>加粗</b></p><script>alert(1)</script><style>.a{}</style>';
        expect(memoPlainText(html)).toBe('正文 加粗');
    });
});

describe('来源映射不兜底公开（scripts/sync-data.mjs）', () => {
    const baseStatus = {
        id: 'gts-missing-visibility',
        content: '<p>这条上游没有给 visibility</p>',
        created_at: '2026-11-26T08:00:00.000Z',
        account: { display_name: '1900', username: 'owner', url: 'https://gts.test/@owner' }
    };

    it('GoToSocial status 缺 visibility 时映射为空值，不兜底成 PUBLIC', () => {
        const memo = gtsStatusToMemo(baseStatus);
        expect(memo.visibility).toBe('');
        expect(isPublishableMemo(memo)).toBe(false);
    });

    it('缺 visibility 的 memo 落地时被丢弃（trimMemos 输出里没有它），store 侧也拿不到', () => {
        const dropped = gtsStatusToMemo(baseStatus);
        const kept = gtsStatusToMemo({ ...baseStatus, id: 'gts-public', visibility: 'PUBLIC' });
        const landed = trimMemos([dropped, kept], undefined);
        expect(landed.map((memo) => memo.id)).toEqual(['gts-public']);

        // 即使绕过落地把原始映射直接写进数据文件，store 侧同一套规则仍会拦下
        expect(filterPublishableMemos([dropped]).map((memo) => memo.id)).toEqual([]);
    });

    it('非法 visibility（null / 数字 / 对象 / 数组）同样落成空值且不可发布', () => {
        for (const visibility of [null, undefined, 1, 0, {}, ['PUBLIC'], '   ']) {
            const memo = gtsStatusToMemo({ ...baseStatus, visibility });
            expect(normalizeMemoVisibility(memo.visibility)).toBe('');
            expect(isPublishableMemo(memo)).toBe(false);
        }
    });

    it('显式给的 public 仍归一化成 PUBLIC 并放行（不是把过滤改成一律拦）', () => {
        const memo = gtsStatusToMemo({ ...baseStatus, visibility: ' public ' });
        expect(memo.visibility).toBe('PUBLIC');
        expect(trimMemos([memo], undefined).map((m) => m.id)).toEqual(['gts-missing-visibility']);
    });

    it('整批都不可发布时仍然硬失败（不拿空数组覆盖已有文件）', () => {
        expect(() => trimMemos([gtsStatusToMemo(baseStatus)], undefined)).toThrow(/拒绝用空数据覆盖已有文件/);
    });
});

describe('check-public-data.mjs 检测逻辑', () => {
    it('可见性计数只统计条数', () => {
        expect(countVisibilities([{ visibility: 'PUBLIC' }, { visibility: 'public' }, { visibility: 'PRIVATE' }, {}])).toEqual({
            PUBLIC: 2,
            PRIVATE: 1,
            '(缺失)': 1
        });
    });

    it('特征命中按内容子串统计，同一特征只算一次', () => {
        const features = ['非公开样本正文片段甲甲甲甲', '非公开样本正文片段乙乙乙乙'];
        expect(countFeatureHits('x 非公开样本正文片段甲甲甲甲 y 非公开样本正文片段甲甲甲甲', features)).toBe(1);
        expect(countFeatureHits('什么都没写', features)).toBe(0);
    });

    it('只为够长的记录生成特征', () => {
        const features = featuresOf([{ content: '<p>短</p>' }, { content: '<p>这是一条足够长的非公开正文，用来验证特征生成。</p>' }]);
        expect(features).toHaveLength(1);
        expect(features[0]).toContain('这是一条足够长的非公开正文');
    });

    it('扫描目录只收文本文件，跳过图片', () => {
        const dir = mkdtempSync(path.join(os.tmpdir(), 'check-public-'));
        try {
            mkdirSync(path.join(dir, 'sub'));
            writeFileSync(path.join(dir, 'a.html'), '<html></html>');
            writeFileSync(path.join(dir, 'sub', 'b.json'), '{}');
            writeFileSync(path.join(dir, 'c.jpg'), 'binary');
            const files = listTextFiles(dir).map((f) => path.relative(dir, f)).sort();
            expect(files).toEqual(['a.html', path.join('sub', 'b.json')]);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it('参考特征会排除「同文已公开」的片段（避免转发/重发的假阳性）', () => {
        const dir = mkdtempSync(path.join(os.tmpdir(), 'ref-features-'));
        try {
            const backup = path.join(dir, 'backup.json');
            writeFileSync(
                backup,
                JSON.stringify([
                    { visibility: 'PRIVATE', content: '<p>这段私密正文同时在公开文章里出现过所以不能当泄露信号</p>' },
                    { visibility: 'UNLISTED', content: '<p>这段未列出正文只在备份里出现可以作为检测特征</p>' },
                    { visibility: 'PUBLIC', content: '<p>公开正文</p>' }
                ])
            );
            const corpus = '这段私密正文同时在公开文章里出现过所以不能当泄露信号';
            const reference = referenceFeatures(backup, ['PUBLIC'], corpus);
            expect(reference.total).toBe(3);
            expect(reference.nonPublic).toBe(2);
            expect(reference.excluded).toBe(1);
            expect(reference.features).toHaveLength(1);
            expect(reference.features[0]).toContain('这段未列出正文只在备份里出现');
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it('真实仓库跑一遍：退出码 0（data 已清理，dist 若存在也不应命中）', () => {
        const root = path.join(__dirname, '..', '..');
        const out = execFileSync('node', ['scripts/check-public-data.mjs'], { cwd: root, encoding: 'utf8', timeout: 60_000 });
        expect(out).toContain('src/data');
        expect(out).toMatch(/通过|跳过/);
    }, 120_000);
});
