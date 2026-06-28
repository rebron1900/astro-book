import config from '../config';
import type { DataSource } from './types';

export interface Memo {
    [key: string]: unknown;
    type: string;
}

export async function getMemos(): Promise<Memo[]> {
    const memos = await fetch(config.memos.url).then((res) => res.json());
    return memos.map((memo: any) => ({
        ...memo,
        type: 'memo' // 为 Memos 添加 type 属性
    }));
}

export const memosSource: DataSource<Memo[]> = {
    name: 'memos',
    fetch: getMemos
};
