/**
 * 统一的页面挂载器。
 *
 * 站点所有页面都装了 ClientRouter，`astro:page-load` 在首次加载和每次导航后
 * 都会触发；不使用 View Transitions 的页面则退化为 DOMContentLoaded 执行一次。
 * 同一页面内重复触发只执行一次；init 可返回清理函数，在下次执行前或
 * `astro:before-swap`（离开当前页面）时调用。
 */
export type Cleanup = () => void;

export function onPageLoad(init: () => void | Cleanup): void {
    let cleanup: Cleanup | null = null;
    let booted = false;

    const run = () => {
        if (booted) return;
        booted = true;
        const result = init();
        cleanup = typeof result === 'function' ? result : null;
    };

    const reset = () => {
        cleanup?.();
        cleanup = null;
        booted = false;
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', run, { once: true });
    } else {
        run();
    }
    document.addEventListener('astro:page-load', run);
    document.addEventListener('astro:before-swap', reset);
}
