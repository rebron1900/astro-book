/**
 * Obsidian callout（`> [!NOTE] 可选标题`）→ 带类型色的提示块。
 *
 * Sätteri 的 mdast 插件（不是 remark）：把 blockquote 换成一个自定义节点，
 * 通过 `data.hName` 渲染成 `div.callout.callout-<kind>`，标题单独一段，
 * 正文子节点原样保留——所以块内的列表、代码、链接照常走后面的管线。
 *
 * 类型名按 Quartz `ofm.ts` 的映射表全收；颜色在 _custom.scss 里按类名给。
 */
import { defineMdastPlugin } from 'satteri';

const TYPE_ALIASES = {
    note: 'note',
    abstract: 'note',
    summary: 'note',
    tldr: 'note',
    info: 'info',
    todo: 'info',
    tip: 'tip',
    hint: 'tip',
    important: 'tip',
    success: 'success',
    check: 'success',
    done: 'success',
    question: 'question',
    help: 'question',
    faq: 'question',
    warning: 'warning',
    caution: 'warning',
    attention: 'warning',
    failure: 'failure',
    fail: 'failure',
    missing: 'failure',
    danger: 'danger',
    error: 'danger',
    bug: 'bug',
    example: 'example',
    quote: 'quote',
    cite: 'quote'
};

const CALLOUT_MARKER = /^\[!([A-Za-z][\w-]*)\]([+-])?[ \t]*/;

export const satteriCallouts = defineMdastPlugin({
    name: 'garden-callouts',
    blockquote(node, ctx) {
        const first = node.children?.[0];
        if (!first || first.type !== 'paragraph' || !Array.isArray(first.children)) return;
        const head = first.children[0];
        if (!head || head.type !== 'text') return;
        const match = CALLOUT_MARKER.exec(head.value);
        if (!match) return;
        const rawType = match[1].toLowerCase();
        const kind = TYPE_ALIASES[rawType];
        if (!kind) return;

        // 标记同一行剩下的文字是标题（`> [!NOTE] 自定义标题`）
        const rest = head.value.slice(match[0].length);
        const newline = rest.indexOf('\n');
        const inlineTitle = (newline === -1 ? rest : rest.slice(0, newline)).trim();
        const remainder = newline === -1 ? '' : rest.slice(newline + 1);
        const title = inlineTitle || rawType.charAt(0).toUpperCase() + rawType.slice(1);

        // 正文：同一段落里剩下的子节点（软换行留下的 break 去掉，别开头多一个空行）
        const bodyChildren = first.children.slice(1);
        if (bodyChildren[0] && bodyChildren[0].type === 'break') bodyChildren.shift();

        const children = [
            {
                type: 'paragraph',
                data: { hName: 'div', hProperties: { className: ['callout-title'] } },
                children: [{ type: 'text', value: title }]
            }
        ];
        if (remainder.trim() || bodyChildren.length) {
            children.push({
                type: 'paragraph',
                children: [...(remainder ? [{ type: 'text', value: remainder }] : []), ...bodyChildren]
            });
        }
        children.push(...node.children.slice(1));

        ctx.replaceNode(node, {
            type: 'gardenCallout',
            children,
            data: {
                hName: 'div',
                hProperties: { className: ['callout', `callout-${kind}`], 'data-callout': rawType }
            }
        });
    }
});
