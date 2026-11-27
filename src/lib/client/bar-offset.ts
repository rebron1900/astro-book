/**
 * 移动端悬浮顶栏（`.bk-bar`）的底边位置。
 *
 * 页面里靠 sticky 贴身的内容（运动 / 足迹地图等）是从顶栏下面开始贴的，
 * 判断「是否已经吸顶」时要按这个偏移算，否则投影会晚一整条顶栏的高度才出现。
 *
 * 顶栏是 fixed 元素，滚页面时它的位置不变，所以量一次就缓存；窗口尺寸、
 * 横竖屏、安全区变化时清掉缓存重新量。桌面端顶栏 display:none，量出来是 0。
 */
let cached = -1;

const measure = (): number => document.querySelector<HTMLElement>('.bk-bar')?.getBoundingClientRect().bottom ?? 0;

export function floatingBarOffset(): number {
    if (cached < 0) cached = measure();
    return cached;
}

export function resetFloatingBarOffset(): void {
    cached = -1;
}

if (typeof window !== 'undefined') {
    window.addEventListener('resize', resetFloatingBarOffset);
    window.addEventListener('orientationchange', resetFloatingBarOffset);
}
