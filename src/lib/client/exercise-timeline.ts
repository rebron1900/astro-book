/**
 * 运动页中间时间线的交互：选中某条记录 / 某个月份后派发 `exercise:select`，
 * 并和地图、统计面板双向同步（外部选中时高亮 + 滚动到对应位置）。
 *
 * DOM 结构沿用首页时间线的 ledger（月份一条 ledger-row，卡片区是 strava-cards 网格），
 * 这里只负责加状态类与事件，不往卡片里插按钮。
 */
import type { ExerciseHoverDetail, ExerciseScope, ExerciseSelectDetail } from '../exercise';
import { EXERCISE_HOVER_EVENT, EXERCISE_SELECT_EVENT, addDays, scopeKey, weekStartOf } from '../exercise';

interface TimelineController {
    applyScope: (scope: ExerciseScope) => void;
    applySportFilter: (sport: string) => void;
    card: (id: string) => HTMLElement | undefined;
    cardByDate: (date: string) => HTMLElement | undefined;
    cardInRange: (start: string, end: string) => HTMLElement | undefined;
    monthRow: (key: string) => HTMLElement | undefined;
}

let controller: TimelineController | null = null;
let externalBound = false;
/** 月份行的入场观察器：和首页时间线共用同一套 reveal-ready / is-visible 规则 */
let revealObserver: IntersectionObserver | null = null;
let revealDisabled = false;

function ensureRevealObserver(): IntersectionObserver | null {
    if (revealDisabled) return null;
    if (revealObserver) return revealObserver;
    if (typeof IntersectionObserver === 'undefined' || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        revealDisabled = true;
        return null;
    }
    revealObserver = new IntersectionObserver(
        (entries) => {
            entries.forEach((entry) => {
                if (!entry.isIntersecting) return;
                entry.target.classList.add('is-visible');
                revealObserver?.unobserve(entry.target);
            });
        },
        { rootMargin: '0px 0px -5% 0px', threshold: 0.05 }
    );
    return revealObserver;
}

function monthKeyOfScope(scope: ExerciseScope, cardMonth: Map<string, string>): string {
    if (scope.kind === 'month') return `${scope.year}-${String(scope.month).padStart(2, '0')}`;
    if (scope.kind === 'record') return cardMonth.get(scope.id) ?? '';
    return '';
}

function handleExternalSelect(event: Event) {
    const detail = (event as CustomEvent<ExerciseSelectDetail>).detail;
    if (!detail?.scope || detail.source === 'timeline' || !controller) return;
    const scope = detail.scope;
    controller.applyScope(scope);

    if (scope.kind === 'record') {
        controller.card(scope.id)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
    }
    if (scope.kind === 'month') {
        controller.monthRow(`${scope.year}-${String(scope.month).padStart(2, '0')}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
    }
    if (scope.kind === 'day') {
        controller.cardByDate(scope.date)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
    }
    if (scope.kind === 'week') {
        controller.cardInRange(scope.date, addDays(weekStartOf(scope.date), 6))?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
    }
    if (scope.kind === 'year') {
        controller.monthRow(`${scope.year}-12`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
}

function mountExerciseTimeline() {
    const root = document.querySelector<HTMLElement>('[data-exercise-timeline]');
    if (!root || root.dataset.bound === 'true') return;
    root.dataset.bound = 'true';

    const months = Array.from(root.querySelectorAll<HTMLElement>('.ex-month-row'));
    const cards = Array.from(root.querySelectorAll<HTMLElement>('.strava-card[data-exercise-id]'));

    // 和首页时间线一样：进入视口的月份行才播放淡入上浮，不再所有卡片在首屏一起动
    const observer = ensureRevealObserver();
    months.forEach((row) => {
        if (row.dataset.revealReady) return;
        row.dataset.revealReady = 'true';
        if (!observer) {
            row.classList.add('is-visible');
            return;
        }
        row.classList.add('reveal-ready');
        observer.observe(row);
    });

    // 运动类型筛选器跟着地图一起吸顶，而且位于 Solid 岛内，随时可能被重新挂载：
    // 用 document 级事件委托，避免绑定到旧按钮节点上导致「有时候点了没反应」。
    const applySportFilter = (sport: string) => {
        document.querySelectorAll<HTMLElement>('[data-exercise-filter] .filter-chip').forEach((chip) => {
            chip.classList.toggle('is-active', (chip.dataset.sport ?? 'all') === sport);
        });
        cards.forEach((card) => {
            const match = sport === 'all' || card.dataset.sport === sport;
            if (match) card.removeAttribute('hidden');
            else card.setAttribute('hidden', '');
        });
        months.forEach((row) => {
            const visible = Array.from(row.querySelectorAll<HTMLElement>('.strava-card')).some((card) => !card.hasAttribute('hidden'));
            if (visible) row.removeAttribute('hidden');
            else row.setAttribute('hidden', '');
        });
    };
    const cardMonth = new Map<string, string>();
    cards.forEach((card) => {
        const id = card.dataset.exerciseId;
        const section = card.closest<HTMLElement>('.ex-month-row');
        if (id && section?.dataset.monthKey) cardMonth.set(id, section.dataset.monthKey);
    });

    let currentScope: ExerciseScope = { kind: 'all' };
    try {
        currentScope = JSON.parse(root.dataset.initialScope || '{"kind":"all"}') as ExerciseScope;
    } catch {
        currentScope = { kind: 'all' };
    }

    const applyScope = (next: ExerciseScope) => {
        currentScope = next;
        root.dataset.scope = scopeKey(next);
        // 日/周范围没有「哪一个月」，用起始日期补出所属月份，方便定位
        const scopeDate = next.kind === 'day' || next.kind === 'week' ? next.date : '';
        const activeMonth = monthKeyOfScope(next, cardMonth) || (scopeDate ? scopeDate.slice(0, 7) : '');
        const activeRecordId = next.kind === 'record' ? next.id : '';
        const activeDate = next.kind === 'day' ? next.date : '';
        const weekRange = next.kind === 'week' ? [weekStartOf(next.date), addDays(weekStartOf(next.date), 6)] : null;

        months.forEach((row) => {
            row.classList.toggle('is-active', (row.dataset.monthKey ?? '') === activeMonth);
        });

        cards.forEach((card) => {
            const date = card.dataset.date ?? '';
            const active =
                (Boolean(activeRecordId) && card.dataset.exerciseId === activeRecordId) ||
                (Boolean(activeDate) && date === activeDate) ||
                (weekRange !== null && date >= weekRange[0] && date <= weekRange[1]);
            card.classList.toggle('is-active', active);
        });
    };

    const dispatch = (scope: ExerciseScope, source: ExerciseSelectDetail['source']) => {
        document.dispatchEvent(new CustomEvent<ExerciseSelectDetail>(EXERCISE_SELECT_EVENT, { detail: { scope, source } }));
    };

    const selectMonth = (key: string) => {
        const [year, month] = key.split('-').map(Number);
        const next: ExerciseScope = { kind: 'month', year, month };
        applyScope(next);
        dispatch(next, 'timeline');
    };

    const selectRecord = (id: string) => {
        const next: ExerciseScope = { kind: 'record', id };
        applyScope(next);
        dispatch(next, 'timeline');
    };

    const onRootClick = (event: MouseEvent) => {
        const target = event.target as HTMLElement | null;
        if (!target) return;
        // 卡片标题 / ↗ 是外链，保持首页行为：直接打开 Strava
        if (target.closest('a')) return;

        const card = target.closest<HTMLElement>('.strava-card[data-exercise-id]');
        const id = card?.dataset.exerciseId;
        if (id) {
            event.preventDefault();
            selectRecord(id);
            return;
        }

        const row = target.closest<HTMLElement>('.ex-month-row');
        const key = row?.dataset.monthKey;
        if (key) selectMonth(key);
    };

    const onPointerOver = (event: MouseEvent) => {
        const target = event.target as HTMLElement | null;
        const card = target?.closest<HTMLElement>('.strava-card[data-exercise-id]');
        const id = card?.dataset.exerciseId;
        if (id) {
            document.dispatchEvent(new CustomEvent<ExerciseHoverDetail>(EXERCISE_HOVER_EVENT, { detail: { id } }));
        }
    };

    const onPointerOut = (event: MouseEvent) => {
        const target = event.target as HTMLElement | null;
        const card = target?.closest<HTMLElement>('.strava-card[data-exercise-id]');
        if (!card) return;
        const related = (event as MouseEvent & { relatedTarget?: Node | null }).relatedTarget as Node | null;
        if (related && card.contains(related)) return;
        document.dispatchEvent(new CustomEvent<ExerciseHoverDetail>(EXERCISE_HOVER_EVENT, { detail: { id: null } }));
    };

    const onFocusIn = (event: FocusEvent) => {
        const target = event.target as HTMLElement | null;
        const card = target?.closest<HTMLElement>('.strava-card[data-exercise-id]');
        const id = card?.dataset.exerciseId;
        if (id) {
            document.dispatchEvent(new CustomEvent<ExerciseHoverDetail>(EXERCISE_HOVER_EVENT, { detail: { id } }));
        }
    };

    root.addEventListener('click', onRootClick);
    root.addEventListener('mouseover', onPointerOver);
    root.addEventListener('mouseout', onPointerOut);
    root.addEventListener('focusin', onFocusIn);

    controller = {
        applyScope,
        applySportFilter,
        card: (id) => cards.find((item) => item.dataset.exerciseId === id),
        cardByDate: (date) => cards.find((item) => item.dataset.date === date),
        cardInRange: (start, end) => cards.find((item) => (item.dataset.date ?? '') >= start && (item.dataset.date ?? '') <= end),
        monthRow: (key) => months.find((item) => item.dataset.monthKey === key)
    };

    if (!externalBound) {
        externalBound = true;
        document.addEventListener(EXERCISE_SELECT_EVENT, handleExternalSelect);
        document.addEventListener('click', (event) => {
            const target = event.target as HTMLElement | null;
            const chip = target?.closest<HTMLElement>('[data-exercise-filter] .filter-chip');
            if (!chip || !controller) return;
            controller.applySportFilter(chip.dataset.sport ?? 'all');
        });
        document.addEventListener('astro:before-swap', () => {
            controller = null;
            revealObserver?.disconnect();
            revealObserver = null;
            revealDisabled = false;
        });
    }

    applyScope(currentScope);
    applySportFilter('all');
}

/** 页面加载 / Astro 路由切换后初始化（重复调用无副作用） */
export function initExerciseTimeline() {
    mountExerciseTimeline();
}

if (typeof document !== 'undefined') {
    document.addEventListener('astro:page-load', initExerciseTimeline);
    if (document.readyState !== 'loading') initExerciseTimeline();
}
