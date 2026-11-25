/**
 * 剧集聚合卡的「当天看了哪些集」面板。
 *
 * 卡片本身带一个 <template>，里面是这组剧集的集号 / 集名 / 进度和进度条；
 * 只有集数区间（S01E131–E133）是触发点，悬停或键盘聚焦时把模板克隆进 tippy。
 * 卡片标题和简介的截断仍走全站统一的 reading-truncation，不受这里影响。
 */
import type { Instance } from 'tippy.js';
import { createTippy } from './tippy';
import { afterTransition } from './idle';

type Host = HTMLElement & { _tippy?: Instance };

const SELECTOR = '.emby-episode-range';

function attach(el: Host): void {
    if (el._tippy) return;
    const card = el.closest('.emby-group');
    const template = card?.querySelector('template.emby-episode-template');
    if (!(template instanceof HTMLTemplateElement)) return;

    el.setAttribute('tabindex', '0');
    createTippy(el, {
        content: () => {
            const wrap = document.createElement('div');
            wrap.className = 'emby-episode-wrap';
            wrap.appendChild(template.content.cloneNode(true));
            return wrap;
        },
        theme: 'emby-episodes',
        appendTo: () => document.body,
        maxWidth: 'min(30rem, 92vw)',
        interactive: false,
        trigger: 'mouseenter focus',
        delay: [140, 0],
        offset: [0, 8]
    });
}

function detach(el: Host): void {
    if (!el._tippy) return;
    el._tippy.destroy();
    el.removeAttribute('tabindex');
}

function refresh(root: ParentNode = document): void {
    root.querySelectorAll<Host>(SELECTOR).forEach((el) => {
        try {
            attach(el);
        } catch (error) {
            console.warn('[emby-group] tippy 挂载失败', error);
        }
    });
}

export function initEmbyGroups(): () => void {
    // 先同步挂一次（服务端已渲染的卡片），再等过渡结束补一次，避免首次刷新跑在卡片插入前
    refresh();
    const boot = afterTransition(() => refresh());

    const onKeyDown = (event: KeyboardEvent) => {
        if (event.key !== 'Escape') return;
        document.querySelectorAll<Host>(SELECTOR).forEach((el) => {
            if (el._tippy?.state.isVisible) el._tippy.hide();
        });
    };

    document.addEventListener('keydown', onKeyDown);

    const list = document.querySelector('[data-timeline-list]');
    const observer =
        list && typeof MutationObserver !== 'undefined' ? new MutationObserver(() => refresh()) : null;
    observer?.observe(list as Node, { childList: true, subtree: true });

    return () => {
        boot();
        observer?.disconnect();
        document.removeEventListener('keydown', onKeyDown);
        document.querySelectorAll<Host>(SELECTOR).forEach(detach);
    };
}
