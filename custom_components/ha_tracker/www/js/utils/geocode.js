//
// geocode.js
// Reverse-geocoding con caché LRU, cola (concurrencia limitada) y backoff.
// Reintenta también cuando 200 viene sin dirección utilizable.
// Úsalo para convertir (lat,lon,ts) -> address.
//

import { fetchReverseGeocode } from '../ha/fetch.js';

// ---------- Config ----------
let POS_CACHE_MAX = 400; // caché LRU por uniqueId
let RG_MAX = 4; // concurrencia máxima
let MAX_EMPTY_RETRIES = 2; // reintentos extra cuando 200 llega sin address

export function setGeocodeCacheSize(n) {
    POS_CACHE_MAX = Math.max(50, Number(n) || POS_CACHE_MAX);
}
export function setGeocodeConcurrency(n) {
    RG_MAX = Math.max(1, Number(n) || RG_MAX);
}
export function setGeocodeEmptyRetries(n) {
    MAX_EMPTY_RETRIES = Math.max(0, Number(n) || MAX_EMPTY_RETRIES);
}

// ---------- Key helpers ----------
const posKey = (lat, lon, tsMs) => `${Number(lat).toFixed(6)},${Number(lon).toFixed(6)},${Number(tsMs)}`;
const coordKey = (lat, lon) => `${Number(lat).toFixed(6)},${Number(lon).toFixed(6)}`;

// ---------- Caches ----------
const posCache = new Map(); // uniqueId -> { key, address }
const coordAddrCache = new Map(); // "lat,lon" -> address (solo NO vacíos)
const coordInFlight = new Map(); // "lat,lon" -> Promise<string>

// ---------- Estado por uniqueId ----------
const wanted = new Map(); // uniqueId -> key
const inFlight = new Map(); // uniqueId -> key
const retryCount = new Map(); // uniqueId -> n

function lruPut(id, val) {
    if (posCache.has(id))
        posCache.delete(id);
    posCache.set(id, val);
    if (posCache.size > POS_CACHE_MAX) {
        const first = posCache.keys().next().value;
        posCache.delete(first);
    }
}
function resetRetry(id) {
    retryCount.delete(id);
}
function scheduleRetry(id, baseMs, cb) {
    const n = (retryCount.get(id) || 0) + 1;
    retryCount.set(id, n);
    const jitter = Math.floor(Math.random() * 250);
    const delay = Math.min(8000, Math.max(300, baseMs) * Math.pow(1.6, n)) + jitter;
    setTimeout(cb, delay);
}

// ---------- Mini pool de concurrencia ----------
let active = 0, q = [];
function run(task) {
    return new Promise((res, rej) => {
        q.push({
            task,
            res,
            rej
        });
        pump();
    });
}
function pump() {
    while (active < RG_MAX && q.length) {
        const { task, res, rej } = q.shift();
        active++;
        task().then(res, rej).finally(() => {
            active--;
            pump();
        });
    }
}

// ---------- API ----------
/**
 * Resuelve dirección para (lat,lon,tsMs) y la entrega a onAddress(address:string).
 * uniqueId: único por “fila lógica”; incluye el timestamp (p.ej. `${rowId}_${tsMs}`).
 */
// Helper: guarda la dirección en los data- del DOM (si existen esas filas)
function persistAddressToDom(uniqueId, addr) {
  try {
    const main = document.querySelector(`tr.pos-main-row[data-entity-id="${uniqueId}"]`);
    if (main) main.dataset.address = addr || '';

    const addrRow = document.querySelector(`tr.position-address-row[data-entity-id="${uniqueId}"]`);
    if (addrRow) addrRow.dataset.address = addr || '';
  } catch (e) {
    // ignora errores de DOM
  }
}

export async function requestAddress(uniqueId, lat, lon, tsMs, onAddress) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(tsMs))
    return;

  const key = posKey(lat, lon, tsMs);
  wanted.set(uniqueId, key);

  // caché por uniqueId (válida solo si la key coincide)
  const hit = posCache.get(uniqueId);
  if (hit?.key === key) {
    const addr = hit.address || '';
    onAddress?.(addr);
    persistAddressToDom(uniqueId, addr);
    wanted.delete(uniqueId);
    resetRetry(uniqueId);
    return;
  }

  // evita duplicados exactos por uniqueId
  if (inFlight.get(uniqueId) === key) return;
  inFlight.set(uniqueId, key);

  const scheduleRetryIfWanted = (ms) => {
    if (inFlight.get(uniqueId) === key) inFlight.delete(uniqueId);
    scheduleRetry(uniqueId, ms, () => {
      if (wanted.get(uniqueId) === key)
        requestAddress(uniqueId, lat, lon, tsMs, onAddress);
    });
  };

  const cKey = coordKey(lat, lon);

  try {
    // Reutiliza dirección por coordenada si ya existe (solo guardamos NO vacíos)
    if (coordAddrCache.has(cKey)) {
      const addr = coordAddrCache.get(cKey) || '';
      lruPut(uniqueId, { key, address: addr });
      if (wanted.get(uniqueId) === key) {
        onAddress?.(addr);
        persistAddressToDom(uniqueId, addr);
        wanted.delete(uniqueId);
        resetRetry(uniqueId);
      }
      return;
    }

    // Si hay una petición en marcha para esa coordenada, únete a ella
    if (coordInFlight.has(cKey)) {
      const addr = await coordInFlight.get(cKey); // '' si aún no obtenido
      if (wanted.get(uniqueId) !== key) return;

      if (!addr) {
        // 200 “vacío”: reintentos controlados por uniqueId
        const n = retryCount.get(uniqueId) || 0;
        if (n < MAX_EMPTY_RETRIES) {
          scheduleRetryIfWanted(600);
          return;
        }
        // agotados reintentos: entrega vacío sin cachear
        onAddress?.('');
        persistAddressToDom(uniqueId, '');
        wanted.delete(uniqueId);
        resetRetry(uniqueId);
        return;
      }

      // addr válido
      lruPut(uniqueId, { key, address: addr });
      onAddress?.(addr);
      persistAddressToDom(uniqueId, addr);
      wanted.delete(uniqueId);
      resetRetry(uniqueId);
      return;
    }

    // Dispara petición con cola de concurrencia
    const p = run(() => fetchReverseGeocode(lat, lon));
    // El promise compartido entrega SOLO el display_name (o '' si no viene)
    coordInFlight.set(cKey, p.then(d => (d?.address?.display_name || '').trim()));

    const data = await p;

    // Puede haber cambiado el deseo mientras tanto
    if (wanted.get(uniqueId) !== key) return;

    // Estados transitorios con Retry-After
    if (data?.error === 'queued' && Number.isFinite(data?.retry_after)) {
      scheduleRetryIfWanted(data.retry_after * 1000);
      return;
    }
    if (['temporarily_unavailable', 'rate_limited', 'busy'].includes(data?.error)) {
      const ra = Number.isFinite(data?.retry_after) ? data.retry_after : 1.5;
      scheduleRetryIfWanted(ra * 1000);
      return;
    }

    // 200 OK “normal”
    const addr = (data?.address?.display_name || '').trim();

    if (!addr) {
      // NO cachear vacío y reintentar hasta MAX_EMPTY_RETRIES
      const n = retryCount.get(uniqueId) || 0;
      if (n < MAX_EMPTY_RETRIES) {
        scheduleRetryIfWanted(600);
        return;
      }
      // agotados reintentos: entrega vacío sin cachear
      onAddress?.('');
      persistAddressToDom(uniqueId, '');
      wanted.delete(uniqueId);
      resetRetry(uniqueId);
      return;
    }

    // Dirección válida: cachea por coordenada y por uniqueId
    coordAddrCache.set(cKey, addr);
    lruPut(uniqueId, { key, address: addr });
    onAddress?.(addr);
    persistAddressToDom(uniqueId, addr);
    wanted.delete(uniqueId);
    resetRetry(uniqueId);

  } catch {
    // error de red u otros: backoff
    if (wanted.get(uniqueId) === key) scheduleRetryIfWanted(1200);
  } finally {
    coordInFlight.delete(cKey);
    if (inFlight.get(uniqueId) === key) inFlight.delete(uniqueId);
  }
}


export function cancelAddress(uniqueId) {
    wanted.delete(uniqueId);
    inFlight.delete(uniqueId);
    resetRetry(uniqueId);
}

export function clearGeocodeCaches() {
    posCache.clear();
    coordAddrCache.clear();
    coordInFlight.clear();
    wanted.clear();
    inFlight.clear();
    retryCount.clear();
}
