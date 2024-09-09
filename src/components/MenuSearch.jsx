// src/components/SearchComponent.jsx
import { createSignal, onMount } from 'solid-js';
import Fuse from 'fuse.js';

const SearchComponent = () => {
    let fuse;

    const indexConfig = {
        includeScore: true,
        useExtendedSearch: true,
        fieldNormWeight: 1.5,
        threshold: 0.2,
        ignoreLocation: true,
        keys: [
            { name: 'title', weight: 0.7 },
            { name: 'html', weight: 0.2 }
        ]
    };

    onMount(() => {});

    const search = () => {};

    return (
        <div class='book-search'>
            <input type='text' id='book-search-input' placeholder='Search' aria-label='Search' maxlength='64' data-hotkeys='s/' />
            <div class='book-search-spinner hidden'></div>
            <ul id='book-search-results'></ul>
        </div>
    );
};

export default SearchComponent;
