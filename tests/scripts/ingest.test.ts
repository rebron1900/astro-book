import { describe, expect, it, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { assertContractVersion, getContract } from '../../scripts/lib/ingest/contracts.mjs';
import { validateDataset, validateFields, parseFieldType } from '../../scripts/lib/ingest/validate.mjs';
import { runIngestSource, sanitize, loadSource, headerPairs, AUTH_HEADERS } from '../../scripts/lib/ingest/executor.mjs';
import { readState } from '../../scripts/lib/ingest/state.mjs';
import * as embySource from '../../scripts/lib/sources/emby.mjs';

/**
 * M2 模块层验收：契约校验 + 执行器语义（失败不写盘、多输出一致、空结果、幂等、锁、dry-run）
 * 用临时目录 + 临时来源模块，不发真实网络、不碰仓库里的 src/data。
 */

const tempRoots: string[] = [];

function makeProject(): string {
    const root = mkdtempSync(path.join(os.tmpdir(), 'ingest-'));
    tempRoots.push(root);
    mkdirSync(path.join(root, 'src', 'data'), { recursive: true });
    mkdirSync(path.join(root, 'public'), { recursive: true });
    return root;
}

function writeModule(root: string, name: string, meta: Record<string, unknown>, body: string): string {
    const file = path.join(root, `${name}.mjs`);
    writeFileSync(file, `export const meta = ${JSON.stringify(meta)};\nexport async function collect(ctx) {\n${body}\n}\n`, 'utf8');
    return pathToFileURL(file).href;
}

const quiet = { log() {}, warn() {}, error() {} };

function contractFor(dataset: string, overrides: Record<string, unknown> = {}) {
    return {
        [dataset]: {
            version: 1,
            file: 'out.json',
            writeMode: 'replace',
            key: 'id',
            allowEmpty: false,
            item: { id: 'string', name: 'string' },
            ...overrides
        }
    };
}

function readJson(root: string, rel: string) {
    return JSON.parse(readFileSync(path.join(root, rel), 'utf8'));
}

afterEach(() => {
    for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('契约与字段校验', () => {
    it('真实契约可加载且版本可对照', () => {
        expect(getContract('emby.viewing').file).toBe('emby.json');
        expect(() => assertContractVersion('emby.viewing', 1)).not.toThrow();
        expect(() => assertContractVersion('emby.viewing', 2)).toThrow(/契约版本不匹配/);
        expect(() => getContract('不存在的 dataset')).toThrow(/未知 dataset/);
    });

    it('类型串：可选、联合、非法类型', () => {
        expect(parseFieldType('string?')).toEqual({ union: ['string'], optional: true, raw: 'string?' });
        expect(parseFieldType('number|null').union).toEqual(['number', 'null']);
        expect(() => parseFieldType('date')).toThrow(/不受支持/);
    });

    it('必填缺失、类型不符、null 许可', () => {
        expect(validateFields({}, { id: 'string' })).toEqual(['字段 id 缺失（要求 string）']);
        expect(validateFields({ id: 1 }, { id: 'string' })).toHaveLength(1);
        expect(validateFields({ id: 'a', lastPlayedAt: null }, { id: 'string', lastPlayedAt: 'number|null' })).toEqual([]);
        expect(validateFields({ id: 'a', lastPlayedAt: 'x' }, { id: 'string', lastPlayedAt: 'number|null' })).toHaveLength(1);
        expect(validateFields(null, { id: 'string' })).toEqual(['记录不是对象']);
    });

    it('真实 emby 契约：重复主键 / 排序不满足 / 正常数据', () => {
        const valid = [
            { id: 'a', type: 'movie', title: 'A', played: true, playedPercent: 100, lastPlayedAt: 20, rating: null, seriesRating: null, seriesOverview: null, cover: null, minutes: null },
            { id: 'b', type: 'episode', title: 'B', played: false, playedPercent: 12, lastPlayedAt: 10, rating: null, seriesRating: null, seriesOverview: null, cover: null, minutes: 30 }
        ];
        expect(validateDataset('emby.viewing', valid)).toMatchObject({ ok: true, count: 2 });
        const duplicate = [{ ...valid[0] }, { ...valid[0], lastPlayedAt: 10 }];
        expect(validateDataset('emby.viewing', duplicate).errors.join()).toMatch(/重复的主键/);
        const unsorted = [valid[1], valid[0]];
        expect(validateDataset('emby.viewing', unsorted).errors.join()).toMatch(/排序后置条件/);
    });

    it('map 型契约：前缀白名单与值类型', () => {
        const ok = validateDataset('imagemeta.sizes', { size_a: { width: 1, height: 2 }, error_b: { timestamp: 1, error: 'x' } });
        expect(ok.ok).toBe(true);
        expect(ok.count).toBe(2);
        const badPrefix = validateDataset('imagemeta.sizes', { other: { width: 1 } });
        expect(badPrefix.errors.join()).toMatch(/不在允许前缀/);
        const badValue = validateDataset('imagemeta.sizes', { size_a: 'x' });
        expect(badValue.ok).toBe(false);
    });
});

describe('执行器：失败不写盘、多输出一致', () => {
    it('缺凭据 → auth，失败且不写盘', async () => {
        const root = makeProject();
        const file = writeModule(root, 'cred', { id: 'fake', optional: false, credentials: ['FAKE_KEY'], datasets: ['fake.data'] }, 'return { outputs: [] };');
        await expect(runIngestSource('fake', { projectRoot: root, registry: { fake: { module: file, optional: false } }, contracts: contractFor('fake.data'), env: {}, log: quiet })).rejects.toMatchObject({
            code: 'auth'
        });
        expect(existsSync(path.join(root, 'src/data/out.json'))).toBe(false);
    });

    it('只注入声明凭据', async () => {
        const root = makeProject();
        const file = writeModule(
            root,
            'inject',
            { id: 'fake', optional: false, credentials: ['A_KEY'], optionalCredentials: ['B_KEY'], datasets: ['fake.data'] },
            "return { outputs: [{ dataset: 'fake.data', data: [{ id: 'x', name: Object.keys(ctx.env).sort().join(',') }], complete: true }] };"
        );
        await runIngestSource('fake', {
            projectRoot: root,
            registry: { fake: { module: file, optional: false } },
            contracts: contractFor('fake.data'),
            env: { A_KEY: 'a', B_KEY: 'b', OTHER_SECRET: 'c' },
            log: quiet
        });
        expect(readJson(root, 'src/data/out.json')).toEqual([{ id: 'x', name: 'A_KEY,B_KEY' }]);
    });

    it('分页不全（complete:false）→ 不写盘，旧文件保持不变', async () => {
        const root = makeProject();
        writeFileSync(path.join(root, 'src/data/out.json'), '[{"id":"old","name":"旧"}]');
        const file = writeModule(root, 'incomplete', { id: 'fake', optional: false, credentials: [], datasets: ['fake.data'] }, "return { outputs: [{ dataset: 'fake.data', data: [], complete: false }] };");
        await expect(
            runIngestSource('fake', { projectRoot: root, registry: { fake: { module: file, optional: false } }, contracts: contractFor('fake.data'), log: quiet })
        ).rejects.toMatchObject({ code: 'incomplete' });
        expect(readJson(root, 'src/data/out.json')).toEqual([{ id: 'old', name: '旧' }]);
    });

    it('重复 ID → 整源失败，报首个重复 id，不写盘', async () => {
        const root = makeProject();
        writeFileSync(path.join(root, 'src/data/out.json'), '[{"id":"old","name":"旧"}]');
        const file = writeModule(
            root,
            'dup',
            { id: 'fake', optional: false, credentials: [], datasets: ['fake.data'] },
            "return { outputs: [{ dataset: 'fake.data', data: [{ id: 'a', name: '1' }, { id: 'a', name: '2' }], complete: true }] };"
        );
        const error = await runIngestSource('fake', { projectRoot: root, registry: { fake: { module: file, optional: false } }, contracts: contractFor('fake.data'), log: quiet }).catch((e) => e);
        expect(error.code).toBe('contract');
        expect(error.message).toMatch(/id=a/);
        expect(readJson(root, 'src/data/out.json')).toEqual([{ id: 'old', name: '旧' }]);
    });

    it('多输出部分失败 → 两个文件都不写', async () => {
        const root = makeProject();
        writeFileSync(path.join(root, 'src/data/out.json'), '{"old":true}');
        writeFileSync(path.join(root, 'src/data/second.json'), '{"old":true}');
        const contracts2 = {
            'fake.one': { version: 1, file: 'out.json', writeMode: 'replace', key: 'id', allowEmpty: false, item: { id: 'string', name: 'string' } },
            'fake.two': { version: 1, file: 'second.json', writeMode: 'replace', key: 'id', allowEmpty: false, item: { id: 'string', name: 'string' } }
        };
        const file = writeModule(
            root,
            'multi',
            { id: 'fake', optional: false, credentials: [], datasets: ['fake.one', 'fake.two'] },
            "return { outputs: [\n  { dataset: 'fake.one', data: [{ id: 'a', name: '1' }], complete: true },\n  { dataset: 'fake.two', data: [{ id: 'b', name: 2 }], complete: true }\n] };"
        );
        await expect(runIngestSource('fake', { projectRoot: root, registry: { fake: { module: file, optional: false } }, contracts: contracts2, log: quiet })).rejects.toMatchObject({
            code: 'contract'
        });
        expect(readJson(root, 'src/data/out.json')).toEqual({ old: true });
        expect(readJson(root, 'src/data/second.json')).toEqual({ old: true });
    });

    it('空结果：allowEmpty:false 保留旧数据；allowEmpty:true 写空', async () => {
        const root = makeProject();
        writeFileSync(path.join(root, 'src/data/out.json'), '[{"id":"old","name":"旧"}]');
        const emptyModule = (name: string) =>
            writeModule(root, name, { id: 'fake', optional: false, credentials: [], datasets: ['fake.data'] }, "return { outputs: [{ dataset: 'fake.data', data: [], complete: true }] };");

        await expect(
            runIngestSource('fake', { projectRoot: root, registry: { fake: { module: emptyModule('e1'), optional: false } }, contracts: contractFor('fake.data'), log: quiet })
        ).rejects.toMatchObject({ code: 'empty' });
        expect(readJson(root, 'src/data/out.json')).toHaveLength(1);

        await runIngestSource('fake', {
            projectRoot: root,
            registry: { fake: { module: emptyModule('e2'), optional: false } },
            contracts: contractFor('fake.data', { allowEmpty: true }),
            log: quiet
        });
        expect(readJson(root, 'src/data/out.json')).toEqual([]);
    });

    it('merge 写入保留旧记录，重复 key 以新值为准', async () => {
        const root = makeProject();
        writeFileSync(path.join(root, 'src/data/out.json'), JSON.stringify([{ id: 'a', name: '旧' }, { id: 'b', name: '保留' }]));
        const file = writeModule(root, 'merge', { id: 'fake', optional: false, credentials: [], datasets: ['fake.data'] }, "return { outputs: [{ dataset: 'fake.data', data: [{ id: 'a', name: '新' }, { id: 'c', name: '新增' }], complete: true }] };");
        await runIngestSource('fake', {
            projectRoot: root,
            registry: { fake: { module: file, optional: false } },
            contracts: contractFor('fake.data', { writeMode: 'merge' }),
            log: quiet
        });
        expect(readJson(root, 'src/data/out.json')).toEqual([
            { id: 'a', name: '新' },
            { id: 'b', name: '保留' },
            { id: 'c', name: '新增' }
        ]);
    });

    it('幂等：同一输入连跑两次，第二次 changed=0 且文件不变', async () => {
        const root = makeProject();
        const file = writeModule(root, 'idem', { id: 'fake', optional: false, credentials: [], datasets: ['fake.data'] }, "return { outputs: [{ dataset: 'fake.data', data: [{ id: 'a', name: '1' }], complete: true }] };");
        const options = { projectRoot: root, registry: { fake: { module: file, optional: false } }, contracts: contractFor('fake.data'), log: quiet };
        const first = await runIngestSource('fake', options);
        const second = await runIngestSource('fake', options);
        expect(first.changed).toBe(1);
        expect(second.changed).toBe(0);
    });

    it('dry-run：报告将写入但不落盘、不写状态、不写封面', async () => {
        const root = makeProject();
        const file = writeModule(
            root,
            'dry',
            { id: 'fake', optional: false, credentials: [], datasets: ['fake.data'], artifacts: [{ dir: 'public/covers' }] },
            "ctx.writeArtifact('covers/x.jpg', Buffer.from('x'));\nreturn { outputs: [{ dataset: 'fake.data', data: [{ id: 'a', name: '1' }], complete: true }] };"
        );
        const result = await runIngestSource('fake', { projectRoot: root, registry: { fake: { module: file, optional: false } }, contracts: contractFor('fake.data'), dryRun: true, log: quiet });
        expect(result.changed).toBe(0);
        expect(result.report.join()).toMatch(/dry-run 将写入/);
        expect(existsSync(path.join(root, 'src/data/out.json'))).toBe(false);
        expect(existsSync(path.join(root, 'public/covers/x.jpg'))).toBe(false);
        expect(existsSync(path.join(root, '.cache/sync-state.json'))).toBe(false);
    });

    it('并发锁：锁被活进程占用时直接失败（code=lock）', async () => {
        const root = makeProject();
        mkdirSync(path.join(root, '.cache'), { recursive: true });
        writeFileSync(path.join(root, '.cache/sync.lock'), JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
        const file = writeModule(root, 'lock', { id: 'fake', optional: false, credentials: [], datasets: ['fake.data'] }, "return { outputs: [{ dataset: 'fake.data', data: [{ id: 'a', name: '1' }], complete: true }] };");
        await expect(
            runIngestSource('fake', { projectRoot: root, registry: { fake: { module: file, optional: false } }, contracts: contractFor('fake.data'), log: quiet })
        ).rejects.toMatchObject({ code: 'lock' });
    });

    it('输出未声明的 dataset → contract 失败', async () => {
        const root = makeProject();
        const file = writeModule(root, 'undeclared', { id: 'fake', optional: false, credentials: [], datasets: ['fake.data'] }, "return { outputs: [{ dataset: 'other.data', data: [], complete: true }] };");
        await expect(
            runIngestSource('fake', {
                projectRoot: root,
                registry: { fake: { module: file, optional: false } },
                contracts: { ...contractFor('fake.data'), 'other.data': contractFor('x')['x'] },
                log: quiet
            })
        ).rejects.toMatchObject({ code: 'contract' });
    });

    it('registry 与 meta 的可选性不一致 → registry 硬失败', async () => {
        const root = makeProject();
        const file = writeModule(root, 'mismatch', { id: 'fake', optional: true, credentials: [], datasets: ['fake.data'] }, 'return { outputs: [] };');
        await expect(loadSource('fake', { fake: { module: file, optional: false } })).rejects.toMatchObject({ code: 'registry' });
    });

    it('附属产物只能写进 meta.artifacts 声明的目录', async () => {
        const root = makeProject();
        const file = writeModule(
            root,
            'artifact',
            { id: 'fake', optional: false, credentials: [], datasets: ['fake.data'], artifacts: [{ dir: 'public/covers' }] },
            "ctx.writeArtifact('evil/x.jpg', Buffer.from('x'));\nreturn { outputs: [] };"
        );
        await expect(
            runIngestSource('fake', { projectRoot: root, registry: { fake: { module: file, optional: false } }, contracts: contractFor('fake.data'), log: quiet })
        ).rejects.toMatchObject({ code: 'artifact' });
        expect(existsSync(path.join(root, 'public/evil/x.jpg'))).toBe(false);
    });
});

describe('执行器：失败分类与脱敏', () => {
    it('401 → code=auth；429/503 → code=upstream', async () => {
        const root = makeProject();
        const mk = (name: string) =>
            writeModule(root, name, { id: 'fake', optional: false, credentials: [], datasets: ['fake.data'] }, "await ctx.fetchJson('https://example.test/data');\nreturn { outputs: [] };");
        const call = (name: string, status: number) =>
            runIngestSource('fake', {
                projectRoot: root,
                registry: { fake: { module: mk(name), optional: false } },
                contracts: contractFor('fake.data'),
                log: quiet,
                fetchImpl: async () => new Response('nope', { status })
            });
        await expect(call('a401', 401)).rejects.toMatchObject({ code: 'auth' });
        await expect(call('a403', 403)).rejects.toMatchObject({ code: 'auth' });
        await expect(call('a429', 429)).rejects.toMatchObject({ code: 'upstream' });
        await expect(call('a503', 503)).rejects.toMatchObject({ code: 'upstream' });
    });

    it('日志与错误信息里的密钥被替换为 ***', () => {
        expect(sanitize('get https://x.test/a?api_key=SECRETVALUE123', ['SECRETVALUE123'])).not.toContain('SECRETVALUE123');
        expect(sanitize('token=plaintextvalue')).toContain('token=***');
        expect(sanitize('Authorization=Bearer abc', ['Bearer abc'])).not.toContain('Bearer abc');
    });
});

describe('真实 emby 模块（desensitized fetch stub）', () => {
    const now = Date.now();

    function embyFetch(calls: { index: number; covers: number }) {
        return async (url: string) => {
            const text = String(url);
            if (text.includes('/Images/Primary')) {
                calls.covers += 1;
                return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
            }
            if (text.includes('/Users/u1/Items/m1')) {
                return new Response(
                    JSON.stringify({
                        Id: 'm1',
                        Name: '沙丘 2',
                        Type: 'Movie',
                        ProductionYear: 2024,
                        Genres: ['科幻'],
                        RunTimeTicks: 600_000_000 * 166,
                        CommunityRating: 8.1,
                        Overview: '  沙漠与预言。 ',
                        ImageTags: { Primary: 'tag1' },
                        UserData: { Played: true, LastPlayedDate: new Date(now - 86400000).toISOString() }
                    }),
                    { status: 200 }
                );
            }
            if (text.includes('/Users/u1/Items?Recursive')) {
                calls.index += 1;
                return new Response(JSON.stringify({ Items: [{ Id: 'm1', Type: 'Movie', Name: '沙丘 2', UserData: { Played: true } }] }), { status: 200 });
            }
            return new Response('not found', { status: 404 });
        };
    }

    it('产出契约合法数据 + 封面写入 public/emby-cover + 状态更新；重复运行幂等', async () => {
        const root = makeProject();
        const calls = { index: 0, covers: 0 };
        const options = {
            projectRoot: root,
            env: { EMBY_BASE_URL: 'https://emby.test', EMBY_USER_ID: 'u1', EMBY_API_KEY: 'test-emby-key' },
            log: quiet,
            fetchImpl: embyFetch(calls)
        };
        const first = await runIngestSource('emby', options);
        expect(first.changed).toBe(1);
        const data = readJson(root, 'src/data/emby.json');
        expect(data).toHaveLength(1);
        expect(data[0]).toMatchObject({ id: 'm1', type: 'movie', title: '沙丘 2', cover: '/emby-cover/m1.jpg', played: true, minutes: 166, seriesRating: null });
        expect(existsSync(path.join(root, 'public/emby-cover/m1.jpg'))).toBe(true);
        const state = readState(root);
        expect(state.sources.emby.lastRun?.['emby.viewing']).toBe(1);

        const second = await runIngestSource('emby', options);
        expect(second.changed).toBe(0);
        expect(readJson(root, 'src/data/emby.json')).toEqual(data);
    });

    it('最近 90 天为空 → 契约 allowEmpty:false 拒绝写盘', async () => {
        const root = makeProject();
        const fetchImpl = async (url: string) => {
            const text = String(url);
            if (text.includes('/Users/u1/Items/m1')) {
                return new Response(JSON.stringify({ Id: 'm1', Type: 'Movie', Name: '旧片', UserData: { Played: true, LastPlayedDate: '2020-01-01T00:00:00Z' } }), { status: 200 });
            }
            if (text.includes('/Users/u1/Items?Recursive')) {
                return new Response(JSON.stringify({ Items: [{ Id: 'm1', Type: 'Movie', Name: '旧片', UserData: { Played: true } }] }), { status: 200 });
            }
            return new Response('not found', { status: 404 });
        };
        await expect(
            runIngestSource('emby', {
                projectRoot: root,
                env: { EMBY_BASE_URL: 'https://emby.test', EMBY_USER_ID: 'u1', EMBY_API_KEY: 'test-emby-key' },
                log: quiet,
                fetchImpl
            })
        ).rejects.toMatchObject({ code: 'empty' });
        expect(existsSync(path.join(root, 'src/data/emby.json'))).toBe(false);
    });

    it('模块导入无副作用：meta 声明齐全，collect 是函数', () => {
        expect(embySource.meta).toMatchObject({ id: 'emby', optional: true, datasets: ['emby.viewing'] });
        expect(embySource.meta.credentials).toContain('EMBY_API_KEY');
        expect(typeof embySource.collect).toBe('function');
    });
});

describe('真实 imagemeta 模块（stub fetch，只补缺失项）', () => {
    it('读取 ghost.json 收集 cdn 图片，保留已有记录并写入新尺寸；第二次跑不再请求', async () => {
        const root = makeProject();
        const ghost = {
            posts: [{ feature_image: 'https://cdn.1900.live/a.png', html: '<p><img src="https://cdn.1900.live/b.png"></p><p><img src="https://other.test/c.png"></p>' }],
            pages: []
        };
        writeFileSync(path.join(root, 'src/data/ghost.json'), JSON.stringify(ghost));
        writeFileSync(path.join(root, 'src/data/image-meta.json'), JSON.stringify({ 'size_https://cdn.1900.live/a.png': { width: 10, height: 20 } }));
        const urls: string[] = [];
        const fetchImpl = async (url: string) => {
            urls.push(String(url));
            return new Response(JSON.stringify({ width: 30, height: 40 }), { status: 200 });
        };
        const first = await runIngestSource('imagemeta', { projectRoot: root, log: quiet, fetchImpl });
        expect(first.changed).toBe(1);
        expect(urls).toHaveLength(1);
        expect(urls[0]).toContain('cdn.1900.live/b.png');
        const data = readJson(root, 'src/data/image-meta.json');
        expect(data['size_https://cdn.1900.live/a.png']).toEqual({ width: 10, height: 20 });
        expect(data['size_https://cdn.1900.live/b.png']).toEqual({ width: 30, height: 40 });
        expect(data['size_https://other.test/c.png']).toBeUndefined();

        const second = await runIngestSource('imagemeta', { projectRoot: root, log: quiet, fetchImpl });
        expect(second.changed).toBe(0);
        expect(urls).toHaveLength(1);
    });

    it('缺少 ghost.json → 抛错，不写空索引', async () => {
        const root = makeProject();
        await expect(runIngestSource('imagemeta', { projectRoot: root, log: quiet })).rejects.toMatchObject({ code: 'upstream' });
        expect(existsSync(path.join(root, 'src/data/image-meta.json'))).toBe(false);
    });
});

describe('新增来源演示：只加模块 + registry 一行 + 契约，不改 executor', () => {
    it('一个最小来源跑通：注册 → 采集 → 校验 → 写盘', async () => {
        const root = makeProject();
        const file = writeModule(
            root,
            'demo',
            { id: 'demo', optional: false, credentials: [], datasets: ['demo.items'] },
            "const now = 1700000000000;\nreturn { outputs: [{ dataset: 'demo.items', data: [{ id: 'd1', name: '示例条目', at: now }], complete: true }] };"
        );
        const registry = { demo: { module: file, optional: false } };
        const contracts = { 'demo.items': { version: 1, file: 'demo.json', writeMode: 'replace', key: 'id', allowEmpty: false, item: { id: 'string', name: 'string', at: 'number' } } };
        const result = await runIngestSource('demo', { projectRoot: root, registry, contracts, log: quiet });
        expect(result.changed).toBe(1);
        expect(readJson(root, 'src/data/demo.json')).toEqual([{ id: 'd1', name: '示例条目', at: 1700000000000 }]);
        // 同一份 executor 文件字节不变即可证明「没改 executor」——这里用契约/registry 表驱动断言
        expect(contracts['demo.items'].file).toBe('demo.json');
    });
});

describe('CLI 行为不变（dry-run，零网络）', () => {
    const repoRoot = path.join(__dirname, '..', '..');

    it('缺 EMBY_* 凭据：可选源告警、退出码 0、不写 emby.json', () => {
        const before = readFileSync(path.join(repoRoot, 'src/data/emby.json'), 'utf8');
        const env = { ...process.env };
        for (const key of ['EMBY_BASE_URL', 'EMBY_USER_ID', 'EMBY_API_KEY']) delete env[key];
        const run = spawnSync('node', ['scripts/sync-data.mjs', 'emby', '--dry-run'], { cwd: repoRoot, encoding: 'utf8', env, timeout: 60_000 });
        const output = `${run.stdout}\n${run.stderr}`;
        expect(run.status).toBe(0);
        expect(output).toContain('[emby]');
        expect(output).toMatch(/缺少凭据|可选源/);
        expect(readFileSync(path.join(repoRoot, 'src/data/emby.json'), 'utf8')).toBe(before);
    }, 120_000);
});

/**
 * 跨域重定向：认证头只发给允许的目标。
 * undici 默认 follow 只剥 Authorization/Cookie，自定义头（X-Emby-Token）会带过域，
 * 所以执行器自己跟随跳转（redirect: 'manual'）并逐跳判断 origin。
 */
describe('跨域重定向不带走认证头（executor fetchWithTimeout）', () => {
    const TOKEN = 'test-emby-token-value';
    const ACCEPT = 'application/json';

    function headerMap(raw: unknown): Record<string, string> {
        const map: Record<string, string> = {};
        for (const [name, value] of headerPairs(raw)) map[String(name).toLowerCase()] = String(value);
        return map;
    }

    /** 路由表驱动 + 记录每跳收到的 URL 与头。 */
    function stub(routes: Record<string, () => Response>) {
        const seen: Array<{ url: string; headers: Record<string, string> }> = [];
        const fetchImpl = async (url: string, init: { headers?: unknown } = {}) => {
            seen.push({ url: String(url), headers: headerMap(init.headers) });
            const route = routes[String(url)];
            return route ? route() : new Response('not found', { status: 404 });
        };
        return { seen, fetchImpl };
    }

    const redirect = (location: string, status = 302) => () => new Response(null, { status, headers: { location } });
    const ok = () => new Response(JSON.stringify({ ok: true }), { status: 200 });

    /** 三种头形态：普通对象 / Headers 实例 / 二维数组。 */
    const HEADER_FORMS: Array<{ name: string; literal: string }> = [
        { name: '普通对象', literal: `{ 'X-Emby-Token': ${JSON.stringify(TOKEN)}, Accept: ${JSON.stringify(ACCEPT)} }` },
        { name: 'Headers 实例', literal: `new Headers({ 'X-Emby-Token': ${JSON.stringify(TOKEN)}, Accept: ${JSON.stringify(ACCEPT)} })` },
        { name: '二维数组', literal: `[['X-Emby-Token', ${JSON.stringify(TOKEN)}], ['Accept', ${JSON.stringify(ACCEPT)}]]` }
    ];

    const FULL_LITERAL = `{ 'X-Emby-Token': ${JSON.stringify(TOKEN)}, Accept: ${JSON.stringify(ACCEPT)}, authorization: 'Bearer abc', cookie: 'sid=1', 'proxy-authorization': 'Basic xyz', 'x-other': 'keep-me' }`;

    async function fetchOnce(headersLiteral: string, fetchImpl: (url: string, init?: { headers?: unknown }) => Promise<Response>, url = 'https://emby.test/Items') {
        const root = makeProject();
        const file = writeModule(
            root,
            'redirects',
            { id: 'fake', optional: false, credentials: [], datasets: ['fake.data'] },
            `await ctx.fetchJson(${JSON.stringify(url)}, { headers: ${headersLiteral} });\nreturn { outputs: [{ dataset: 'fake.data', data: [{ id: '1', name: 'a' }], complete: true }] };`
        );
        return runIngestSource('fake', {
            projectRoot: root,
            registry: { fake: { module: file, optional: false } },
            contracts: contractFor('fake.data'),
            log: quiet,
            fetchImpl
        });
    }

    it('①同域跳转后 x-emby-token 还在（三种头形态都成立）', async () => {
        for (const form of HEADER_FORMS) {
            const { seen, fetchImpl } = stub({ 'https://emby.test/Items': redirect('/Items2'), 'https://emby.test/Items2': ok });
            await fetchOnce(form.literal, fetchImpl);
            expect(seen.map((call) => call.url)).toEqual(['https://emby.test/Items', 'https://emby.test/Items2']);
            expect(seen[1].headers['x-emby-token']).toBe(TOKEN);
            expect(seen[1].headers.accept).toBe(ACCEPT);
        }
    });

    it('②跨域跳转后认证头全没了、非认证头还在', async () => {
        const { seen, fetchImpl } = stub({ 'https://emby.test/Items': redirect('https://cdn.other.test/blob'), 'https://cdn.other.test/blob': ok });
        await fetchOnce(FULL_LITERAL, fetchImpl);
        expect(seen).toHaveLength(2);
        // 跳转前：认证头都在（证明是「跳转时剥掉」，不是一开始就没发）
        for (const name of AUTH_HEADERS) expect(seen[0].headers[name]).toBeTruthy();
        // 跳转后：一个都不剩
        for (const name of AUTH_HEADERS) expect(seen[1].headers[name]).toBeUndefined();
        // 非认证头保留
        expect(seen[1].headers.accept).toBe(ACCEPT);
        expect(seen[1].headers['x-other']).toBe('keep-me');
    });

    it('③相对 Location 按当前 URL 解析（相对路径与 ../ 都支持）', async () => {
        const routes = {
            'https://emby.test/api/Items': redirect('../sub/Items2?x=1'),
            'https://emby.test/sub/Items2?x=1': redirect('/v2/Items3'),
            'https://emby.test/v2/Items3': ok
        };
        const { seen, fetchImpl } = stub(routes);
        await fetchOnce(FULL_LITERAL, fetchImpl, 'https://emby.test/api/Items');
        expect(seen.map((call) => call.url)).toEqual([
            'https://emby.test/api/Items',
            'https://emby.test/sub/Items2?x=1',
            'https://emby.test/v2/Items3'
        ]);
        // 同域跳转两次，认证头一直保留
        expect(seen[2].headers['x-emby-token']).toBe(TOKEN);
    });

    it('④第 6 跳报 upstream 错，不继续跟', async () => {
        const routes: Record<string, () => Response> = {};
        for (let hop = 0; hop <= 6; hop += 1) routes[`https://emby.test/Items?hop=${hop}`] = redirect(`https://emby.test/Items?hop=${hop + 1}`);
        const { seen, fetchImpl } = stub(routes);
        await expect(fetchOnce(FULL_LITERAL, fetchImpl, 'https://emby.test/Items?hop=0')).rejects.toMatchObject({
            code: 'upstream',
            message: expect.stringContaining('重定向超过 5 跳')
        });
        // 5 跳跟完、第 6 个 3xx 直接放弃：共发出 6 个请求
        expect(seen).toHaveLength(6);
    });

    it('⑤跨域取图（fetchBinary）仍能正常返回字节，认证头同样不带过去', async () => {
        const root = makeProject();
        const file = writeModule(
            root,
            'redirects-binary',
            { id: 'fake', optional: false, credentials: [], datasets: ['fake.data'] },
            "const res = await ctx.fetchBinary('https://emby.test/Images/Primary', { headers: { 'X-Emby-Token': 't', Accept: 'image/*' } });\nreturn { outputs: [{ dataset: 'fake.data', data: [{ id: '1', name: String(res.bytes.length) }], complete: true }] };"
        );
        const seen: Array<{ url: string; headers: Record<string, string> }> = [];
        const fetchImpl = async (url: string, init: { headers?: unknown } = {}) => {
            seen.push({ url: String(url), headers: headerMap(init.headers) });
            if (String(url) === 'https://emby.test/Images/Primary') return new Response(null, { status: 302, headers: { location: 'https://cdn.other.test/img.jpg' } });
            return new Response(new Uint8Array([1, 2, 3, 4]), { status: 200 });
        };
        await runIngestSource('fake', {
            projectRoot: root,
            registry: { fake: { module: file, optional: false } },
            contracts: contractFor('fake.data'),
            log: quiet,
            fetchImpl
        });
        expect(seen).toHaveLength(2);
        expect(seen[1].url).toBe('https://cdn.other.test/img.jpg');
        expect(seen[1].headers['x-emby-token']).toBeUndefined();
        expect(seen[1].headers.accept).toBe('image/*');
        expect(readJson(root, 'src/data/out.json')[0].name).toBe('4');
    });
});

describe('超时文案（不足 1s 显示毫秒）', () => {
    it('400ms → 「超时（400ms）」；1200ms → 「超时（1s）」，行为不变仍是 upstream', async () => {
        const root = makeProject();
        const file = writeModule(root, 'slow', { id: 'slow', optional: false, credentials: [], datasets: ['slow.data'] }, 'await new Promise(() => {});');
        const registry = { slow: { module: file, optional: false } };
        const contracts = contractFor('slow.data');
        await expect(runIngestSource('slow', { projectRoot: root, registry, contracts, log: quiet, timeoutMs: 400 })).rejects.toMatchObject({
            code: 'upstream',
            message: expect.stringContaining('collect 超时（400ms）')
        });
        await expect(runIngestSource('slow', { projectRoot: root, registry, contracts, log: quiet, timeoutMs: 1200 })).rejects.toMatchObject({
            code: 'upstream',
            message: expect.stringContaining('collect 超时（1s）')
        });
        expect(existsSync(path.join(root, 'src/data/out.json'))).toBe(false);
    });
});
