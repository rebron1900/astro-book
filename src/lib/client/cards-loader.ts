/**
 * 按需加载 `cards.ts`（约 16KB 的第三方卡片脚本：视频 / 音频 / 折叠卡片）。
 * 只有页面里真的出现这些卡片时才拉取独立 chunk，避免打进全站 head bundle。
 */
const CARD_SELECTOR = '.kg-video-card, .kg-audio-card, .kg-toggle-card';

let modulePromise: Promise<typeof import('../cards')> | null = null;

export async function initCards(): Promise<void> {
    if (typeof document === 'undefined') return;
    if (!document.querySelector(CARD_SELECTOR)) return;

    modulePromise ??= import('../cards');
    const cards = await modulePromise;
    cards.initVideo();
    cards.initAudio();
    cards.initToggle();
}
