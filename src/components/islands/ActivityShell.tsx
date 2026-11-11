import { For, Show, createSignal, onCleanup, onMount } from 'solid-js';
import type { ExerciseRecord, ExerciseScope, ExerciseSelectDetail } from '../../lib/exercise';
import { EXERCISE_SELECT_EVENT } from '../../lib/exercise';
import type { FootprintData } from '../../lib/footprint';
import { createExerciseMap, type ExerciseMapController } from '../../lib/client/exercise-map';
import { createFootprintMap, type FootprintMapController } from '../../lib/client/footprint-map';
import { afterTransition } from '../../lib/client/idle';
import { ACTIVITY_PLACE_FILTER_EVENT, type ActivityPlaceFilterDetail } from '../../lib/client/activity';

/**
 * `/activity/` 的主体：一张地图 + 两种模式。
 *
 * - 地图容器只有一份，切换模式时先 destroy 旧控制器再创建新的，
 *   保证同一时刻只有一个 Mapbox 实例（两个实例同时活着会明显拖慢页面）。
 * - 模式写在 `.activity-page[data-activity-mode]` 上，时间线和右侧栏用 CSS 跟着切。
 * - 地图等页面过渡动画结束后再初始化（见 lib/client/idle）。
 */
export interface ActivityShellProps {
    records: ExerciseRecord[];
    initialScope: ExerciseScope;
    footprint: FootprintData;
    token: string;
    routesUrl: string;
}

type Mode = 'exercise' | 'footprint';

export default function ActivityShell(props: ActivityShellProps) {
    const [mode, setMode] = createSignal<Mode>('exercise');
    const [status, setStatus] = createSignal<string | null>(null);

    let viewport: HTMLDivElement | undefined;
    let canvas: HTMLDivElement | undefined;
    let exerciseMap: ExerciseMapController | null = null;
    let footprintMap: FootprintMapController | null = null;
    let cancelInit: (() => void) | null = null;
    /** 右栏「地点筛选」的当前选择，切回足迹模式时补一次 */
    let filterNames: ReadonlySet<string> = new Set<string>();

    /** 把当前模式写到页面上，时间线 / 侧栏靠它切换 */
    const publishMode = (next: Mode) => {
        const page = document.querySelector('.activity-page');
        if (page) page.setAttribute('data-activity-mode', next);
    };

    const teardown = () => {
        cancelInit?.();
        cancelInit = null;
        exerciseMap?.destroy();
        exerciseMap = null;
        footprintMap?.destroy();
        footprintMap = null;
    };

    const build = (next: Mode) => {
        teardown();
        if (!canvas) return;
        // 旧实例销毁后容器里可能还留着画布节点，先清干净再交给新实例
        canvas.replaceChildren();
        setStatus(null);

        if (next === 'exercise') {
            exerciseMap = createExerciseMap({
                container: canvas,
                viewport,
                token: props.token,
                routesUrl: props.routesUrl,
                records: props.records,
                onSelectRoute: (id) => {
                    document.dispatchEvent(new CustomEvent<ExerciseSelectDetail>(EXERCISE_SELECT_EVENT, { detail: { scope: { kind: 'record', id }, source: 'map' } }));
                },
                onStatus: (next) => setStatus(next.message)
            });
            exerciseMap.setScope(props.initialScope);
            void exerciseMap.start();
        } else {
            footprintMap = createFootprintMap({
                container: canvas,
                token: props.token,
                places: props.footprint.places,
                onError: () => setStatus('地图加载失败，可以稍后再试'),
                onReady: () => setStatus(null)
            });
            footprintMap.start();
            footprintMap.setFilter(filterNames);
        }
    };

    const switchMode = (next: Mode) => {
        if (next === mode()) return;
        setMode(next);
        publishMode(next);
        build(next);
    };

    onMount(() => {
        publishMode('exercise');
        cancelInit = afterTransition(() => {
            cancelInit = null;
            build('exercise');
        });

        // 时间线选中某条记录时，运动地图跟着取景
        // 右栏的地点筛选（另一个岛）通过 document 事件把选中的地名送过来
        const onPlaceFilter = (event: Event) => {
            const detail = (event as CustomEvent<ActivityPlaceFilterDetail>).detail;
            filterNames = new Set(detail?.names ?? []);
            footprintMap?.setFilter(filterNames);
        };
        document.addEventListener(ACTIVITY_PLACE_FILTER_EVENT, onPlaceFilter);

        const onSelect = (event: Event) => {
            const detail = (event as CustomEvent<ExerciseSelectDetail>).detail;
            if (!detail?.scope) return;
            exerciseMap?.setScope(detail.scope);
        };
        document.addEventListener(EXERCISE_SELECT_EVENT, onSelect);
        document.addEventListener('astro:before-swap', teardown);

        onCleanup(() => {
            document.removeEventListener(EXERCISE_SELECT_EVENT, onSelect);
            document.removeEventListener(ACTIVITY_PLACE_FILTER_EVENT, onPlaceFilter);
            document.removeEventListener('astro:before-swap', teardown);
            teardown();
        });
    });

    return (
        <section class="act" aria-label="运动与足迹">
            <div class="act-map" data-mode={mode()}>
                <div class="act-map-card">
                    <div class="act-map-viewport" ref={viewport}>
                        <div class="act-map-canvas" ref={canvas} />
                    </div>

                    <div class="act-switch" role="group" aria-label="切换运动 / 足迹">
                        <button class="act-switch-btn" type="button" aria-pressed={mode() === 'exercise'} onClick={() => switchMode('exercise')}>
                            运动
                        </button>
                        <button class="act-switch-btn" type="button" aria-pressed={mode() === 'footprint'} onClick={() => switchMode('footprint')}>
                            足迹
                        </button>
                    </div>

                    <Show when={status()}>
                        {(message) => (
                            <p class="act-map-status" role="status">
                                {message()}
                            </p>
                        )}
                    </Show>
                </div>
            </div>

            <Show when={mode() === 'footprint'}>
                <div class="act-rows" aria-label="足迹游记">
                    <For each={props.footprint.articles}>
                        {(article, index) => {
                            const previous = () => props.footprint.articles[index() - 1];
                            return (
                                <article class="ledger-row act-row">
                                    <div class="ledger-date">
                                        <span class="act-row-day">{article.dateLabel.slice(5)}</span>
                                        <Show when={previous()?.year !== article.year}>
                                            <span class="act-row-year">{article.year}</span>
                                        </Show>
                                    </div>
                                    <div class="ledger-rail" aria-hidden="true">
                                        <span class="rail-marker"></span>
                                    </div>
                                    <div class="ledger-body">
                                        <h3 class="act-row-title">
                                            <a href={article.url}>{article.title}</a>
                                        </h3>
                                        <p class="act-row-excerpt">{article.excerpt}</p>
                                        <Show when={article.placeNames.length > 0}>
                                            <p class="act-row-places">
                                                <For each={article.placeNames.slice(0, 4)}>{(name) => <span class="act-chip">{name}</span>}</For>
                                            </p>
                                        </Show>
                                    </div>
                                </article>
                            );
                        }}
                    </For>
                </div>
            </Show>
        </section>
    );
}
