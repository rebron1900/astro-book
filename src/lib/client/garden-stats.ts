/**
 * 花园笔记的点赞 / 浏览量。
 *
 * 和博客文章共用 Artalk 的页面统计（同一个 site、同一套 page key 规则），
 * 只是博客那边由页脚 + 评论组件完成，花园笔记没有页脚，所以在这里补：
 *
 * - 浏览量：首次访问 POST /pages/pv 登记并 +1，同一浏览器同一页面只计一次
 *   （localStorage 标记）。花园笔记的评论区通过 countPv=false 关闭 Artalk 自带的
 *   PV 登记，统一由这里计数，所以短笔记（不渲染评论区）也不会漏；请求失败时会
 *   撤回标记，下次访问还能重试。
 * - 点赞：POST /votes/page/{page_id}/up；page 记录先由 PV 登记创建，否则点赞没有 id。
 *   Artalk 2.10 起可以用 GET /votes/page/{page_id} 问服务端“我点过赞没有”，
 *   localStorage 只作为首屏快速回显，最终状态以服务端为准。
 *
 * 结构约定见 GardenNoteView.astro：`[data-garden-stats]` 里放
 * `[data-garden-like]`、`[data-garden-likes]`、`[data-garden-views]`。
 */
import cocoMessage from '../coco-message';
import {
    artalkPageKey,
    artalkPvSeenKey,
    type ArtalkPageStats,
    fetchArtalkPageStats,
    fetchArtalkPageVote,
    hasCountedPv,
    hasLiked,
    logArtalkPagePv,
    markLiked,
    markPvCounted,
    voteArtalkPageUp
} from '../artalk-stats';
import { onPageLoad } from './mount';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** PV 登记失败时撤回本地标记，下次访问还能重试；成功则保留，避免和评论区重复计数 */
const clearPvCounted = (pageKey: string) => {
    try {
        localStorage.removeItem(artalkPvSeenKey(pageKey));
    } catch {
        // 存储不可用时无所谓：本来也没有标记需要清
    }
};

export function bindGardenNoteStats(): void {
    onPageLoad(() => {
        // 悬浮预览里可能也会带统计结构，只认正文里那一份，预览不能触发计数
        const root = [...document.querySelectorAll<HTMLElement>('[data-garden-stats]')].find((node) => !node.closest('.garden-popover'));
        if (!root) return;

        let disposed = false;

        const likeButton = root.querySelector<HTMLButtonElement>('[data-garden-like]');
        const likeCount = root.querySelector<HTMLElement>('[data-garden-likes]');
        const viewCount = root.querySelector<HTMLElement>('[data-garden-views]');

        const pageKey = artalkPageKey();
        const pageTitle = root.dataset.pageTitle || document.title;

        let stats: ArtalkPageStats | null = null;
        let voting = false;
        let votedInThisView = false;

        const notify = (kind: 'success' | 'info' | 'error', text: string) => {
            cocoMessage.insertCSS();
            cocoMessage[kind](text);
        };

        const setActive = (active: boolean) => {
            likeButton?.classList.toggle('active', active);
            likeButton?.setAttribute('aria-pressed', String(active));
        };

        if (hasLiked(pageKey)) setActive(true);

        // 标记要在请求前同步写入：评论组件的 PV 判断也读同一个 key，
        // 晚写就会两边各 +1。请求失败时再撤回，避免一次网络错误永久吞掉浏览量。
        let pvPromise: Promise<number> | null = null;
        if (!hasCountedPv(pageKey)) {
            markPvCounted(pageKey);
            pvPromise = logArtalkPagePv(pageKey, pageTitle).catch(() => {
                clearPvCounted(pageKey);
                return 0;
            });
        }

        const load = async (retry = true): Promise<void> => {
            // 首次访问先等 PV 登记落库，再读页面数据；否则 /comments 可能拿到 +1 前的 pv，
            // 页面会一直少显示一次，直到下次刷新。
            if (pvPromise) await pvPromise.catch(() => 0);
            let data = await fetchArtalkPageStats(pageKey).catch(() => null);

            // 首次访问时 PV 登记和页面查询可能抢跑，page 还没建出来，稍后重试一次
            if ((!data || data.id <= 0) && retry) {
                if (pvPromise) await pvPromise.catch(() => 0);
                await sleep(600);
                data = await fetchArtalkPageStats(pageKey).catch(() => null);
            }

            stats = data;

            // 以 /comments 的 pv 为准：POST 的返回值在同 IP 重复访问时可能比库里多 1，
            // 显示库里值可以避免刷新后数字回落；请求失败时才退回 POST 的结果。
            const pv = data?.pv ?? (pvPromise ? await pvPromise.catch(() => 0) : 0);
            if (disposed || !root.isConnected) return;

            if (viewCount) viewCount.textContent = pv > 0 ? String(pv) : '—';
            // 用户刚点过赞时别用慢请求把数字盖回旧值
            if (likeCount && data && !votedInThisView) likeCount.textContent = String(data.voteUp);

            // Artalk 2.10：以服务端的 is_up 为准，localStorage 只负责首屏快速回显
            if (data && data.id > 0 && !votedInThisView) {
                const vote = await fetchArtalkPageVote(data.id).catch(() => null);
                if (vote && !disposed && root.isConnected && !votedInThisView) {
                    stats.voteUp = vote.up;
                    setActive(vote.isUp);
                    if (likeCount) likeCount.textContent = String(vote.up);
                }
            }
        };

        const handleLike = async () => {
            if (disposed || voting) return;

            voting = true;
            likeButton?.setAttribute('aria-busy', 'true');

            try {
                if (!stats || stats.id <= 0) await load();
                if (disposed || !root.isConnected) return;

                if (!stats || stats.id <= 0) {
                    notify('error', '点赞失败，请稍后再试');
                    return;
                }

                const vote = await voteArtalkPageUp(stats.id);
                if (disposed || !root.isConnected) return;

                votedInThisView = true;
                stats.voteUp = vote.up;
                if (likeCount) likeCount.textContent = String(vote.up);

                if (!vote.isUp) {
                    // Artalk 2.10：再点一次即取消点赞
                    setActive(false);
                    notify('info', '已取消点赞');
                    return;
                }

                markLiked(pageKey);
                setActive(true);
                notify('success', '点赞成功，谢谢你的 ❤️');
            } catch (error) {
                console.error('Artalk vote failed:', error);
                notify('error', '点赞失败，请稍后再试');
            } finally {
                voting = false;
                likeButton?.removeAttribute('aria-busy');
            }
        };

        likeButton?.addEventListener('click', handleLike);

        void load();

        return () => {
            disposed = true;
            likeButton?.removeEventListener('click', handleLike);
        };
    });
}
