/**
 * 移动端两个抽屉（左栏导航 / 目录·反链）的共用开合逻辑。
 *
 * 结构仍是主题的 `#menu-control` / `#toc-control` 复选框 + CSS 过渡，这里只补
 * CSS 做不到的部分：一次只开一个、Esc 关闭、点抽屉里的链接后收起、切换页面后复位，
 * 以及打开时锁住背景滚动。博客与花园走同一套。
 */
import { onPageLoad } from './mount';

const CLOSE_ON_LINK = '.book-menu a[href], .book-header aside a[href]';

export function bindMobileDrawers(): void {
    onPageLoad(() => {
        const menu = document.querySelector<HTMLInputElement>('#menu-control');
        const toc = document.querySelector<HTMLInputElement>('#toc-control');
        if (!menu || !toc) return;

        const syncLock = () => {
            document.documentElement.classList.toggle('drawer-open', menu.checked || toc.checked);
        };

        const closeAll = () => {
            if (!menu.checked && !toc.checked) return;
            menu.checked = false;
            toc.checked = false;
            syncLock();
        };

        // 同时只允许一个抽屉：开目录就收起导航，反之亦然
        const onMenuChange = () => {
            if (menu.checked) toc.checked = false;
            syncLock();
        };
        const onTocChange = () => {
            if (toc.checked) {
                menu.checked = false;
                // 没有目录/反链面板的页面（例如首页）按到目录图标时不要只锁滚动。
                // 活动页有自己的右侧抽屉（复用同一个 #toc-control），这里不能误关。
                const hasPanel = Boolean(document.querySelector('.book-header aside')) || Boolean(document.querySelector('.activity-page'));
                if (!hasPanel) toc.checked = false;
            }
            syncLock();
        };
        const onKeydown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') closeAll();
        };
        // 点抽屉内的链接后立即收起，避免页面已换、抽屉还开着
        const onClick = (event: MouseEvent) => {
            const target = event.target as HTMLElement | null;
            if (target?.closest(CLOSE_ON_LINK)) closeAll();
        };

        menu.addEventListener('change', onMenuChange);
        toc.addEventListener('change', onTocChange);
        document.addEventListener('keydown', onKeydown);
        document.addEventListener('click', onClick);

        // 首次进入或 SPA 换页后都从关闭态开始（复选框的选中态可能被浏览器保留）
        menu.checked = false;
        toc.checked = false;
        syncLock();

        return () => {
            menu.removeEventListener('change', onMenuChange);
            toc.removeEventListener('change', onTocChange);
            document.removeEventListener('keydown', onKeydown);
            document.removeEventListener('click', onClick);
            document.documentElement.classList.remove('drawer-open');
        };
    });
}
