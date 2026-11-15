/**
 * 初始化文章目录（TOC）滚动高亮。
 * 用 IntersectionObserver 监听标题进入视口，高亮对应目录链接及其祖先 <li>。
 */
let activeObserver: IntersectionObserver | null = null;

export default function initToc() {
    activeObserver?.disconnect();
    activeObserver = null;
    const offset = 80;
    // 桌面右栏 + 移动端抽屉里各有一份目录，两份都要跟着正文高亮
    const links = document.querySelectorAll<HTMLAnchorElement>('.book-toc-content a, .book-header aside a');
    if (!links.length) return;

    const byHeading = new Map<HTMLElement, HTMLAnchorElement[]>();
    links.forEach((a) => {
        const id = a.getAttribute('href')?.slice(1) ?? '';
        const el = id ? document.getElementById(id) : null;
        if (!el) return;
        const group = byHeading.get(el) ?? [];
        group.push(a);
        byHeading.set(el, group);
    });
    if (!byHeading.size) return;

    /* 一次性清空所有高亮 */
    function clearAllActive() {
        links.forEach((a) => {
            a.classList.remove('active');
            a.closest('li')?.classList.remove('active');
        });
    }

    const io = (activeObserver = new IntersectionObserver(
        (entries) => {
            entries.forEach((en) => {
                const matched = byHeading.get(en.target as HTMLElement);
                if (!matched) return;

                if (en.isIntersecting) {
                    clearAllActive();
                    matched.forEach((link) => {
                        link.classList.add('active');
                        let li = link.closest('li');
                        while (li) {
                            li.classList.add('active');
                            li = li.parentElement?.closest('li') ?? null;
                        }
                    });
                }
            });
        },
        {
            rootMargin: `-${offset}px 0px -60% 0px`
        }
    ));

    byHeading.forEach((_links, el) => io.observe(el));
}
