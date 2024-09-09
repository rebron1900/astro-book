import { getSvg } from '../utils/help';
import { createSignal, For, onMount, Show } from 'solid-js';
import config from '../data/config';

const MenuTheme = () => {
    const [theme, setTheme] = createSignal('');
    const [themeName, setThemename] = createSignal('');

    onMount(() => {
        const storedTheme = localStorage.getItem('name');
        if (storedTheme) {
            setTheme(storedTheme);
        } else {
            setTheme(config.themes[0].desc);
            changeTheme(config.themes[0]);
        }
    });

    const changeTheme = (theme) => {
        localStorage.setItem('name', theme.desc);
        localStorage.setItem('theme', theme.name);
        localStorage.setItem('themetype', theme.type);
        document.documentElement.setAttribute('class', theme.name);
        document.getElementById('theme').checked = false;
        setTheme(theme.desc);
    };

    const menuTheme = () => {
        return (
            <ul class='book-theme'>
                <li>配色</li>
                <li>
                    <input type='checkbox' id='theme' class='toggle' />
                    <label for='theme' class='flex justify-between'>
                        <span role='button' class='flex align-center'>
                            <span innerHTML={getSvg('theme')}></span>
                            <span>{theme()}</span>
                        </span>
                    </label>
                    <ul>
                        <For each={config.themes}>{(theme, index) => <li onClick={[changeTheme, theme]}>{theme.desc}</li>}</For>
                    </ul>
                </li>
            </ul>
        );
    };

    return menuTheme();
};

export default MenuTheme;
