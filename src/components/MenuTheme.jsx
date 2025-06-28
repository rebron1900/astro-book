import { getSvg } from '../utils/help';
import { createSignal, For, onMount } from 'solid-js';
import config from '../data/config';

const MenuTheme = () => {
    const [theme, setTheme] = createSignal('');

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
        // If reduceMotion is enabled or browser doesn't support View Transitions API, update theme directly
        if (document.documentElement.classList.contains('reduce-motion')) {
            updateTheme();
            return;
        }

        // 获取需要临时启用动画的元素
        const menuContent = document.querySelector('.book-menu-content[data-astro-transition-scope]');
        const menuanmi = document.querySelector('.book-menu-content[data-astro-transition-scope]').dataset.astroTransitionScope;

        // 临时移除transition:animate="none"属性
        if (menuContent) {
            menuContent.dataset.astroTransitionScope = '';
        }

        // Temporarily add markers during animation to implement view transition and disable CSS transitions
        document.documentElement.style.setProperty('view-transition-name', 'animation-theme-toggle');
        document.documentElement.setAttribute('data-theme-changing', '');

        // If browser supports View Transitions API, use it to update theme
        const themeTransition = document.startViewTransition(() => {
            // 1. 存储主题设置
            localStorage.setItem('name', theme.desc);
            localStorage.setItem('theme', theme.name);
            localStorage.setItem('themetype', theme.type);
            document.documentElement.setAttribute('class', theme.name);
            document.getElementById('theme').checked = false;
            setTheme(theme.desc);

            const root = document.documentElement;
            const currentFrom = getComputedStyle(root).getPropertyValue('--from').trim();

            if (currentFrom === '100% 0 0 0') {
                root.style.setProperty('--from', '0 0 100% 0');
            } else {
                root.style.setProperty('--from', '100% 0 0 0');
            }

            document.dispatchEvent(new Event('theme-changed'));
        });

        themeTransition.finished.then(() => {
            document.documentElement.style.removeProperty('view-transition-name');
            document.documentElement.removeAttribute('data-theme-changing');

            // 恢复元素的transition:animate="none"属性
            if (menuContent) {
                menuContent.dataset.astroTransitionScope = menuanmi;
            }
        });
    };
    const menuTheme = () => {
        return (
            <ul class='book-theme'>
                <li class='book-section-flat'>
                    <span>配色</span>
                    <ul class='book-collspan'>
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
                                {/* <For each={config.themes}>{(theme, index) => <li onClick={(e) => changeBtn(changeTheme, theme, e)}>{theme.desc}</li>}</For> */}
                            </ul>
                        </li>
                    </ul>
                </li>
            </ul>
        );
    };

    return menuTheme();
};

export default MenuTheme;
