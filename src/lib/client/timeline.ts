// 时间线页交互：无限滚动 + memo 展开 + 图片堆叠画廊 + 滚动渐入。
// 由 List.astro 通过 onPageLoad(initTimeline) 挂载；这里沿用原有 DOM 结构，
// 类型层面先关闭检查，后续可逐步补类型。
// @ts-nocheck
import initZoom from './zoom';

    export function initTimeline(): (() => void) | void {
        let activeCleanup = null;
        const boot = () => {
        const list = document.querySelector('[data-timeline-list]');
        if (!list || list.dataset.autoLoadReady === 'true') return;
        activeCleanup?.();
        activeCleanup = null;
        list.dataset.autoLoadReady = 'true';
        if (list.dataset.autoLoad === 'false') return;

        const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        let loading = false;

        const setupMemoText = (root = document) => {
            root.querySelectorAll('[data-memo-text]').forEach((box) => {
                if (box.dataset.memoReady === 'true') return;
                box.dataset.memoReady = 'true';

                const block = box.closest('.memo-block');
                const button = block?.querySelector('[data-memo-more]');
                if (!button) return;

                const sync = () => {
                    if (box.classList.contains('is-expanded')) return;
                    const overflow = box.scrollHeight > box.clientHeight + 2;
                    box.classList.toggle('is-collapsed', overflow);
                    button.hidden = !overflow;
                    button.setAttribute('aria-expanded', 'false');
                };

                const body = box.querySelector('.memo-content');
                if (body && 'ResizeObserver' in window) {
                    new ResizeObserver(() => sync()).observe(body);
                }
                if (document.fonts?.ready) document.fonts.ready.then(sync);
                window.addEventListener('load', sync);
                sync();

                button.addEventListener('click', () => {
                    const isExpanded = box.classList.contains('is-expanded');
                    if (isExpanded) {
                        box.classList.remove('is-expanded');
                        box.classList.add('is-collapsed');
                        button.setAttribute('aria-label', '展开全文');
                        button.setAttribute('aria-expanded', 'false');
                        button.hidden = false;
                        window.setTimeout(sync, 300);
                    } else {
                        box.style.setProperty('--memo-expanded-height', `${box.scrollHeight}px`);
                        box.classList.add('is-expanded');
                        box.classList.remove('is-collapsed');
                        button.setAttribute('aria-label', '收起');
                        button.setAttribute('aria-expanded', 'true');
                        button.hidden = false;
                    }
                });
            });
        };

        const setupPhotoStacks = (root = document) => {
            root.querySelectorAll('.memo-photo-stack').forEach((stack) => {
                if (stack.dataset.photosReady === 'true') return;
                stack.dataset.photosReady = 'true';
                const photos = Array.from(stack.querySelectorAll('.memo-photo'));
                if (!photos.length) return;
                const gallery = stack.closest('[data-photo-gallery]');
                const prevButton = gallery ? gallery.querySelector('[data-photo-nav="prev"]') : null;
                const nextButton = gallery ? gallery.querySelector('[data-photo-nav="next"]') : null;

                // 照片横向溢出时用两侧按钮替代滚动条：滚到两端时对应的按钮收起
                const syncGalleryNav = () => {
                    if (!gallery || !prevButton || !nextButton) return;
                    const maxScroll = stack.scrollWidth - stack.clientWidth;
                    const scrollable = maxScroll > 1;
                    prevButton.hidden = !scrollable || stack.scrollLeft <= 1;
                    nextButton.hidden = !scrollable || stack.scrollLeft >= maxScroll - 1;
                };

                // 翻页步长：默认翻过一屏的 3/4；单张很宽的照片按它自己的宽度翻，
                // 保证一次点击至少能完整越过一张，窄容器里也不会原地打转。
                const photoStep = () => {
                    const page = stack.clientWidth * 0.75;
                    let step = page > 0 ? page : 120;
                    if (photos.length > 1) {
                        const delta = photos[1].getBoundingClientRect().left - photos[0].getBoundingClientRect().left;
                        if (Math.abs(delta) > 8) step = Math.max(step, Math.abs(delta));
                    } else {
                        const width = photos[0].getBoundingClientRect().width;
                        if (width > 0) step = Math.max(step, width);
                    }
                    return step;
                };

                const scrollGallery = (direction) => {
                    stack.scrollBy({ left: direction * photoStep(), behavior: reduceMotion ? 'auto' : 'smooth' });
                };

                if (gallery && prevButton && nextButton) {
                    gallery.dataset.galleryReady = 'true';
                    prevButton.addEventListener('click', () => scrollGallery(-1));
                    nextButton.addEventListener('click', () => scrollGallery(1));
                    stack.addEventListener('scroll', syncGalleryNav, { passive: true });
                    window.addEventListener('resize', syncGalleryNav);
                }

                const setPhotoSize = (photo) => {
                    const image = photo.querySelector('img');
                    if (!image) return;
                    const naturalWidth = image.naturalWidth;
                    const naturalHeight = image.naturalHeight;
                    if (!naturalWidth || !naturalHeight) return;
                    const compact = window.innerWidth <= 544;
                    const height = compact ? 90 : 112;
                    // 只用两种固定比例：横向长边 1.618，纵向短边 1 / 1.618。
                    const ratio = naturalWidth >= naturalHeight ? 1.61803398875 : 1 / 1.61803398875;
                    photo.style.setProperty('--photo-width', `${Math.round(height * ratio)}px`);
                    photo.style.setProperty('--photo-height', `${height}px`);
                };

                const setActive = (activeIndex) => {
                    photos.forEach((photo, index) => {
                        photo.classList.toggle('is-right', activeIndex >= 0 && index > activeIndex);
                        photo.classList.toggle('is-active', index === activeIndex);
                    });
                };
                photos.forEach((photo, index) => {
                    const image = photo.querySelector('img');
                    const video = photo.querySelector('video');
                    if (image) {
                        if (image.complete && image.naturalWidth) setPhotoSize(photo);
                        else
                            image.addEventListener(
                                'load',
                                () => {
                                    // 宽度确定后溢出状态可能才成立，重新同步一次按钮
                                    setPhotoSize(photo);
                                    syncGalleryNav();
                                },
                                { once: true }
                            );
                    }
                    if (video) {
                        // 视频拿到时长前宽度是 300px，元数据到齐后溢出状态会变，需要重新同步
                        if (video.readyState >= 1) window.setTimeout(syncGalleryNav, 0);
                        else video.addEventListener('loadedmetadata', syncGalleryNav, { once: true });
                    }
                    photo.addEventListener('pointerenter', () => setActive(index));
                });
                stack.addEventListener('pointerleave', () => setActive(-1));
                // 字体、图片陆续就位时气泡宽度/溢出状态还会变，这几个时机各补一次同步
                if (document.fonts && document.fonts.ready) document.fonts.ready.then(syncGalleryNav).catch(() => {});
                window.addEventListener('load', syncGalleryNav, { once: true });
                requestAnimationFrame(() => requestAnimationFrame(syncGalleryNav));
                syncGalleryNav();
            });
        };

        const revealObserver = !reduceMotion && 'IntersectionObserver' in window
            ? new IntersectionObserver((entries) => {
                entries.forEach((entry) => {
                    if (!entry.isIntersecting) return;
                    entry.target.classList.add('is-visible');
                    revealObserver.unobserve(entry.target);
                });
            }, { rootMargin: '0px 0px -5% 0px', threshold: 0.05 })
            : null;

        const setupReveal = (root = document, animate = true) => {
            root.querySelectorAll('.ledger-row:not([data-reveal-ready]), .timeline-month-row:not([data-reveal-ready])').forEach((row) => {
                row.dataset.revealReady = 'true';
                if (!animate || !revealObserver) {
                    row.classList.add('is-visible');
                    return;
                }
                row.classList.add('reveal-ready');
                revealObserver.observe(row);
            });
        };

        const setupNewRows = (animate = true) => {
            setupMemoText();
            setupPhotoStacks();
            setupReveal(document, animate);
            window.dispatchEvent(new CustomEvent('timeline:updated'));
        };

        const pageCache = new Map();
        const fetchPage = (url) => {
            if (!pageCache.has(url)) {
                pageCache.set(
                    url,
                    fetch(url, { headers: { 'X-Requested-With': 'fetch' } })
                        .then((response) => {
                            if (!response.ok) throw new Error('Request failed');
                            return response.text();
                        })
                        .catch(() => {
                            pageCache.delete(url);
                            return null;
                        })
                );
            }
            return pageCache.get(url);
        };

        const prefetchSeen = new Set();
        const prefetchChain = (url, depth) => {
            if (!url || depth <= 0 || prefetchSeen.has(url)) return;
            prefetchSeen.add(url);
            void fetchPage(url).then((html) => {
                if (!html || depth <= 1) return;
                const doc = new DOMParser().parseFromString(html, 'text/html');
                const nextList = doc.querySelector('[data-timeline-list]');
                const nextUrl = nextList?.getAttribute('data-next');
                if (nextUrl) prefetchChain(nextUrl, depth - 1);
            });
        };

        const prefetchNext = () => {
            prefetchChain(list.dataset.next, 3);
        };

        const loadNext = async () => {
            if (loading) return false;
            const nextUrl = list.dataset.next;
            if (!nextUrl) return false;
            loading = true;
            try {
                const html = await fetchPage(nextUrl);
                if (!html) return false;
                const doc = new DOMParser().parseFromString(html, 'text/html');
                const nextList = doc.querySelector('[data-timeline-list]');
                if (!nextList) return false;
                const incoming = Array.from(nextList.querySelectorAll('.ledger-row, .timeline-month-row'));
                if (!incoming.length) {
                    list.dataset.next = '';
                    return false;
                }
                if (list.dataset.groupBy === 'month') {
                    incoming.forEach((row) => {
                        if (!row.matches('.timeline-month-row')) return;
                        const key = row.getAttribute('data-month-key');
                        const existing = key ? list.querySelector(`.timeline-month-row[data-month-key="${key}"]`) : null;
                        const grid = existing?.querySelector('.timeline-month-grid');
                        if (grid) {
                            row.querySelectorAll('.timeline-month-grid > *').forEach((card) => grid.append(card));
                        } else {
                            list.append(row);
                        }
                    });
                } else {
                    incoming.forEach((row) => list.append(row));
                }
                list.dataset.next = nextList.getAttribute('data-next') || '';
                setupNewRows();
                prefetchNext();
                return true;
            } catch {
                return false;
            } finally {
                loading = false;
            }
        };

        const loadStatus = document.querySelector('[data-timeline-load-status]');
        const refreshLoadStatus = () => {
            if (!loadStatus) return;
            loadStatus.textContent = list.dataset.next ? '继续向下滚动加载更多' : '已加载全部';
        };
        const requestNext = async () => {
            if (loading) return false;
            if (loadStatus) loadStatus.textContent = '正在加载…';
            const loaded = await loadNext();
            refreshLoadStatus();
            return loaded;
        };

        setupNewRows();
        refreshLoadStatus();
        prefetchNext();

        let scrollTicking = false;
        const onWindowScroll = () => {
            if (scrollTicking) return;
            scrollTicking = true;
            requestAnimationFrame(() => {
                scrollTicking = false;
                if (!list.isConnected) return;
                if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2600) void requestNext();
            });
        };
        window.addEventListener('scroll', onWindowScroll, { passive: true });

        const hidePagination = () => document.querySelector('.book-pagination')?.setAttribute('hidden', '');
        hidePagination();
        window.addEventListener('load', hidePagination);

        const sentinel = document.createElement('div');
        sentinel.className = 'timeline-sentinel';
        sentinel.setAttribute('aria-hidden', 'true');
        list.after(sentinel);

        const loadMoreButton = list.dataset.loadMore === 'true' ? document.createElement('button') : null;
        if (loadMoreButton) {
            loadMoreButton.type = 'button';
            loadMoreButton.className = 'timeline-load-more';
            loadMoreButton.textContent = '加载更多';
            loadMoreButton.addEventListener('click', async () => {
                loadMoreButton.disabled = true;
                loadMoreButton.textContent = '加载中…';
                await requestNext();
                loadMoreButton.disabled = false;
                loadMoreButton.textContent = '加载更多';
                loadMoreButton.hidden = !list.dataset.next;
            });
            list.after(loadMoreButton);
        }

        let loadObserver = null;
        if ('IntersectionObserver' in window) {
            loadObserver = new IntersectionObserver((entries) => {
                if (entries.some((entry) => entry.isIntersecting)) void requestNext();
            }, { rootMargin: '2800px 0px' });
            loadObserver.observe(sentinel);
        }

        // 导航前清掉上一页残留的 window 监听 / observer，避免 detached 列表继续请求
        activeCleanup = () => {
            window.removeEventListener('scroll', onWindowScroll);
            window.removeEventListener('load', hidePagination);
            loadObserver?.disconnect();
            activeCleanup = null;
        };
        };
        boot();
        const onTimelineUpdated = () => initZoom();
        window.addEventListener('timeline:updated', onTimelineUpdated);
        return () => {
            activeCleanup?.();
            window.removeEventListener('timeline:updated', onTimelineUpdated);
        };
}
