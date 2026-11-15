/**
 * 数字花园（/garden）的发布配置。
 *
 * 这里的每条规则都决定「哪些私有笔记会被渲染成公开页面」，改动等于扩大或收缩公开面，
 * 必须在 PR 里显式 review。发布集合的最终闸门不在这里，而是
 * `src/config/garden-published.json` 那份路径清单（见 scripts/check-garden.mjs）。
 */
export const gardenConfig = {
    /** 站内路由前缀 */
    route: '/garden',
    /** 本地开发时指向本机 vault 的环境变量名 */
    vaultDirEnv: 'GARDEN_VAULT_DIR',
    /** 同步产物目录（gitignored） */
    outputDir: '.garden',
    /** 被引用附件的镜像目录（gitignored，注意它在 public/ 下，会进构建产物） */
    publicAssetDir: 'public/garden',
    /** 已发布路径清单：新增路径必须显式写进来才允许发布 */
    publishedManifest: 'src/config/garden-published.json',

    /** 移植 Quartz 的 ignorePatterns：这就是今天的公开面 */
    exclude: [
        'private/**',
        'templates/**',
        'Templates/**',
        '.obsidian/**',
        '.trash/**',
        '11-Diary/**',
        '44-Work/**',
        // 看板类笔记整体是内部工作流：精确名 + 通配 + 归档目录都挡掉
        '看板.md',
        '看板*.md',
        '**/看板*.md',
        '**/看板*.canvas',
        '99-Rsources/archive/**',
        // 标题里带 Strava 的同步/折腾记录：保守起见一并挡掉（`Strava/**` 只挡同名目录）
        '**/*strava*.md',
        'Strava/**',
        '00-inBox/**',
        '33-Canvas/**',
        '66-Project/**',
        'Excalidraw/**'
    ],

    /** 在 Quartz 白名单基础上再收一层：模板、素材库、画布、草稿不发布 */
    excludeExtra: ['99-Rsources/Templates/**', '99-Rsources/Assets/**', '**/*.canvas', '**/_draft/**', '**/_private/**'],

    /**
     * 发布口径，二选一：
     * - 'exclude'（默认）：vault 里所有笔记都当作候选，再按下面的黑名单剔除；
     * - 'include'：默认全拦，只有 include 里列出的目录/文件才会发布。
     * 切换后一定要重跑 `yarn sync:garden` 看摘要里的篇数，再决定是否更新发布清单。
     */
    publishMode: 'include' as 'exclude' | 'include',

    /**
     * 白名单条目，只在 publishMode='include' 时生效（旧行为也兼容：列表非空即按白名单走）。
     * 直接写目录名即可，等价于该目录及所有子目录：
     *   include: ['22-Knowledge', '55-Blog']
     * 也支持 glob：'22-Knowledge/AI/**'、'55-Blog/*.md'。
     * 注意 exclude / excludeExtra 仍然生效，作为安全底线（模板、素材库不会被白名单带回来）。
     * 根目录 index.md 是花园首页本体，白名单模式下始终保留，不用写进列表。
     * 白名单模式下列表留空会直接拒绝同步，避免「以为只发几个目录、结果全站都发了」。
     */
    include: ['22-Knowledge', '55-Blog'] as string[],

    /** Obsidian 的 draft: true 一律不发布 */
    skipDraft: true,
    /** true = 必须 frontmatter publish: true 才发布（更严格，暂不启用） */
    requirePublish: false,

    /** 允许镜像到 public/garden 的附件类型 */
    assetExts: ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.pdf', '.mp4', '.mp3', '.zip'],
    /** 单个附件大小上限 */
    maxAssetBytes: 20 * 1024 * 1024,

    /** 正文短于这个字数就不挂评论区 */
    commentMinChars: 120,
    /** 旧站有效 URL 全小写，新站沿用 */
    lowercasePaths: true,

    /**
     * 坏链上限分开设：两类性质不同，混成一个数就判断不了是解析 bug 还是撤稿导致。
     * - missing：目标在 vault 里根本不存在（真坏链，解析逻辑出问题时这里会飙升）
     * - toUnpublished：目标存在但没发布（撤稿/改名导致，属于预期）
     */
    maxBrokenMissing: 40,
    maxBrokenUnpublished: 80
} as const;

export type GardenConfig = typeof gardenConfig;
