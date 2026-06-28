import config from '../config';
import type { DataSource, Memo } from './types';

export async function getMemos(): Promise<Memo[]> {
    const memos = (await fetch(config.memos.url).then((res) => res.json())) as Memo[];
    return memos.map((memo) => ({
        ...memo,
        type: 'memo'
    }));
}

export const memosSource: DataSource<Memo[]> = {
    name: 'memos',
    fetch: getMemos
};
