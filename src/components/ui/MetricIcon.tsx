/**
 * 指标小图标（Solid 版）：地图信息卡、统计面板等 island 里使用。
 *
 * 和 Astro 版（MetricIcon.astro）一样只输出一行 <use>，路径定义在
 * `MetricSprite.astro` 的 <symbol> 里（整页一份）。以前这里内联 METRIC_ICONS 的路径，
 * 运动页 1000 多个图标一共多写 100 多 KB、还要随水合一起进客户端。
 * stroke/fill 仍写在 <svg> 上：呈现属性会继承进 <use> 引用的影子树，观感不变。
 */
import type { MetricIconKind } from '../../lib/metric-icons';

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
        >
            <use href={`#mi-${props.kind}`} />
        </svg>
    );
}