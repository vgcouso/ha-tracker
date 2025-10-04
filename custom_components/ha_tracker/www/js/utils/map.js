// utils/map.js

import { loadCSSOnce, loadScriptOnce } from './loader.js';
import { t } from './i18n.js';

// -----------------------------------------------------------------------------
// External libraries
// -----------------------------------------------------------------------------

const MAPLIBRE_VERSION = '3.5.2';
const GEOCODER_ENDPOINT = 'https://nominatim.openstreetmap.org/search';

const LOCAL_LIB_PATH = '/ha-tracker/vendor/maplibre';

const RESOURCES = {
    mapLibreCSS: `${LOCAL_LIB_PATH}/maplibre-gl.css?v=${MAPLIBRE_VERSION}`,
    mapLibreJS: `${LOCAL_LIB_PATH}/maplibre-gl.js?v=${MAPLIBRE_VERSION}`,
};

const TERRAIN_SOURCE_URL = 'https://demotiles.maplibre.org/terrain/source.json';

async function ensureMapLibreLoaded() {
    await loadCSSOnce(RESOURCES.mapLibreCSS, { matchPrefix: false });
    await loadScriptOnce(RESOURCES.mapLibreJS, {
        matchPrefix: false,
        test: () => typeof window.maplibregl !== 'undefined',
    });
}

// -----------------------------------------------------------------------------
// Internal helpers
// -----------------------------------------------------------------------------

let mapInstance = null;
let activePopup = null;

const panes = new Map();
const overlayRegistry = new Set();

const BASE_STYLE_KEYS = {
    openfreemap: 'openfreemap',
    osm: 'osm',
    esri: 'esri',
};

function createRasterStyle({ id, tiles, tileSize = 256, attribution, maxZoom = 19, useTerrain = false }) {
    return {
        version: 8,
        name: id,
        pitch: 0,
        sources: {
            base: {
                type: 'raster',
                tiles,
                tileSize,
                maxzoom: maxZoom,
                attribution,
            },
            ...(useTerrain
                ? {
                    terrain: {
                        type: 'raster-dem',
                        url: TERRAIN_SOURCE_URL,
                        tileSize: 512,
                    },
                }
                : {}),
        },
        layers: [
            {
                id: 'background',
                type: 'background',
                paint: {
                    'background-color': '#dde6f4',
                },
            },
            {
                id: 'base-layer',
                type: 'raster',
                source: 'base',
            },
            ...(useTerrain
                ? [
                    {
                        id: 'hillshade-layer',
                        type: 'hillshade',
                        source: 'terrain',
                        paint: {
                            'hillshade-illumination-direction': 315,
                            'hillshade-highlight-color': '#ffffff',
                            'hillshade-shadow-color': '#44516c',
                            'hillshade-exaggeration': 0.4,
                        },
                    },
                ]
                : []),
        ],
        terrain: useTerrain
            ? {
                source: 'terrain',
                exaggeration: 1.2,
            }
            : undefined,
        glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
    };
}

const BASE_STYLES = {
    [BASE_STYLE_KEYS.openfreemap]: {
        key: BASE_STYLE_KEYS.openfreemap,
        label: 'OpenFreemap 3D',
        style: 'https://tile.openfreemap.org/styles/liberty',
        supportsTerrain: true,
    },
    [BASE_STYLE_KEYS.osm]: {
        key: BASE_STYLE_KEYS.osm,
        label: 'OpenStreetMap',
        style: createRasterStyle({
            id: 'osm',
            tiles: [
                'https://a.tile.openstreetmap.org/{z}/{x}/{y}.png',
                'https://b.tile.openstreetmap.org/{z}/{x}/{y}.png',
                'https://c.tile.openstreetmap.org/{z}/{x}/{y}.png',
            ],
            attribution: '© OpenStreetMap contributors',
            useTerrain: true,
        }),
        supportsTerrain: true,
    },
    [BASE_STYLE_KEYS.esri]: {
        key: BASE_STYLE_KEYS.esri,
        label: 'Esri Satélite',
        style: createRasterStyle({
            id: 'esri',
            tiles: [
                'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
            ],
            attribution: '© Esri, Maxar, Earthstar Geographics',
            maxZoom: 19,
            useTerrain: true,
        }),
        supportsTerrain: true,
    },
};

let currentBaseKey = BASE_STYLE_KEYS.osm;
const baseLayerRadios = new Map();

function ensurePane(name) {
    if (!panes.has(name)) {
        panes.set(name, {
            style: {},
        });
    }
    return panes.get(name);
}

function getPaneStyle(name) {
    return panes.get(name)?.style ?? null;
}

function lngLatFromLatLng([lat, lng]) {
    return [lng, lat];
}

function latLngFromLngLat(lngLat) {
    if (!lngLat)
        return { lat: 0, lng: 0 };
    if (Array.isArray(lngLat)) {
        const lat = Number(lngLat[1]);
        const lng = Number(lngLat[0]);
        return {
            lat: Number.isFinite(lat) ? lat : 0,
            lng: Number.isFinite(lng) ? lng : 0,
        };
    }
    const lat = Number(lngLat.lat);
    const lng = Number(lngLat.lng);
    return {
        lat: Number.isFinite(lat) ? lat : 0,
        lng: Number.isFinite(lng) ? lng : 0,
    };
}

function clampPitch(value) {
    return Math.max(0, Math.min(60, value));
}

function createCirclePolygon([lat, lng], radiusMeters, steps = 64) {
    const latNum = Number(lat);
    const lngNum = Number(lng);
    const radius = Number(radiusMeters);
    if (!Number.isFinite(latNum) || !Number.isFinite(lngNum) || !Number.isFinite(radius))
        return {
            type: 'Feature',
            geometry: {
                type: 'Polygon',
                coordinates: [],
            },
            properties: {},
        };

    const coordinates = [];
    const earthRadius = 6378137;
    const angularDistance = radius / earthRadius;
    const latRad = latNum * Math.PI / 180;
    const lngRad = lngNum * Math.PI / 180;

    for (let step = 0; step <= steps; step++) {
        const bearing = (step / steps) * 2 * Math.PI;
        const sinLat = Math.sin(latRad);
        const cosLat = Math.cos(latRad);
        const sinAng = Math.sin(angularDistance);
        const cosAng = Math.cos(angularDistance);

        const lat2 = Math.asin(
            sinLat * cosAng + cosLat * sinAng * Math.cos(bearing)
        );
        const lng2 = lngRad + Math.atan2(
            Math.sin(bearing) * sinAng * cosLat,
            cosAng - sinLat * Math.sin(lat2)
        );

        coordinates.push([
            (lng2 * 180) / Math.PI,
            (lat2 * 180) / Math.PI,
        ]);
    }

    return {
        type: 'Feature',
        geometry: {
            type: 'Polygon',
            coordinates: [coordinates],
        },
        properties: {},
    };
}

function registerOverlay(overlay) {
    overlayRegistry.add(overlay);
}

function unregisterOverlay(overlay) {
    overlayRegistry.delete(overlay);
}

function rebuildVectorOverlays() {
    overlayRegistry.forEach((overlay) => {
        try {
            overlay.rebuild();
        } catch (err) {
            console.error('Error rebuilding overlay', err);
        }
    });
}

function setActivePopup(popup) {
    if (activePopup && activePopup !== popup) {
        try {
            activePopup.remove();
        } catch (err) {
            console.error('Error closing previous popup', err);
        }
    }
    activePopup = popup;
}

// -----------------------------------------------------------------------------
// Map facade (Leaflet compatible API)
// -----------------------------------------------------------------------------

class MapFacade {
    setInstance(instance) {
        mapInstance = instance;
    }

    get instance() {
        return mapInstance;
    }

    setView([lat, lng], zoom, options = {}) {
        if (!mapInstance)
            return;
        const latNum = Number(lat);
        const lngNum = Number(lng);
        if (!Number.isFinite(latNum) || !Number.isFinite(lngNum))
            return;
        mapInstance.easeTo({
            center: [lngNum, latNum],
            zoom: zoom ?? mapInstance.getZoom(),
            duration: options.animate === false ? 0 : 500,
        });
    }

    getZoom() {
        return mapInstance?.getZoom?.() ?? 0;
    }

    fitBounds(bounds, options = {}) {
        if (!mapInstance || !bounds)
            return;
        const rawPadding = options.padding ?? 40;
        const padding = Array.isArray(rawPadding)
            ? { top: rawPadding[1] ?? rawPadding[0], bottom: rawPadding[1] ?? rawPadding[0], left: rawPadding[0], right: rawPadding[0] }
            : rawPadding;
        mapInstance.fitBounds(bounds, {
            padding,
            duration: options.animate === false ? 0 : 500,
        });
    }

    fitWorld() {
        this.fitBounds([
            [-180, -85],
            [180, 85],
        ], { animate: false });
    }

    invalidateSize() {
        mapInstance?.resize?.();
    }

    closePopup() {
        if (activePopup) {
            try {
                activePopup.remove();
            } catch (err) {
                console.error('Error closing popup', err);
            }
            activePopup = null;
        }
    }

    on(evt, handler) {
        mapInstance?.on?.(evt, handler);
    }

    off(evt, handler) {
        mapInstance?.off?.(evt, handler);
    }

    addControl(control, position) {
        mapInstance?.addControl?.(control, position);
    }

    createPane(name) {
        return ensurePane(name);
    }

    getPane(name) {
        return panes.get(name) ?? null;
    }

    removeLayer(layer) {
        if (!layer)
            return;
        try {
            layer.remove();
        } catch (err) {
            console.error('Error removing layer', err);
        }
    }
}

export const map = new MapFacade();

// -----------------------------------------------------------------------------
// Overlay adapters
// -----------------------------------------------------------------------------

let markerIdCounter = 0;

class MarkerAdapter {
    constructor([lat, lng], options = {}) {
        this.id = `marker-${++markerIdCounter}`;
        this.options = options;
        this.pane = options.pane ?? null;
        this.element = document.createElement('div');
        this.element.className = options.className || 'map-marker';
        this.element.style.pointerEvents = 'auto';
        this.element.style.cursor = options.cursor || 'pointer';
        if (this.pane) {
            const paneStyle = getPaneStyle(this.pane);
            if (paneStyle?.pointerEvents)
                this.element.style.pointerEvents = paneStyle.pointerEvents;
            if (paneStyle?.zIndex)
                this.element.style.zIndex = paneStyle.zIndex;
        }
        this.marker = new maplibregl.Marker({
            element: this.element,
            anchor: 'center',
        });
        this.setLatLng([lat, lng]);
        if (options.icon)
            this.setIcon(options.icon);
        this.popup = null;
        this.visible = true;
    }

    addTo() {
        if (map.instance)
            this.marker.addTo(map.instance);
        return this;
    }

    remove() {
        try {
            this.marker.remove();
        } catch {}
        if (this.popup)
            this.popup.remove();
    }

    setLatLng([lat, lng]) {
        const latNum = Number(lat);
        const lngNum = Number(lng);
        if (!Number.isFinite(latNum) || !Number.isFinite(lngNum))
            return this;
        this.marker.setLngLat([lngNum, latNum]);
        return this;
    }

    getLatLng() {
        return latLngFromLngLat(this.marker.getLngLat());
    }

    setIcon(icon) {
        this.icon = icon;
        if (icon?.className != null)
            this.element.className = icon.className;
        if (icon?.html != null)
            this.element.innerHTML = icon.html;
        if (Array.isArray(icon?.iconSize)) {
            const [w, h] = icon.iconSize.map((value) => Number(value) || 0);
            this._iconSize = [w, h];
            this.element.style.width = `${w}px`;
            this.element.style.height = `${h}px`;
        } else {
            this._iconSize = null;
            this.element.style.removeProperty('width');
            this.element.style.removeProperty('height');
        }
        if (Array.isArray(icon?.iconAnchor)) {
            const [axRaw, ayRaw] = icon.iconAnchor;
            const ax = Number(axRaw) || 0;
            const ay = Number(ayRaw) || 0;
            const [w, h] = this._iconSize ?? [0, 0];
            const offsetX = (w / 2) - ax;
            const offsetY = (h / 2) - ay;
            this.marker.setOffset([offsetX, offsetY]);
        } else {
            this.marker.setOffset([0, 0]);
        }
        return this;
    }

    setZIndexOffset(offset) {
        this.element.style.zIndex = String(offset);
        return this;
    }

    setVisible(flag) {
        this.visible = !!flag;
        this.element.style.display = this.visible ? '' : 'none';
        return this;
    }

    isVisible() {
        return this.visible;
    }

    bindPopup(content, options = {}) {
        if (!this.popup)
            this.popup = new PopupAdapter(options);
        else if (options)
            this.popup.updateOptions(options);
        this.popup.setContent(content);
        if (Array.isArray(this.icon?.popupAnchor)) {
            const [pxRaw, pyRaw] = this.icon.popupAnchor;
            const px = Number(pxRaw) || 0;
            const py = Number(pyRaw) || 0;
            const [w, h] = this._iconSize ?? [0, 0];
            const offsetX = (w / 2) - px;
            const offsetY = (h / 2) - py;
            this.popup.setOffset([offsetX, offsetY]);
        }
        this.marker.setPopup(this.popup.popup);
        return this;
    }

    getPopup() {
        return this.popup ?? null;
    }

    openPopup() {
        if (!this.popup)
            return;
        this.popup.setLatLngFromMarker(this.marker);
        this.popup.addTo(map.instance);
        setActivePopup(this.popup);
    }

    on(event, handler) {
        this.element.addEventListener(event, handler);
        return this;
    }
}

let popupIdCounter = 0;

class PopupAdapter {
    constructor(options = {}) {
        this.id = `popup-${++popupIdCounter}`;
        this.options = options;
        this.popup = new maplibregl.Popup({
            closeOnClick: options.closeOnClick !== false,
            closeButton: options.closeButton !== false,
            maxWidth: options.maxWidth ?? '320px',
            offset: options.offset ?? 0,
        });
        this.content = '';
        this.popup.on('close', () => {
            if (activePopup === this)
                activePopup = null;
        });
    }

    updateOptions(options = {}) {
        this.options = { ...this.options, ...options };
        if (Object.prototype.hasOwnProperty.call(options, 'maxWidth'))
            this.popup.setMaxWidth(String(options.maxWidth));
        if (Object.prototype.hasOwnProperty.call(options, 'offset'))
            this.setOffset(options.offset);
        if (Object.prototype.hasOwnProperty.call(options, 'closeOnClick'))
            this.popup.options.closeOnClick = options.closeOnClick !== false;
        if (Object.prototype.hasOwnProperty.call(options, 'closeButton'))
            this.popup.options.closeButton = options.closeButton !== false;
    }

    setContent(content) {
        this.content = content;
        if (typeof content === 'string')
            this.popup.setHTML(content);
        else if (content instanceof HTMLElement)
            this.popup.setDOMContent(content);
        return this;
    }

    getContent() {
        return this.content;
    }

    setOffset(offset) {
        if (offset == null)
            return this;
        let normalized = offset;
        if (Array.isArray(offset)) {
            const [xRaw, yRaw] = offset;
            const x = Number(xRaw) || 0;
            const y = Number(yRaw) || 0;
            normalized = [x, y];
        }
        this.popup.setOffset(normalized);
        return this;
    }

    setLatLng([lat, lng]) {
        const latNum = Number(lat);
        const lngNum = Number(lng);
        if (!Number.isFinite(latNum) || !Number.isFinite(lngNum))
            return this;
        this.popup.setLngLat([lngNum, latNum]);
        return this;
    }

    setLatLngFromMarker(marker) {
        const lngLat = marker.getLngLat();
        this.popup.setLngLat(lngLat);
    }

    addTo(instance) {
        if (!instance)
            return this;
        setActivePopup(this);
        this.popup.addTo(instance);
        return this;
    }

    openOn(target) {
        if (target?.instance)
            this.addTo(target.instance);
        else if (target)
            this.addTo(target);
        else
            this.addTo(map.instance);
        return this;
    }

    remove() {
        try {
            this.popup.remove();
        } catch {}
        if (activePopup === this)
            activePopup = null;
    }
}

let circleIdCounter = 0;

class CircleAdapter {
    constructor([lat, lng], options = {}) {
        this.id = `circle-${++circleIdCounter}`;
        const latNum = Number(lat);
        const lngNum = Number(lng);
        this.center = {
            lat: Number.isFinite(latNum) ? latNum : 0,
            lng: Number.isFinite(lngNum) ? lngNum : 0,
        };
        this.radius = Number.isFinite(Number(options.radius)) ? Number(options.radius) : 100;
        this.color = options.color ?? '#3388ff';
        this.fillColor = options.fillColor ?? 'rgba(51,136,255,0.2)';
        this.fillOpacity = options.fillOpacity ?? 0.5;
        this.opacity = options.opacity ?? 1;
        this.pane = options.pane ?? null;
        this.map = null;
        this.popup = null;
        this.popupWasOpen = false;
        this.events = new Map();
        this._activeBindings = [];
        this.options = {
            color: this.color,
            fillColor: this.fillColor,
            fillOpacity: this.fillOpacity,
        };
        registerOverlay(this);
    }

    addTo() {
        this.map = map.instance;
        this.rebuild();
        return this;
    }

    rebuild() {
        if (!map.instance)
            return;
        if (!map.instance.isStyleLoaded()) {
            map.instance.once('styledata', () => this.rebuild());
            return;
        }
        this.removeLayers();

        const feature = createCirclePolygon([this.center.lat, this.center.lng], this.radius);
        if (!feature?.geometry?.coordinates?.length)
            return;
        this.sourceId = `${this.id}-source`;
        this.fillLayerId = `${this.id}-fill`;
        this.strokeLayerId = `${this.id}-stroke`;

        if (map.instance.getSource(this.sourceId))
            map.instance.removeSource(this.sourceId);

        map.instance.addSource(this.sourceId, {
            type: 'geojson',
            data: feature,
        });

        map.instance.addLayer({
            id: this.fillLayerId,
            type: 'fill',
            source: this.sourceId,
            paint: {
                'fill-color': this.fillColor,
                'fill-opacity': this.fillOpacity,
            },
        });

        map.instance.addLayer({
            id: this.strokeLayerId,
            type: 'line',
            source: this.sourceId,
            paint: {
                'line-color': this.color,
                'line-width': 2,
                'line-opacity': this.opacity,
            },
        });

        if (this.popup && this.popupWasOpen)
            this.openPopup();

        this._bindEvents();
    }

    removeLayers() {
        if (!map.instance)
            return;
        this._unbindEvents();
        if (this.strokeLayerId && map.instance.getLayer(this.strokeLayerId))
            map.instance.removeLayer(this.strokeLayerId);
        if (this.fillLayerId && map.instance.getLayer(this.fillLayerId))
            map.instance.removeLayer(this.fillLayerId);
        if (this.sourceId && map.instance.getSource(this.sourceId))
            map.instance.removeSource(this.sourceId);
    }

    remove() {
        this.removeLayers();
        unregisterOverlay(this);
        if (this.popup)
            this.popup.remove();
        this.popupWasOpen = false;
        this.events.clear();
    }

    getLatLng() {
        return { ...this.center };
    }

    getRadius() {
        return this.radius;
    }

    setStyle({ color, fillColor, fillOpacity }) {
        if (color)
            this.color = color;
        if (fillColor)
            this.fillColor = fillColor;
        if (typeof fillOpacity === 'number')
            this.fillOpacity = fillOpacity;
        this.options.color = this.color;
        this.options.fillColor = this.fillColor;
        this.options.fillOpacity = this.fillOpacity;
        if (map.instance) {
            if (this.strokeLayerId && map.instance.getLayer(this.strokeLayerId))
                map.instance.setPaintProperty(this.strokeLayerId, 'line-color', this.color);
            if (this.fillLayerId && map.instance.getLayer(this.fillLayerId))
                map.instance.setPaintProperty(this.fillLayerId, 'fill-color', this.fillColor);
            if (this.fillLayerId && map.instance.getLayer(this.fillLayerId))
                map.instance.setPaintProperty(this.fillLayerId, 'fill-opacity', this.fillOpacity);
        }
    }

    bindPopup(content, options = {}) {
        if (!this.popup)
            this.popup = new PopupAdapter(options);
        this.popup.setContent(content);
        if (!this._popupCloseHandlerAttached && this.popup?.popup) {
            this.popup.popup.on('close', () => {
                this.popupWasOpen = false;
            });
            this._popupCloseHandlerAttached = true;
        }
        return this;
    }

    getPopup() {
        return this.popup ?? null;
    }

    setPopupContent(content) {
        if (!this.popup)
            this.bindPopup(content);
        else
            this.popup.setContent(content);
    }

    isPopupOpen() {
        return !!this.popupWasOpen;
    }

    openPopup() {
        if (!this.popup)
            return;
        this.popup.setLatLng([this.center.lat, this.center.lng]);
        this.popup.openOn(map);
        this.popupWasOpen = true;
    }

    getBounds() {
        const earthRadius = 6378137;
        const latRad = this.center.lat * Math.PI / 180;
        const angularDistance = this.radius / earthRadius;
        const latDelta = (angularDistance * 180) / Math.PI;
        const lngDelta = (angularDistance * 180) / Math.PI / Math.max(Math.cos(latRad), 1e-6);

        const south = this.center.lat - latDelta;
        const north = this.center.lat + latDelta;
        const west = this.center.lng - lngDelta;
        const east = this.center.lng + lngDelta;

        return [
            [west, south],
            [east, north],
        ];
    }

    on(event, handler) {
        if (typeof handler !== 'function')
            return this;
        if (event !== 'click')
            return this;
        if (!this.events.has(event))
            this.events.set(event, new Set());
        this.events.get(event).add(handler);
        this._bindEvents();
        return this;
    }

    _bindEvents() {
        if (!map.instance)
            return;
        this._unbindEvents();
        if (!this.fillLayerId || !this.strokeLayerId)
            return;

        const clickHandlers = this.events.get('click');
        if (clickHandlers && clickHandlers.size) {
            clickHandlers.forEach((fn) => {
                const wrapper = () => fn();
                map.instance.on('click', this.fillLayerId, wrapper);
                map.instance.on('click', this.strokeLayerId, wrapper);
                this._activeBindings.push({ event: 'click', layerId: this.fillLayerId, wrapper });
                this._activeBindings.push({ event: 'click', layerId: this.strokeLayerId, wrapper });
            });
        }
    }

    _unbindEvents() {
        if (!map.instance || !this._activeBindings.length)
            return;
        this._activeBindings.forEach(({ event, layerId, wrapper }) => {
            try {
                map.instance.off(event, layerId, wrapper);
            } catch {}
        });
        this._activeBindings = [];
    }
}

let polylineIdCounter = 0;

class PolylineAdapter {
    constructor(coords, options = {}) {
        this.id = `polyline-${++polylineIdCounter}`;
        this.coords = Array.isArray(coords) ? coords : [];
        this.color = options.color ?? '#3388ff';
        this.weight = options.weight ?? 4;
        this.opacity = options.opacity ?? 1;
        this.lineCap = options.lineCap ?? 'round';
        this.lineJoin = options.lineJoin ?? 'round';
        this.pane = options.pane ?? null;
        registerOverlay(this);
    }

    addTo() {
        this.rebuild();
        return this;
    }

    rebuild() {
        if (!map.instance)
            return;

        if (!map.instance.isStyleLoaded()) {
            map.instance.once('styledata', () => this.rebuild());
            return;
        }

        this.removeLayers();
        this.sourceId = `${this.id}-source`;
        this.layerId = `${this.id}-layer`;

        const coordinates = this.coords
            .map(([lat, lng]) => [Number(lng), Number(lat)])
            .filter(([lng, lat]) => Number.isFinite(lat) && Number.isFinite(lng));

        if (!coordinates.length)
            return;

        const feature = {
            type: 'Feature',
            geometry: {
                type: 'LineString',
                coordinates,
            },
            properties: {},
        };

        map.instance.addSource(this.sourceId, {
            type: 'geojson',
            data: feature,
        });

        map.instance.addLayer({
            id: this.layerId,
            type: 'line',
            source: this.sourceId,
            layout: {
                'line-cap': this.lineCap,
                'line-join': this.lineJoin,
            },
            paint: {
                'line-color': this.color,
                'line-width': this.weight,
                'line-opacity': this.opacity,
            },
        });
    }

    removeLayers() {
        if (!map.instance)
            return;
        if (this.layerId && map.instance.getLayer(this.layerId))
            map.instance.removeLayer(this.layerId);
        if (this.sourceId && map.instance.getSource(this.sourceId))
            map.instance.removeSource(this.sourceId);
    }

    remove() {
        this.removeLayers();
        unregisterOverlay(this);
    }
}

// -----------------------------------------------------------------------------
// Base layer control
// -----------------------------------------------------------------------------

function updateBaseLayerSelection(selectedKey) {
    baseLayerRadios.forEach((input, key) => {
        input.checked = key === selectedKey;
    });
}

function cloneStyleDefinition(definition) {
    return typeof definition === 'string' ? definition : JSON.parse(JSON.stringify(definition));
}

function applyBaseStyle(styleKey, { updateSelection = true } = {}) {
    if (!map.instance)
        return;
    const style = BASE_STYLES[styleKey];
    if (!style)
        return;
    currentBaseKey = styleKey;
    map.instance.setStyle(cloneStyleDefinition(style.style));
    if (updateSelection)
        updateBaseLayerSelection(styleKey);
}

function createBaseLayerControl() {
    const container = document.createElement('div');
    container.className = 'maplibre-control maplibre-ctrl maplibre-ctrl-group base-layer-control';

    const form = document.createElement('div');
    form.className = 'base-layer-options';
    container.appendChild(form);

    Object.values(BASE_STYLES).forEach((style) => {
        const label = document.createElement('label');
        label.className = 'base-layer-option';

        const input = document.createElement('input');
        input.type = 'radio';
        input.name = 'base-layer';
        input.value = style.key;
        input.checked = style.key === currentBaseKey;
        baseLayerRadios.set(style.key, input);

        input.addEventListener('change', () => {
            if (!input.checked)
                return;
            applyBaseStyle(style.key, { updateSelection: false });
        });

        const span = document.createElement('span');
        span.textContent = style.label;

        label.appendChild(input);
        label.appendChild(span);
        form.appendChild(label);
    });

    return {
        onAdd: () => container,
        onRemove: () => {
            baseLayerRadios.clear();
            container.remove();
        },
    };
}

// -----------------------------------------------------------------------------
// Pitch control
// -----------------------------------------------------------------------------

let currentPitch = 0;

function createPitchControl() {
    const container = document.createElement('div');
    container.className = 'maplibre-control maplibre-ctrl maplibre-ctrl-group pitch-control';

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'pitch-toggle';
    button.title = t('toggle_3d_view') || '3D';
    button.textContent = '3D';

    const updateState = () => {
        button.classList.toggle('active', currentPitch > 0.1);
    };

    const syncPitchFromMap = () => {
        if (!map.instance)
            return;
        currentPitch = clampPitch(map.instance.getPitch?.() ?? currentPitch);
        updateState();
    };

    button.addEventListener('click', () => {
        currentPitch = currentPitch > 0 ? 0 : 55;
        if (map.instance)
            map.instance.easeTo({ pitch: currentPitch, duration: 500 });
        updateState();
    });

    updateState();
    container.appendChild(button);

    return {
        onAdd: () => {
            if (map.instance) {
                map.instance.on('pitchend', syncPitchFromMap);
                map.instance.on('load', syncPitchFromMap);
            }
            return container;
        },
        onRemove: () => {
            if (map.instance) {
                map.instance.off('pitchend', syncPitchFromMap);
                map.instance.off('load', syncPitchFromMap);
            }
            container.remove();
        },
    };
}

// -----------------------------------------------------------------------------
// Geocoder control
// -----------------------------------------------------------------------------

function createGeocoderControl() {
    const container = document.createElement('div');
    container.className = 'maplibre-control maplibre-ctrl maplibre-ctrl-group geocoder-control';

    const form = document.createElement('form');
    form.autocomplete = 'off';
    container.appendChild(form);

    const input = document.createElement('input');
    input.type = 'search';
    input.placeholder = t('search_place') || 'Search';
    input.setAttribute('aria-label', input.placeholder);
    form.appendChild(input);

    const submit = document.createElement('button');
    submit.type = 'submit';
    submit.className = 'geocoder-submit';
    submit.title = input.placeholder;
    submit.textContent = '🔍';
    form.appendChild(submit);

    const results = document.createElement('div');
    results.className = 'geocoder-results';
    container.appendChild(results);

    let abortController = null;

    function clearResults() {
        results.innerHTML = '';
    }

    async function search(q) {
        clearResults();
        if (!q || q.trim().length < 3)
            return;

        if (abortController)
            abortController.abort();
        abortController = new AbortController();

        const params = new URLSearchParams({
            q,
            format: 'json',
            addressdetails: '1',
            limit: '6',
        });

        try {
            const response = await fetch(`${GEOCODER_ENDPOINT}?${params.toString()}`, {
                headers: {
                    'Accept-Language': (navigator.languages || []).join(',') || navigator.language || 'en',
                },
                signal: abortController.signal,
            });
            if (!response.ok)
                throw new Error(`HTTP ${response.status}`);
            const data = await response.json();
            renderResults(data || []);
        } catch (err) {
            if (err.name === 'AbortError')
                return;
            console.error('Geocoder error', err);
        }
    }

    function renderResults(items) {
        clearResults();
        if (!Array.isArray(items) || !items.length)
            return;

        const list = document.createElement('ul');
        list.className = 'geocoder-result-list';

        items.forEach((item) => {
            const li = document.createElement('li');
            const button = document.createElement('button');
            button.type = 'button';
            button.textContent = item.display_name || `${item.lat}, ${item.lon}`;
            button.addEventListener('click', () => {
                const lat = Number(item.lat);
                const lon = Number(item.lon);
                if (Number.isFinite(lat) && Number.isFinite(lon)) {
                    map.setView([lat, lon], Math.max(map.getZoom(), 16));
                    currentPitch = Math.max(currentPitch, 30);
                    map.instance?.easeTo({ pitch: currentPitch, duration: 500 });
                    setTimeout(() => {
                        const popup = new PopupAdapter();
                        popup
                            .setContent(item.display_name || '')
                            .setLatLng([lat, lon])
                            .openOn(map);
                    }, 350);
                }
                clearResults();
            });
            li.appendChild(button);
            list.appendChild(li);
        });

        results.appendChild(list);
    }

    form.addEventListener('submit', (event) => {
        event.preventDefault();
        search(input.value);
    });

    input.addEventListener('input', () => {
        const value = input.value.trim();
        if (!value)
            clearResults();
    });

    document.addEventListener('click', (event) => {
        if (!container.contains(event.target))
            clearResults();
    });

    return {
        onAdd: () => container,
        onRemove: () => container.remove(),
    };
}

// -----------------------------------------------------------------------------
// Map initialisation
// -----------------------------------------------------------------------------

export async function initMap() {
    try {
        await ensureMapLibreLoaded();

        const defaultCenter = [-3.7038, 40.4168];

        mapInstance = new maplibregl.Map({
            container: 'map',
            style: cloneStyleDefinition(BASE_STYLES[currentBaseKey].style),
            center: defaultCenter,
            zoom: 6,
            pitch: 0,
            bearing: 0,
            antialias: true,
            attributionControl: false,
        });

        map.setInstance(mapInstance);

        mapInstance.on('error', (event) => {
            const error = event?.error ?? event ?? {};
            const sourceId = error?.sourceId ?? event?.sourceId ?? event?.source?.id ?? '';
            if (sourceId === 'terrain') {
                console.warn('Terrain tiles failed to load, disabling relief layers', error);
                try {
                    if (mapInstance.getLayer('hillshade-layer'))
                        mapInstance.removeLayer('hillshade-layer');
                } catch (err) {
                    console.debug('Unable to remove hillshade layer', err);
                }
                try {
                    if (mapInstance.getSource('terrain'))
                        mapInstance.removeSource('terrain');
                } catch (err) {
                    console.debug('Unable to remove terrain source', err);
                }
                try {
                    mapInstance.setTerrain(null);
                } catch (err) {
                    console.debug('Unable to reset terrain configuration', err);
                }
                return;
            }
            if (currentBaseKey === BASE_STYLE_KEYS.osm)
                return;
            const status = error?.status ?? error?.statusCode ?? error?.cause?.status ?? null;
            const isStyleResource = error?.resourceType === 'style' || sourceId === 'base';
            const failedRequest = typeof error?.message === 'string' &&
                /Failed to fetch|HTTP/.test(error.message);
            if (!isStyleResource && !failedRequest && ![401, 403, 404].includes(status))
                return;
            console.warn('Falling back to OpenStreetMap base layer after style load error', error);
            applyBaseStyle(BASE_STYLE_KEYS.osm);
        });

        mapInstance.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
        mapInstance.addControl(new maplibregl.ScaleControl({ maxWidth: 200, unit: 'metric' }), 'bottom-left');
        mapInstance.addControl(createBaseLayerControl(), 'top-left');
        mapInstance.addControl(createPitchControl(), 'top-right');
        mapInstance.addControl(createGeocoderControl(), 'bottom-left');

        const attribution = new maplibregl.AttributionControl({ compact: true });
        mapInstance.addControl(attribution, 'bottom-left');

        mapInstance.on('styledata', () => {
            rebuildVectorOverlays();
            if (currentPitch > 0)
                mapInstance.setPitch(clampPitch(currentPitch));
        });

        mapInstance.on('load', () => {
            mapInstance.resize();
        });

        window.addEventListener('resize', () => map.invalidateSize());

    } catch (error) {
        console.error('Error starting map:', error);
        throw error;
    }
}

// -----------------------------------------------------------------------------
// Public helpers
// -----------------------------------------------------------------------------

export function isValidCoordinates(lat, lng) {
    return lat != null && lng != null && !Number.isNaN(lat) && !Number.isNaN(lng);
}

export function getDistanceFromLatLonInMeters(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const dLat = degToRad(lat2 - lat1);
    const dLon = degToRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 +
        Math.cos(degToRad(lat1)) * Math.cos(degToRad(lat2)) *
        Math.sin(dLon / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

function degToRad(deg) {
    return deg * (Math.PI / 180);
}

export function createDivIcon(options = {}) {
    return {
        className: options.className ?? '',
        html: options.html ?? '',
        iconSize: options.iconSize ?? null,
        iconAnchor: options.iconAnchor ?? null,
        popupAnchor: options.popupAnchor ?? null,
    };
}

export function createMarker(latlng, options = {}) {
    const marker = new MarkerAdapter(latlng, options);
    return marker.addTo(map.instance);
}

export function createCircle(latlng, options = {}) {
    const circle = new CircleAdapter(latlng, options);
    return circle.addTo(map.instance);
}

export function createPolyline(latlngs, options = {}) {
    const polyline = new PolylineAdapter(latlngs, options);
    return polyline.addTo(map.instance);
}

export function createPopup(options = {}) {
    return new PopupAdapter(options);
}

export function latLngBounds(latlngs) {
    const points = (latlngs || [])
        .map(([lat, lng]) => ({ lat: Number(lat), lng: Number(lng) }))
        .filter((pt) => Number.isFinite(pt.lat) && Number.isFinite(pt.lng));
    if (!points.length)
        return null;
    let minLat = Infinity, minLng = Infinity, maxLat = -Infinity, maxLng = -Infinity;
    points.forEach(({ lat, lng }) => {
        minLat = Math.min(minLat, lat);
        minLng = Math.min(minLng, lng);
        maxLat = Math.max(maxLat, lat);
        maxLng = Math.max(maxLng, lng);
    });
    return [
        [minLng, minLat],
        [maxLng, maxLat],
    ];
}

export function removeOverlay(overlay) {
    if (!overlay)
        return;
    if (typeof overlay.remove === 'function')
        overlay.remove();
}

