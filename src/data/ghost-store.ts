import { getSettings, getPosts, getAllTags, getAllPages, getAllPosts, getNeodb, getFlux, getMemos, getAllAuthors } from '../utils/api';
import { atom } from 'nanostores';

const settingsStore = atom(await getSettings());
const postsStore = atom(await getPosts());
const postsAllStore = atom(await getAllPosts());
const tagsStore = atom(await getAllTags());
const pagesStore = atom(await getAllPages());
const neodbStore = atom(await getNeodb());
const fluxStore = atom(await getFlux());
const memosStore = atom(await getMemos());
const authorsStore = atom(await getAllAuthors());

export const settings = settingsStore.get();
export const posts = postsStore.get();
export const tags = tagsStore.get();
export const pages = pagesStore.get();
export const postsAll = postsAllStore.get();
export const neodb = neodbStore.get();
export const flux = fluxStore.get();
export const memos = memosStore.get();
export const authors = authorsStore.get();
