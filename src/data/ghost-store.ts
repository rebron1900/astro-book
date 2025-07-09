import { getSettings, getPosts, getAllTags, getAllPages, getAllPosts, getNeodb, getFlux, getMemos, getAllAuthors, getAllContent } from '../utils/api';
import { atom } from 'nanostores';
// import { minfont } from '../utils/help';

const settingsStore = atom(await getSettings());
const postsStore = atom(await getPosts());
const postsAllStore = atom(await getAllPosts());
const tagsStore = atom(await getAllTags());
const pagesStore = atom(await getAllPages());
const neodbStore = atom(await getNeodb());
const fluxStore = atom(await getFlux());
const memosStore = atom(await getMemos());
const authorsStore = atom(await getAllAuthors());
const allContentStore = atom(await getAllContent());

export const settings = settingsStore.get();
export const posts = postsStore.get();
export const tags = tagsStore.get();
export const pages = pagesStore.get();
export const postsAll = postsAllStore.get();
export const neodb = neodbStore.get();
export const flux = fluxStore.get();
export const memos = memosStore.get();
export const authors = authorsStore.get();
export const allContent = allContentStore.get();

// export function buildFonts() {
//     const titleText = postsAll
//         .map(function (item) {
//             let tags = item.tags.map((tag) => tag.name).join(',');
//             let desc = item.excerpt != null ? item.excerpt.substring(0, 100) : '';
//             return item.title + desc + tags;
//         })
//         .join(',');
//     minfont(titleText);
// }

// buildFonts();
