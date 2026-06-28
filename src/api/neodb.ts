import type { DataSource, NeoDBItem } from './types';

const neodbURL = import.meta.env.NEODB_URL;

export const getNeodb = async (): Promise<NeoDBItem[]> => {
    const res = await fetch(neodbURL);
    if (!res.ok) throw new Error(`NeoDB ${res.status} ${res.statusText}`);
    return (await res.json()) as NeoDBItem[];
};

export const neodbSource: DataSource<NeoDBItem[]> = {
    name: 'neodb',
    fetch: getNeodb
};
