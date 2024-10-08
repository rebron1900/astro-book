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

    const changeBtn = (func, theme, $eve) => {
        const x = $eve.clientX;
        const y = $eve.clientY;
        // 计算鼠标点击位置距离视窗的最大圆半径
        const endRadius = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
        document.documentElement.style.setProperty('--x', x + 'px');
        document.documentElement.style.setProperty('--y', y + 'px');
        document.documentElement.style.setProperty('--r', endRadius + 'px');
        // 判断浏览器是否支持document.startViewTransition
        if (document.startViewTransition) {
            // 如果支持就使用document.startViewTransition方法
            document.startViewTransition(() => {
                func(theme); // 这里的函数是切换主题的函数，调用changeBtn函数时进行传入
            });
        } else {
            // 如果不支持，就使用最原始的方式，切换主题
            func(theme);
        }
    };

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
