import { describe, expect, it } from 'vitest';
import {
    assetMirrorPath,
    assetUrlPath,
    assignIds,
    casedIdOf,
    contentDigestOf,
    extractWikiLinks,
    foldersOf,
    gardenConfigProblems,
    globToRegExp,
    isAssetTarget,
    linkKeysOf,
    linkifyInlineTags,
    replaceOutsideCode,
    mergeTagCases,
    normalizeKey,
    normalizeTags,
    rewriteMarkdownImages,
    rewriteWikiLinks,
    routeIdOf,
    sha1,
    shouldPublishPath,
    stripObsidianComments,
    tagPageKeysOf,
    slugifyFilePath,
    sluggifySegment
} from '../../src/lib/garden/core';

const rules = {
    exclude: ['private/**', '看板.md', '11-Diary/**'],
    excludeExtra: ['99-Rsources/Templates/**', '**/*.canvas'],
    include: [] as string[]
};

describe('slug：Quartz v4 规则', () => {
    it('空白→-、&→-and-、%→-percent，删掉半角 ? 与 #', () => {
        expect(sluggifySegment('a b\tc')).toBe('a-b-c');
        // Quartz 是先空白→`-` 再 `&`→`-and-`，所以 `A & B` 得到双横线；这里照抄，旧 URL 才对得上
        expect(sluggifySegment('A & B')).toBe('A--and--B');
        expect(sluggifySegment('90%')).toBe('90-percent');
        expect(sluggifySegment('a?b#c')).toBe('abc');
    });

    it('CJK、全角符号、大小写原样保留', () => {
        expect(sluggifySegment('记忆系统对比：Hermes vs OpenViking')).toBe('记忆系统对比：Hermes-vs-OpenViking');
    });

    it('逐段处理路径，去 .md 扩展名，保留 .excalidraw', () => {
        expect(slugifyFilePath('22-Knowledge/AI/AI Agent 记忆.md')).toBe('22-Knowledge/AI/AI-Agent-记忆');
        expect(slugifyFilePath('index.md')).toBe('index');
        expect(slugifyFilePath('a/_index.md')).toBe('a/index');
        expect(slugifyFilePath('a/drawing.excalidraw.md')).toBe('a/drawing.excalidraw');
    });

    it('路由 id 再小写一层（旧站有效 URL 全是小写）', () => {
        expect(routeIdOf('22-Knowledge/Nas/NAS.md')).toBe('22-knowledge/nas/nas');
        expect(casedIdOf('22-Knowledge/Nas/NAS.md')).toBe('22-Knowledge/Nas/NAS');
    });
});

describe('过滤规则', () => {
    it('glob 支持 ** 与 *', () => {
        expect(globToRegExp('private/**').test('private/a/b.md')).toBe(true);
        expect(globToRegExp('**/*.canvas').test('x/y/z.canvas')).toBe(true);
        expect(globToRegExp('看板.md').test('看板.md')).toBe(true);
        expect(globToRegExp('**/_draft/**').test('a/_draft/b.md')).toBe(true);
        expect(globToRegExp('private/**').test('privateish/a.md')).toBe(false);
    });

    it('排除表与额外收紧项同时生效，点开头的目录一律跳过', () => {
        expect(shouldPublishPath('11-Diary/2024-01-01.md', rules)).toBe(false);
        expect(shouldPublishPath('99-Rsources/Templates/t.md', rules)).toBe(false);
        expect(shouldPublishPath('22-Knowledge/AI/x.md', rules)).toBe(true);
        expect(shouldPublishPath('.obsidian/workspace.md', rules)).toBe(false);
    });

    it('include 非空时变成白名单（default-deny）', () => {
        const allow = { ...rules, include: ['22-Knowledge/**'] };
        expect(shouldPublishPath('22-Knowledge/a.md', allow)).toBe(true);
        expect(shouldPublishPath('55-Blog/a.md', allow)).toBe(false);
    });

    it('白名单可以直接写目录名，等价于该目录及全部子目录', () => {
        const allow = { ...rules, publishMode: 'include' as const, include: ['22-Knowledge'] };
        expect(shouldPublishPath('22-Knowledge/a.md', allow)).toBe(true);
        expect(shouldPublishPath('22-Knowledge/AI/deep/x.md', allow)).toBe(true);
        expect(shouldPublishPath('22-Knowledge-old/a.md', allow)).toBe(false);
        expect(shouldPublishPath('23-Knowledge/a.md', allow)).toBe(false);
    });

    it('白名单条目容忍 ./ 前缀、结尾斜杠与 Windows 反斜杠', () => {
        const allow = { ...rules, publishMode: 'include' as const, include: ['./55-Blog/', '22-Knowledge\\AI'] };
        expect(shouldPublishPath('55-Blog/a.md', allow)).toBe(true);
        expect(shouldPublishPath('22-Knowledge/AI/x.md', allow)).toBe(true);
        expect(shouldPublishPath('22-Knowledge/Nas/x.md', allow)).toBe(false);
    });

    it('白名单里每个目录都命中，且 exclude 仍是安全底线', () => {
        const allow = { ...rules, publishMode: 'include' as const, include: ['22-Knowledge', '99-Rsources'] };
        // 列了目录但子路径在黑名单里：不发布（白名单不能把模板/素材带回来）
        expect(shouldPublishPath('99-Rsources/Templates/t.md', allow)).toBe(false);
        expect(shouldPublishPath('22-Knowledge/x.canvas', allow)).toBe(false);
        expect(shouldPublishPath('22-Knowledge/x.md', allow)).toBe(true);
    });

    it('白名单里没写也保留根目录 index.md（花园首页）', () => {
        const allow = { ...rules, publishMode: 'include' as const, include: ['22-Knowledge'] };
        expect(shouldPublishPath('index.md', allow)).toBe(true);
        expect(shouldPublishPath('杂记.md', allow)).toBe(false);
    });

    it('白名单模式下空列表什么都不发，并报配置错误', () => {
        const allow = { ...rules, publishMode: 'include' as const, include: [] as string[] };
        expect(shouldPublishPath('22-Knowledge/a.md', allow)).toBe(false);
        expect(gardenConfigProblems(allow).length).toBe(1);
        expect(gardenConfigProblems({ ...allow, include: ['22-Knowledge'] })).toEqual([]);
    });
});

describe('id 冲突处理', () => {
    it('小写后同名：按原始路径排序，先出现者保留 base，后者加 -2', () => {
        const assigned = assignIds([{ relPath: '22-Knowledge/Nas/Nas.md' }, { relPath: '22-Knowledge/Nas/NAS.md' }]);
        const byPath = Object.fromEntries(assigned.map((item) => [item.relPath, item.id]));
        expect(byPath['22-Knowledge/Nas/NAS.md']).toBe('22-knowledge/nas/nas');
        expect(byPath['22-Knowledge/Nas/Nas.md']).toBe('22-knowledge/nas/nas-2');
    });

    it('同输入同输出（与传入顺序无关）', () => {
        const a = assignIds([{ relPath: 'b.md' }, { relPath: 'B.md' }]);
        const b = assignIds([{ relPath: 'B.md' }, { relPath: 'b.md' }]);
        expect(a.map((item) => item.id)).toEqual(b.map((item) => item.id));
    });

    it('三连冲突依次得到 -2、-3', () => {
        const ids = assignIds([{ relPath: 'x/note.md' }, { relPath: 'x/Note.md' }, { relPath: 'x/NOTE.md' }]).map((item) => item.id);
        expect(ids).toEqual(['x/note', 'x/note-2', 'x/note-3']);
    });
});

describe('文件夹与标签', () => {
    it('文件夹取所有祖先路径', () => {
        expect(foldersOf(['a/b/c', 'a/d'])).toEqual(['a', 'a/b']);
    });

    it('tags 字符串写法按逗号拆开并去重', () => {
        expect(normalizeTags('VPS, Linux')).toEqual(['VPS', 'Linux']);
        expect(normalizeTags(['a', 'a', ' b '])).toEqual(['a', 'b']);
        expect(normalizeTags(undefined)).toEqual([]);
    });

    it('标签大小写合并：显示名取出现最多，并列取字典序靠前', () => {
        const groups = mergeTagCases(['Git', 'git', 'Git', 'VPS']);
        const git = groups.find((group) => group.key === 'git');
        expect(git?.display).toBe('Git');
        expect(git?.count).toBe(3);
        expect(git?.variants).toEqual(['Git', 'git']);
        expect(groups.map((group) => group.key)).toEqual(['git', 'vps']);
    });
});

describe('链接与附件', () => {
    it('抽出 wiki 链接与嵌入，去掉别名和锚点', () => {
        const refs = extractWikiLinks('a [[笔记|别名]] b ![[图.png]] c [[x#标题]]');
        expect(refs.map((ref) => ref.target)).toEqual(['笔记', '图.png', 'x']);
        expect(refs.map((ref) => ref.embed)).toEqual([false, true, false]);
    });

    it('能解析的改写、不能解析的保留原文并计数', () => {
        const { body, unresolved } = rewriteWikiLinks('![[x.png]] [[missing]]', (target) => (target === 'x.png' ? { url: '/garden/x.png', label: 'x.png' } : null));
        expect(body).toBe('![x.png](/garden/x.png) [[missing]]');
        expect(unresolved).toBe(1);
    });

    it('附件路径按 Quartz 规则 slug 化、保留大小写，URL 按段编码', () => {
        // 旧站静态资源同样是 slug 过的（正文 `Pasted%20image%201.png` → 公开 URL `Pasted-image-1.png`）
        expect(assetMirrorPath('99-Rsources/Assets/Pasted image 1.png')).toBe('99-Rsources/Assets/Pasted-image-1.png');
        // Quartz 是「空格→-」再「&→-and-」，两边连字符不合并
        expect(assetMirrorPath('a/A & B.pdf')).toBe('a/A--and--B.pdf');
        expect(assetMirrorPath('a/100%.png')).toBe('a/100-percent.png');
        expect(assetUrlPath('/garden', '99-Rsources/Assets/图 1.png')).toBe('/garden/99-Rsources/Assets/%E5%9B%BE%201.png');
    });

    it('附件类型按扩展名判断', () => {
        expect(isAssetTarget('a/b.PNG', ['.png'])).toBe(true);
        expect(isAssetTarget('a/b.md', ['.png'])).toBe(false);
    });
});

describe('链接键：Obsidian 的各种写法都要能对上', () => {
    it('带路径的笔记：完整路径、去扩展名、文件名三种写法等价', () => {
        // normalizeKey 本身就吃掉 `.md`，所以带扩展名的键不会单独出现
        expect(linkKeysOf('66-Project/读书计划/山茶文具店.md')).toEqual(['66-project/读书计划/山茶文具店', '山茶文具店']);
        expect(linkKeysOf('66-Project/读书计划/山茶文具店.md')).toEqual(linkKeysOf('66-Project/读书计划/山茶文具店'));
    });

    it('文件夹笔记：`目录/笔记` 也要指向 `目录/笔记/index.md`', () => {
        expect(linkKeysOf('22-knowledge/工具/obsidian/index.md')).toEqual([
            '22-knowledge/工具/obsidian/index',
            // 文件名键取目录名（`obsidian`），否则每篇 folder note 都会抢 `[[index]]`
            'obsidian',
            // 这一条是本次补的：Obsidian 里 `[[22-knowledge/工具/obsidian]]` 指向文件夹笔记
            '22-knowledge/工具/obsidian'
        ]);
    });

    it('根笔记 `index.md` 保留 `index` 这个键，且不产出空键', () => {
        expect(linkKeysOf('index.md')).toEqual(['index']);
    });

    it('反斜杠路径与大小写先归一化', () => {
        expect(linkKeysOf('A\\B\\Note.md')).toEqual(linkKeysOf('a/b/note.md'));
    });
});

describe('行内 #tag 转链接', () => {
    const known = new Set(['生活', 'ai', 'ai/agent']);

    it('空白之后 / 行首的已存在标签转成标签页链接', () => {
        expect(linkifyInlineTags('今天 #生活 很好', known).body).toBe('今天 [#生活](/garden/tags/生活/) 很好');
        expect(linkifyInlineTags('#生活 开头', known).body).toBe('[#生活](/garden/tags/生活/) 开头');
    });

    it('层级标签走层级 URL', () => {
        expect(linkifyInlineTags('看 #ai/agent 这篇', known).body).toBe('看 [#ai/agent](/garden/tags/ai/agent/) 这篇');
    });

    it('十六进制色值不当标签（#fff / #1a2b3c）', () => {
        const hex = new Set(['fff', '1a2b3c']);
        expect(linkifyInlineTags('颜色 #fff 和 #1a2b3c', hex).body).toBe('颜色 #fff 和 #1a2b3c');
    });

    it('markdown 标题行整行跳过', () => {
        expect(linkifyInlineTags('## 标题 #生活', known).body).toBe('## 标题 #生活');
    });

    it('围栏与行内代码里的 #tag 不动', () => {
        const fenced = ['```bash', '# 是注释不是标签 #生活', '```', '外面 #生活'].join('\n');
        expect(linkifyInlineTags(fenced, known).body).toContain('# 是注释不是标签 #生活');
        expect(linkifyInlineTags(fenced, known).body).toContain('外面 [#生活]');
        expect(linkifyInlineTags('用 `#生活` 表示', known).body).toBe('用 `#生活` 表示');
    });

    it('未知标签原样保留，不造死链', () => {
        expect(linkifyInlineTags('这个 #不存在 保持', known).body).toBe('这个 #不存在 保持');
    });

    it('非空白边界的 foo#bar 不匹配', () => {
        expect(linkifyInlineTags('见 foo#bar 结束', new Set(['bar'])).body).toBe('见 foo#bar 结束');
    });

    it('已经在链接文字里的不再嵌套', () => {
        expect(linkifyInlineTags('看 [见 #生活 这篇](https://x)', known).body).toBe('看 [见 #生活 这篇](https://x)');
    });
});

describe('代码区域保护', () => {
    // 只记录「这段是不是代码」：调用方据此决定要不要把解析不到的链接降级成文本
    const collect = (input: string) => {
        const calls: Array<{ text: string; code: boolean }> = [];
        replaceOutsideCode(input, (segment, inCode) => {
            calls.push({ text: segment, code: inCode });
            return segment;
        });
        return calls;
    };

    it('围栏代码块整体算代码，块外的正文不算', () => {
        const calls = collect(['```toml', '[menu]', '  [[menu.main]]', '```', '正文 [[真实笔记]]'].join('\n'));
        expect(calls.filter((call) => call.code).map((call) => call.text)).toEqual(['```toml', '[menu]', '  [[menu.main]]', '```']);
        expect(calls.some((call) => !call.code && call.text.includes('正文 [[真实笔记]]'))).toBe(true);
    });

    it('Obsidian 插件的围栏（image-layout-f）也算代码段，调用方可以照常解析里面的图片', () => {
        const calls = collect(['```image-layout-f', '![[x.jpg]]', '```'].join('\n'));
        expect(calls.some((call) => call.code && call.text.includes('![[x.jpg]]'))).toBe(true);
    });

    it('行内代码按反引号串长度配对，代码外同一行也照常处理', () => {
        const calls = collect('- `[[note^]]` 嵌入笔记');
        expect(calls.filter((call) => call.code).map((call) => call.text)).toEqual(['`[[note^]]`']);
        expect(calls.some((call) => !call.code && call.text.includes('嵌入笔记'))).toBe(true);
    });

    it('~~~ 围栏同样受保护，闭合后恢复', () => {
        const calls = collect(['~~~js', 'const a = [[1, 2]];', '~~~', '[[笔记]]'].join('\n'));
        expect(calls.some((call) => call.code && call.text.includes('const a = [[1, 2]];'))).toBe(true);
        expect(calls.some((call) => !call.code && call.text.includes('[[笔记]]'))).toBe(true);
    });
});

describe('Obsidian 注释剥离', () => {
    it('整块注释（Waypoint 生成的目录）与行内注释都被去掉', () => {
        const input = '# 标题\n\n%% Begin Waypoint %%\n- a\n- b\n%% End Waypoint %%\n\n正文 %%行内备注%% 继续';
        const out = stripObsidianComments(input);
        expect(out).not.toContain('Waypoint');
        expect(out).not.toContain('%%');
        expect(out).toContain('正文');
        expect(out).toContain('# 标题');
    });

    it('不含注释的正文原样返回', () => {
        expect(stripObsidianComments('普通\n正文')).toBe('普通\n正文');
    });
});

describe('标准 markdown 图片改写', () => {
    const table: Record<string, string> = {
        '../99-Rsources/Assets/a.png': '/garden/99-rsources/assets/a.png',
        '99-Rsources/Assets/b.webp': '/garden/99-rsources/assets/b.webp',
        'Pasted%20image%201.png': '/garden/99-rsources/assets/pasted%20image%201.png',
        'a & b.png': '/garden/99-rsources/assets/a & b.png'
    };
    const resolve = (target: string) => {
        const url = table[target];
        return url ? { url, label: target.split('/').pop() ?? target } : null;
    };

    it('能解析的相对图片改写成站内附件 URL', () => {
        const { body, resolved, missing } = rewriteMarkdownImages('x ![](../99-Rsources/Assets/a.png) y', resolve);
        // alt 为空时用源文件名，和 wiki 嵌入的 label 规则一致
        expect(body).toBe('x ![a.png](/garden/99-rsources/assets/a.png) y');
        expect(resolved).toBe(1);
        expect(missing).toBe(0);
    });

    it('带空格与百分号编码的路径都能改写', () => {
        const { body } = rewriteMarkdownImages('![](Pasted%20image%201.png) ![](99-Rsources/Assets/b.webp)', resolve);
        expect(body).toBe('![Pasted%20image%201.png](/garden/99-rsources/assets/pasted%20image%201.png) ![b.webp](/garden/99-rsources/assets/b.webp)');
    });

    it('解析不到时降级成文字而不是保留原语法（否则 Astro 会当内容资源去 import）', () => {
        const { body, missing } = rewriteMarkdownImages('![](../nope/missing.png) ![说明](nope.png)', resolve);
        expect(body).toBe('**[图片缺失]** **[图片缺失：说明]**');
        expect(missing).toBe(2);
        expect(body).not.toContain('](');
    });

    it('绝对路径 / 外链 / 锚点 / data URI 原样保留', () => {
        const input = '![](/garden/a.png) ![](https://e.com/a.png) ![](#x) ![](data:image/png;base64,AAA)';
        expect(rewriteMarkdownImages(input, resolve).body).toBe(input);
    });

    it('保留 title 与已有 alt；alt 为空时用文件名', () => {
        const { body } = rewriteMarkdownImages('![](99-Rsources/Assets/b.webp "尺寸")', resolve);
        expect(body).toBe('![b.webp](/garden/99-rsources/assets/b.webp "尺寸")');
    });
});

describe('标签页 key 集合', () => {
    it('层级 tag 同时产出父级页，且去重排序', () => {
        expect(tagPageKeysOf(['privacy/email', 'x/twitter', 'ai'])).toEqual(['ai', 'privacy', 'privacy/email', 'x', 'x/twitter']);
    });

    it('普通 tag 原样返回', () => {
        expect(tagPageKeysOf(['git', 'vps'])).toEqual(['git', 'vps']);
    });
});

describe('摘要与稳定序列化', () => {
    it('contentDigest 与顺序无关', () => {
        const a = contentDigestOf([{ id: 'a', hash: '1' }, { id: 'b', hash: '2' }]);
        const b = contentDigestOf([{ id: 'b', hash: '2' }, { id: 'a', hash: '1' }]);
        expect(a).toBe(b);
        expect(a).toBe(sha1('a:1\nb:2'));
    });

    it('normalizeKey 归一化大小写、空白与 .md', () => {
        expect(normalizeKey('  22-Knowledge/A  B.md ')).toBe('22-knowledge/a b');
    });
});
