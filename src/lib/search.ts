import Fuse from 'fuse.js';
import cocoMessage from './coco-message';
import { isGardenPath } from './garden/path';

interface SearchPage {
    href: string;
    title: string;
    section: string;
    content?: string;
}

type SearchIndex = Fuse<SearchPage>;
type SearchScope = 'blog' | 'garden';

declare global {
    interface Window {
        bookSearchIndex?: SearchIndex;
        gardenSearchIndex?: SearchIndex;
    }
}

const scopeOf = (): SearchScope => (isGardenPath(location.pathname) ? 'garden' : 'blog');

const indexKeyOf = (scope: SearchScope): 'bookSearchIndex' | 'gardenSearchIndex' => (scope === 'garden' ? 'gardenSearchIndex' : 'bookSearchIndex');

const DATA_URL: Record<SearchScope, string> = {
    blog: '/search-data.json',
    garden: '/garden-search-data.json'
};

const PLACEHOLDER: Record<SearchScope, string> = {
    blog: 'Search',
    garden: '搜花园笔记'
};

const EMPTY_HINT: Record<SearchScope, string> = {
    blog: '没有找到相关文章',
    garden: '花园里没有找到这篇'
};

/** 全局只注册一次：`s/` 热键聚焦搜索框（每次事件再取当前页面的输入框）。 */
function focusSearchFieldOnKeyPress(event: KeyboardEvent) {
    const target = event.target as HTMLInputElement | null;
    // 正在输入框/可编辑区域里打字时不劫持
    if (target && (target.value !== undefined || target.isContentEditable)) return;

    const input = document.querySelector<HTMLInputElement>('#book-search-input');
    if (!input || input === document.activeElement) return;

    const dataHotkeys = input.getAttribute('data-hotkeys') || '';
    const characterPressed = String.fromCharCode(event.charCode);
    if (dataHotkeys.indexOf(characterPressed) < 0) return;

    input.focus();
    event.preventDefault();
}

const search = () => {
    const scope = scopeOf();
    const searchDataURL = DATA_URL[scope];
    const indexKey = indexKeyOf(scope);

    const indexConfig = Object.assign(
        {
            encode: false,
            tokenize: function (str: string) {
                return str.replace(/[\x00-\x7F]/g, '').split('');
            }
        },
        {
            includeScore: true,
            useExtendedSearch: true,
            fieldNormWeight: 1.5,
            threshold: 0.2,
            ignoreLocation: true,
            keys: [
                {
                    name: 'title',
                    weight: 0.7
                },
                {
                    name: 'content',
                    weight: 0.2
                },
                {
                    name: 'section',
                    weight: 0.1
                }
            ]
        }
    );

    const inputMaybe = document.querySelector<HTMLInputElement>('#book-search-input');
    const resultsMaybe = document.querySelector<HTMLElement>('#book-search-results');

    if (!inputMaybe || !resultsMaybe) {
        return;
    }

    const input: HTMLInputElement = inputMaybe;
    const results: HTMLElement = resultsMaybe;

    // 花园页的搜索框换文案，别还是博客的
    if (input.getAttribute('placeholder') !== PLACEHOLDER[scope]) {
        input.setAttribute('placeholder', PLACEHOLDER[scope]);
        input.setAttribute('aria-label', PLACEHOLDER[scope]);
    }

    const clearResults = () => {
        while (results.firstChild) results.removeChild(results.firstChild);
        results.dataset.activeIndex = '-1';
    };

    const items = () => [...results.querySelectorAll<HTMLLIElement>('li[data-search-item]')];

    const setActive = (index: number) => {
        const list = items();
        if (!list.length) return;
        const next = Math.max(0, Math.min(index, list.length - 1));
        list.forEach((item, i) => item.classList.toggle('active', i === next));
        results.dataset.activeIndex = String(next);
        const active = list[next];
        if (active && typeof active.scrollIntoView === 'function') {
            active.scrollIntoView({ block: 'nearest' });
        }
    };

    if (input.dataset.searchBound !== 'true') {
        input.dataset.searchBound = 'true';
        input.addEventListener('focus', init);
        // 用 input 事件而不是 keyup：方向键/Enter 不该触发重新检索
        input.addEventListener('input', search);
        input.addEventListener('keydown', (event: KeyboardEvent) => {
            if (event.key === 'ArrowDown') {
                event.preventDefault();
                setActive(Number(results.dataset.activeIndex ?? -1) + 1);
            } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                setActive(Number(results.dataset.activeIndex ?? 0) - 1);
            } else if (event.key === 'Enter') {
                const current = results.dataset.activeIndex;
                const target =
                    current !== undefined && current !== '-1'
                        ? items()[Number(current)]?.querySelector('a')
                        : results.querySelector<HTMLAnchorElement>('li[data-search-item] a');
                if (target) {
                    event.preventDefault();
                    location.href = target.href;
                }
            } else if (event.key === 'Escape') {
                input.value = '';
                clearResults();
                input.blur();
            }
        });
    }

    function init() {
        input.removeEventListener('focus', init); // init once
        const cached = window[indexKey];
        if (cached) {
            input.required = false;
            return;
        }

        input.required = true;
        fetch(searchDataURL)
            .then((pages) => pages.json())
            .then((pages: SearchPage[]) => {
                window[indexKey] = new Fuse(pages, indexConfig);
                input.required = false;
            })
            .catch((err) => {
                console.warn('[search] 索引加载失败:', err);
                input.required = false; // 失败也应允许提交，避免表单永久不可用
            });
    }

    function search() {
        clearResults();

        const keyword = input.value.trim();
        if (!keyword) {
            return;
        }

        const index = window[indexKey];
        if (!index) {
            // 索引还没加载完（或加载失败）：给一句提示，别让用户对着空列表发呆
            const hint = document.createElement('li');
            hint.className = 'book-search-empty';
            hint.textContent = '搜索索引加载中…';
            results.appendChild(hint);
            return;
        }

        const searchHits = index.search(keyword).slice(0, 10);
        if (!searchHits.length) {
            const hint = document.createElement('li');
            hint.className = 'book-search-empty';
            hint.textContent = `${EMPTY_HINT[scope]}「${keyword}」`;
            results.appendChild(hint);
            return;
        }

        results.dataset.activeIndex = '-1';
        searchHits.forEach(function (page) {
            const li = element('<li data-search-item><a href></a><br /><small></small></li>');
            if (!li) return;
            const a = li.querySelector<HTMLAnchorElement>('a'),
                small = li.querySelector<HTMLElement>('small');

            if (a) {
                a.href = page.item.href;
                a.textContent = page.item.title;
            }
            if (small) small.textContent = page.item.section;

            results.appendChild(li);
        });
    }

    function element(content: string): HTMLElement | null {
        const div = document.createElement('div');
        div.innerHTML = content;
        return div.firstElementChild as HTMLElement | null;
    }
};

// 模块只会被加载一次，热键监听也只注册一次
if (typeof document !== 'undefined') {
    document.addEventListener('keypress', focusSearchFieldOnKeyPress);
}

export default search;
