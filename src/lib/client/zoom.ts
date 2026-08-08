import mediumZoom from 'medium-zoom';

/**
 * 初始化文章正文图片的 medium-zoom 放大功能。
 * 用 data-zoom-initialized 标记防止重复绑定（SPA 导航时会重复调用）。
 * 排除 .og-card 内的图片（OG 卡片是链接跳转，不需要放大）。
 */
export default function initZoom() {
    const images = document.querySelectorAll<HTMLImageElement>('.markdown img:not(.og-card img):not([data-zoom-initialized])');
    if (!images.length) return;

    images.forEach((img) => {
        mediumZoom(img, {
            background: 'rgba(0,0,0,0.75)'
        });
        img.setAttribute('data-zoom-initialized', 'true');
    });
}
