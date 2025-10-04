// utils/map.js 

import { loadCSSOnce, loadScriptOnce } from './loader.js';
import { t } from './i18n.js';

export let map;

const MAPLIBRE_VERSION = '4.1.2';
const CDN = {
  maplibreCSS: `https://cdn.jsdelivr.net/npm/maplibre-gl@${MAPLIBRE_VERSION}/dist/maplibre-gl.css`,
  maplibreJS: `https://cdn.jsdelivr.net/npm/maplibre-gl@${MAPLIBRE_VERSION}/dist/maplibre-gl.js`,
};

async function ensureMapLibreLoaded() {
  await loadCSSOnce(CDN.maplibreCSS);
  await loadScriptOnce(CDN.maplibreJS, { test: () => !!window.maplibregl });
}

let stylesInjected = false;

function injectControlStyles() {
  if (stylesInjected) {
    return;
  }

  const style = document.createElement('style');
  style.textContent = `
    .maplibregl-ctrl.ha-style-switcher {
      min-width: 120px;
    }

    .maplibregl-ctrl.ha-style-switcher select {
      width: 100%;
      border: none;
      padding: 4px 8px;
      color: inherit;
      background: transparent;
      font: inherit;
      cursor: pointer;
    }

    .maplibregl-ctrl.ha-geocoder {
      width: 220px;
      max-width: 100%;
      padding: 4px 6px;
    }

    .maplibregl-ctrl.ha-geocoder form {
      display: flex;
      gap: 4px;
    }

    .maplibregl-ctrl.ha-geocoder input[type="search"] {
      flex: 1;
      min-width: 0;
      padding: 4px 6px;
      border: 1px solid rgba(0,0,0,0.3);
      border-radius: 4px;
      font: inherit;
      background-color: rgba(255,255,255,0.9);
      color: inherit;
    }

    .maplibregl-ctrl.ha-geocoder button[type="submit"] {
      padding: 4px 8px;
      border: 1px solid rgba(0,0,0,0.3);
      border-radius: 4px;
      background: rgba(0,0,0,0.05);
      color: inherit;
      cursor: pointer;
    }

    .maplibregl-ctrl.ha-geocoder-results {
      margin-top: 4px;
      max-height: 180px;
      overflow-y: auto;
      border: 1px solid rgba(0,0,0,0.2);
      border-radius: 4px;
      background: rgba(255,255,255,0.95);
      box-shadow: 0 2px 6px rgba(0,0,0,0.15);
      list-style: none;
      padding: 4px 0;
    }

    .maplibregl-ctrl.ha-geocoder-results li {
      margin: 0;
      padding: 4px 8px;
      cursor: pointer;
      line-height: 1.4;
    }

    .maplibregl-ctrl.ha-geocoder-results li:hover,
    .maplibregl-ctrl.ha-geocoder-results li:focus {
      background: rgba(0,0,0,0.08);
      outline: none;
    }

    .maplibregl-ctrl-scale {
      min-width: 80px;
      text-align: center;
      font-size: 11px;
      font-family: sans-serif;
      padding: 2px 4px;
      background: rgba(255,255,255,0.8);
      border-radius: 4px;
      border: 1px solid rgba(0,0,0,0.2);
      margin: 0 0 8px 8px;
    }
  `;

  document.head.appendChild(style);
  stylesInjected = true;
}

class BaseLayerControl {
  constructor(layers, defaultLayerId) {
    this.layers = layers;
    this.defaultLayerId = defaultLayerId;
    this.onChange = this.onChange.bind(this);
    this._syncVisibility = this._syncVisibility.bind(this);
  }

  getDefaultPosition() {
    return 'top-left';
  }

  onAdd(maplibreMap) {
    this.map = maplibreMap;
    this.container = document.createElement('div');
    this.container.className = 'maplibregl-ctrl maplibregl-ctrl-group ha-style-switcher';

    this.select = document.createElement('select');
    this.layers.forEach(({ id, name }) => {
      const option = document.createElement('option');
      option.value = id;
      option.textContent = name;
      if (id === this.defaultLayerId) {
        option.selected = true;
      }
      this.select.appendChild(option);
    });

    this.select.addEventListener('change', this.onChange);
    this.container.appendChild(this.select);

    this.map.once('styledata', this._syncVisibility);
    return this.container;
  }

  onRemove() {
    if (this.map) {
      this.map.off('styledata', this._syncVisibility);
    }
    if (this.select) {
      this.select.removeEventListener('change', this.onChange);
    }
    if (this.container?.parentNode) {
      this.container.parentNode.removeChild(this.container);
    }
    this.map = undefined;
  }

  onChange() {
    if (!this.map) {
      return;
    }
    const selected = this.select.value;
    this.layers.forEach(({ id, layerId }) => {
      const visibility = id === selected ? 'visible' : 'none';
      if (this.map.getLayer(layerId)) {
        this.map.setLayoutProperty(layerId, 'visibility', visibility);
      }
    });
  }

  _syncVisibility() {
    this.onChange();
  }
}

class MapScaleControl {
  constructor(options = {}) {
    this.maxWidth = options.maxWidth || 100;
    this.unit = options.unit || 'metric';
    this._update = this._update.bind(this);
  }

  getDefaultPosition() {
    return 'bottom-left';
  }

  onAdd(maplibreMap) {
    this.map = maplibreMap;
    this.container = document.createElement('div');
    this.container.className = 'maplibregl-ctrl maplibregl-ctrl-scale';
    this.container.textContent = '';
    this.map.on('move', this._update);
    this._update();
    return this.container;
  }

  onRemove() {
    if (this.map) {
      this.map.off('move', this._update);
    }
    if (this.container?.parentNode) {
      this.container.parentNode.removeChild(this.container);
    }
    this.map = undefined;
  }

  _update() {
    if (!this.map || !this.container) {
      return;
    }

    const centerLatitude = this.map.getCenter().lat;
    const metersPerPixel = (40075016.686 * Math.cos((centerLatitude * Math.PI) / 180)) / Math.pow(2, this.map.getZoom() + 8);
    const maxMeters = metersPerPixel * this.maxWidth;

    const distances = this.unit === 'imperial'
      ? [0.3048, 0.9144, 1.60934, 8.04672, 16.0934, 80.4672, 160.934]
      : [1, 5, 10, 50, 100, 250, 500, 1000, 5000];

    let distance = distances[0];
    for (const candidate of distances) {
      if (candidate <= maxMeters) {
        distance = candidate;
      } else {
        break;
      }
    }

    const width = Math.round(distance / metersPerPixel);
    const isImperial = this.unit === 'imperial';
    let displayValue = isImperial ? distance / 0.3048 : distance;
    let unitLabel = isImperial ? 'ft' : 'm';

    if (!isImperial && displayValue >= 1000) {
      displayValue /= 1000;
      unitLabel = 'km';
    } else if (isImperial && displayValue >= 5280) {
      displayValue /= 5280;
      unitLabel = 'mi';
    }

    this.container.style.width = `${width}px`;
    this.container.textContent = `${Math.round(displayValue * 10) / 10} ${unitLabel}`;
  }
}

class NominatimGeocoderControl {
  constructor(options = {}) {
    this.options = {
      placeholder: t('search_place'),
      limit: 5,
      acceptLanguage: navigator.languages?.join(',') || navigator.language || 'en',
      biasToBounds: true,
      ...options,
    };

    this._onSubmit = this._onSubmit.bind(this);
    this._onInputFocus = this._onInputFocus.bind(this);
    this._handleOutsideClick = this._handleOutsideClick.bind(this);
    this._onMoveEnd = this._onMoveEnd.bind(this);
  }

  getDefaultPosition() {
    return 'bottom-left';
  }

  onAdd(maplibreMap) {
    this.map = maplibreMap;
    this.container = document.createElement('div');
    this.container.className = 'maplibregl-ctrl maplibregl-ctrl-group ha-geocoder';

    this.form = document.createElement('form');
    this.input = document.createElement('input');
    this.input.type = 'search';
    this.input.placeholder = this.options.placeholder;
    this.input.autocomplete = 'off';
    this.input.addEventListener('focus', this._onInputFocus);

    this.submit = document.createElement('button');
    this.submit.type = 'submit';
    this.submit.textContent = '🔍';

    this.resultsList = document.createElement('ul');
    this.resultsList.className = 'maplibregl-ctrl ha-geocoder-results';
    this.resultsList.style.display = 'none';

    this.form.appendChild(this.input);
    this.form.appendChild(this.submit);
    this.form.addEventListener('submit', this._onSubmit);

    this.container.appendChild(this.form);
    this.container.appendChild(this.resultsList);

    document.addEventListener('click', this._handleOutsideClick);
    this.map.on('moveend', this._onMoveEnd);
    this._onMoveEnd();

    return this.container;
  }

  onRemove() {
    if (this.form) {
      this.form.removeEventListener('submit', this._onSubmit);
    }
    if (this.input) {
      this.input.removeEventListener('focus', this._onInputFocus);
    }
    document.removeEventListener('click', this._handleOutsideClick);
    if (this.map) {
      this.map.off('moveend', this._onMoveEnd);
    }
    this._clearResults();
    if (this.container?.parentNode) {
      this.container.parentNode.removeChild(this.container);
    }
    this.map = undefined;
  }

  _onInputFocus(event) {
    event.target.select();
  }

  async _onSubmit(event) {
    event.preventDefault();
    const query = this.input.value.trim();
    if (!query) {
      this._clearResults();
      return;
    }

    const params = new URLSearchParams({
      q: query,
      format: 'jsonv2',
      limit: String(this.options.limit),
    });

    if (this.options.acceptLanguage) {
      params.set('accept-language', this.options.acceptLanguage);
    }
    if (this.options.biasToBounds && this.boundsString) {
      params.set('viewbox', this.boundsString);
      params.set('bounded', '1');
    }

    this.container.classList.add('is-loading');

    try {
      const response = await fetch(`https://nominatim.openstreetmap.org/search?${params.toString()}`, {
        headers: {
          Accept: 'application/json',
        },
        referrerPolicy: 'no-referrer-when-downgrade',
      });

      if (!response.ok) {
        throw new Error(`Geocoder request failed (${response.status})`);
      }

      const results = await response.json();
      this._renderResults(Array.isArray(results) ? results : []);
    } catch (err) {
      console.error('Geocoder error', err);
      this._renderResults([]);
    } finally {
      this.container.classList.remove('is-loading');
    }
  }

  _renderResults(results) {
    this.resultsList.innerHTML = '';

    if (!results.length) {
      this.resultsList.style.display = 'none';
      return;
    }

    results.forEach((item) => {
      const li = document.createElement('li');
      li.tabIndex = 0;
      li.textContent = item.display_name || item.name || item.osm_id;
      li.addEventListener('click', () => this._handleSelection(item));
      li.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          this._handleSelection(item);
        }
      });
      this.resultsList.appendChild(li);
    });

    this.resultsList.style.display = 'block';
  }

  _handleSelection(item) {
    if (!this.map) {
      return;
    }
    const lat = parseFloat(item.lat);
    const lon = parseFloat(item.lon);
    const hasBounds = Array.isArray(item.boundingbox) && item.boundingbox.length === 4;

    if (hasBounds) {
      const [south, north, west, east] = item.boundingbox.map((value) => parseFloat(value));
      this.map.fitBounds([[west, south], [east, north]], { padding: 40, duration: 750 });
    } else if (!Number.isNaN(lat) && !Number.isNaN(lon)) {
      this.map.easeTo({ center: [lon, lat], zoom: 16, duration: 750 });
    }

    this._clearResults();

    const popup = new window.maplibregl.Popup({ closeOnMove: true })
      .setLngLat([lon, lat])
      .setHTML(`<strong>${item.display_name || ''}</strong>`);

    popup.addTo(this.map);
  }

  _handleOutsideClick(event) {
    if (!this.container?.contains(event.target)) {
      this._clearResults();
    }
  }

  _clearResults() {
    this.resultsList.innerHTML = '';
    this.resultsList.style.display = 'none';
  }

  _onMoveEnd() {
    if (!this.map) {
      return;
    }
    const bounds = this.map.getBounds();
    this.boundsString = [
      bounds.getWest(),
      bounds.getSouth(),
      bounds.getEast(),
      bounds.getNorth(),
    ].join(',');
  }
}

const BASE_STYLE = {
  version: 8,
  name: 'HA Tracker Base',
  sources: {
    'osm-raster': {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      minzoom: 1,
      maxzoom: 19,
      attribution: '© OpenStreetMap contributors',
    },
    'esri-raster': {
      type: 'raster',
      tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
      tileSize: 256,
      minzoom: 1,
      maxzoom: 19,
      attribution: '© Esri, Maxar, Earthstar Geographics',
    },
  },
  layers: [
    {
      id: 'background',
      type: 'background',
      paint: {
        'background-color': '#d7ebff',
      },
    },
    {
      id: 'base-osm',
      type: 'raster',
      source: 'osm-raster',
      minzoom: 1,
      maxzoom: 19,
      layout: {
        visibility: 'visible',
      },
    },
    {
      id: 'base-esri',
      type: 'raster',
      source: 'esri-raster',
      minzoom: 1,
      maxzoom: 19,
      layout: {
        visibility: 'none',
      },
    },
  ],
};

const DEMO_BUILDINGS = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: {
        height: 65,
        color: '#b7c2ff',
      },
      geometry: {
        type: 'Polygon',
        coordinates: [[
          [-3.7067, 40.4177],
          [-3.7056, 40.4177],
          [-3.7056, 40.417],
          [-3.7067, 40.417],
          [-3.7067, 40.4177],
        ]],
      },
    },
    {
      type: 'Feature',
      properties: {
        height: 45,
        color: '#d5b6ff',
      },
      geometry: {
        type: 'Polygon',
        coordinates: [[
          [-3.7038, 40.4179],
          [-3.7029, 40.4179],
          [-3.7029, 40.4171],
          [-3.7038, 40.4171],
          [-3.7038, 40.4179],
        ]],
      },
    },
    {
      type: 'Feature',
      properties: {
        height: 80,
        color: '#ffd1a6',
      },
      geometry: {
        type: 'Polygon',
        coordinates: [[
          [-3.7008, 40.4174],
          [-3.7002, 40.4174],
          [-3.7002, 40.4167],
          [-3.7008, 40.4167],
          [-3.7008, 40.4174],
        ]],
      },
    },
  ],
};

export async function initMap() {
  try {
    await ensureMapLibreLoaded();
    injectControlStyles();

    const mapElement = document.getElementById('map');
    if (!mapElement) {
      throw new Error('Map container not found');
    }

    const style = JSON.parse(JSON.stringify(BASE_STYLE));

    const { maplibregl } = window;
    map = new maplibregl.Map({
      container: mapElement,
      style,
      center: [-3.7038, 40.4168],
      zoom: 6,
      pitch: 45,
      bearing: -17.6,
      antialias: true,
      attributionControl: false,
    });

    const resize = () => {
      if (!map) {
        return;
      }
      if (map.isStyleLoaded()) {
        map.resize();
      } else {
        map.once('load', () => map.resize());
      }
    };

    document.body.addEventListener(
      'transitionend',
      (event) => {
        if (event.target === document.body && event.propertyName === 'opacity') {
          setTimeout(resize, 0);
        }
      },
      { once: true },
    );

    if ('ResizeObserver' in window) {
      const observer = new ResizeObserver(resize);
      observer.observe(mapElement);
    }

    window.addEventListener('resize', resize);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        setTimeout(resize, 0);
      }
    });

    map.addControl(new maplibregl.NavigationControl({ showCompass: true }), 'top-right');
    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');

    const baseLayerControl = new BaseLayerControl([
      { id: 'osm', name: 'OpenStreetMap', layerId: 'base-osm' },
      { id: 'esri', name: 'Esri Satélite', layerId: 'base-esri' },
    ], 'osm');
    map.addControl(baseLayerControl, 'top-left');

    const scaleControl = new MapScaleControl();
    map.addControl(scaleControl, 'bottom-left');

    const geocoderControl = new NominatimGeocoderControl();
    map.addControl(geocoderControl, 'bottom-left');

    map.on('load', () => {
      map.resize();

      map.setFog({
        range: [-1, 2],
        color: '#d7ebff',
        'high-color': '#ffffff',
        'space-color': '#d8f2ff',
        'star-intensity': 0.15,
      });

      map.addSource('ha-buildings', {
        type: 'geojson',
        data: DEMO_BUILDINGS,
      });

      map.addLayer({
        id: 'ha-buildings',
        type: 'fill-extrusion',
        source: 'ha-buildings',
        paint: {
          'fill-extrusion-color': ['coalesce', ['get', 'color'], '#b6becf'],
          'fill-extrusion-opacity': 0.8,
          'fill-extrusion-height': ['get', 'height'],
          'fill-extrusion-base': 0,
        },
      });
    });

    setTimeout(resize, 350);

    return map;
  } catch (error) {
    console.error('Error starting map:', error);
    throw error;
  }
}

export function isValidCoordinates(lat, lng) {
    return lat != null && lng != null && !isNaN(lat) && !isNaN(lng);
}

export function getDistanceFromLatLonInMeters(lat1, lon1, lat2, lon2) {
    const R = 6371000; // Radio de la Tierra en metros
    const dLat = degToRad(lat2 - lat1);
    const dLon = degToRad(lon2 - lon1);
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(degToRad(lat1)) * Math.cos(degToRad(lat2)) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c; // Devuelve la distancia en metros
}

function degToRad(deg) {
    return deg * (Math.PI / 180);
}
