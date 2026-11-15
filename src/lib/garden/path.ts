/**
 * 花园路径判定。搜索与站内链预览共用，避免两处各写一份边界的 `startsWith`。
 *
 * 注意：`/garden-foo` 不能算花园（否则搜索会去拉花园索引、popover 也会误挂）。
 */
export function isGardenPath(pathname: string): boolean {
    const path = pathname.replace(/\/+$/, '') || '/';
    return path === '/garden' || path.startsWith('/garden/');
}

/**
 * 花园里一条 id 对应的站内 URL。
 *
 * 根笔记（id === 'index'）的页面是 `/garden/`，不是 `/garden/index/`——手拼
 * `/garden/${id}/` 会产出站内死链（反链块、局部图回退列表都踩过）。
 */
export function gardenHrefOf(id: string): string {
    return id === 'index' ? '/garden/' : `/garden/${id}/`;
}
