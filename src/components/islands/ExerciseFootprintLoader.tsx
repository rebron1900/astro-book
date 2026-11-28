import { Show, createSignal, onCleanup, onMount } from 'solid-js';
import type { FootprintData } from '../../lib/footprint';
import { ACTIVITY_MODE_EVENT, type ActivityModeDetail } from '../../lib/client/activity';
import ExerciseFootprint from './ExerciseFootprint';

export interface ExerciseFootprintLoaderProps {
    /** 足迹数据接口（构建期算好的标点 + 游记）：打开足迹时才拉一次 */
    dataUrl: string;
    /** Mapbox public token */
    token: string;
    /** 合并页用：只在足迹模式下创建地图（不传 = 一直激活） */
    activeMode?: 'exercise' | 'footprint';
}

/**
 * 足迹模式的按需数据外壳。
 *
 * 足迹这一栏在 /activity/ 里默认是 `display:none`，以前把 84KB 的 SSR 标记
 * （34 个省分组 + 上百张卡片）直接写进页面，用户看不到却要为它付下载和解析的代价。
 * 这里只输出一个和真实结构同高同宽的骨架，用户真的切到足迹时才去拉数据（65KB）。
 */
export default function ExerciseFootprintLoader(props: ExerciseFootprintLoaderProps) {
    const [data, setData] = createSignal<FootprintData | null>(null);
    const [failed, setFailed] = createSignal(false);

    onMount(() => {
        let cancelled = false;
        let loading = false;

        const load = () => {
            if (loading || data()) return;
            loading = true;
            fetch(props.dataUrl, { headers: { accept: 'application/json' } })
                .then((response) => (response.ok ? response.json() : Promise.reject(new Error(String(response.status)))))
                .then((payload: FootprintData) => {
                    if (!cancelled) setData(payload);
                })
                .catch(() => {
                    loading = false;
                    if (!cancelled) setFailed(true);
                });
        };

        // 直链进足迹（页面已经有 data-activity-mode）就立即拉，否则等切换按钮的广播
        const currentMode = document.querySelector('.activity-page')?.getAttribute('data-activity-mode');
        if (currentMode === 'footprint') load();

        const onMode = (event: Event) => {
            if ((event as CustomEvent<ActivityModeDetail>).detail?.mode === 'footprint') load();
        };
        document.addEventListener(ACTIVITY_MODE_EVENT, onMode);

        onCleanup(() => {
            cancelled = true;
            document.removeEventListener(ACTIVITY_MODE_EVENT, onMode);
        });
    });

    return (
        <Show
            when={data()}
            fallback={
                // 骨架：和真实足迹同结构，切模式时高度不会跳
                <section class="ex-fp" aria-label="足迹" tabindex={-1}>
                    <div class="ex-fp-stage">
                        <div class="ex-fp-map-wrap">
                            <div class="ex-fp-map" />
                        </div>
                        <aside class="ex-fp-panel" aria-label="足迹时间线">
                            <div class="ex-fp-empty" role="status">
                                <p class="ex-fp-empty-title">{failed() ? '足迹数据没有取到' : '正在加载足迹…'}</p>
                                <p class="ex-fp-empty-text">
                                    {failed() ? '刷新页面可以再试一次；运动时间线不受影响。' : '标点和游记按省份排好后就出现。'}
                                </p>
                            </div>
                        </aside>
                    </div>
                </section>
            }
        >
            {(loaded) => <ExerciseFootprint data={loaded()} token={props.token} activeMode={props.activeMode} />}
        </Show>
    );
}
