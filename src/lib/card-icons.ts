/**
 * 卡片上重复出现的小图标（Lucide，24×24、stroke 2）。
 *
 * 为什么要 sprite：运动页的 178 张卡片、归档页的 150 个月份各自内联同一枚图标的
 * 整段 `<path>`，一页要多写 90–120KB、多出上百个 SVG 节点。这里把路径集中定义一次，
 * 卡片里只留一行 `<use>`（约 60 字节），观感完全不变。
 *
 * 取自 @lucide/astro 1.79.0 的 icons/footprints、bike、mountain、dumbbell、book-open-text。
 * 注意：`waves` 在 1.79.0 里没有被导出（`Waves` 实际是 undefined），
 * 游泳卡片一直走 `?? Footprints` 兜底，这里保持同一结果。
 */
export const CARD_ICONS: Record<string, string> = {
    footprints:
        '<path d="M4 16v-2.38C4 11.5 2.97 10.5 3 8c.03-2.72 1.49-6 4.5-6C9.37 2 10 3.8 10 5.5c0 3.11-2 5.66-2 8.68V16a2 2 0 1 1-4 0Z"></path><path d="M20 20v-2.38c0-2.12 1.03-3.12 1-5.62-.03-2.72-1.49-6-4.5-6C14.63 6 14 7.8 14 9.5c0 3.11 2 5.66 2 8.68V20a2 2 0 1 0 4 0Z"></path><path d="M16 17h4"></path><path d="M4 13h4"></path>',
    bike: '<circle cx="18.5" cy="17.5" r="3.5"></circle><circle cx="5.5" cy="17.5" r="3.5"></circle><circle cx="15" cy="5" r="1"></circle><path d="M12 17.5V14l-3-3 4-3 2 3h2"></path>',
    mountain: '<path d="m8 3 4 8 5-5 5 15H2L8 3z"></path>',
    dumbbell:
        '<path d="M17.596 12.768a2 2 0 1 0 2.829-2.829l-1.768-1.767a2 2 0 0 0 2.828-2.829l-2.828-2.828a2 2 0 0 0-2.829 2.828l-1.767-1.768a2 2 0 1 0-2.829 2.829z"></path><path d="m2.5 21.5 1.4-1.4"></path><path d="m20.1 3.9 1.4-1.4"></path><path d="M5.343 21.485a2 2 0 1 0 2.829-2.828l1.767 1.768a2 2 0 1 0 2.829-2.829l-6.364-6.364a2 2 0 1 0-2.829 2.829l1.768 1.767a2 2 0 0 0-2.828 2.829z"></path><path d="m9.6 14.4 4.8-4.8"></path>',
    'book-open-text':
        '<path d="M12 5v16"></path><path d="M16 13h2"></path><path d="M16 9h2"></path><path d="M20.001 19A2 2 0 0022 17V5a2 2 0 00-1.999-2L16 3.002A5 5 0 0012 5a5 5 0 00-4-2H4a2 2 0 00-2 2v12a2 2 0 001.999 2H8a5 5 0 014 2 5 5 0 014-2z"></path><path d="M6 13h2"></path><path d="M6 9h2"></path>'
};

/** 卡片里只写 `#ci-<name>`；换成 `<use>` 后单个图标约 60 字节。 */
export const CARD_ICON_ID = (name: string) => `#ci-${name}`;