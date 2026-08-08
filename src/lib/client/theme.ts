/**
 * 应用/切换主题。is:inline 版用于首屏同步执行（防 FOUC），此模块版供 bundle 复用。
 * 两者逻辑保持一致。
 */
export default function changeTheme() {
    const theme = localStorage.theme;
    if (localStorage.theme !== 'auto') {
        document.documentElement.classList.add(theme);
        document.documentElement.setAttribute('data-theme', theme);

        localStorage.theme = theme;
        localStorage.themetype = localStorage.themetype || 'light';
    } else {
        const prefersDarkScheme = window.matchMedia('(prefers-color-scheme: dark)').matches;
        localStorage.themetype = prefersDarkScheme ? 'dark' : 'light';
    }

    localStorage.name = localStorage.name || '自适应';
    localStorage.theme = theme || 'auto';
}
