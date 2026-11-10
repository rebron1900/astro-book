import { METRIC_ICONS, type MetricIconKind } from '../../lib/metric-icons';

/**
 * 指标小图标（Solid 版）：地图信息卡、统计面板等 island 里使用。
 * 路径来自 `src/lib/metric-icons.ts`，与 Astro 版 / tooltip HTML 版完全一致。
 */
export interface MetricIconProps {
    kind: MetricIconKind;
    class?: string;
}

export default function MetricIcon(props: MetricIconProps) {
    return (
        <svg
            class={props.class ?? 'metric-icon'}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
            innerHTML={METRIC_ICONS[props.kind]}
        />
    );
}
