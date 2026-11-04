import { createSignal, onCleanup, onMount } from 'solid-js';
import type { ExerciseHoverDetail, ExerciseRecord, ExerciseScope, ExerciseSelectDetail } from '../../lib/exercise';
import { EXERCISE_HOVER_EVENT, EXERCISE_SELECT_EVENT } from '../../lib/exercise';
import ExerciseStats from './ExerciseStats';

/**
 * 运动页面右侧栏：日历 + 全部运动总览。
 * 地图在中间内容区（ExerciseMapPanel），这里只负责统计与范围同步。
 */
export interface ExerciseSidebarProps {
    /** 页面内嵌的精简运动数据 */
    records: ExerciseRecord[];
    initialScope: ExerciseScope;
}

export default function ExerciseSidebar(props: ExerciseSidebarProps) {
    const [scope, setScope] = createSignal<ExerciseScope>(props.initialScope);
    const [hoverId, setHoverId] = createSignal<string | null>(null);

    const select = (next: ExerciseScope) => {
        setScope(next);
        document.dispatchEvent(new CustomEvent<ExerciseSelectDetail>(EXERCISE_SELECT_EVENT, { detail: { scope: next, source: 'stats' } }));
    };

    onMount(() => {
        const handleSelect = (event: Event) => {
            const detail = (event as CustomEvent<ExerciseSelectDetail>).detail;
            if (!detail?.scope || detail.source === 'stats') return;
            setScope(detail.scope);
        };
        const handleHover = (event: Event) => {
            const detail = (event as CustomEvent<ExerciseHoverDetail>).detail;
            setHoverId(detail?.id ?? null);
        };

        document.addEventListener(EXERCISE_SELECT_EVENT, handleSelect);
        document.addEventListener(EXERCISE_HOVER_EVENT, handleHover);
        onCleanup(() => {
            document.removeEventListener(EXERCISE_SELECT_EVENT, handleSelect);
            document.removeEventListener(EXERCISE_HOVER_EVENT, handleHover);
        });
    });

    return (
        <div class="ex-sidebar" data-exercise-sidebar data-ex-scope={scope().kind}>
            <ExerciseStats records={props.records} scope={scope()} onSelect={(next) => select(next)} onHover={setHoverId} />
        </div>
    );
}
