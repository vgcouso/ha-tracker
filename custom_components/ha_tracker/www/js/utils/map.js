// utils/map.js
import { USE_MAP } from '../globals.js';

let _implPromise;
function _getImpl() {
    if (!_implPromise) {
        _implPromise = USE_MAP === '2D'
             ? import('./map2D.js')
             : import('./map3D.js');
    }
    return _implPromise;
}

export let map; // <- se asigna tras initMap()

export async function initMap(...args) {
    const m = await _getImpl();
    const result = await m.initMap?.(...args);
    // OJO: aquí actualizamos el export para que deje de ser undefined
    map = m.map;
    return result ?? map;
}

// Si prefieres, un helper para obtener el mapa asegurado:
export async function getMap() {
    const m = await _getImpl();
    if (!m.map) {
        // si aún no se llamó a initMap, la llamamos sin args
        await m.initMap?.();
    }
    map = m.map;
    return map;
}

// =====================
// Utilidades síncronas
// =====================
export function isValidCoordinates(lat, lng) {
    return Number.isFinite(lat) && Number.isFinite(lng);
}
export function getDistanceFromLatLonInMeters(lat1, lon1, lat2, lon2) {
    const R = 6371000,
    toR = d => d * Math.PI / 180;
    const dLat = toR(lat2 - lat1),
    dLon = toR(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toR(lat1)) * Math.cos(toR(lat2)) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// =====================
// Hueco a la derecha (solo desktop)
// =====================

// Breakpoint consistente con tu CSS (<=600px es “móvil”)
export function isSmallScreen() {
    return window.matchMedia?.('(max-width: 600px)').matches ?? false;
}

/**
 * Lee el ancho del panel (si está visible) y devuelve el padding “seguro” a la derecha.
 * Por defecto, en móvil no añade margen (desktopOnly: true).
 */
export function getRightSafePadding(extra = 16, {
    desktopOnly = true
} = {}) {
    const small = isSmallScreen();
    if (desktopOnly && small) {
        return {
            panel: 0,
            right: 0,
            isMobile: true
        };
    }

    const panelEl = document.getElementById('forms-container');
    if (!panelEl)
        return {
            panel: 0,
            right: extra,
            isMobile: small
        };

    // En desktop: visible si NO tiene .hidden
    // En móvil: visible solo si TIENE .visible (según tu CSS)
    const hiddenDesktop = panelEl.classList?.contains('hidden');
    const hiddenMobile = small && !panelEl.classList?.contains('visible');
    const isHidden = hiddenDesktop || hiddenMobile;

    const w = isHidden ? 0 : Math.round(panelEl.getBoundingClientRect().width || 0);
    return {
        panel: w,
        right: w + extra,
        isMobile: small
    };
}

// =====================
// Helpers de bounds y viewport
// =====================

// Leaflet LatLngBounds / MapLibre LngLatBounds → bordes
function _getBoundsEdges(b) {
    const get = (fn, fallback) => (typeof b?.[fn] === 'function' ? b[fn]() : fallback);
    let west = get('getWest', b?._sw?.lng ?? b?._southWest?.lng ?? -180);
    let east = get('getEast', b?._ne?.lng ?? b?._northEast?.lng ?? 180);
    let south = get('getSouth', b?._sw?.lat ?? b?._southWest?.lat ?? -85);
    let north = get('getNorth', b?._ne?.lat ?? b?._northEast?.lat ?? 85);
    return {
        west,
        east,
        south,
        north
    };
}
function _lngSpan(west, east) {
    let span = east - west;
    if (span < 0)
        span += 360; // cruzando antimeridiano
    return span;
}
function _mapSizePx() {
    const mapEl = document.getElementById('map');
    if (!mapEl)
        return {
            w: 1,
            h: 1
        };
    const r = mapEl.getBoundingClientRect();
    return {
        w: Math.max(1, Math.round(r.width)),
        h: Math.max(1, Math.round(r.height))
    };
}

// Viewport width/height (MapLibre o Leaflet)
function _getViewportWH() {
    if (map?._ml?.getContainer) {
        const c = map._ml.getContainer();
        return {
            w: c?.clientWidth || 0,
            h: c?.clientHeight || 0
        };
    }
    const s = map.getSize?.();
    return {
        w: s?.x || 0,
        h: s?.y || 0
    };
}

// Clampa el padding derecho (que nunca “coma” todo el mapa)
function _safeRight(extraRight, {
    desktopOnly = true
} = {}) {
    const { w } = _getViewportWH();
    const { right, isMobile } = getRightSafePadding(extraRight, {
        desktopOnly
    });
    if (desktopOnly && isMobile)
        return 0;
    // deja siempre al menos 48px de área visible
    return Math.max(0, Math.min(right, Math.max(0, w - 48)));
}

// Target (x,y) del “centro visible” considerando panel y top/bottom fijos
function _visibleTargetXY({
    extraRight = 16,
    desktopOnly = true,
    baseTop = 0,
    baseBottom = 0
}) {
    const { w, h } = _getViewportWH();
    const right = _safeRight(extraRight, {
        desktopOnly
    });
    const targetX = (w - right) / 2;
    const targetY = (baseTop || baseBottom)
     ? (baseTop + (h - baseTop - baseBottom) / 2)
     : (h / 2);
    return {
        targetX,
        targetY,
        right
    };
}

/**
 * Desplaza el centro “pxRight” píxeles a la DERECHA (equivalente a panBy([pxRight,0])).
 * Si existe Leaflet panBy, lo usa. Si no, aproxima con un cambio de long. en función de bounds y ancho.
 * (Queda como fallback/utility por si lo necesitas en otras partes.)
 */
function _shiftCenterByPixels(pxRight, {
    animate = false
} = {}) {
    if (!map || !pxRight)
        return;

    // Leaflet: usa panBy si existe
    if (typeof map.panBy === 'function') {
        try {
            map.panBy([pxRight, 0], {
                animate
            });
        } catch {}
        return;
    }

    // Fallback (p.ej. shim 3D): cambiamos el centro en long. equivalente a esos píxeles
    try {
        const bounds = map.getBounds?.();
        const center = map.getCenter?.();
        const zoom = map.getZoom?.();
        if (!bounds || !center || zoom == null)
            return;

        const { west, east } = _getBoundsEdges(bounds);
        const { w } = _mapSizePx();
        const spanLng = _lngSpan(west, east);
        const dLngPerPx = spanLng / Math.max(1, w);
        const deltaLng = pxRight * dLngPerPx;

        const newCenter = {
            lat: center.lat,
            lng: center.lng + deltaLng
        };
        map.setView?.(newCenter, zoom, {
            animate
        });
    } catch { /* noop */
    }
}

// =====================
// Focus de punto con hueco a la derecha (desktop)
// =====================

/**
 * Centra un punto dejando hueco a la derecha SOLO en desktop.
 * En móvil se comporta como “siempre”: sin margen extra.
 */
export function focusPoint(point, {
    zoom = null,
    animate = false,
    extraRight = 16,
    desktopOnly = true,
    baseTop = 0, // si tienes barra superior fija, pon su alto aquí
    baseBottom = 0 // idem para un footer fijo
} = {}) {
    if (!map)
        return;

    const latlng = Array.isArray(point) ? {
        lat: point[0],
        lng: point[1]
    }
     : point;

    // Calcula el nuevo centro exacto en ambos motores
    function computeNewCenter() {
        const { targetX, targetY } = _visibleTargetXY({
            extraRight,
            desktopOnly,
            baseTop,
            baseBottom
        });
        const { w, h } = _getViewportWH();
        if (!w || !h) {
            const z = map._ml ? (zoom ?? map._ml.getZoom()) : (zoom ?? map.getZoom?.());
            return {
                center: [latlng.lng, latlng.lat],
                zoom: z,
                dx: 0,
                dy: 0
            };
        }

        if (map._ml) {
            const ml = map._ml;
            const p = ml.project([latlng.lng, latlng.lat]);
            const c = {
                x: w / 2,
                y: h / 2
            };
            const dx = p.x - targetX,
            dy = p.y - targetY;
            const newCenterScreen = [c.x + dx, c.y + dy];
            const newC = ml.unproject(newCenterScreen);
            return {
                center: [newC.lng, newC.lat],
                zoom: (zoom ?? ml.getZoom()),
                dx,
                dy
            };
        }

        const p = map.latLngToContainerPoint(latlng);
        const c = map.latLngToContainerPoint(map.getCenter());
        const dx = p.x - targetX,
        dy = p.y - targetY;
        const newCenterPx = L.point(c.x + dx, c.y + dy);
        const newCenterLatLng = map.containerPointToLatLng(newCenterPx);
        return {
            center: [newCenterLatLng.lng, newCenterLatLng.lat],
            zoom: (zoom ?? map.getZoom?.()),
            dx,
            dy
        };
    }

    // Aplica el centro (según plataforma)
    function applyCenter(center, z, anim) {
        if (map._ml) {
            map._ml.easeTo({
                center,
                zoom: z,
                duration: anim ? 300 : 0
            });
        } else {
            // Leaflet espera [lat, lng]
            map.setView?.({
                lat: center[1],
                lng: center[0]
            }, z, {
                animate: anim
            });
        }
    }

    // 1) primer pase
    const pass1 = computeNewCenter();
    applyCenter(pass1.center, pass1.zoom, animate);

    // 2) reajustes post-layout (por si cambia el ancho del panel)
    let attempts = 2;
    const EPS = 1; // píxeles
    const reAdjust = () => {
        if (attempts-- <= 0)
            return;
        try {
            map.invalidateSize?.();
        } catch {}
        const pass = computeNewCenter();
        if (Math.abs(pass.dx) > EPS || Math.abs(pass.dy) > EPS) {
            applyCenter(pass.center, pass.zoom, animate);
            requestAnimationFrame(reAdjust);
        }
    };
    requestAnimationFrame(reAdjust);
}

// =====================
// fitBounds con padding asimétrico seguro
// =====================

// Extractor robusto de SW/NE (no cae a defaults del mundo)
function _extractSWNE(b) {
    if (!b)
        return null;

    // 1) APIs típicas
    if (typeof b.getSouthWest === 'function' && typeof b.getNorthEast === 'function') {
        const sw = b.getSouthWest(),
        ne = b.getNorthEast();
        if (sw && ne && Number.isFinite(sw.lat) && Number.isFinite(sw.lng) && Number.isFinite(ne.lat) && Number.isFinite(ne.lng)) {
            return {
                sw: {
                    lat: sw.lat,
                    lng: sw.lng
                },
                ne: {
                    lat: ne.lat,
                    lng: ne.lng
                }
            };
        }
    }

    // 2) Props internas frecuentes (Leaflet/shims)
    const sw2 = b._southWest || b._sw;
    const ne2 = b._northEast || b._ne;
    if (sw2 && ne2 && Number.isFinite(sw2.lat) && Number.isFinite(sw2.lng) && Number.isFinite(ne2.lat) && Number.isFinite(ne2.lng)) {
        return {
            sw: {
                lat: sw2.lat,
                lng: sw2.lng
            },
            ne: {
                lat: ne2.lat,
                lng: ne2.lng
            }
        };
    }

    // 3) Formato plano { south, west, north, east }
    if (Number.isFinite(b.south) && Number.isFinite(b.west) && Number.isFinite(b.north) && Number.isFinite(b.east)) {
        return {
            sw: {
                lat: b.south,
                lng: b.west
            },
            ne: {
                lat: b.north,
                lng: b.east
            }
        };
    }

    // 4) Array de puntos [[lat,lng], ...] -> calculamos envolvente
    if (Array.isArray(b) && b.length) {
        let minLat = +Infinity,
        minLng = +Infinity,
        maxLat = -Infinity,
        maxLng = -Infinity;
        for (const p of b) {
            if (!Array.isArray(p) || p.length < 2)
                continue;
            let lat = Number(p[0]),
            lng = Number(p[1]);
            // Si parece [lng,lat], lo invertimos
            if (Math.abs(lat) > 90 && Math.abs(lng) <= 90)
                [lng, lat] = [lat, lng];
            if (!Number.isFinite(lat) || !Number.isFinite(lng))
                continue;
            if (lat < minLat)
                minLat = lat;
            if (lat > maxLat)
                maxLat = lat;
            if (lng < minLng)
                minLng = lng;
            if (lng > maxLng)
                maxLng = lng;
        }
        if (isFinite(minLat) && isFinite(minLng) && isFinite(maxLat) && isFinite(maxLng)) {
            return {
                sw: {
                    lat: minLat,
                    lng: minLng
                },
                ne: {
                    lat: maxLat,
                    lng: maxLng
                }
            };
        }
    }

    return null; // <- mejor no hacer nada que “saltar” al mundo
}

/**
 * Ajusta bounds dejando margen a la derecha SOLO en desktop.
 * En móvil usa el padding simétrico normal (right se clampa automáticamente).
 */
export function fitBoundsSafe(
    bounds, {
    animate = false,
    base = 24, // margen estándar (px) donde no hay panel
    extraRight = 16, // aire extra a sumar al ancho del panel
    desktopOnly = true,
    baseTop = 0, // si tienes header fijo
    baseBottom = 0, // si tienes footer fijo
    refitAttempts = 2, // reintentos post-layout
} = {}) {
    if (!map)
        return;

    const doApply = () => {
        const { targetX, targetY, right } = _visibleTargetXY({
            extraRight,
            desktopOnly,
            baseTop,
            baseBottom
        });
        void targetX;
        void targetY; // (solo informativo; pads usan right/top/bottom)

        const leftPad = base;
        const rightPad = base + right;
        const topPad = baseTop || base;
        const bottomPad = baseBottom || base;

        const swne = _extractSWNE(bounds);
        if (!swne)
            return false;

        // --- MAPLIBRE (3D) ---
        if (map._ml && (typeof map._ml.fitBounds === 'function' || typeof map._ml.cameraForBounds === 'function')) {
            const ml = map._ml;
            const bb = [[swne.sw.lng, swne.sw.lat], [swne.ne.lng, swne.ne.lat]];
            const padding = {
                left: leftPad,
                right: rightPad,
                top: topPad,
                bottom: bottomPad
            };

            try {
                const bearing = ml.getBearing?.() ?? 0;
                const pitch = ml.getPitch?.() ?? 0;

                // 1) Calcular encuadre sin perspectiva (pitch 0) para un zoom/centro "conservador"
                if (typeof ml.cameraForBounds === 'function') {
                    const cam = ml.cameraForBounds(bb, {
                        padding,
                        bearing,
                        pitch: 0
                    });
                    (animate ? ml.easeTo : ml.jumpTo).call(ml, {
                        center: cam.center,
                        zoom: cam.zoom,
                        bearing,
                        pitch, // restauramos el pitch real
                        duration: animate ? 300 : 0
                    });
                } else {
                    ml.fitBounds(bb, {
                        padding,
                        duration: animate ? 300 : 0
                    });
                }

                // 2) Post-ajuste por píxeles: asegurar que extremos caben con paddings reales
                const fixEdges = (tries = 3) => {
                    const c = ml.getContainer?.();
                    const w = c?.clientWidth || 0;
                    if (!w)
                        return true;

                    const guard = 12; // pequeño margen extra para icono (~48px)
                    const leftLimit = leftPad + guard;
                    const rightLimit = w - (rightPad + guard);

                    // usa las 4 esquinas del bounds (cubre 2 puntos a izq/der)
                    const pts = [
                        [swne.sw.lng, swne.sw.lat],
                        [swne.ne.lng, swne.ne.lat],
                        [swne.sw.lng, swne.ne.lat],
                        [swne.ne.lng, swne.sw.lat],
                    ];
                    let minX = Infinity,
                    maxX = -Infinity;
                    for (const [lng, lat] of pts) {
                        const p = ml.project([lng, lat]);
                        if (!p)
                            continue;
                        if (p.x < minX)
                            minX = p.x;
                        if (p.x > maxX)
                            maxX = p.x;
                    }
                    if (!isFinite(minX) || !isFinite(maxX))
                        return true;

                    // Errores (positivos = fuera)
                    const leftErr = Math.max(0, leftLimit - minX); // demasiado a la IZQUIERDA
                    const rightErr = Math.max(0, maxX - rightLimit); // demasiado a la DERECHA

                    if (leftErr === 0 && rightErr === 0)
                        return true;

                    if (leftErr > 0 && rightErr > 0) {
                        // ambos fuera -> un pelín de zoom out y reintento
                        ml.easeTo({
                            zoom: ml.getZoom() - 0.22,
                            duration: animate ? 180 : 0
                        });
                    } else if (leftErr > 0) {
                        // mover contenido a la DERECHA en pantalla => panear a la IZQUIERDA (dx negativo)
                        ml.panBy([-leftErr, 0], {
                            duration: animate ? 160 : 0
                        });
                    } else if (rightErr > 0) {
                        // mover contenido a la IZQUIERDA en pantalla => panear a la DERECHA (dx positivo)
                        ml.panBy([rightErr, 0], {
                            duration: animate ? 160 : 0
                        });
                    }

                    if (tries - 1 <= 0)
                        return true;
                    requestAnimationFrame(() => fixEdges(tries - 1));
                    return false;
                };

                if (animate)
                    setTimeout(() => requestAnimationFrame(() => fixEdges(3)), 320);
                else
                    requestAnimationFrame(() => fixEdges(3));

                return true;
            } catch {
                return false;
            }
        }

        // --- LEAFLET (2D) ---
        try {
            map.fitBounds(bounds, {
                paddingTopLeft: [leftPad, topPad],
                paddingBottomRight: [rightPad, bottomPad],
                animate
            });
            return true;
        } catch {
            return false;
        }
    };

    try {
        map.invalidateSize?.();
    } catch {}
    const ok = doApply();
    if (!ok)
        return;

    // Refit en 1–2 frames por si el panel cambia de ancho tras abrirse
    let attempts = refitAttempts;
    const raf = () => {
        if (attempts-- <= 0)
            return;
        try {
            map.invalidateSize?.();
        } catch {}
        doApply();
        if (attempts > 0)
            requestAnimationFrame(raf);
    };
    requestAnimationFrame(raf);
}
