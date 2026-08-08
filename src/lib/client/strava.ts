import mapboxgl from 'mapbox-gl/dist/mapbox-gl.js';
import MapboxLanguage from '@mapbox/mapbox-gl-language';
import 'mapbox-gl/dist/mapbox-gl.css';
import config from '../../config';

interface StravaActivity {
    run_id: string | number;
    type: string;
    summary_polyline?: string;
}

// Google polyline 解码（MIT）
function decodePolyline(str: string, precision = 5): number[][] {
    let index = 0,
        lat = 0,
        lng = 0,
        coordinates: number[][] = [],
        shift = 0,
        result = 0,
        byte: number | null = null,
        latitude_change,
        longitude_change,
        factor = Math.pow(10, precision);

    while (index < str.length) {
        byte = null;
        shift = 0;
        result = 0;
        do {
            byte = str.charCodeAt(index++) - 63;
            result |= (byte & 0x1f) << shift;
            shift += 5;
        } while (byte >= 0x20);
        latitude_change = result & 1 ? ~(result >> 1) : result >> 1;

        shift = result = 0;
        do {
            byte = str.charCodeAt(index++) - 63;
            result |= (byte & 0x1f) << shift;
            shift += 5;
        } while (byte >= 0x20);
        longitude_change = result & 1 ? ~(result >> 1) : result >> 1;

        lat += latitude_change;
        lng += longitude_change;
        coordinates.push([lng / factor, lat / factor]);
    }
    return coordinates;
}

// 初始化地图
export default function initMap() {
    const DATA_URL = config.strava.activitiesUrl;

    mapboxgl.accessToken = import.meta.env.MAP_KEY;

    const map = new mapboxgl.Map({
        container: 'map',
        style: `mapbox://styles/mapbox/${localStorage.getItem('themetype') || 'streets'}-v10`,
        center: [108.14, 33.87],
        zoom: 3,
        minZoom: 3,
        maxZoom: 24
    });
    map.addControl(new MapboxLanguage({ defaultLanguage: 'zh-Hans' }));

    let activities: StravaActivity[] = [];

    function setOpacity(id: string, opacity: number) {
        if (map.getLayer(id)) {
            map.setPaintProperty(id, 'line-opacity', opacity);
        }
    }

    function highlight(id: string | number) {
        activities.forEach((act) => {
            const layerId = 'route-' + act.run_id;
            setOpacity(layerId, act.run_id === id ? 1 : 0.1);
        });
    }

    function resetHighlight() {
        activities.forEach((act) => setOpacity('route-' + act.run_id, 0.5));
    }

    function zoomToActivity(id: string | number) {
        const act = activities.find((a) => a.run_id === id);
        if (!act || !act.summary_polyline) return;
        const coords = decodePolyline(act.summary_polyline);
        if (!coords.length) return;

        const bounds = new mapboxgl.LngLatBounds();
        coords.forEach((c) => bounds.extend(c as [number, number]));
        map.fitBounds(bounds, { padding: 40, duration: 800 });
    }

    map.on('load', async () => {
        try {
            const res = await fetch(DATA_URL);
            activities = await res.json();

            const allCoords: number[][] = [];

            activities.forEach((act) => {
                if (!act.summary_polyline) return;

                const coords = decodePolyline(act.summary_polyline);
                if (!coords.length) return;

                const geojson: GeoJSON.Feature = {
                    type: 'Feature',
                    properties: { id: act.run_id },
                    geometry: { type: 'LineString', coordinates: coords }
                };

                const sourceId = 'route-' + act.run_id;
                map.addSource(sourceId, { type: 'geojson', data: geojson });
                map.addLayer({
                    id: sourceId,
                    type: 'line',
                    source: sourceId,
                    layout: { 'line-join': 'round', 'line-cap': 'round' },
                    paint: {
                        'line-color': act.type === 'Run' ? '#f97316' : '#3b82f6',
                        'line-width': 4,
                        'line-opacity': 0.5
                    }
                });

                allCoords.push(...coords);
            });

            if (allCoords.length) {
                const bounds = new mapboxgl.LngLatBounds();
                allCoords.forEach((c) => bounds.extend(c as [number, number]));
                map.fitBounds(bounds, { padding: 40 });
            }
        } catch (err) {
            console.error(err);
            const list = document.getElementById('activityList');
            if (list) list.textContent = '加载失败';
        }
    });
}
