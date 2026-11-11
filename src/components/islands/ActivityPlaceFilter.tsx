/**
 * 地点筛选（省份 → 地名两级）。
 *
 * 注意：/activity/ 页面当前**暂不挂载**这个组件（用户要求先下线，右栏留给概览/分布/成就）。
 * 需要恢复时：在 activity.astro 的 .act-side--footprint 里加一行
 *   <ActivityPlaceFilter client:media="(min-width: 47.85rem)" places={footprint.places} />
 * 事件通道（lib/client/activity.ts）和 ActivityShell 里的监听都还在。
 */
import { For, Show, createEffect, createMemo, createSignal, onMount } from 'solid-js';
import type { FootprintPlace } from '../../lib/footprint';
import { ACTIVITY_PLACE_FILTER_EVENT, type ActivityPlaceFilterDetail } from '../../lib/client/activity';
import { groupPlacesByProvince } from '../../lib/footprint';

/**
 * `/activity/` 右侧栏的「地点筛选」：省份 → 地名两级。
 * 勾选结果通过 document 事件发给地图岛（见 lib/client/activity.ts）。
 */
export interface ActivityPlaceFilterProps {
    places: readonly FootprintPlace[];
}

export default function ActivityPlaceFilter(props: ActivityPlaceFilterProps) {
    const groups = groupPlacesByProvince(props.places);
    const [selected, setSelected] = createSignal<ReadonlySet<string>>(new Set<string>());
    const [expanded, setExpanded] = createSignal<ReadonlySet<string>>(new Set<string>());

    const emit = (next: ReadonlySet<string>) => {
        document.dispatchEvent(new CustomEvent<ActivityPlaceFilterDetail>(ACTIVITY_PLACE_FILTER_EVENT, { detail: { names: [...next] } }));
    };

    const togglePlace = (name: string) => {
        const next = new Set(selected());
        if (next.has(name)) next.delete(name);
        else next.add(name);
        setSelected(next);
        emit(next);
    };

    const toggleProvince = (province: string) => {
        const next = new Set(selected());
        const names = groups.find((group) => group.province === province)?.places.map((place) => place.name) ?? [];
        const allSelected = names.every((name) => next.has(name));
        for (const name of names) {
            if (allSelected) next.delete(name);
            else next.add(name);
        }
        setSelected(next);
        emit(next);
    };

    const toggleExpanded = (province: string) => {
        const next = new Set(expanded());
        if (next.has(province)) next.delete(province);
        else next.add(province);
        setExpanded(next);
    };

    const selectedCount = createMemo(() => selected().size);

    const clearAll = () => {
        const empty = new Set<string>();
        setSelected(empty);
        emit(empty);
    };

    onMount(() => {
        // 进页面先告诉地图「当前没有筛选」，避免来回切换模式时状态错位
        emit(new Set<string>());
    });

    return (
        <section class="act-flt" aria-label="地点筛选">
            <header class="act-flt-head">
                <h2 class="act-side-title">地点筛选</h2>
                <Show when={selectedCount() > 0}>
                    <button class="act-flt-clear" type="button" onClick={clearAll}>
                        清空
                    </button>
                </Show>
            </header>

            <p class="act-flt-count">
                <Show when={selectedCount() > 0} fallback={`${props.places.length} 个地点`}>
                    已选 {selectedCount()} 个
                </Show>
            </p>

            <ul class="act-flt-groups">
                <For each={groups}>
                    {(group) => {
                        const names = group.places.map((place) => place.name);
                        const checked = () => names.filter((name) => selected().has(name)).length;
                        const isOpen = () => expanded().has(group.province);
                        let box: HTMLInputElement | undefined;
                        // checkbox 的半选态只能用 DOM 属性，不能写成 JSX attribute
                        createEffect(() => {
                            if (box) box.indeterminate = checked() > 0 && checked() < names.length;
                        });
                        return (
                            <li class="act-flt-group">
                                <div class="act-flt-row">
                                    <button
                                        class="act-flt-caret"
                                        type="button"
                                        aria-expanded={isOpen()}
                                        aria-label={`${isOpen() ? '收起' : '展开'}${group.province}`}
                                        onClick={() => toggleExpanded(group.province)}
                                    >
                                        <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                            <path d="m9 6 6 6-6 6" />
                                        </svg>
                                    </button>
                                    <label class="act-flt-label">
                                        <input ref={box} type="checkbox" checked={checked() === names.length && names.length > 0} onChange={() => toggleProvince(group.province)} />
                                        <span class="act-flt-name">{group.province}</span>
                                        <span class="act-flt-badge">{group.points}</span>
                                    </label>
                                </div>

                                <Show when={isOpen()}>
                                    <ul class="act-flt-places">
                                        <For each={group.places}>
                                            {(place) => (
                                                <li>
                                                    <label class="act-flt-label act-flt-label--place">
                                                        <input type="checkbox" checked={selected().has(place.name)} onChange={() => togglePlace(place.name)} />
                                                        <span class="act-flt-name">{place.name}</span>
                                                        <Show when={place.articles > 0}>
                                                            <span class="act-flt-badge act-flt-badge--soft">{place.articles}</span>
                                                        </Show>
                                                    </label>
                                                </li>
                                            )}
                                        </For>
                                    </ul>
                                </Show>
                            </li>
                        );
                    }}
                </For>
            </ul>
        </section>
    );
}
