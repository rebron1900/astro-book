/* 正常路线用到的图层样式 */
import type { LineLayerSpecification } from 'mapbox-gl';
import { LAYER_BASE, LAYER_FOCUS, LAYER_FOCUS_GLOW, LAYER_HALO, LAYER_HOVER, SOURCE_ID } from './constants';


export function baseLayerSpecification(): LineLayerSpecification {
    return {
        id: LAYER_BASE,
        type: 'line',
        source: SOURCE_ID,
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
            'line-color': ['get', 'color'],
            'line-width': ['interpolate', ['linear'], ['zoom'], 3, 1.7, 8, 2.1, 13, 2.6],
            'line-opacity': 0.3
        }
    };
}

export function focusGlowLayerSpecification(): LineLayerSpecification {
    return {
        id: LAYER_FOCUS_GLOW,
        type: 'line',
        source: SOURCE_ID,
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
            'line-color': ['get', 'color'],
            'line-width': ['interpolate', ['linear'], ['zoom'], 3, 6.5, 8, 7, 15, 8],
            'line-opacity': 0.2,
            'line-blur': 1.6
        }
    };
}

export function focusLayerSpecification(): LineLayerSpecification {
    return {
        id: LAYER_FOCUS,
        type: 'line',
        source: SOURCE_ID,
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
            'line-color': ['get', 'color'],
            'line-width': ['interpolate', ['linear'], ['zoom'], 3, 2.6, 8, 3, 15, 3.4],
            'line-opacity': 0.94
        }
    };
}

export function hoverHaloLayerSpecification(): LineLayerSpecification {
    return {
        id: LAYER_HALO,
        type: 'line',
        source: SOURCE_ID,
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
            'line-color': ['get', 'color'],
            'line-width': ['interpolate', ['linear'], ['zoom'], 3, 6, 10, 7, 15, 8],
            'line-opacity': 0.2,
            'line-blur': 1.5
        }
    };
}

export function hoverLayerSpecification(): LineLayerSpecification {
    return {
        id: LAYER_HOVER,
        type: 'line',
        source: SOURCE_ID,
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
            'line-color': ['get', 'color'],
            'line-width': ['interpolate', ['linear'], ['zoom'], 3, 3, 10, 3.6, 15, 4.2],
            'line-opacity': 1
        }
    };
}
