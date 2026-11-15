/**
 * 「回到顶部」按钮：点击平滑滚动到顶部，滚动时控制按钮显隐。
 *
 * 用**事件委托**挂在 document 上只绑一次：花园页的右栏在桌面/移动两份 `aside` 里
 * 各渲染一个按钮，`getElementById` 只能拿到第一个，另一个点了没反应；而且
 * ClientRouter 每次导航都会换掉按钮节点，绑在节点上的监听就失效了。
 */
let installed = false;

export default function initBackToTop() {
    const buttons = () => Array.from(document.querySelectorAll<HTMLElement>('[data-scroll-to-top]'));

    const onClick = (event: MouseEvent) => {
        const target = event.target as HTMLElement | null;
        if (!target?.closest('[data-scroll-to-top]')) return;
        event.preventDefault();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    let ticking = false;
    const onScroll = () => {
        if (ticking) return;
        ticking = true;
        requestAnimationFrame(() => {
            ticking = false;
            const scrolled = document.body.scrollTop > 20 || document.documentElement.scrollTop > 20;
            for (const button of buttons()) button.style.opacity = scrolled ? '1' : '0';
        });
    };

    if (!installed) {
        document.addEventListener('click', onClick);
        window.addEventListener('scroll', onScroll, { passive: true });
        installed = true;
    }

    // 首次进入（含 ClientRouter 导航后）同步一次显隐
    onScroll();
}
