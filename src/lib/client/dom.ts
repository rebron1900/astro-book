/** 客户端常用的 DOM / 环境小工具，避免各组件各写一份。 */

const HTML_ESCAPES: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
};

/** 转义任意值，安全用于 HTML 文本与属性上下文。 */
export function escapeHtml(value: unknown): string {
    return String(value ?? '').replace(/[&<>"']/g, (char) => HTML_ESCAPES[char] ?? char);
}

/** 用户是否开启了「减少动态效果」。 */
export function prefersReducedMotion(): boolean {
    return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** 下一帧执行（对滚动/尺寸事件做节流用）。 */
export function onNextFrame(callback: () => void): void {
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(callback);
    else setTimeout(callback, 16);
}
