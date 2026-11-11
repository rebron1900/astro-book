import { createSignal, onCleanup, onMount } from 'solid-js';
import type { ExerciseHoverDetail, ExerciseRecord, ExerciseScope, ExerciseSelectDetail, SportKey } from '../../lib/exercise';
import { EXERCISE_HOVER_EVENT, EXERCISE_SELECT_EVENT, SPORT_META, SPORT_ORDER } from '../../lib/exercise';
import ExerciseMap from './ExerciseMap';

/**
 * 中间内容区顶部的预览地图：
 * - 地图本体用 ExerciseMap（Mapbox）；
 * - 往下滚动时自动吸顶，并通过 `.is-stuck` 平滑切换到「悬浮条」形态；
 * - 与时间线、右侧统计通过 document 事件同步选中范围。
 */
export interface ExerciseMapPanelProps {
    records: ExerciseRecord[];
    initialScope: ExerciseScope;
    token: string;
    routesUrl: string;
    /** 合并页用：只在指定模式下创建地图（不传 = 一直激活） */
    activeMode?: 'exercise' | 'footprint';
}

export default function ExerciseMapPanel(props: ExerciseMapPanelProps) {
    const [scope, setScope] = createSignal<ExerciseScope>(props.initialScope);
    const [hoverId, setHoverId] = createSignal<string | null>(null);
    const [stuck, setStuck] = createSignal(false);

    let sentinel: HTMLDivElement | undefined;
    let hero: HTMLDivElement | undefined;

    // 运动类型筛选跟着地图一起吸顶：计数直接取自页面记录，不需要再单独传 props
    const counts = new Map<SportKey, number>();
    for (const record of props.records) counts.set(record.sport, (counts.get(record.sport) ?? 0) + 1);
    const filters = [
        { key: 'all' as const, label: '全部', count: props.records.length },
        ...SPORT_ORDER.filter((key) => (counts.get(key) ?? 0) > 0).map((key) => ({ key, label: SPORT_META[key].label, count: counts.get(key) ?? 0 }))
    ];

    const select = (next: ExerciseScope) => {
        setScope(next);
        document.dispatchEvent(new CustomEvent<ExerciseSelectDetail>(EXERCISE_SELECT_EVENT, { detail: { scope: next, source: 'map' } }));
    };

    onMount(() => {
        const handleSelect = (event: Event) => {
            const detail = (event as CustomEvent<ExerciseSelectDetail>).detail;
            if (!detail?.scope || detail.source === 'map') return;
            setScope(detail.scope);
        };
        const handleHover = (event: Event) => {
            const detail = (event as CustomEvent<ExerciseHoverDetail>).detail;
            setHoverId(detail?.id ?? null);
        };
        document.addEventListener(EXERCISE_SELECT_EVENT, handleSelect);
        document.addEventListener(EXERCISE_HOVER_EVENT, handleHover);

        // 窗口尺寸变化（含手机横竖屏）会跨断点改变地图可视高度：
        // 这时直接切到新尺寸，不要播放「裁切 + 位移」过渡，否则地图会短暂露底。
        let resizeTimer: ReturnType<typeof setTimeout> | null = null;
        const handleViewportResize = () => {
            if (!hero) return;
            hero.classList.add('is-resizing');
            if (resizeTimer) clearTimeout(resizeTimer);
            resizeTimer = setTimeout(() => {
                resizeTimer = null;
                hero?.classList.remove('is-resizing');
            }, 160);
        };
        window.addEventListener('resize', handleViewportResize);

        // 用哨兵元素判断「是否已经吸顶」：滚过哨兵后给 hero 加 .is-stuck
        let observer: IntersectionObserver | null = null;
        if (sentinel && typeof IntersectionObserver !== 'undefined') {
            observer = new IntersectionObserver(
                (entries) => {
                    const entry = entries[0];
                    if (!entry) return;
                    setStuck(!entry.isIntersecting);
                },
                { threshold: 0 }
            );
            observer.observe(sentinel);
        }

        onCleanup(() => {
            document.removeEventListener(EXERCISE_SELECT_EVENT, handleSelect);
            document.removeEventListener(EXERCISE_HOVER_EVENT, handleHover);
            window.removeEventListener('resize', handleViewportResize);
            if (resizeTimer) clearTimeout(resizeTimer);
            observer?.disconnect();
        });
    });

    return (
        <>
            <div class="ex-map-sentinel" ref={sentinel} aria-hidden="true"></div>
            <div class="ex-map-hero" classList={{ 'is-stuck': stuck() }} data-ex-map-panel data-scope-kind={scope().kind} ref={hero}>
                <ExerciseMap
                    records={props.records}
                    token={props.token}
                    routesUrl={props.routesUrl}
                    scope={scope()}
                    hoverId={hoverId()}
                    compact={stuck()}
                    onSelectRoute={(id) => select({ kind: 'record', id })}
                    onReset={() => select({ kind: 'all' })}
                    activeMode={props.activeMode}
                />
                <div class="ex-map-filter" data-exercise-filter>
                    <div class="filter-chips" role="group" aria-label="运动类型筛选">
                        {filters.map((item) => (
                            <button type="button" class="filter-chip" classList={{ 'is-active': item.key === 'all' }} data-sport={item.key}>
                                {item.label}
                                <span>{item.count}</span>
                            </button>
                        ))}
                    </div>
                </div>
            </div>
        </>
    );
}
