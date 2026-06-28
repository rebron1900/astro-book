import mapboxgl from 'mapbox-gl/dist/mapbox-gl.js';
import MapboxLanguage from '@mapbox/mapbox-gl-language';
import Supercluster from 'supercluster';
import geojsonExtent from '@mapbox/geojson-extent/geojson-extent';
import tippy from 'tippy.js';

import 'mapbox-gl/dist/mapbox-gl.css';
import 'tippy.js/themes/light.css';

// 定义 ControlButton 类
class ControlButton {
    constructor({ className = '', title = '' }) {
        this._className = className;
        this._title = title;
    }

    onAdd(map) {
        this._btn = document.createElement('button');
        this._btn.className = `mapboxgl-ctrl-icon ${this._className}`;
        this._btn.type = 'button';
        this._btn.title = this._title;

        this._btn.onclick = () => map.flyTo({ center: [108.14, 33.87], zoom: 3 });

        this._container = document.createElement('div');
        this._container.className = 'mapboxgl-ctrl-group mapboxgl-ctrl';
        this._container.appendChild(this._btn);

        return this._container;
    }

    onRemove() {
        this._container.parentNode.removeChild(this._container);
        this._map = undefined;
    }
}

class MapHandler {
    constructor({ data = [], key = '' }) {
        this.data = data;
        this.clusterData = [];
        this.markers = [];
        this.tippyInstances = [];
        this.key = key;
        this.allFeatures = []; // 存储所有原始特征
        this._createMap();
    }

    _createMap() {
        mapboxgl.accessToken = this.key;

        this.map = new mapboxgl.Map({
            container: 'map',
            style: `mapbox://styles/mapbox/${localStorage.themetype}-v10`,
            center: [108.14, 33.87],
            zoom: 3,
            minZoom: 3,
            maxZoom: 24
        });

        this.cluster = new Supercluster({ radius: 26, maxZoom: 24 });

        this._addControls();
        this._setupMapEvents();
    }

    _addControls() {
        this.map.addControl(new MapboxLanguage({ defaultLanguage: 'zh-Hans' }));
        this.map.addControl(new mapboxgl.NavigationControl({ showCompass: false }));
        this.map.addControl(new ControlButton({ className: 'mapbox-gl-draw_polygon', title: '返回' }), 'top-right');
        this.map.addControl(new FilterControl(this), 'bottom-right');
    }

    _setupMapEvents() {
        this.map.on('load', () => {
            if (this.data) {
                this.allFeatures = [...this.data.features]; // 保存原始数据
                this.cluster.load(this.data.features);
                this.clusterData = this._getClusterData(3);
                this.updateMarkers();
                document.querySelector('#map').classList.add('is-loaded');
            }
        });

        this.map.on('zoom', () => {
            // 在缩放时，如果有过滤器激活，则使用当前过滤器
            const filterControl = this.map._controls.find((control) => control instanceof FilterControl);
            if (filterControl) {
                this.updateMarkersWithFilters(filterControl.activeFilters);
            } else {
                const zoomLevel = Math.floor(this.map.getZoom());
                this.clusterData = this._getClusterData(zoomLevel);
                this.updateMarkers();
            }
        });
    }

    _getClusterData(zoomLevel) {
        return {
            type: 'FeatureCollection',
            features: this.cluster.getClusters([-180, -90, 180, 90], zoomLevel)
        };
    }

    updateMarkers() {
        this.markers.forEach((marker) => marker.remove());
        this.tippyInstances.forEach((instance) => instance.destroy());
        this.markers = [];
        this.tippyInstances = [];

        this.clusterData.features.forEach((feature) => {
            feature.properties.cluster ? this.addClusterMarker(feature) : this.addPhotoMarker(feature);
        });
    }

    updateMarkersWithFilters(filters) {
        this.markers.forEach((marker) => marker.remove());
        this.tippyInstances.forEach((instance) => instance.destroy());
        this.markers = [];
        this.tippyInstances = [];

        // 根据过滤条件重新处理数据
        let filteredFeatures = [...this.allFeatures];

        // 过滤有文章的标记
        if (!filters.withPost) {
            filteredFeatures = filteredFeatures.filter((feature) => {
                return !this._hasAssociatedPost(feature.properties.description);
            });
        }

        // 过滤无文章的标记
        if (!filters.withoutPost) {
            filteredFeatures = filteredFeatures.filter((feature) => {
                return this._hasAssociatedPost(feature.properties.description);
            });
        }

        // 重新聚类
        this.cluster.load(filteredFeatures);
        const zoomLevel = Math.floor(this.map.getZoom());
        this.clusterData = this._getClusterData(zoomLevel);

        // 显示或隐藏聚合标记
        this.clusterData.features.forEach((feature) => {
            if (feature.properties.cluster) {
                if (filters.cluster) {
                    this.addClusterMarker(feature);
                }
            } else {
                const hasPost = this._hasAssociatedPost(feature.properties.description);
                if ((hasPost && filters.withPost) || (!hasPost && filters.withoutPost)) {
                    this.addPhotoMarker(feature);
                }
            }
        });
    }

    _hasAssociatedPost(description) {
        if (!description) return false;

        const regex = /\[(.*?)\]\((.*?)\)\((.*?)\)/g;
        const matches = [...description.matchAll(regex)];
        return matches.length > 0;
    }

    createMarker() {
        return document.createElement('div');
    }

    addPhotoMarker(feature) {
        const markerElement = this.createMarker();
        markerElement.className = 'marker';

        let results;

        if (feature.properties.description) {
            const str = feature.properties.description;
            // 使用正则表达式匹配所有的标题、链接和图片URL
            const regex = /\[(.*?)\]\((.*?)\)\((.*?)\)/g;
            const matches = [...str.matchAll(regex)];

            // 将匹配结果转换为对象数组
            results = matches.map((match) => ({
                title: match[1],
                url: match[2],
                img: match[3]
            }));

            results = results.length == 0 ? null : results;
        }

        const popupContent = this._generatePopupContent(feature.properties.name, results);

        if (results) {
            markerElement.classList.add('img-post');
            markerElement.style.setProperty('--photo', `url("${results[0].img}")`);
        } else {
            markerElement.classList.add('no-post');
        }

        this.tippyInstances.push(
            tippy(markerElement, {
                allowHTML: true,
                placement: 'top',
                maxWidth: 300,
                delay: 150,
                interactive: true,
                content: popupContent
            })
        );

        this.addMarkerToMap(markerElement, feature.geometry.coordinates);
    }

    _extractResults(description) {
        if (!description) return null;

        const regex = /$$(.*?)$$$(.*?)$$(.*?)$/g;
        const matches = [...description.matchAll(regex)];

        return matches.map((match) => ({
            title: match[1],
            url: match[2],
            img: match[3]
        }));
    }

    _generatePopupContent(name, results) {
        let content = `<strong>${name}</strong><br />`;
        if (results) {
            results.forEach((item) => {
                content += `- <a style='color:var(--hint-color-info)' target="_blank" href="${item.url}">${item.title}</a><br />`;
            });
        } else {
            content += '该地点暂无游记。';
        }
        return content.replace(/<br \/?>$/, '');
    }

    addClusterMarker(feature) {
        const clusterMarker = this.createMarker();
        clusterMarker.className = 'marker cluster';
        clusterMarker.dataset.cardinality = Math.min(99, feature.properties.point_count);

        clusterMarker.addEventListener('click', (event) => this.clusterDidClick(event, feature));

        const leaves = this.cluster.getLeaves(
            feature.properties.cluster_id,
            Infinity // limit：想取多少就写多少，Infinity 表示全部
        );
        const names = `<strong>包含了 ${clusterMarker.dataset.cardinality} 个地点</strong><br />` + leaves.map((leaf) => leaf.properties.name).join(', ');

        this.tippyInstances.push(
            tippy(clusterMarker, {
                content: names || '无标记',
                allowHTML: true,
                placement: 'top',
                maxWidth: 300,
                delay: 150,
                interactive: true
            })
        );

        this.addClusterToMap(clusterMarker, feature.geometry.coordinates);
    }

    addClusterToMap(markerElement, coordinates) {
        const marker = new mapboxgl.Marker(markerElement).setLngLat(coordinates).addTo(this.map);
        this.markers.push(marker);
        return marker;
    }

    addMarkerToMap(markerElement, coordinates) {
        const marker = new mapboxgl.Marker(markerElement).setLngLat(coordinates).addTo(this.map);
        this.markers.push(marker);
        return marker;
    }

    clusterDidClick(event, feature) {
        const leaves = {
            type: 'FeatureCollection',
            features: this.cluster.getLeaves(feature.properties.cluster_id)
        };
        this.map.fitBounds(geojsonExtent(leaves), {
            padding: 0.32 * this.map.getContainer().offsetHeight
        });
    }
}

// 定义 FilterControl 类
class FilterControl {
    constructor(mapHandler) {
        this.mapHandler = mapHandler;
        this.activeFilters = {
            cluster: true,
            withPost: true,
            withoutPost: true
        };
    }

    onAdd(map) {
        this._container = document.createElement('div');
        this._container.className = 'mapboxgl-ctrl mapboxgl-ctrl-group filter-control';

        // 创建三个过滤按钮
        //this._createFilterButton('🔴', '聚合标记，悬浮可查看地点清单', 'cluster');
        this._createFilterButton('🟢', '有关联文章的标记', 'withPost');
        this._createFilterButton('🔵', '无关联文章的标记', 'withoutPost');

        return this._container;
    }

    _createFilterButton(emoji, title, filterKey) {
        const button = document.createElement('button');
        button.type = 'button';
        button.title = title;
        button.className = 'filter-btn';
        button.dataset.filter = filterKey;
        button.innerHTML = emoji;

        button.addEventListener('click', () => {
            this.toggleFilter(filterKey, button);
        });

        this._container.appendChild(button);
    }

    toggleFilter(filterKey, button) {
        this.activeFilters[filterKey] = !this.activeFilters[filterKey];

        if (this.activeFilters[filterKey]) {
            button.classList.remove('active');
        } else {
            button.classList.add('active');
        }

        this.mapHandler.updateMarkersWithFilters(this.activeFilters);
    }

    onRemove() {
        this._container.parentNode.removeChild(this._container);
    }
}

export default function initMap(url, key) {
    url = 'https://ghproxy.net/https://raw.githubusercontent.com/rebron1900/doumark-action/master/data/geojson.json?short_path=832ba66';
    key = 'pk.eyJ1IjoiZmF0ZXNpbmdlciIsImEiOiJjanc4bXFocG8wMXM1NDNxanB0MG5sa2ZpIn0.HqA5Q8Y4Jp1s3_TQ-sqVoQ';

    const mapContainer = document.querySelector('#map');
    if (mapContainer) {
        fetch(url)
            .then((response) => response.json())
            .then((data) => {
                window.mapboxi = new MapHandler({ data, key });
            });
    }
}
