/**
 * 初始化文章目录（TOC）滚动高亮。
 * 用 IntersectionObserver 监听标题进入视口，高亮对应目录链接及其祖先 <li>。
 */
export default function initToc() {
    const links = document.querySelectorAll<HTMLAnchorElement>('.book-toc-content a');
    if (!links.length) return;

    const headings: Array<{ el: HTMLElement; link: HTMLAnchorElement }> = [];
    const offset = 80;

    links.forEach((a) => {
        const id = a.getAttribute('href')?.slice(1) ?? '';
        const el = document.getElementById(id);
        if (el) headings.push({ el, link: a });
    });
    if (!headings.length) return;

    /* 一次性清空所有高亮 */
    function clearAllActive() {
        links.forEach((a) => {
            a.classList.remove('active');
            a.closest('li')?.classList.remove('active');
        });
    }

    const io = new IntersectionObserver(
        (entries) => {
            entries.forEach((en) => {
                const map = headings.find((m) => m.el === en.target);
                if (!map) return;

                if (en.isIntersecting) {
                    clearAllActive();
                    map.link.classList.add('active');
                    let li = map.link.closest('li');
                    while (li) {
                        li.classList.add('active');
                        li = li.parentElement?.closest('li') ?? null;
                    }
                }
            });
        },
        {
            rootMargin: `-${offset}px 0px -60% 0px`
        }
    );

    headings.forEach((m) => io.observe(m.el));
}
