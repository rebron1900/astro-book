import { getSvg } from '../utils/help';
import { createSignal, For, onMount, Show } from 'solid-js';
import config from '../data/config';

const MenuTheme = () => {
    const [theme, setTheme] = createSignal('');

    onMount(() => {
        const storedTheme = localStorage.getItem('name');
        if (storedTheme) {
            loadFont(storedTheme);
            setTheme(storedTheme);
        } else {
            setTheme(config.themes[0].desc);
            changeTheme(config.themes[0]);
        }
    });

    const loadFont = (theme) => {
        if (theme == 'yayu' || theme == 'onojyun') {
            const link = document.createElement('link');
            link.href = 'https://google-fonts.mirrors.sjtug.sjtu.edu.cn/css2?family=Noto+Serif+SC:wght@200..900&display=swap';
            link.rel = 'stylesheet';
            document.head.appendChild(link);
        }
    };

    const changeTheme = (theme) => {
        localStorage.setItem('name', theme.desc);
        localStorage.setItem('theme', theme.name);
        localStorage.setItem('themetype', theme.type);
        document.documentElement.setAttribute('class', theme.name);
        document.getElementById('theme').checked = false;
        setTheme(theme.desc);
        loadFont(theme.name);
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
