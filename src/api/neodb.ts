import type { DataSource } from './types';

const neodbURL = import.meta.env.NEODB_URL;

export const getNeodb = async () => {
    const res = await fetch(neodbURL);
    if (!res.ok) throw new Error(`NeoDB ${res.status} ${res.statusText}`);
    return res.json();
};

export const neodbSource: DataSource = {
    name: 'neodb',
    fetch: getNeodb
};
