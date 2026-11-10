/**
 * 右侧栏（.book-toc-content）的 View Transition 命名时机。
 *
 * 带 view-transition-name 的元素会被单独抓成一张快照：前后两页都有侧栏时它保持静止，
 * 这是想要的效果。但如果两边不一致（例如从普通页进相册/友链这类宽样式页，目标页压根没有侧栏），
 * 旧侧栏就会作为一张独立快照压在新页面上闪一下再消失。
 *
 * 所以在 `astro:before-preparation` 里挂住 loader：等目标文档拉下来、解析成 newDocument 之后，
 * 只在「两边都有侧栏」时保留名字，否则把元素并回整页快照，让侧栏跟着页面一起进场/退场。
 * 判断发生在 startViewTransition 之前，所以对旧页面的快照同样有效。
 */

const TOC = '.book-toc-content';

type PreparationEvent = Event & {
    newDocument: Document;
    loader: () => Promise<void>;
};

function setNamed(el: HTMLElement, named: boolean): void {
    if (named) el.style.removeProperty('view-transition-name');
    else el.style.setProperty('view-transition-name', 'none');
}

let registered = false;

export function initTocViewTransition(): void {
    if (registered) return;
    registered = true;

    document.addEventListener('astro:before-preparation', (rawEvent) => {
        const event = rawEvent as PreparationEvent;

        // 上一次导航可能把内联覆盖留在了当前侧栏上（进入有侧栏的页面时用过），
        // 下一次过渡前先恢复，让它重新按「两边都有侧栏」参与配对。
        document.querySelectorAll<HTMLElement>(TOC).forEach((el) => setNamed(el, true));

        const load = event.loader;
        event.loader = async () => {
            await load();
            const incoming = event.newDocument?.querySelector<HTMLElement>(TOC) ?? null;
            const current = document.querySelector<HTMLElement>(TOC);
            if (current && !incoming) setNamed(current, false); // 目标页没有侧栏：让旧侧栏随旧页面退场
            else if (incoming && !current) setNamed(incoming, false); // 当前页没有侧栏：让新侧栏随新页面进场
        };
    });
}
