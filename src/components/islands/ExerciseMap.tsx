import { createEffect, createSignal, onCleanup, onMount } from 'solid-js';
import type { ExerciseRecord, ExerciseScope } from '../../lib/exercise';
import { SPORT_META, estimateCalories, formatDuration, formatRecordDistance, recordsInScope, scopeLabel } from '../../lib/exercise';
import { createExerciseMap, type ExerciseMapController, type ExerciseMapStatus } from '../../lib/client/exercise-map';

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
    // 单条记录时「1 次」是废话，只在范围型 scope 后面缀次数
    const badge = () => {
        const label = scopeLabel(props.scope, props.records);
        return props.scope.kind === 'record' ? label : `${label} · ${inScope().length} 次`;
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

        controller = createExerciseMap({
            container: canvas,
            viewport,
            token: props.token,
            routesUrl: props.routesUrl,
            records: props.records,
            onSelectRoute: (id) => props.onSelectRoute(id),
            onStatus: (next) => setStatus(next),
            onReplayAvailable: (available) => setReplayable(available),
            onReplayChange: (active) => setReplayActive(active),
            onReplayPlayback: (playing) => setReplayPlaying(playing),
            onReplayProgress: (progress) => setReplayProgress(progress)
        });

        // 先把当前 props 灌进去，再用 effect 跟随后续变化
        controller.setScope(props.scope);
        controller.setHover(props.hoverId);
        void controller.start();

        createEffect(() => controller?.setScope(props.scope));
        createEffect(() => controller?.setHover(props.hoverId));
        createEffect(() => controller?.setCompact(props.compact));

        onCleanup(() => controller?.destroy());
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
            {(() => {
                const record = activeRecord();
                if (!record) return null;
                return (
                    <div class="ex-map-info">
                        <div class="ex-map-info-top">
                            <span>
                                {record.date.slice(5)} {record.time}
                            </span>
                            <span class="ex-map-info-sport">{SPORT_META[record.sport].label}</span>
                        </div>
                        <p class="ex-map-info-name">{record.name}</p>
                        <ul class="ex-map-info-stats">
                            <li>
                                <b>{formatRecordDistance(record.distance)}</b>
                                <span>距离</span>
                            </li>
                            <li>
                                <b>{formatDuration(record.seconds)}</b>
                                <span>用时</span>
                            </li>
                            <li>
                                <b>{Math.round(record.elevation)} m</b>
                                <span>爬升</span>
                            </li>
                            <li>
                                <b>{estimateCalories(record.sport, record.seconds)} kcal</b>
                                <span>消耗</span>
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
