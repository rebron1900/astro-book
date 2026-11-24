/**
 * 阅读卡片划线的展开交互（disclosure，不是 tooltip）。
 *
 * 状态由脚本统一管：`state.open`（点击/键盘）或 `state.hover`（鼠标悬停）任一为真即展开，
 * `hidden` 与 `aria-expanded` 永远由同一个 render() 写入，CSS 不再参与开关判断。
 * 这样避免「CSS hover 打开、aria-expanded 仍是 false」以及「focus 先开、click 又关」的错位。
 *
 * - 鼠标：pointerenter/pointerleave（只认 mouse），移出且未点击固定时关闭
 * - 键盘：focus 时若 :focus-visible（说明是 Tab 进来）则展开；Esc 关闭并归还焦点
 * - 触屏：点按钮切换，点卡片外部关闭
 *
 * 由 List.astro 通过 onPageLoad(initReadingTips) 挂载，重复导航安全（返回清理函数）。
 */
export function initReadingTips(): (() => void) | void {
    const closers = new Set<() => void>();

    const bind = (root: ParentNode = document) => {
        root.querySelectorAll<HTMLButtonElement>('[data-rd-trigger]').forEach((btn) => {
            if (btn.dataset.rdBound === '1') return;
            btn.dataset.rdBound = '1';
            const tip = document.getElementById(btn.getAttribute('aria-controls') ?? '');
            if (!tip) return;
            const card = btn.closest<HTMLElement>('.reading-card');
            const state = { open: false, hover: false };
            // Tab 进来时 focus 已经自动展开了，紧随其后的 Enter/Space 会再派发一次 click，
            // 第一次键盘激活只「确认展开」，第二次才收起，避免「Tab 一看就没了」。
            let openedByFocus = false;

            const render = () => {
                const visible = state.open || state.hover;
                btn.setAttribute('aria-expanded', String(visible));
                tip.hidden = !visible;
                card?.classList.toggle('is-tip-open', visible);
            };

            const close = () => {
                state.open = false;
                state.hover = false;
                openedByFocus = false;
                render();
            };

            btn.addEventListener('click', (event) => {
                event.preventDefault();
                const keyboardActivation = (event as MouseEvent).detail === 0;
                if (keyboardActivation && openedByFocus && state.open) {
                    openedByFocus = false;
                    render();
                    return;
                }
                openedByFocus = false;
                state.open = !state.open;
                if (!state.open) state.hover = false;
                render();
            });

            card?.addEventListener('pointerenter', (event) => {
                if ((event as PointerEvent).pointerType !== 'mouse') return;
                state.hover = true;
                render();
            });
            card?.addEventListener('pointerleave', (event) => {
                if ((event as PointerEvent).pointerType !== 'mouse') return;
                state.hover = false;
                if (!state.open) render();
            });

            btn.addEventListener('focus', () => {
                // 鼠标点击也会 focus；只在键盘焦点（Tab）时自动展开，避免点击被 focus 抢先打开
                if (btn.matches(':focus-visible')) {
                    state.open = true;
                    openedByFocus = true;
                    render();
                }
            });

            const onFocusOut = (event: FocusEvent) => {
                const next = event.relatedTarget as Node | null;
                if (!next || !card?.contains(next)) close();
            };
            card?.addEventListener('focusout', onFocusOut);

            const onKeyDown = (event: KeyboardEvent) => {
                if (event.key !== 'Escape') return;
                close();
                btn.blur();
            };
            btn.addEventListener('keydown', onKeyDown);

            const onDocPointerDown = (event: PointerEvent) => {
                const target = event.target as Node | null;
                if (!target || card?.contains(target)) return;
                close();
            };
            document.addEventListener('pointerdown', onDocPointerDown);

            closers.add(() => {
                document.removeEventListener('pointerdown', onDocPointerDown);
                card?.removeEventListener('focusout', onFocusOut);
            });
        });
    };

    bind();

    // 无限滚动新插入的卡片也要绑上
    const list = document.querySelector('[data-timeline-list]');
    if (!list || typeof MutationObserver === 'undefined') {
        return () => closers.forEach((fn) => fn());
    }
    const observer = new MutationObserver(() => bind(list));
    observer.observe(list, { childList: true, subtree: true });
    return () => {
        observer.disconnect();
        closers.forEach((fn) => fn());
        closers.clear();
    };
}
