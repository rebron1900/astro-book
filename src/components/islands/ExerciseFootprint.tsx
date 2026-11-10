import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from 'solid-js';
import { Portal } from 'solid-js/web';
import type { FootprintArticle, FootprintData, FootprintPlace, FootprintProvinceGroup } from '../../lib/footprint';
import { FOOTPRINT_OPEN_EVENT, articleMatchesSelection, groupPlacesByProvince, markRepeatArticles } from '../../lib/footprint';
import { createFootprintMap, type FootprintMapController, type FootprintPlaceInfo } from '../../lib/client/footprint-map';
import { prefersReducedMotion } from '../../lib/client/dom';
import initZoom from '../../lib/client/zoom';

export interface ExerciseFootprintProps {
    /** 构建期算好的足迹数据（标点 + 游记） */
    data: FootprintData;
    /** Mapbox public token */
    token: string;
}

/** 和样式里的窄屏断点保持一致：窄屏筛选走全屏模态 */
const NARROW_QUERY = '(max-width: 47.84rem)';

/**
 * 足迹模式：从预览地图上方的「足迹」按钮进入，页面切成和友邻页类似的布局。
 *
 * 左侧导航保留；中间是地图，占满「除了标题 / 副标题之外」的剩余高度，右上角悬浮「筛选」HUD；
 * 右侧时间线沿用首页 / 友邻页那套纵向时间轴（日期 + 竖线圆点 + 内容），宽度和 TOC 列一致（16rem），
 * 自己内部滚动；桌面端整页不滚动，窄屏地图在上、时间线在下，页面正常滚动。
 *
 * 入口有两种：`#footprint`（无 JS 也能落到这个 hash，挂载后自查）和 document 事件（页内即时响应）。
 * 地图第一次打开时才创建（此时容器才有真实尺寸），关闭不销毁，页面卸载时统一清理。
 */
export default function ExerciseFootprint(props: ExerciseFootprintProps) {
    const [open, setOpen] = createSignal(false);
    const [mapHostReady, setMapHostReady] = createSignal(false);
    const [activePlace, setActivePlace] = createSignal<string | null>(null);
    /** 聚焦时具体高亮哪张卡：一个地点可能对应多篇游记，只在被点/被滚到的那张上挂聚焦样式 */
    const [activeCardSlug, setActiveCardSlug] = createSignal<string | null>(null);
    const [mapError, setMapError] = createSignal(false);
    /** 窄屏滚下去之后悬浮地图缩高（只影响视觉高度，滚动回顶部恢复） */
    const [mapCompact, setMapCompact] = createSignal(false);

    /** 构建期算一次的两级树：省份 → 该省地名 */
    const groups = groupPlacesByProvince(props.data.places);
    /** 默认全部收起：面板打开先看到 12 个省，要展开哪个省再点箭头 */
    const defaultExpanded = () => new Set<string>();

    /** 筛选：只存「地名」一套状态，省份的勾选 / 半选 / 计数全部从它推出来 */
    const [selected, setSelected] = createSignal<ReadonlySet<string>>(new Set<string>());
    const [expanded, setExpanded] = createSignal<ReadonlySet<string>>(defaultExpanded());
    const [filterOpen, setFilterOpen] = createSignal(false);
    const [narrow, setNarrow] = createSignal(false);
    /** 3D/平面按钮的视觉：真源在控制器，这里只接收 onStateChange 的镜像 */
    const [pitchMode, setPitchMode] = createSignal<'flat' | 'tilt'>('flat');

    let overlay: HTMLDivElement | undefined;
    let mapHost: HTMLDivElement | undefined;
    let panel: HTMLElement | undefined;
    let filterRoot: HTMLDivElement | undefined;
    let filterPanel: HTMLDivElement | undefined;
    let filterModal: HTMLDivElement | undefined;
    let controller: FootprintMapController | undefined;
    let lastFocus: HTMLElement | null = null;
    let lastFilterFocus: HTMLElement | null = null;
    let lastScroll = 0;
    let wasOpen = false;

    const filteredArticles = createMemo(() => props.data.articles.filter((article) => articleMatchesSelection(article, selected())));
    /** 同日多篇不重复显示日期：判定逻辑在数据层（有单测），这里只消费结果 */
    const repeatFlags = createMemo(() => markRepeatArticles(filteredArticles()));
    const selectedProvinces = createMemo(() => groups.filter((group) => group.places.some((place) => selected().has(place.name))));

    const provinceHit = (group: FootprintProvinceGroup) => group.places.filter((place) => selected().has(place.name)).length;
    const provinceChecked = (group: FootprintProvinceGroup) => provinceHit(group) === group.places.length;
    const provinceMixed = (group: FootprintProvinceGroup) => {
        const hit = provinceHit(group);
        return hit > 0 && hit < group.places.length;
    };

    /** 地名 -> 关联游记：地图 tooltip 要显示「几篇 / 最近日期 / 标题」 */
    const articlesByPlace = new Map<string, FootprintArticle[]>();
    for (const article of props.data.articles) {
        for (const placeId of article.placeIds) {
            const list = articlesByPlace.get(placeId);
            if (list) list.push(article);
            else articlesByPlace.set(placeId, [article]);
        }
    }

    const placeInfo = (place: FootprintPlace): FootprintPlaceInfo => {
        const articles = articlesByPlace.get(place.id) ?? [];
        return {
            count: articles.length,
            latest: articles[0]?.dateLabel ?? null,
            // tooltip 里要能点进文章，所以直接给完整字段，不再只传标题
            articles: articles.map((article) => ({ title: article.title, url: article.url, dateLabel: article.dateLabel }))
        };
    };

    const subtitle = () => {
        const stats = props.data.stats;
        const parts = [`${stats.places} 个地点`];
        if (stats.articles > 0) parts.push(`${stats.articles} 篇游记`);
        if (stats.years) parts.push(`${stats.years[0]}—${stats.years[1]}`);
        return parts.join(' · ');
    };

    /** 日期列只放「月.日」，年和星期另起两行，和首页时间线同一结构 */
    /**
     * 卡片两段式：第一次点先把这篇的第一个地点定到地图上，已经定位过的卡片再点才打开文章。
     * 正文里还有标题链接和地点 chip，它们在各自的处理里 stopPropagation，不会被这里截走。
     */
    const activateCard = (event: MouseEvent, article: FootprintArticle) => {
        // 正在划词选中正文时不要当成点击
        const selection = window.getSelection();
        if (selection && !selection.isCollapsed && selection.toString().trim()) return;
        // 点的是卡片里的链接、chip 或图片（灯箱）时，各走各的，别被两段式截走
        const target = event.target as HTMLElement | null;
        if (target && target !== (event.currentTarget as HTMLElement) && target.closest('a, button, img')) return;
        event.stopPropagation();
        const placeId = article.placeIds[0];
        if (placeId && activePlace() !== placeId) {
            pendingCardSlug = article.slug;
            controller?.focusPlace(placeId);
            return;
        }
        // 走卡片标题那个真链接：站点开着 ClientRouter，这样是站内客户端跳转（有过渡、不闪白），
        // 直接 location.assign 会整页刷新，观感和点标题链接不一致
        const link = (event.currentTarget as HTMLElement | null)?.querySelector<HTMLAnchorElement>('.ex-fp-row-title a');
        if (link) {
            link.click();
            return;
        }
        window.location.assign(article.url);
    };

    const monthDay = (article: FootprintArticle) => article.dateLabel.slice(5);

    // 首页 List.astro 用的是同一组标签，这里保持一致
    const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

    /** 用 dateLabel 的年月日算星期，避免 new Date(iso) 在浏览器时区下跨天 */
    const weekdayOf = (article: FootprintArticle) => {
        const [year, month, day] = article.dateLabel.split('.').map(Number);
        if (!year || !month || !day) return '';
        return WEEKDAYS[new Date(year, month - 1, day).getDay()] ?? '';
    };

    const ensureMap = () => {
        if (controller || !mapHost) return;
        controller = createFootprintMap({
            container: mapHost,
            token: props.token,
            places: props.data.places,
            placeInfo,
            onSelect: (placeId) => {
                setActivePlace(placeId);
                if (placeId) revealArticle(placeId);
                else setActiveCardSlug(null);
            },
            // 已激活的标点再点一次：打开该地点最新的游记；没有游记就只保持聚焦
            onOpenPlace: (placeId) => {
                const article = articlesByPlace.get(placeId)?.[0];
                if (article) openArticle(article);
            },
            onError: () => setMapError(true),
            onReady: () => setMapError(false),
            onStateChange: (state) => setPitchMode(state.pitchMode)
        });
        controller.start();
        // 地图可能是「筛选过之后才第一次打开」的，创建后立刻补一次当前筛选
        controller.setFilter(selected());
    };

    /** 点卡片聚焦时记下这张卡，等 onSelect 回来时优先高亮它 */
    let pendingCardSlug: string | null = null;

    /** 走卡片标题那个真链接，让 ClientRouter 做站内跳转；卡片被筛掉时退化成整页跳转 */
    const openArticle = (article: FootprintArticle) => {
        const card = panel?.querySelector<HTMLElement>(`[data-slug="${CSS.escape(article.slug)}"]`);
        const link = card?.querySelector<HTMLAnchorElement>('.ex-fp-row-title a');
        if (link) {
            link.click();
            return;
        }
        window.location.assign(article.url);
    };

    /** 点地图上的标点后，把时间线里对应的游记卡片滚到眼前 */
    const revealArticle = (placeId: string | null | undefined) => {
        if (!placeId || !panel) return;
        // 点卡片进来的优先高亮那张卡；点标点进来就取这个地点最新的游记
        const preferred = pendingCardSlug;
        pendingCardSlug = null;
        const article =
            (preferred ? filteredArticles().find((item) => item.slug === preferred) : undefined) ??
            filteredArticles().find((item) => item.placeIds.includes(placeId));
        if (!article) {
            // 这个地点没有游记（118 个标点里 70 个是这种）：右栏没有对应卡片，
            // 必须把上一张卡的高亮清掉，否则地图亮新点、右栏亮旧卡
            setActiveCardSlug(null);
            return;
        }
        setActiveCardSlug(article.slug);
        const card = panel.querySelector<HTMLElement>(`[data-slug="${article.slug}"]`);
        if (!card) return;
        card.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
        card.classList.remove('is-flash');
        // 重新触发一次高亮动画
        void card.offsetWidth;
        card.classList.add('is-flash');
        window.setTimeout(() => card.classList.remove('is-flash'), 1400);
    };

    /* ------------------------------ 筛选状态 ------------------------------ */

    const toggleProvince = (group: FootprintProvinceGroup) => {
        const next = new Set(selected());
        const remove = provinceChecked(group);
        for (const place of group.places) {
            if (remove) next.delete(place.name);
            else next.add(place.name);
        }
        setSelected(next);
    };

    const togglePlace = (name: string) => {
        const next = new Set(selected());
        if (next.has(name)) next.delete(name);
        else next.add(name);
        setSelected(next);
    };

    const selectAll = () => setSelected(new Set(props.data.places.map((place) => place.name)));
    const clearAll = () => setSelected(new Set<string>());

    const toggleExpand = (province: string) => {
        const next = new Set(expanded());
        if (next.has(province)) next.delete(province);
        else next.add(province);
        setExpanded(next);
    };

    const openFilter = () => {
        lastFilterFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        setFilterOpen(true);
    };

    const closeFilter = () => {
        if (!filterOpen()) return;
        setFilterOpen(false);
        requestAnimationFrame(() => lastFilterFocus?.focus({ preventScroll: true }));
    };

    const toggleFilter = () => (filterOpen() ? closeFilter() : openFilter());

    /** 全屏模态里 Tab 不跑出去 */
    const trapTab = (event: KeyboardEvent) => {
        if (event.key !== 'Tab' || !filterModal) return;
        const focusable = [
            ...filterModal.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), [tabindex]:not([tabindex="-1"])')
        ];
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
        } else if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
        }
    };

    /* ------------------------------ 开关足迹 ------------------------------ */

    /**
     * 用 View Transition 包住「运动页 ↔ 足迹」的页内切换。
     * 地图和右侧时间线各自起名，其余部分走根节点淡入淡出；
     * 减弱动画时直接切；退出/再进时清掉标记，避免和 ClientRouter 的页面过渡抢。
     */
    const runWithViewTransition = (apply: () => void) => {
        const doc = document as Document & { startViewTransition?: (callback: () => void | Promise<void>) => { finished?: Promise<unknown> } };
        if (prefersReducedMotion() || typeof doc.startViewTransition !== 'function') {
            apply();
            return;
        }
        document.documentElement.setAttribute('data-fp-transition', '');
        try {
            const transition = doc.startViewTransition(() => {
                apply();
                // Solid 的 DOM 更新走 effect 队列：让出两个宏任务再让浏览器取「新快照」，
                // 否则可能拍到展开到一半的中间态。
                // 不用 rAF：过渡的捕获阶段 rAF 可能被推迟，Chrome 会判 DOM update 超时并中止过渡。
                return new Promise<void>((resolve) => {
                    setTimeout(() => setTimeout(resolve, 0), 0);
                });
            });
            void Promise.resolve(transition?.finished)
                .catch(() => undefined)
                .then(() => document.documentElement.removeAttribute('data-fp-transition'));
        } catch {
            document.documentElement.removeAttribute('data-fp-transition');
            apply();
        }
    };

    const openMode = () => {
        if (open()) return;
        lastFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        // 页内切换会把上面一大段运动内容藏起来，先记下滚动位置，退出时再还回去
        lastScroll = window.scrollY;
        window.scrollTo({ top: 0, behavior: 'auto' });
        runWithViewTransition(() => {
            // 布局类在这里同步加，effect 里那次是幂等的兜底：过渡回调必须当场看到新布局
            document.body.classList.add('is-footprint');
            setOpen(true);
        });
    };

    /** 退出足迹：筛选状态只在本次足迹会话里保留，退出即重置 */
    const closeMode = () => {
        setFilterOpen(false);
        setSelected(new Set<string>());
        setExpanded(defaultExpanded());
        controller?.clearActive();
        runWithViewTransition(() => {
            document.body.classList.remove('is-footprint');
            setOpen(false);
        });
    };

    createEffect(() => {
        if (!open()) return;
        wasOpen = true;
        document.body.classList.add('is-footprint');
        if (window.location.hash !== '#footprint') history.replaceState(history.state, '', '#footprint');
        // 把焦点交给整层而不是按钮：避免刚打开就出现一圈「返回运动」的焦点环
        requestAnimationFrame(() => {
            overlay?.focus({ preventScroll: true });
        });
    });

    // 地图容器拿到 ref、模式也打开之后再创建实例（此时 flex 高度已经就位）
    createEffect(() => {
        if (!open() || !mapHostReady()) return;
        ensureMap();
        requestAnimationFrame(() => {
            controller?.resize();
            controller?.fitAll();
        });
    });

    // 卡片里的图片复用站内的 medium-zoom 灯箱：列表随筛选重渲染，每次渲染后补挂一次
    createEffect(() => {
        if (!open()) return;
        filteredArticles();
        requestAnimationFrame(() => initZoom());
    });

    // 窄屏：页面往下滚过一小段就把悬浮地图缩高，过渡结束后调一次 map.resize()，不每帧调
    createEffect(() => {
        if (!open() || !narrow()) {
            setMapCompact(false);
            return;
        }
        let frame: number | null = null;
        let resizeTimer: number | null = null;
        let compact = window.scrollY > 64;
        setMapCompact(compact);
        const onScroll = () => {
            if (frame !== null) return;
            frame = requestAnimationFrame(() => {
                frame = null;
                const next = window.scrollY > 64;
                if (next === compact) return;
                compact = next;
                setMapCompact(next);
                if (resizeTimer !== null) clearTimeout(resizeTimer);
                // 过渡结束后再 resize：时长从 CSS 读，别在这里手写一份和样式对不上的数字
                const wrap = overlay?.querySelector<HTMLElement>('.ex-fp-map-wrap');
                const duration = Number.parseFloat(wrap ? getComputedStyle(wrap).transitionDuration : '') || 0;
                resizeTimer = window.setTimeout(() => controller?.resize(), Math.round(duration * 1000) + 20);
            });
        };
        window.addEventListener('scroll', onScroll, { passive: true });
        onCleanup(() => {
            window.removeEventListener('scroll', onScroll);
            if (frame !== null) cancelAnimationFrame(frame);
            if (resizeTimer !== null) clearTimeout(resizeTimer);
        });
    });

    // 选中集合变了就同步给地图：未选中的标点压暗，不从地图移走
    createEffect(() => {
        const names = selected();
        if (!open()) return;
        controller?.setFilter(names);
    });

    // 窄屏筛选是模态：锁 body 滚动，把焦点送进去
    createEffect(() => {
        if (!filterOpen() || !narrow()) return;
        document.body.classList.add('is-fp-modal');
        requestAnimationFrame(() => filterModal?.focus({ preventScroll: true }));
        onCleanup(() => document.body.classList.remove('is-fp-modal'));
    });

    // 桌面 popover：打开时把焦点放进面板，Esc 关闭后还回按钮
    createEffect(() => {
        if (!filterOpen() || narrow()) return;
        requestAnimationFrame(() => filterPanel?.focus({ preventScroll: true }));
    });

    createEffect(() => {
        if (open() || !wasOpen) return;
        document.body.classList.remove('is-footprint');
        if (window.location.hash === '#footprint') {
            history.replaceState(history.state, '', `${window.location.pathname}${window.location.search}`);
        }
        requestAnimationFrame(() => {
            window.scrollTo({ top: lastScroll, behavior: 'auto' });
            lastFocus?.focus({ preventScroll: true });
        });
    });

    onMount(() => {
        const onOpenEvent = () => openMode();
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key !== 'Escape' || !open()) return;
            // 顺序：筛选面板 → 激活的卡片/3D → 退足迹；每一步都只吃掉自己那一层
            if (filterOpen()) {
                event.preventDefault();
                event.stopPropagation();
                closeFilter();
                return;
            }
            // 用 HUD 单独开的 3D 也算一层：没有激活卡片时不跳过它，先收回平面再退足迹
            if (activePlace() || pitchMode() === 'tilt') {
                event.preventDefault();
                event.stopPropagation();
                controller?.clearActive();
                return;
            }
            event.preventDefault();
            closeMode();
        };
        // 直接改 hash（比如从别的页面点 /exercise/#footprint，或后退）也要能进/出足迹；
        // openMode 自带 `if (open()) return`，重复触发（事件 + hashchange）是幂等的
        const onHashChange = () => {
            if (window.location.hash === '#footprint') openMode();
            else if (open()) closeMode();
        };
        // 桌面 popover 点外面收起（窄屏是模态，不走这条）
        const onPointerDown = (event: PointerEvent) => {
            if (!filterOpen() || narrow()) return;
            const target = event.target as Node | null;
            if (filterRoot && target && filterRoot.contains(target)) return;
            closeFilter();
        };

        const media = window.matchMedia(NARROW_QUERY);
        setNarrow(media.matches);
        const onMediaChange = () => {
            // 跨断点时面板形态会从 popover 换成全屏模态：先收起，别突然弹模态抢焦点
            if (filterOpen()) closeFilter();
            setNarrow(media.matches);
        };

        document.addEventListener(FOOTPRINT_OPEN_EVENT, onOpenEvent);
        document.addEventListener('keydown', onKeyDown);
        document.addEventListener('pointerdown', onPointerDown);
        window.addEventListener('hashchange', onHashChange);
        media.addEventListener('change', onMediaChange);

        // 早点击兜底：入口是 <a href="/exercise/#footprint">，事件监听还没挂上时
        // 浏览器已经把 hash 写进地址栏，这里挂载时补一次
        if (window.location.hash === '#footprint') openMode();

        onCleanup(() => {
            document.removeEventListener(FOOTPRINT_OPEN_EVENT, onOpenEvent);
            document.removeEventListener('keydown', onKeyDown);
            document.removeEventListener('pointerdown', onPointerDown);
            window.removeEventListener('hashchange', onHashChange);
            media.removeEventListener('change', onMediaChange);
            document.body.classList.remove('is-footprint', 'is-fp-modal');
            document.documentElement.removeAttribute('data-fp-transition');
            controller?.destroy();
            controller = undefined;
        });
    });

    /** 两级筛选树：桌面 popover 和手机模态共用同一份状态与结构 */
    const FilterTree = () => (
        <div class="ex-fp-tree">
            <For each={groups}>
                {(group) => {
                    let checkbox: HTMLInputElement | undefined;
                    createEffect(() => {
                        if (checkbox) checkbox.indeterminate = provinceMixed(group);
                    });
                    const isOpen = () => expanded().has(group.province);
                    return (
                        <div class="ex-fp-province" classList={{ 'is-open': isOpen() }}>
                            <div class="ex-fp-province-row">
                                <label class="ex-fp-check ex-fp-check-province">
                                    <input
                                        type="checkbox"
                                        ref={(element) => {
                                            checkbox = element;
                                        }}
                                        checked={provinceChecked(group)}
                                        onChange={() => toggleProvince(group)}
                                        aria-label={`${group.province}，${group.points} 个标点`}
                                    />
                                    <span class="ex-fp-check-text">{group.province}</span>
                                    <span class="ex-fp-check-count">{group.points}</span>
                                </label>
                                <button
                                    class="ex-fp-province-toggle"
                                    type="button"
                                    aria-expanded={isOpen()}
                                    aria-label={`${isOpen() ? '收起' : '展开'}${group.province}`}
                                    onClick={() => toggleExpand(group.province)}
                                >
                                    <svg
                                        viewBox="0 0 24 24"
                                        aria-hidden="true"
                                        fill="none"
                                        stroke="currentColor"
                                        stroke-width="2"
                                        stroke-linecap="round"
                                        stroke-linejoin="round"
                                    >
                                        <path d="m6 9 6 6 6-6" />
                                    </svg>
                                </button>
                            </div>
                            <Show when={isOpen()}>
                                <div class="ex-fp-place-list">
                                    <For each={group.places}>
                                        {(place) => (
                                            <label class="ex-fp-check ex-fp-check-place" classList={{ 'is-active': selected().has(place.name) }}>
                                                <input
                                                    type="checkbox"
                                                    checked={selected().has(place.name)}
                                                    onChange={() => togglePlace(place.name)}
                                                    aria-label={`${place.name}${place.articles > 0 ? `，${place.articles} 篇游记` : '，还没有游记'}`}
                                                />
                                                <span class="ex-fp-check-text">{place.name}</span>
                                                <Show when={place.articles > 0}>
                                                    <span class="ex-fp-check-badge">{place.articles} 篇</span>
                                                </Show>
                                            </label>
                                        )}
                                    </For>
                                </div>
                            </Show>
                        </div>
                    );
                }}
            </For>
        </div>
    );

    const FilterSummary = () => (
        <p class="ex-fp-filter-meta">
            已选 {selectedProvinces().length} 省 · {selected().size} 个地方
        </p>
    );

    const FilterActions = () => (
        <div class="ex-fp-filter-actions">
            <button class="ex-fp-filter-action" type="button" onClick={selectAll}>
                全选
            </button>
            <button class="ex-fp-filter-action" type="button" disabled={selected().size === 0} onClick={clearAll}>
                清空
            </button>
        </div>
    );

    return (
        <section
            class="ex-fp"
            classList={{ 'is-map-error': mapError(), 'is-map-compact': mapCompact() }}
            hidden={!open()}
            ref={overlay}
            aria-label="足迹"
            tabindex={-1}
        >
            <header class="ex-fp-head">
                <div class="ex-fp-heading page-head">
                    <h1 class="book-title page-title">走过的地方</h1>
                    <p class="page-intro">{subtitle()}</p>
                </div>
                <div class="ex-fp-actions">
                    <Show when={selected().size > 0}>
                        <p class="ex-fp-selection">
                            <span class="ex-fp-selection-full">
                                已选 {selectedProvinces().length} 省 · {selected().size} 个地方 · {filteredArticles().length} 篇游记
                            </span>
                            <span class="ex-fp-selection-short">已选 {selected().size}</span>
                        </p>
                    </Show>
                    <button class="ex-fp-btn ex-fp-close" type="button" aria-label="返回运动记录" onClick={closeMode}>
                        <svg
                            viewBox="0 0 24 24"
                            aria-hidden="true"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="2"
                            stroke-linecap="round"
                            stroke-linejoin="round"
                        >
                            <path d="M15 5 8 12l7 7" />
                        </svg>
                        <span class="ex-fp-close-label">返回运动</span>
                    </button>
                </div>
            </header>

            <div class="ex-fp-stage">
                <div class="ex-fp-map-wrap">
                    <div
                        class="ex-fp-map"
                        ref={(element) => {
                            mapHost = element;
                            setMapHostReady(true);
                        }}
                    />
                    <div class="ex-fp-hud">
                        <button
                            class="ex-fp-hud-btn"
                            type="button"
                            aria-pressed={pitchMode() === 'tilt'}
                            title="切换 3D / 平面视角"
                            onClick={() => controller?.togglePitch()}
                        >
                            3D
                        </button>
                        <button
                            class="ex-fp-hud-btn"
                            type="button"
                            onClick={() => {
                                controller?.clearActive();
                                controller?.fitAll();
                            }}
                        >
                            全部
                        </button>
                        <button class="ex-fp-hud-btn" type="button" onClick={() => controller?.random()}>
                            随便走走
                        </button>
                    </div>

                    <div class="ex-fp-filter" ref={filterRoot}>
                        <button class="ex-fp-filter-btn" type="button" aria-expanded={filterOpen()} aria-controls="ex-fp-filter-panel" onClick={toggleFilter}>
                            <svg
                                viewBox="0 0 24 24"
                                aria-hidden="true"
                                fill="none"
                                stroke="currentColor"
                                stroke-width="1.9"
                                stroke-linecap="round"
                                stroke-linejoin="round"
                            >
                                <path d="M4 6h16M7 12h10M10 18h4" />
                            </svg>
                            <span>筛选</span>
                            <Show when={selectedProvinces().length > 0}>
                                <span class="ex-fp-filter-badge">{selectedProvinces().length}</span>
                            </Show>
                        </button>

                        <Show when={filterOpen() && !narrow()}>
                            <div class="ex-fp-filter-panel" id="ex-fp-filter-panel" role="dialog" aria-label="按省份筛选" tabindex={-1} ref={filterPanel}>
                                <div class="ex-fp-filter-head">
                                    <p class="ex-fp-filter-title">按省份筛选</p>
                                    <FilterSummary />
                                </div>
                                <FilterActions />
                                <FilterTree />
                            </div>
                        </Show>
                    </div>

                    <p class="ex-fp-map-state" role="status" hidden={!mapError()}>
                        地图暂时没有加载出来，时间线仍然可以浏览。
                    </p>
                </div>

                <aside class="ex-fp-panel" ref={panel} aria-label="足迹时间线">
                    <Show
                        when={filteredArticles().length > 0}
                        fallback={
                            <div class="ex-fp-empty" role="status">
                                <p class="ex-fp-empty-title">{selected().size > 0 ? '这个筛选下还没有游记' : '还没有带地点标签的游记'}</p>
                                <p class="ex-fp-empty-text">
                                    {selected().size > 0 ? '换几个省份，或者清空筛选看全部游记。' : '给游记打上 #地点-地名 标签，就会出现在这里。'}
                                </p>
                                <Show when={selected().size > 0}>
                                    <button class="ex-fp-empty-btn" type="button" onClick={clearAll}>
                                        清空筛选
                                    </button>
                                </Show>
                            </div>
                        }
                    >
                        <div class="ex-fp-rows">
                            <For each={filteredArticles()}>
                                {(article, index) => {
                                    const repeat = () => repeatFlags()[index()] ?? false;
                                    const changedYear = () => filteredArticles()[index() - 1]?.year !== article.year;
                                    return (
                                        // 卡片本体也参与激活：第一次点聚焦地点、第二次跳文章。
                                        // 标题链接和地点 chip 各自 stopPropagation，点它们只走自己的逻辑
                                        <article
                                            class="ledger-row"
                                            classList={{
                                                'is-repeat': repeat(),
                                                'is-active': activeCardSlug() === article.slug
                                            }}
                                            data-kind="post"
                                            data-slug={article.slug}
                                            role="button"
                                            tabindex="0"
                                            aria-label={`${article.title}：首次点击在地图上定位，再次点击打开文章`}
                                            onClick={(event) => activateCard(event, article)}
                                            onKeyDown={(event) => {
                                                // 焦点在内部的链接/按钮上时由它们自己处理 Enter/Space
                                                if (event.target !== event.currentTarget) return;
                                                if (event.key !== 'Enter' && event.key !== ' ') return;
                                                event.preventDefault();
                                                activateCard(event as unknown as MouseEvent, article);
                                            }}
                                            onMouseEnter={() => controller?.highlight(article.placeIds)}
                                            onMouseLeave={() => controller?.clearHighlight()}
                                            onFocusIn={() => controller?.highlight(article.placeIds)}
                                            onFocusOut={() => controller?.clearHighlight()}
                                        >
                                            <div class="ledger-date">
                                                <Show when={changedYear()}>
                                                    <span class="ledger-year">{article.year}</span>
                                                </Show>
                                                <time class="ledger-date-value" datetime={article.date}>
                                                    {monthDay(article)}
                                                </time>
                                                <span class="ledger-weekday">{weekdayOf(article)}</span>
                                            </div>
                                            <div class="ledger-rail" aria-hidden="true">
                                                <span class="rail-marker">
                                                    {/* 首页时间线里文章节点的图标（@lucide/astro BookOpenText），Solid 侧只能内联同一路径 */}
                                                    <svg
                                                        viewBox="0 0 24 24"
                                                        fill="none"
                                                        stroke="currentColor"
                                                        stroke-width="2"
                                                        stroke-linecap="round"
                                                        stroke-linejoin="round"
                                                    >
                                                        <path d="M12 5v16" />
                                                        <path d="M16 13h2" />
                                                        <path d="M16 9h2" />
                                                        <path d="M20.001 19A2 2 0 0 0 22 17V5a2 2 0 0 0-1.999-2L16 3.002A5 5 0 0 0 12 5a5 5 0 0 0-4-2H4a2 2 0 0 0-2 2v12a2 2 0 0 0 1.999 2H8a5 5 0 0 1 4 2 5 5 0 0 1 4-2z" />
                                                        <path d="M6 13h2" />
                                                        <path d="M6 9h2" />
                                                    </svg>
                                                </span>
                                            </div>
                                            <div class="ledger-body ex-fp-body">
                                                <h3 class="ex-fp-row-title">
                                                    {/* stopPropagation 后仍能被 ClientRouter 拦走（它在 document 捕获阶段接管），
                                                        两段式卡片也是靠点这个真链接做站内跳转；改成 stopImmediatePropagation 会静默退化成整页刷新 */}
                                                    <a href={article.url} onClick={(event) => event.stopPropagation()}>
                                                        {article.title}
                                                    </a>
                                                </h3>
                                                {article.excerpt ? <p class="ex-fp-row-text">{article.excerpt}</p> : null}
                                                <Show when={article.images.length > 0}>
                                                    <div class="ex-fp-row-media" classList={{ 'is-single': article.images.length === 1 }}>
                                                        <For each={article.images}>
                                                            {(src) => <img src={src} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" />}
                                                        </For>
                                                    </div>
                                                </Show>
                                                <Show when={article.placeIds.length > 0}>
                                                    <div class="ex-fp-row-places">
                                                        <For each={article.placeIds}>
                                                            {(placeId, placeIndex) => (
                                                                <button
                                                                    class="ex-fp-chip"
                                                                    type="button"
                                                                    classList={{ 'is-active': activePlace() === placeId }}
                                                                    onClick={(event) => {
                                                                        event.stopPropagation();
                                                                        controller?.focusPlace(placeId);
                                                                    }}
                                                                >
                                                                    {article.placeNames[placeIndex()]}
                                                                </button>
                                                            )}
                                                        </For>
                                                        {/* 一个标签命中就算匹配：没落地的标签只是补充信息，纯文本不可点 */}
                                                        <For each={article.unmatchedTags}>{(tag) => <span class="ex-fp-tag">{tag}</span>}</For>
                                                    </div>
                                                </Show>
                                                {/* 只有整篇一个标点都没命中，才是真的没匹配上 */}
                                                <Show when={article.placeIds.length === 0 && article.tags.length > 0}>
                                                    <p class="ex-fp-row-note">这篇的标签没有对应的地图标点：{article.tags.join('、')}</p>
                                                </Show>
                                            </div>
                                        </article>
                                    );
                                }}
                            </For>
                        </div>
                    </Show>

                </aside>
            </div>

            <Show when={filterOpen() && narrow()}>
                <Portal>
                    <div
                        class="ex-fp-modal"
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="ex-fp-modal-title"
                        tabindex={-1}
                        ref={filterModal}
                        onKeyDown={trapTab}
                    >
                        <header class="ex-fp-modal-head">
                            <p class="ex-fp-modal-title" id="ex-fp-modal-title">
                                按省份筛选
                            </p>
                            <button class="ex-fp-modal-close" type="button" aria-label="关闭筛选" onClick={closeFilter}>
                                <svg
                                    viewBox="0 0 24 24"
                                    aria-hidden="true"
                                    fill="none"
                                    stroke="currentColor"
                                    stroke-width="2"
                                    stroke-linecap="round"
                                    stroke-linejoin="round"
                                >
                                    <path d="M18 6 6 18M6 6l12 12" />
                                </svg>
                            </button>
                        </header>
                        <FilterSummary />
                        <FilterActions />
                        <div class="ex-fp-modal-body">
                            <FilterTree />
                        </div>
                        <footer class="ex-fp-modal-foot">
                            <button class="ex-fp-filter-done" type="button" onClick={closeFilter}>
                                完成
                            </button>
                        </footer>
                    </div>
                </Portal>
            </Show>
        </section>
    );
}
