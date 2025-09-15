// utils/map.js 

import { loadCSSOnce, loadScriptOnce } from './loader.js';
import {t} from './i18n.js';

export let map;

const CDN = {
  leafletCSS: 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  leafletJS:  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.js',
  geocoderCSS:'https://unpkg.com/leaflet-control-geocoder/dist/Control.Geocoder.css',
  geocoderJS: 'https://unpkg.com/leaflet-control-geocoder/dist/Control.Geocoder.js',
  editableJS: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet-editable/1.3.0/Leaflet.Editable.min.js',
};

async function ensureLeafletLoaded() {
  await loadCSSOnce(CDN.leafletCSS);
  await loadCSSOnce(CDN.geocoderCSS);

  await loadScriptOnce(CDN.leafletJS,  { test: () => !!window.L });
  await loadScriptOnce(CDN.editableJS, { test: () => !!(window.L && L.Editable) });
  await loadScriptOnce(CDN.geocoderJS, { test: () => !!(window.L && L.Control && L.Control.Geocoder) });
}

export async function initMap() {
    try {
		await ensureLeafletLoaded();

        // Configuración predeterminada del mapa
        const mapOptions = {
            center: [40.4168, -3.7038], // Madrid
            zoom: 6,
            editable: true,
			preferCanvas: true,   
        };

        // Inicializar el mapa
        map = L.map('map', mapOptions);

        // Capas base
        const tileLayerOptions = {
            maxZoom: 19,
            minZoom: 1,
			crossOrigin: true, 
        };
        const baseLayers = {
            "OpenStreetMap": L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                ...tileLayerOptions,
                attribution: '© OpenStreetMap contributors',
            }),
            "Esri Satélite": L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
                ...tileLayerOptions,
                attribution: '© Esri, Maxar, Earthstar Geographics',
            }),
        };
        baseLayers["OpenStreetMap"].addTo(map);

        // Control de capas
        const layersControl = L.control.layers(baseLayers, null, {
            position: 'topleft'
        });
        layersControl.addTo(map);

        // Escala en bottom-right para no chocar con el geocoder
        const scaleCtl = L.control.scale({
            position: 'bottomleft'
        }).addTo(map);

        // Ajuste opcional de la posición del selector de capas con CSS/JS
        const layersControlElement = document.querySelector('.leaflet-control-layers');
        const zoomControlElement = document.querySelector('.leaflet-control-zoom');
        if (layersControlElement && zoomControlElement) {
            const zoomControlRect = zoomControlElement.getBoundingClientRect();
            layersControlElement.style.position = 'absolute';
            layersControlElement.style.left = `${zoomControlRect.right}px`;
        }

        // ---- Invalidations para tamaño/visibilidad ----
        const invalidate = () => map && map.invalidateSize(true);

        document.body.addEventListener(
            "transitionend",
            (e) => {
            if (e.target === document.body && e.propertyName === "opacity") {
                setTimeout(invalidate, 0);
            }
        }, {
            once: true
        });

        const mapEl = document.getElementById("map");
        if (mapEl && "ResizeObserver" in window) {
            const ro = new ResizeObserver(() => invalidate());
            ro.observe(mapEl);
        }

        window.addEventListener("resize", invalidate);
        document.addEventListener("visibilitychange", () => {
            if (!document.hidden)
                setTimeout(invalidate, 0);
        });

        setTimeout(invalidate, 350);

        // ---- Geocoder en bottom-left ----
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
                    // email: 'tu_correo@ejemplo.com'
                }
            })
        })
            .on('markgeocode', (e) => {
                const { center, name, bbox } = e.geocode;
                if (bbox)
                    map.fitBounds(bbox);
                else
                    map.setView(center, 16);

                L.popup({
                    // opciones útiles:
                    autoClose: true, // cierra otros popups
                    closeOnClick: true, // se cierra al clicar el mapa
                    keepInView: true // intenta mantenerlo en vista al mover/zoom
                    // className: 'mi-popup' // para estilos personalizados
                })
                .setLatLng(center)
                .setContent(name)
                .openOn(map);
            })
            .addTo(map);

        // Sesgo por vista actual (si quieres búsqueda local; quita bounded para global)
        function updateSearchBias() {
            const b = map.getBounds();
            geocoder.options.geocoder.options.geocodingQueryParams.viewbox =
                [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()].join(',');
            geocoder.options.geocoder.options.geocodingQueryParams.bounded = 1; // quita esta línea para global
        }
        map.on('moveend', updateSearchBias);
        updateSearchBias();
		
		setTimeout(() => map.invalidateSize(true), 0);

    } catch (error) {
        console.error("Error starting map:", error);
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
