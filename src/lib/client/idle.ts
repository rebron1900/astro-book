/**
 * 把「创建地图 / 拉轨迹数据」这类重活，推到页面切换动画结束、浏览器空闲之后再做。
 *
 * 为什么需要：
 * - ClientRouter 换页时 `astro:page-load` 在快照交换后立刻触发，但过渡动画还要跑几百毫秒；
 *   这段时间里初始化 WebGL、拉瓦片、编译地形着色器，过渡会直接掉帧（观感就是「卡一下」）。
 * - 首屏同理：没必要跟首屏渲染抢主线程。
 *
 * 返回取消函数，交给 `onCleanup`，避免组件早于任务执行就卸载了还在跑。
 */
export function afterTransition(run: () => void, options: { timeout?: number } = {}): () => void {
    const timeout = options.timeout ?? 1500;
    let cancelled = false;
    let frame = 0;
    let idleId: number | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const startIdle = () => {
        if (cancelled) return;
        // 再让两帧：过渡的快照已经拍完、布局也稳定，这时候进空闲队列才不会打断动画
        frame = requestAnimationFrame(() => {
            frame = requestAnimationFrame(() => {
                if (cancelled) return;
                const idle = (window as Window & { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number }).requestIdleCallback;
                if (typeof idle === 'function') {
                    idleId = idle(
                        () => {
                            if (!cancelled) run();
                        },
                        { timeout }
                    );
                } else {
                    timer = setTimeout(() => {
                        if (!cancelled) run();
                    }, 60);
                }
            });
        });
    };

    // 过渡进行中就先等它结束（最多等 900ms，防止属性没清掉卡死）
    const deadline = performance.now() + 900;
    const waitTransition = () => {
        if (cancelled) return;
        const running = document.documentElement.hasAttribute('data-astro-transition');
        if (!running || performance.now() > deadline) {
            startIdle();
            return;
        }
        frame = requestAnimationFrame(waitTransition);
    };

    waitTransition();

    return () => {
        cancelled = true;
        if (frame) cancelAnimationFrame(frame);
        if (idleId !== null && typeof cancelIdleCallback === 'function') cancelIdleCallback(idleId);
        if (timer !== null) clearTimeout(timer);
    };
}
