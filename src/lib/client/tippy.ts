/**
 * tippy 统一入口：集中记录实例，导航前销毁。
 * 各组件直接 import tippy 会在 `appendTo: document.body` 的 popper 上不断累积。
 */
import tippy from 'tippy.js';
import type { Instance, Props } from 'tippy.js';

type TippyTarget = string | Element | Element[];

const instances: Instance[] = [];
const MAX_INSTANCES = 80;

export function createTippy(targets: TippyTarget, options: Partial<Props> = {}): Instance[] {
    const result = tippy(targets as Parameters<typeof tippy>[0], options as Parameters<typeof tippy>[1]);
    const created: Instance[] = Array.isArray(result) ? result : [result];
    instances.push(...created);

    // 长列表页面（相册/地图）可能创建很多实例，超出上限就回收最旧的
    if (instances.length > MAX_INSTANCES) {
        instances.splice(0, instances.length - MAX_INSTANCES).forEach((instance) => instance.destroy());
    }
    return created;
}

export function destroyAllTippy(): void {
    instances.forEach((instance) => instance.destroy());
    instances.length = 0;
}

if (typeof document !== 'undefined') {
    document.addEventListener('astro:before-swap', destroyAllTippy);
}
