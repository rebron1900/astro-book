import { createEffect, createSignal, onCleanup, onMount } from 'solid-js';
import type { ExerciseRecord, ExerciseScope } from '../../lib/exercise';
import { estimateCalories, formatDuration, formatRecordDistance, recordsInScope, scopeLabel } from '../../lib/exercise';
import { createExerciseMap, type ExerciseMapController, type ExerciseMapStatus } from '../../lib/client/exercise-map';
import { afterTransition } from '../../lib/client/idle';
import { ACTIVITY_MODE_EVENT, type ActivityModeDetail } from '../../lib/client/activity';
import MetricIcon from '../ui/MetricIcon';

export interface ExerciseMapProps {
    /** 页面内嵌的精简运动记录（无轨迹） */
    records: ExerciseRecord[];
    /** Mapbox public token */
    token: string;
    /** 轨迹数据接口 */
    routesUrl: string;
    /** 当前选中范围（响应式） */
    scope: ExerciseScope;
    /** 时间线悬停的记录 id（响应式） */
    hoverId: string | null;
    /** 预览地图是否已吸顶（响应式） */
    compact: boolean;
    /** 点击地图上的路线 */
    onSelectRoute: (id: string) => void;
    /** 回到「全部路线」 */
    onReset: () => void;
    /**
     * 合并页（/activity/）用：只有当前模式等于它时地图才创建。
     * 不传 = 一直激活（旧的 /exercise/ 页面行为不变）。
     */
    activeMode?: 'exercise' | 'footprint';
}

const INITIAL_STATUS: ExerciseMapStatus = { message: null, unavailable: false };

/**
 * 右侧顶部的地图预览。
 *
 * 服务端只输出卡片骨架（角标 / 「全部」按钮 / 提示条），地图在 onMount 里交给
 * createExerciseMap() 创建；scope 与 hoverId 用 createEffect 驱动控制器。
 * 注意不要用 id 拿 DOM：移动端和桌面端各会挂载一个实例。
 */
export default function ExerciseMap(props: ExerciseMapProps) {
    let canvas: HTMLDivElement | undefined;
    let viewport: HTMLDivElement | undefined;
    let controller: ExerciseMapController | undefined;
    const [status, setStatus] = createSignal<ExerciseMapStatus>(INITIAL_STATUS);
    const [replayable, setReplayable] = createSignal(false);
    const [replayActive, setReplayActive] = createSignal(false);
    const [replayPlaying, setReplayPlaying] = createSignal(false);
    const [replayProgress, setReplayProgress] = createSignal(0);

    const inScope = () => recordsInScope(props.records, props.scope);
    // 单条记录时角标显示这条记录的名字（Garmin/intervals 里的 entry title），
    // 范围型 scope 仍显示「月份 · N 次」
    const badge = () => {
        const scope = props.scope;
        if (scope.kind === 'record') {
            const record = props.records.find((item) => item.id === scope.id);
            if (record?.name) return record.name;
        }
        const label = scopeLabel(scope, props.records);
        return scope.kind === 'record' ? label : `${label} · ${inScope().length} 次`;
    };
    const hasState = () => status().message !== null;
    /** 单条记录时在地图上显示这次运动的基础信息 */
    const activeRecord = () => {
        const scope = props.scope;
        if (scope.kind !== 'record') return null;
        return props.records.find((record) => record.id === scope.id) ?? null;
    };

    onMount(() => {
        if (!canvas) return;

        const [active, setActive] = createSignal(true);
        let cancelStart: (() => void) | null = null;

        const boot = () => {
            if (!canvas || controller || !active()) return;

            controller = createExerciseMap({
                container: canvas,
                viewport,
                token: props.token,
                routesUrl: props.routesUrl,
                records: props.records,
                onSelectRoute: (id) => props.onSelectRoute(id),
                onStatus: (next) => setStatus(next),
                onReplayAvailable: (available) => setReplayable(available),
                onReplayChange: (next) => setReplayActive(next),
                onReplayPlayback: (playing) => setReplayPlaying(playing),
                onReplayProgress: (progress) => setReplayProgress(progress)
            });

            // 先把当前 props 灌进去，再用 effect 跟随后变化
            controller.setScope(props.scope);
            controller.setHover(props.hoverId);
            // 等换页动画结束、浏览器空闲再起地图：WebGL 初始化和首帧瓦片渲染都不该和过渡抢帧
            cancelStart = afterTransition(() => {
                cancelStart = null;
                void controller?.start();
            });
        };

        const teardown = () => {
            cancelStart?.();
            cancelStart = null;
            controller?.destroy();
            controller = undefined;
            canvas?.replaceChildren();
        };

        // 合并页：读一次当前模式，之后跟着广播走
        if (props.activeMode) {
            const readMode = () => document.querySelector('.activity-page')?.getAttribute('data-activity-mode') ?? 'exercise';
            setActive(readMode() === props.activeMode);
            const onMode = (event: Event) => {
                const mode = (event as CustomEvent<ActivityModeDetail>).detail?.mode;
                setActive(mode === props.activeMode);
            };
            document.addEventListener(ACTIVITY_MODE_EVENT, onMode);
            onCleanup(() => document.removeEventListener(ACTIVITY_MODE_EVENT, onMode));
        }

        createEffect(() => {
            if (active() && !controller) boot();
            else if (!active() && controller) teardown();
        });

        createEffect(() => controller?.setScope(props.scope));
        createEffect(() => controller?.setHover(props.hoverId));
        createEffect(() => controller?.setCompact(props.compact));

        // ClientRouter 换页只换 DOM，Solid 的 onCleanup 不保证会跑：
        // 地图实例（WebGL 上下文 + 渲染循环）必须在这里兜底销毁，否则离开一页就多一份一直在画的地图
        const destroyOnSwap = () => teardown();
        document.addEventListener('astro:before-swap', destroyOnSwap);

        onCleanup(() => {
            document.removeEventListener('astro:before-swap', destroyOnSwap);
            teardown();
        });
    });

    return (
        <div class="ex-map-card" classList={{ 'is-empty': hasState(), 'is-replaying': replayActive() }} data-exercise-map>
            <div class="ex-map-viewport" ref={(element) => (viewport = element)}>
                <div class="ex-map-canvas" classList={{ 'has-state': hasState() }} ref={(element) => (canvas = element)} />
            </div>
            <span class="ex-map-badge">{badge()}</span>
            <button class="ex-map-reset" type="button" onClick={() => props.onReset()}>
                全部
            </button>
            {/* 底部同一行：左边是这次运动的指标，右边是重播按钮（窄屏也不会互相压住） */}
            <div class="ex-map-bottom">
                {(() => {
                    const record = activeRecord();
                    if (!record) return null;
                    return (
                        <div class="ex-map-info">
                            <ul class="ex-map-info-stats">
                                <li>
                                    <b>{formatRecordDistance(record.distance)}</b>
                                    <span class="ex-map-info-label">
                                        <MetricIcon kind="distance" />
                                        <em>距离</em>
                                    </span>
                                </li>
                                <li>
                                    <b>{formatDuration(record.seconds)}</b>
                                    <span class="ex-map-info-label">
                                        <MetricIcon kind="duration" />
                                        <em>用时</em>
                                    </span>
                                </li>
                                <li>
                                    <b>{Math.round(record.elevation)} m</b>
                                    <span class="ex-map-info-label">
                                        <MetricIcon kind="elevation" />
                                        <em>爬升</em>
                                    </span>
                                </li>
                                <li>
                                    <b>{estimateCalories(record.sport, record.seconds)} kcal</b>
                                    <span class="ex-map-info-label">
                                        <MetricIcon kind="calories" />
                                        <em>消耗</em>
                                    </span>
                                </li>
                            </ul>
                        </div>
                    );
                })()}
                {replayable() && !replayActive() ? (
                    <button class="ex-map-play" type="button" aria-label="重播这次轨迹" title="重播轨迹" onClick={() => controller?.replay()}>
                        <svg class="ex-map-play-icon" viewBox="0 0 24 24" aria-hidden="true">
                            <path d="M8.5 5.6v12.8l10-6.4z" fill="currentColor" />
                        </svg>
                    </button>
                ) : null}
            </div>
            <p class="ex-map-state" hidden={!hasState()}>
                {status().message ?? ''}
            </p>
            {replayActive() ? (
                <div class="ex-map-replay-bar" role="group" aria-label="轨迹重播控制">
                    <input
                        class="ex-map-replay-range"
                        type="range"
                        min="0"
                        max="1000"
                        step="1"
                        value={String(Math.round(replayProgress() * 1000))}
                        style={`--ex-replay-progress:${Math.round(replayProgress() * 100)}%`}
                        aria-label="绘制进度"
                        aria-valuetext={`${Math.round(replayProgress() * 100)}%`}
                        onInput={(event) => controller?.seekReplay(Number((event.currentTarget as HTMLInputElement).value) / 1000)}
                    />
                    <button
                        class="ex-map-replay-control"
                        type="button"
                        aria-label={replayPlaying() ? '暂停重播' : '继续重播'}
                        title={replayPlaying() ? '暂停重播' : '继续重播'}
                        onClick={() => (replayPlaying() ? controller?.pauseReplay() : controller?.resumeReplay())}
                    >
                        {replayPlaying() ? (
                            <svg class="ex-map-replay-icon" viewBox="0 0 24 24" aria-hidden="true">
                                <rect x="7.5" y="6" width="3.2" height="12" rx="1.2" fill="currentColor" />
                                <rect x="13.3" y="6" width="3.2" height="12" rx="1.2" fill="currentColor" />
                            </svg>
                        ) : (
                            <svg class="ex-map-replay-icon" viewBox="0 0 24 24" aria-hidden="true">
                                <path d="M8.5 5.6v12.8l10-6.4z" fill="currentColor" />
                            </svg>
                        )}
                    </button>
                    <button
                        class="ex-map-replay-control ex-map-replay-close"
                        type="button"
                        aria-label="结束重播"
                        title="结束重播"
                        onClick={() => controller?.stopReplay(true)}
                    >
                        <svg
                            class="ex-map-replay-icon"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="2.2"
                            stroke-linecap="round"
                            aria-hidden="true"
                        >
                            <path d="M6 6l12 12M18 6 6 18" />
                        </svg>
                    </button>
                </div>
            ) : null}
        </div>
    );
}
