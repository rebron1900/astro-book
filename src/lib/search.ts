import Fuse from 'fuse.js';
import cocoMessage from './coco-message';

interface SearchPage {
    href: string;
    title: string;
    section: string;
    content?: string;
}

type SearchIndex = Fuse<SearchPage>;

declare global {
    interface Window {
        bookSearchIndex?: SearchIndex;
    }
}

const search = () => {
    const searchDataURL = '/search-data.json';
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

    // Narrowed to non-null for use in closures below
    const input: HTMLInputElement = inputMaybe;
    const results: HTMLElement = resultsMaybe;

    input.addEventListener('focus', init);
    input.addEventListener('keyup', search);

    document.addEventListener('keypress', focusSearchFieldOnKeyPress);

    function focusSearchFieldOnKeyPress(event: KeyboardEvent) {
        const target = event.target as HTMLInputElement;
        if (target.value !== undefined) {
            return;
        }

        if (input === document.activeElement) {
            return;
        }

        const characterPressed = String.fromCharCode(event.charCode);
        if (!isHotkey(characterPressed)) {
            return;
        }

        input.focus();
        event.preventDefault();
    }

    function isHotkey(character: string) {
        const dataHotkeys = input.getAttribute('data-hotkeys') || '';
        return dataHotkeys.indexOf(character) >= 0;
    }

    function init() {
        input.removeEventListener('focus', init); // init once
        input.required = true;

        if (!window.bookSearchIndex) {
            fetch(searchDataURL)
                .then((pages) => pages.json())
                .then((pages: SearchPage[]) => {
                    window.bookSearchIndex = new Fuse(pages, indexConfig);
                    input.required = false;
                    cocoMessage.success('搜索初始化成功 🎉！');
                })
                .catch((err) => {
                    console.warn('[search] 索引加载失败:', err);
                    input.required = false; // 失败也应允许提交，避免表单永久不可用
                });
        } else {
            input.required = false;
        }
    }

    function search() {
        while (results.firstChild) {
            results.removeChild(results.firstChild);
        }

        if (!input.value) {
            return;
        }

        const searchHits = window.bookSearchIndex?.search(input.value).slice(0, 10) ?? [];
        searchHits.forEach(function (page) {
            const li = element('<li><a href></a><br /><small></small></li>');
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

export default search;
