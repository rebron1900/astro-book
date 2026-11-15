/**
 * 花园站内链预览（popover）。
 *
 * 行为对齐 Quartz 的 `popover.inline.ts`：hover 时才 **fetch 目标页面 HTML**，
 * 解析出目标页的**整个正文区域**（不是只取首段），连同标题 / 目录标签一起塞进卡片；
 * 同一个 URL 只取一次（模块级缓存，超过上限丢最旧的），导航离开时 abort 未完成的请求。
 *
 * 位置跟随光标、自动翻转避让、Esc 关闭、触屏点按、`prefers-reduced-motion` 不做动画。
 * tippy 用 `delegate()`：单个委托父实例，链接被触发时才建子实例，关闭后立刻销毁，
 * 不会在 body 上累积 `[data-tippy-root]`。
 */
import { delegate, hideAll } from 'tippy.js';
import { onPageLoad } from './mount';
import { gardenHrefOf, isGardenPath } from '../garden/path';

interface CardData {
    title: string;
    /** 目标页正文（已把相对地址解析成绝对地址、去掉脚本与重复 id） */
    html: string;
    /** 文件夹 / 标签行，来自 `.garden-note-meta` */
    meta?: string;
}

const gardenIdOf = (href: string): string | null => {
    let url: URL;
    try {
        url = new URL(href, location.href);
    } catch {
        return null;
    }
    if (url.origin !== location.origin) return null;
    const match = url.pathname.match(/^\/garden\/(.+?)\/?$/);
    if (!match) return null;
    try {
        return decodeURIComponent(match[1]);
    } catch {
        return match[1];
    }
};

/** URL → 解析结果 + 写入时间（null = 取不到/没有正文） */
const cache = new Map<string, { data: CardData | null; at: number }>();
/** 失败结果只压 30 秒：一次网络抖动不该让这张卡片永久消失 */
const FAILURE_TTL = 30_000;
/** 正文体积可能不小，缓存只留最近打开过的几十篇 */
const CACHE_LIMIT = 40;

const remember = (url: string, data: CardData | null) => {
    cache.delete(url);
    cache.set(url, { data, at: Date.now() });
    while (cache.size > CACHE_LIMIT) {
        const oldest = cache.keys().next().value;
        if (oldest === undefined) break;
        cache.delete(oldest);
    }
};

/** 相对地址按目标页解析；`#hash` 留在页内，不改成绝对地址 */
const absolutize = (root: HTMLElement, base: URL) => {
    const resolve = (value: string) => {
        if (!value || value.startsWith('#') || value.startsWith('data:') || value.startsWith('mailto:') || value.startsWith('tel:')) return value;
        try {
            return new URL(value, base).href;
        } catch {
            return value;
        }
    };

    root.querySelectorAll<HTMLElement>('[href]').forEach((el) => {
        const value = el.getAttribute('href');
        if (value) el.setAttribute('href', resolve(value));
    });

    root.querySelectorAll<HTMLElement>('[src]').forEach((el) => {
        const value = el.getAttribute('src');
        if (value) el.setAttribute('src', resolve(value));
    });

    root.querySelectorAll<HTMLElement>('[srcset]').forEach((el) => {
        const value = el.getAttribute('srcset');
        if (!value) return;
        const next = value
            .split(',')
            .map((part) => {
                const [url, ...descriptor] = part.trim().split(/\s+/);
                return [resolve(url), ...descriptor].join(' ');
            })
            .join(', ');
        el.setAttribute('srcset', next);
    });
};

const extract = (html: string, url: string): CardData | null => {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const article = doc.querySelector('.book-article');
    if (!article) return null;

    const titleEl = article.querySelector('.page-title') ?? doc.querySelector('.page-title') ?? doc.querySelector('h1');
    const title = (titleEl?.textContent ?? doc.title.split('|')[0] ?? '').replace(/\s+/g, ' ').trim();

    // Quartz 取的是目标页的整个 `.popover-hint` 内容区；对应到这里就是整段正文
    const bodyEl = article.querySelector('.garden-note-body') ?? article;
    const clone = bodyEl.cloneNode(true) as HTMLElement;

    // 预览里不跑脚本、不重复挂样式；标题锚点指向的 id 下面会移除，一并去掉
    clone.querySelectorAll('script, style, link, meta, noscript').forEach((node) => node.remove());
    clone.querySelectorAll('a.anchor').forEach((node) => node.remove());
    absolutize(clone, new URL(url, location.href));

    // 很多笔记正文第一行就是和页面标题同名的 H1/H2，卡片上已有标题，去掉这份重复
    const first = clone.firstElementChild as HTMLElement | null;
    if (first && /^H[1-3]$/.test(first.tagName) && (first.textContent ?? '').replace(/\s+/g, ' ').trim() === title) {
        first.remove();
    }

    // 同一个 id 在主页上已经存在，直接搬进弹层会出现重复锚点
    clone.querySelectorAll('[id]').forEach((node) => node.removeAttribute('id'));

    const metaEl = article.querySelector('.garden-note-meta');
    const meta = (metaEl?.textContent ?? '').replace(/\s+/g, ' ').trim();
    const content = clone.innerHTML.trim();

    return { title: title || url, html: content, meta: meta || undefined };
};

const element = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string) => {
    const node = document.createElement(tag);
    node.className = className;
    if (text) node.textContent = text;
    return node;
};

const renderCard = (data: CardData, id: string): HTMLElement => {
    const wrap = element('div', 'garden-popover');

    const title = element('a', 'garden-popover-title', data.title);
    title.href = gardenHrefOf(id);
    wrap.appendChild(title);

    if (data.html) {
        const body = element('div', 'garden-popover-body');
        // 同源、本站在构建期生成的 HTML；脚本已在上面的 extract 里剔除
        body.innerHTML = data.html;
        wrap.appendChild(body);
    }

    if (data.meta) wrap.appendChild(element('div', 'garden-popover-meta', data.meta));

    return wrap;
};

const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** 挂载委托实例，返回清理函数（交给 onPageLoad 在页面切换时调用） */
function mount(): void | (() => void) {
    if (!isGardenPath(location.pathname)) return;

    // 本页的请求控制器：导航离开时 abort 掉还没回来的请求
    const controller = new AbortController();

    const load = async (url: string): Promise<CardData | null> => {
        const hit = cache.get(url);
        // 成功的缓存一直用；失败（或无正文）的过 30 秒再试一次
        if (hit && (hit.data || Date.now() - hit.at < FAILURE_TTL)) return hit.data;
        try {
            const response = await fetch(url, { signal: controller.signal, credentials: 'same-origin' });
            const data = response.ok ? extract(await response.text(), url) : null;
            remember(url, data);
            return data;
        } catch {
            return null;
        }
    };

    // 已关闭的卡片延后 150ms 再销毁：interactive 下鼠标要从链接移进卡片，
    // 立刻销毁会让内容看得见却点不进去
    const pendingDestroy = new Set<number>();

    const parent = delegate(document.body, {
        // 只对正文里的站内链生效：左栏/面包屑/反链列表不弹
        target: '.book-article a.link-internal, .book-article a[href^="/garden/"]',
        // 卡片必须挂在 body 上：tippy 在 interactive + 默认 appendTo 时会把 popper
        // 塞进链接的父节点（`.book-article` 里面），卡片标题就会再次命中 target 套娃
        appendTo: () => document.body,
        delay: [140, 0],
        duration: prefersReducedMotion() ? 0 : [120, 80],
        animation: prefersReducedMotion() ? false : 'shift-away-subtle',
        placement: 'top',
        followCursor: 'horizontal',
        maxWidth: 460,
        // 触屏直接跟链接走，不弹一块需要滚动的长预览
        touch: false,
        interactive: true,
        interactiveBorder: 10,
        content: ' ',
        onHidden(instance) {
            const timer = window.setTimeout(() => {
                pendingDestroy.delete(timer);
                instance.destroy();
            }, 150);
            pendingDestroy.add(timer);
        },
        onShow(instance) {
            const link = instance.reference as HTMLAnchorElement;
            if (link.closest('.tippy-box')) {
                instance.destroy();
                return;
            }
            // 我们自己有卡片了，原生 title 只会叠出第二个小黑框
            link.removeAttribute('title');

            const url = link.href;
            const id = gardenIdOf(url);
            if (!id) {
                instance.hide();
                return;
            }

            instance.setContent(element('div', 'garden-popover garden-popover-loading', '…'));

            void load(url).then((data) => {
                if (!instance.state.isVisible) return;
                instance.setContent(data ? renderCard(data, id) : renderCard({ title: id.split('/').pop() ?? id, html: '' }, id));
            });
        }
    });

    // tippy 6 没有内置 Esc 关闭，自己挂一个（只影响当前页的 tippy）
    const onKeydown = (event: KeyboardEvent) => {
        if (event.key === 'Escape') hideAll({ duration: 0 });
    };
    document.addEventListener('keydown', onKeydown);

    return () => {
        controller.abort();
        pendingDestroy.forEach((timer) => window.clearTimeout(timer));
        pendingDestroy.clear();
        document.removeEventListener('keydown', onKeydown);
        parent.destroy();
    };
}

export function bindGardenPopover(): void {
    onPageLoad(mount);
}
