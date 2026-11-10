/**
 * 「回到顶部」按钮：点击平滑滚动到顶部，滚动时控制按钮显隐。
 * 用 addEventListener + 清理函数，避免 View Transitions 后残留旧按钮的监听。
 */
let cleanup: (() => void) | null = null;

export default function initBackToTop() {
    cleanup?.();
    cleanup = null;

    const button = document.getElementById('scrollToTop');
    if (!button) return;

    const onClick = () => window.scrollTo({ top: 0, behavior: 'smooth' });
    let ticking = false;
    const onScroll = () => {
        if (ticking) return;
        ticking = true;
        requestAnimationFrame(() => {
            ticking = false;
            const scrolled = document.body.scrollTop > 20 || document.documentElement.scrollTop > 20;
            button.style.opacity = scrolled ? '1' : '0';
        });
    };

    button.addEventListener('click', onClick);
    window.addEventListener('scroll', onScroll, { passive: true });
    cleanup = () => {
        button.removeEventListener('click', onClick);
        window.removeEventListener('scroll', onScroll);
        cleanup = null;
    };
}
