// utils/map.js

import { loadCSSOnce, loadScriptOnce } from './loader.js';
import { t } from './i18n.js';

export let map;

const v = '1.9.4';

const CDN = {
        leafletCSS: '/ha-tracker/vendor/leaflet/leaflet.css?v=' + v,
        leafletJS: '/ha-tracker/vendor/leaflet/leaflet.js?v=' + v,
        geocoderCSS: '/ha-tracker/vendor/leaflet-control-geocoder/Control.Geocoder.css?v=' + v,
        geocoderJS: '/ha-tracker/vendor/leaflet-control-geocoder/Control.Geocoder.js?v=' + v,
        editableJS: '/ha-tracker/vendor/leaflet-editable/Leaflet.Editable.min.js?v=' + v,
        mapLibreCSS: 'https://unpkg.com/maplibre-gl@3.6.1/dist/maplibre-gl.css',
        mapLibreJS: 'https://unpkg.com/maplibre-gl@3.6.1/dist/maplibre-gl.js',
        mapLibreLeafletJS: 'https://unpkg.com/maplibre-gl-leaflet@0.0.21/leaflet-maplibre-gl.js',
};

const DEFAULT_CENTER = [40.4168, -3.7038]; // Madrid
const DEFAULT_ZOOM = 6;
const DEFAULT_PITCH = 45;
const PITCH_MIN = 0;
const PITCH_MAX = 65;
const PITCH_STEP = 5;
const MAPLIBRE_ATTRIBUTION = '© OpenStreetMap contributors, OpenFreeMap.org — Terrain data © Mapzen, NASA & OpenTopo';
const HILLSHADE_ATTRIBUTION = 'Hillshade © OpenTopo, SRTM';

export const DEFAULT_3D_PITCH = DEFAULT_PITCH;

const OPENFREEMAP_3D_STYLE = Object.freeze({
        version: 8,
        name: 'OpenFreeMap 3D',
        sources: {
                openfreemap: {
                        type: 'raster',
                        tiles: [
                                'https://tile.openfreemap.org/{z}/{x}/{y}.png'
                        ],
                        minzoom: 0,
                        maxzoom: 19,
                        tileSize: 256,
                        attribution: '© OpenStreetMap contributors, OpenFreeMap.org'
                },
                terrain: {
                        type: 'raster-dem',
                        tiles: [
                                'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'
                        ],
                        tileSize: 256,
                        encoding: 'terrarium',
                        maxzoom: 14,
                        attribution: 'Terrain data © Mapzen, NASA'
                }
        },
        terrain: {
                source: 'terrain',
                exaggeration: 1.25
        },
        light: {
                anchor: 'viewport',
                position: [1.4, 90, 75],
                intensity: 0.45,
        },
        layers: [
                {
                        id: 'sky',
                        type: 'sky',
                        paint: {
                                'sky-type': 'atmosphere',
                                'sky-atmosphere-color': '#87a7ff',
                                'sky-atmosphere-halo-color': '#d7efff',
                                'sky-atmosphere-sun-intensity': 12,
                        }
                },
                {
                        id: 'openfreemap-base',
                        type: 'raster',
                        source: 'openfreemap',
                        minzoom: 0,
                        maxzoom: 19,
                        paint: {
                                'raster-brightness-min': 0.85,
                                'raster-brightness-max': 1.1,
                                'raster-saturation': 0.1
                        }
                },
                {
                        id: 'terrain-hillshade',
                        type: 'hillshade',
                        source: 'terrain',
                        paint: {
                                'hillshade-exaggeration': 0.6,
                                'hillshade-shadow-color': '#362a1f',
                                'hillshade-highlight-color': '#fff6df',
                                'hillshade-accent-color': '#768a42'
                        }
                }
        ]
});

let desiredPitch = DEFAULT_PITCH;
let pitchControl = null;
let currentMaplibreLayer = null;
let currentMaplibrePitchListener = null;

function cloneStyle(style) {
        return JSON.parse(JSON.stringify(style));
}

function createOpenFreeMap3DStyle() {
        return cloneStyle(OPENFREEMAP_3D_STYLE);
}

async function ensureLeafletLoaded() {
        await loadCSSOnce(CDN.leafletCSS);
        await loadCSSOnce(CDN.geocoderCSS);
        await loadCSSOnce(CDN.mapLibreCSS);

        await loadScriptOnce(CDN.leafletJS, { test: () => !!window.L });
        await loadScriptOnce(CDN.editableJS, { test: () => !!(window.L && L.Editable) });
        await loadScriptOnce(CDN.geocoderJS, { test: () => !!(window.L && L.Control && L.Control.Geocoder) });
        await loadScriptOnce(CDN.mapLibreJS, { test: () => !!window.maplibregl });
        await loadScriptOnce(CDN.mapLibreLeafletJS, { test: () => !!(window.L && L.maplibreGL) });
}

function createHillshadeLayer({ opacity = 0.45, pane = 'overlayPane' } = {}) {
        return L.tileLayer('https://tiles.wmflabs.org/hillshading/{z}/{x}/{y}.png', {
                maxZoom: 19,
                minZoom: 1,
                opacity,
                pane,
                crossOrigin: true,
                attribution: HILLSHADE_ATTRIBUTION
        });
}

function createMapLibreBaseLayer(styleFactory) {
        const layer = L.maplibreGL({
                style: styleFactory(),
                interactive: true,
                pitch: desiredPitch,
                bearing: 0,
                zoom: DEFAULT_ZOOM - 1,
                minZoom: 2,
                maxZoom: 19,
                attributionControl: {
                        customAttribution: MAPLIBRE_ATTRIBUTION
                },
                dragRotate: true,
                touchPitch: true,
                touchZoomRotate: true,
                pitchWithRotate: true
        });
        return layer;
}

function clampPitch(pitch) {
        return Math.max(PITCH_MIN, Math.min(PITCH_MAX, Number.isFinite(pitch) ? pitch : DEFAULT_PITCH));
}

function refreshActiveMapLibre(glMap = currentMaplibreLayer?.getMaplibreMap?.()) {
        if (glMap && typeof glMap.resize === 'function') {
                glMap.resize();
        }
}

function configureTerrain(glMap) {
        try {
                const style = glMap.getStyle();
                if (!style) {
                        return;
                }

                const terrainSource = style.terrain?.source;
                if (terrainSource) {
                        glMap.setTerrain({ source: terrainSource, exaggeration: OPENFREEMAP_3D_STYLE.terrain.exaggeration });
                        if (style.layers?.some(l => l.type === 'hillshade')) {
                                return;
                        }
                }

                if (!glMap.getSource('terrain-dem')) {
                        glMap.addSource('terrain-dem', {
                                type: 'raster-dem',
                                tiles: [
                                        'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'
                                ],
                                tileSize: 256,
                                encoding: 'terrarium',
                                maxzoom: 14
                        });
                }

                glMap.setTerrain({ source: 'terrain-dem', exaggeration: OPENFREEMAP_3D_STYLE.terrain.exaggeration });

                if (!glMap.getLayer('terrain-hillshade')) {
                        glMap.addLayer({
                                id: 'terrain-hillshade',
                                type: 'hillshade',
                                source: 'terrain-dem',
                                paint: {
                                        'hillshade-exaggeration': 0.6,
                                        'hillshade-shadow-color': '#362a1f',
                                        'hillshade-highlight-color': '#fff6df',
                                        'hillshade-accent-color': '#768a42'
                                }
                        });
                }
        } catch (err) {
                console.warn('Unable to configure terrain for MapLibre layer:', err);
        }
}

function detachCurrentMapLibre() {
        if (!currentMaplibreLayer) {
                return;
        }
        const glMap = currentMaplibreLayer.getMaplibreMap?.();
        if (glMap && currentMaplibrePitchListener) {
                glMap.off('pitch', currentMaplibrePitchListener);
        }
        currentMaplibreLayer = null;
        currentMaplibrePitchListener = null;
        updatePitchControlState();
}

function attachToMapLibreLayer(layer) {
        if (!layer || typeof layer.getMaplibreMap !== 'function') {
                detachCurrentMapLibre();
                return;
        }

        if (currentMaplibreLayer === layer) {
                const existing = layer.getMaplibreMap?.();
                if (existing) {
                        refreshActiveMapLibre(existing);
                        updatePitchControlState(existing.getPitch());
                }
                return;
        }

        detachCurrentMapLibre();
        currentMaplibreLayer = layer;

        const glMap = layer.getMaplibreMap?.();
        if (!glMap) {
                updatePitchControlState();
                return;
        }

        const syncPitchFromMap = () => {
                desiredPitch = clampPitch(glMap.getPitch());
                updatePitchControlState(desiredPitch);
        };
        currentMaplibrePitchListener = syncPitchFromMap;

        const setup = () => {
                configureTerrain(glMap);
                if (glMap.dragRotate?.enable) {
                        glMap.dragRotate.enable();
                }
                if (glMap.touchZoomRotate?.enableRotation) {
                        glMap.touchZoomRotate.enableRotation();
                }
                if (glMap.touchPitch?.enable) {
                        glMap.touchPitch.enable();
                }

                glMap.on('pitch', syncPitchFromMap);
                setMapPitch(desiredPitch, { animate: false });
                updatePitchControlState(desiredPitch);
                refreshActiveMapLibre(glMap);
        };

        if (glMap.isStyleLoaded && glMap.isStyleLoaded()) {
                setup();
        } else {
                glMap.once('load', setup);
        }
}

function updatePitchControlState(pitch = desiredPitch) {
        desiredPitch = clampPitch(pitch);
        if (pitchControl) {
                pitchControl.setPitch(desiredPitch);
                pitchControl.setEnabled(Boolean(currentMaplibreLayer));
        }
}

function createPitchControl() {
        const PitchControl = L.Control.extend({
                options: {
                        position: 'topright'
                },
                initialize() {
                        L.Control.prototype.initialize.call(this);
                        this._pitch = desiredPitch;
                        this._enabled = false;
                },
                onAdd() {
                        const container = L.DomUtil.create('div', 'leaflet-bar pitch-control');
                        this._container = container;
                        L.DomEvent.disableClickPropagation(container);
                        L.DomEvent.disableScrollPropagation(container);

                        const label = L.DomUtil.create('span', 'pitch-control__label', container);
                        this._label = label;

                        const createButton = (text, className, handler) => {
                                const btn = L.DomUtil.create('a', `pitch-control__btn ${className}`, container);
                                btn.href = '#';
                                btn.textContent = text;
                                L.DomEvent.on(btn, 'click', (ev) => {
                                        L.DomEvent.stop(ev);
                                        if (!this._enabled) {
                                                return;
                                        }
                                        handler();
                                });
                                return btn;
                        };

                        this._btnDown = createButton('−', 'pitch-control__btn--down', () => adjustMapPitch(-PITCH_STEP));
                        this._btnFlat = createButton('2D', 'pitch-control__btn--flat', () => setMapPitch(0));
                        this._btnDefault = createButton('3D', 'pitch-control__btn--default', () => setMapPitch(DEFAULT_PITCH));
                        this._btnUp = createButton('+', 'pitch-control__btn--up', () => adjustMapPitch(PITCH_STEP));

                        this._render();
                        return container;
                },
                onRemove() {
                        if (this._container) {
                                L.DomEvent.off(this._container);
                        }
                },
                setPitch(pitch) {
                        this._pitch = Math.round(clampPitch(pitch));
                        this._render();
                },
                setEnabled(enabled) {
                        this._enabled = Boolean(enabled);
                        this._render();
                },
                _render() {
                        if (this._label) {
                                this._label.textContent = `${this._pitch}°`;
                        }
                        if (this._container) {
                                this._container.classList.toggle('pitch-control--disabled', !this._enabled);
                        }
                }
        });

        return new PitchControl();
}

function adjustMapPitch(delta) {
        setMapPitch(desiredPitch + delta);
}

export async function initMap() {
        try {
                await ensureLeafletLoaded();

                const mapOptions = {
                        center: DEFAULT_CENTER,
                        zoom: DEFAULT_ZOOM,
                        editable: true,
                        preferCanvas: true,
                };

                map = L.map('map', mapOptions);

                const tileLayerOptions = {
                        maxZoom: 19,
                        minZoom: 1,
                        crossOrigin: true,
                };

                const openStreetMapLayer = () => L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                        ...tileLayerOptions,
                        attribution: '© OpenStreetMap contributors'
                });

                const esriSatelliteLayer = () => L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
                        ...tileLayerOptions,
                        attribution: '© Esri, Maxar, Earthstar Geographics'
                });

                const openFreeMap2DLayer = () => L.tileLayer('https://tile.openfreemap.org/{z}/{x}/{y}.png', {
                        ...tileLayerOptions,
                        attribution: '© OpenStreetMap contributors, OpenFreeMap.org'
                });

                const baseLayers = {
                        'OpenFreeMap 3D (Relieve)': createMapLibreBaseLayer(createOpenFreeMap3DStyle),
                        'OpenFreeMap (2D)': openFreeMap2DLayer(),
                        'OpenStreetMap': openStreetMapLayer(),
                        'OpenStreetMap + Relieve (2D)': L.layerGroup([
                                openStreetMapLayer(),
                                createHillshadeLayer({ opacity: 0.5, pane: 'overlayPane' })
                        ]),
                        'Esri Satélite': esriSatelliteLayer(),
                };

                baseLayers['OpenFreeMap 3D (Relieve)'].addTo(map);
                attachToMapLibreLayer(baseLayers['OpenFreeMap 3D (Relieve)']);

                map.attributionControl.setPosition('bottomleft');

                const overlays = {
                        'Relieve (Hillshade)': createHillshadeLayer({ opacity: 0.45 })
                };

                const layersControl = L.control.layers(baseLayers, overlays, {
                        position: 'topleft'
                });
                layersControl.addTo(map);

                map.on('baselayerchange', (event) => {
                        if (event?.layer && typeof event.layer.getMaplibreMap === 'function') {
                                attachToMapLibreLayer(event.layer);
                        } else {
                                detachCurrentMapLibre();
                        }
                        refreshActiveMapLibre();
                });

                const invalidate = () => invalidateMapSize({ hard: true });

                document.body.addEventListener(
                        'transitionend',
                        (e) => {
                                if (e.target === document.body && e.propertyName === 'opacity') {
                                        setTimeout(invalidate, 0);
                                }
                        },
                        {
                                once: true
                        }
                );

                const mapEl = document.getElementById('map');
                if (mapEl && 'ResizeObserver' in window) {
                        const ro = new ResizeObserver(() => invalidate());
                        ro.observe(mapEl);
                }

                window.addEventListener('resize', invalidate);
                document.addEventListener('visibilitychange', () => {
                        if (!document.hidden) {
                                setTimeout(invalidate, 0);
                        }
                });

                pitchControl = createPitchControl();
                pitchControl.addTo(map);
                updatePitchControlState();

                setTimeout(() => invalidateMapSize({ hard: true }), 350);

                const acceptLang = (navigator.languages && navigator.languages.length)
                        ? navigator.languages.join(',')
                        : (navigator.language || 'en');

                const geocoder = L.Control.geocoder({
                        position: 'bottomleft',
                        placeholder: t('search_place'),
                        collapsed: false,
                        defaultMarkGeocode: false,
                        geocoder: L.Control.Geocoder.nominatim({
                                geocodingQueryParams: {
                                        'accept-language': acceptLang,
                                        limit: 5
                                }
                        })
                })
                        .on('markgeocode', (e) => {
                                const { center, name, bbox } = e.geocode;
                                if (bbox) {
                                        map.fitBounds(bbox);
                                } else {
                                        focusMapOn(center.lat, center.lng, { ensure3d: true });
                                }

                                L.popup({
                                        autoClose: true,
                                        closeOnClick: true,
                                        keepInView: true
                                })
                                .setLatLng(center)
                                .setContent(name)
                                .openOn(map);
                        })
                        .addTo(map);

                function updateSearchBias() {
                        const b = map.getBounds();
                        geocoder.options.geocoder.options.geocodingQueryParams.viewbox =
                                [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()].join(',');
                        geocoder.options.geocoder.options.geocodingQueryParams.bounded = 1;
                }
                map.on('moveend', updateSearchBias);
                updateSearchBias();

        } catch (error) {
                console.error('Error starting map:', error);
        }
}

export function isValidCoordinates(lat, lng) {
        return lat != null && lng != null && !isNaN(lat) && !isNaN(lng);
}

export function setMapPitch(pitch, { animate = true } = {}) {
        desiredPitch = clampPitch(pitch);
        const glMap = currentMaplibreLayer?.getMaplibreMap?.();
        if (!glMap) {
                updatePitchControlState(desiredPitch);
                return false;
        }

        if (animate && typeof glMap.easeTo === 'function') {
                glMap.easeTo({ pitch: desiredPitch, duration: 450 });
        } else if (typeof glMap.setPitch === 'function') {
                glMap.setPitch(desiredPitch);
        }

        updatePitchControlState(desiredPitch);
        return true;
}

export function adjustToDefault3DPitch({ animate = true } = {}) {
        if (isMapLibreBaseActive()) {
                setMapPitch(DEFAULT_PITCH, { animate });
        }
}

export function getMapPitch() {
        return desiredPitch;
}

export function isMapLibreBaseActive() {
        return Boolean(currentMaplibreLayer);
}

export function invalidateMapSize({ hard = false } = {}) {
        if (!map) {
                return;
        }
        map.invalidateSize(hard);
        refreshActiveMapLibre();
}

export function focusMapOn(lat, lng, { zoom = map?.getZoom(), ensure3d = true, animatePitch = true } = {}) {
        if (!map || !isValidCoordinates(lat, lng)) {
                return;
        }
        map.setView([lat, lng], zoom);
        if (ensure3d) {
                adjustToDefault3DPitch({ animate: animatePitch });
        }
}

export function getDistanceFromLatLonInMeters(lat1, lon1, lat2, lon2) {
        const R = 6371000;
        const dLat = degToRad(lat2 - lat1);
        const dLon = degToRad(lon2 - lon1);
        const a =
                Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                Math.cos(degToRad(lat1)) * Math.cos(degToRad(lat2)) *
                Math.sin(dLon / 2) * Math.sin(dLon / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c;
}

function degToRad(deg) {
        return deg * (Math.PI / 180);
}
