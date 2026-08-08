/**
 * 初始化「回到顶部」按钮：点击平滑滚动到顶部，滚动时控制按钮显隐。
 */
export default function initBackToTop() {
    const scrollToTopBtn = document.getElementById('scrollToTop');
    if (!scrollToTopBtn) return;

    scrollToTopBtn.addEventListener('click', () => {
        window.scrollTo({
            top: 0,
            behavior: 'smooth'
        });
    });

    // 每次导航重新绑定，旧 body 已脱离，不会泄漏；直接覆盖式赋值最稳妥
    window.onscroll = function () {
        if (document.body.scrollTop > 20 || document.documentElement.scrollTop > 20) {
            scrollToTopBtn.style.opacity = '1';
        } else {
            scrollToTopBtn.style.opacity = '0';
        }
    };
}
