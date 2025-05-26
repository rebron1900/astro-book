import Fuse from 'fuse.js';

const search = () => {
    const searchDataURL = '/search-data.json';
    const indexConfig = Object.assign(
        {
            encode: false,
            tokenize: function (str) {
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

    const input = document.querySelector('#book-search-input');
    const results = document.querySelector('#book-search-results');

    if (!input) {
        return;
    }

    input.addEventListener('focus', init);
    input.addEventListener('keyup', search);

    document.addEventListener('keypress', focusSearchFieldOnKeyPress);

    /**
     * @param {Event} event
     */
    function focusSearchFieldOnKeyPress(event) {
        if (event.target.value !== undefined) {
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

    /**
     * @param {String} character
     * @returns {Boolean}
     */
    function isHotkey(character) {
        const dataHotkeys = input.getAttribute('data-hotkeys') || '';
        return dataHotkeys.indexOf(character) >= 0;
    }

    function init() {
        input.removeEventListener('focus', init); // init once
        input.required = true;

        if (!window.bookSearchIndex) {
            cocoMessage.success('搜索开始初始化 🎉！');
            fetch(searchDataURL)
                .then((pages) => pages.json())
                .then((pages) => {
                    window.bookSearchIndex = new Fuse(pages, indexConfig);
                })
                .then(() => (input.required = false))
                .then(search);
        } else {
            input.required = false;
        }
        cocoMessage.success('搜索初始化成功 🎉！');
    }

    function search() {
        while (results.firstChild) {
            results.removeChild(results.firstChild);
        }

        if (!input.value) {
            return;
        }

        const searchHits = window.bookSearchIndex.search(input.value).slice(0, 10);
        searchHits.forEach(function (page) {
            const li = element('<li><a href></a><br /><small></small></li>');
            const a = li.querySelector('a'),
                small = li.querySelector('small');

            a.href = page.item.href;
            a.textContent = page.item.title;
            small.textContent = page.item.section;

            results.appendChild(li);
        });
    }

    /**
     * @param {String} content
     * @returns {Node}
     */
    function element(content) {
        const div = document.createElement('div');
        div.innerHTML = content;
        return div.firstChild;
    }
};

export default search;
