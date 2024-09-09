// MyMap.astro
import { createSignal, onMount } from 'solid-js';
import initMap from '../utils/map';

const MyMap = () => {
    const [url, setURL] = createSignal('');
    const [key, setKey] = createSignal('');

    onMount(() => {
        setURL(import.meta.env.MAP_URL);
        setKey(import.meta.env.MAP_KEY);

        initMap(url(), key());
    });

    return <div id='map' class='footer-map'></div>;
};

export default MyMap;
