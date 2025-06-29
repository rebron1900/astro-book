import { getSvg } from '../utils/help';
import { createSignal, For, onMount } from 'solid-js';
import config from '../data/config';
import tippy from 'tippy.js';
import 'tippy.js/dist/tippy.css';

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
        initThemeinfo();
    });

    const initThemeinfo = () => {
        document.querySelectorAll('.theme-item').forEach((item) => {
            if (item.dataset.themeinfo) {
                tippy(item, {
                    content: item.dataset.themeinfo,
                    allowHTML: true,
                    placement: 'right',
                    interactive: true,
                    appendTo: document.body,
                    inlinePositioning: true,
                    arrow: true
                });
            }
        });
    };

    const changeTheme = (theme) => {
        localStorage.setItem('name', theme.desc);
        localStorage.setItem('theme', theme.name);
        localStorage.setItem('themetype', theme.type);
        document.documentElement.setAttribute('class', theme.name);
        setTheme(theme.desc);
    };

    // theme为需要切换的主题名称
    const initViewTrans = (theme) => {
        if (document.documentElement.classList.contains('reduce')) {
            changeTheme(theme);
            return;
        }
        // 因为我的侧边栏是没有启用动画效果的
        // 但是主题切换时需要启用动画效果，所以这里把原来的设置清空。
        const menuContent = document.querySelector('.book-menu-content[data-astro-transition-scope]');
        const menuanmi = document.querySelector('.book-menu-content[data-astro-transition-scope]').dataset.astroTransitionScope;

        // 临时移除侧边栏的transition:animate="none"属性
        if (menuContent) {
            menuContent.dataset.astroTransitionScope = '';
        }

        // 给html设置我们需要的使用的动画类
        document.documentElement.style.setProperty('view-transition-name', 'animation-theme-toggle');
        document.documentElement.setAttribute('data-theme-changing', '');

        // 开始执行动画并且修改主题
        const themeTransition = document.startViewTransition(() => {
            // 存储主题设置&修改页面主题
            changeTheme(theme);
            // 切换主题时「自上而下」的效果和「自下而上」的效果轮换着来。
            const root = document.documentElement;
            const currentFrom = getComputedStyle(root).getPropertyValue('--from').trim();
            if (currentFrom === '100% 0 0 0') {
                root.style.setProperty('--from', '0 0 100% 0');
            } else {
                root.style.setProperty('--from', '100% 0 0 0');
            }

            document.dispatchEvent(new Event('theme-changed'));
        });

        // 动画执行完毕后执行清理操作
        themeTransition.finished.then(() => {
            document.documentElement.style.removeProperty('view-transition-name');
            document.documentElement.removeAttribute('data-theme-changing');
            // 关闭主题列表
            document.getElementById('theme').checked = false;

            // 恢复侧边栏的transition:animate="none"属性
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
                                <For each={config.themes}>
                                    {(theme, index) => (
                                        <li onClick={[initViewTrans, theme]}>
                                            <span class='theme-item' data-themeinfo={theme.info}>
                                                {theme.desc}
                                            </span>
                                        </li>
                                    )}
                                </For>
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
