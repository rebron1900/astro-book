/**
 * 图片尺寸索引来源模块（模块化试点）。
 *
 * 把 Ghost 内容里引用到的 cdn.1900.live 图片逐张取尺寸，落地 src/data/image-meta.json，
 * 构建期 RemotePicture 直接读本地 JSON（零网络），避免图片加载后的布局抖动。
 *
 * 约定：
 * - 导入无副作用；不读 env；不写盘（只返回 dataset）；
 * - 输入是上一个源产出的 ghost.json，通过 ctx.readData('ghost.json') 读取，不直接碰文件系统；
 * - 已有记录（含 error_*）视为缓存，只补缺失项；因此重复运行是幂等的。
 */
const CDN_PREFIX = 'https://cdn.1900.live/';
const CONCURRENCY = 10;

export const meta = {
    id: 'imagemeta',
    optional: false,
    credentials: [],
    optionalCredentials: [],
    datasets: ['imagemeta.sizes'],
    datasetVersions: { 'imagemeta.sizes': 1 },
    description: 'Ghost 图片尺寸索引（src/data/image-meta.json）'
};

/** 收集 Ghost 文章/页面里出现的图片 URL（feature_image + 正文 img）。 */
export function collectImageUrls(ghost) {
    const urls = new Set();
    const entries = [...(ghost?.posts || []), ...(ghost?.pages || [])];
    for (const entry of entries) {
        if (entry.feature_image) urls.add(entry.feature_image);
        if (entry.html) {
            const re = /<img[^>]+src=["']([^"']+)["']/g;
            let match;
            while ((match = re.exec(entry.html)) !== null) urls.add(match[1]);
        }
    }
    return [...urls];
}

export async function collect(ctx) {
    const ghost = ctx.readData('ghost.json');
    if (!ghost) throw new Error('缺少 src/data/ghost.json，无法生成图片尺寸索引');

    const urls = collectImageUrls(ghost);
    const existing = ctx.readData('image-meta.json') || {};
    const cdnUrls = urls.filter((url) => url.startsWith(CDN_PREFIX));
    const toFetch = cdnUrls.filter((url) => !existing[`size_${url}`] && !existing[`error_${url}`]);
    ctx.log(`[imagemeta] 共 ${cdnUrls.length} 张 cdn 图片，需新获取 ${toFetch.length} 张`);

    let fetched = 0;
    for (let i = 0; i < toFetch.length; i += CONCURRENCY) {
        const batch = toFetch.slice(i, i + CONCURRENCY);
        await Promise.all(
            batch.map(async (url) => {
                try {
                    const meta = await ctx.fetchJson(`${encodeURI(url)}!exif`, {}, 10000);
                    existing[`size_${url}`] = { width: meta.width, height: meta.height };
                } catch (error) {
                    existing[`error_${url}`] = { timestamp: Date.now(), error: error.message };
                }
                fetched += 1;
            })
        );
        if (toFetch.length > CONCURRENCY) ctx.log(`[imagemeta] 进度 ${fetched}/${toFetch.length}`);
    }

    return { outputs: [{ dataset: 'imagemeta.sizes', data: existing, complete: true }] };
}
