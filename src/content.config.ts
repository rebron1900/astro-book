import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

/**
 * 数字花园：内容来自 gitignored 的 `.garden/content/`（由 `yarn sync:garden` 从私有 vault 生成）。
 * 同步脚本已经做完过滤 / slug / 小写 / 冲突处理，文件名就是最终 id，这里只去掉扩展名。
 * 目录不存在时 Astro 只 warn，页面层负责给「尚未同步」的提示。
 */
const garden = defineCollection({
    loader: glob({
        base: './.garden/content',
        pattern: '**/*.md',
        generateId: ({ entry }) => entry.replace(/\.md$/i, '')
    }),
    schema: z
        .object({
            title: z.string().optional(),
            aliases: z.union([z.string(), z.array(z.string())]).optional(),
            tags: z.union([z.string(), z.array(z.string())]).optional(),
            date: z.union([z.string(), z.date()]).optional(),
            publish: z.boolean().optional(),
            draft: z.boolean().optional()
        })
        .passthrough()
});

export const collections = { garden };
