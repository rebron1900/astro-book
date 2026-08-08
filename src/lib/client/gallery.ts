/**
 * 初始化 Ghost kg-gallery 图片比例修正。
 * 根据图片 naturalWidth/naturalHeight 设置 flex，使 gallery 布局按比例显示。
 */
export default function initGallery() {
    const gallery = document.querySelectorAll<HTMLImageElement>('.kg-gallery-image img');
    if (!gallery.length) return;

    gallery.forEach((e) => {
        const fix = function () {
            const l = e.closest<HTMLElement>('.kg-gallery-image');
            const a = e.naturalWidth / e.naturalHeight;
            if (l) l.style.flex = a + ' 1 0%';
        };

        if (e.complete) {
            fix();
        } else {
            e.addEventListener('load', fix);
        }
    });
}
