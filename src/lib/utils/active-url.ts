/**
 * 导航激活判定：`/timeline/memo/2/` 命中 `/timeline/`，`/garden/tags/privacy/` 命中 `/garden/`，
 * 但 `/garden-foo/` 不能命中 `/garden/`。抽成纯函数便于测试边界。
 */
export const normalizePath = (value: string): string => {
    const path = value.split(/[?#]/, 1)[0];
    return path.replace(/\/+$/, '') || '/';
};

export function isActiveUrl(currentPathname: string, url: string): boolean {
    if (!url.startsWith('/')) return false;
    const current = normalizePath(currentPathname);
    const target = normalizePath(url);
    return current === target || (target !== '/' && current.startsWith(`${target}/`));
}
