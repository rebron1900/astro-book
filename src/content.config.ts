import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const Obsidian = defineCollection({
    loader: glob({ pattern: '**/*.md', base: './src/content/Obsidian' }),
    schema: z.object({
        title: z.string()
    })
});

export const collections = { Obsidian };
