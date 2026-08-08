import type { NeoDBResponse } from './types';

const neodbURL = import.meta.env.NEODB_URL;

export const getNeodb = async (): Promise<NeoDBResponse> => {
    const res = await fetch(neodbURL);
    if (!res.ok) throw new Error(`NeoDB ${res.status} ${res.statusText}`);
    return (await res.json()) as NeoDBResponse;
};
