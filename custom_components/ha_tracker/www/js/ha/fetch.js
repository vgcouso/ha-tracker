//
// FETCH
//

import { haUrl, DEFAULT_COLOR } from '../globals.js';
import { getToken } from './auth.js';
import { setDevices, setPersons } from '../screens/persons.js';
import { setZones } from '../screens/zones.js';
import { setFilter } from '../screens/filter.js';

async function fetchData(
    url, {
    method = 'GET',
    headers = {},
    body,
    timeoutMs = 15000
} = {},
    authRequired = true) {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort('timeout'), timeoutMs);

    try {
        let currentToken;
        if (authRequired) {
            currentToken = await getToken();
            if (!currentToken || !currentToken.trim()) {
                throw new Error("Invalid token.");
            }
            headers = {
                ...headers,
                Authorization: `Bearer ${currentToken}`
            };
        }

        const init = {
            method,
            headers,
            signal: controller.signal,
            cache: 'no-store',
        };
        if (method !== 'GET' && body !== undefined) {
            init.body = body;
            if (!(body instanceof FormData) && !(body instanceof Blob) && !(body instanceof ArrayBuffer)) {
                init.headers = {
                    'Content-Type': 'application/json',
                    ...headers
                };
            }
        }

        const response = await fetch(url, init);
        const status = response.status;
        const retryAfterHdr = Number(response.headers.get('Retry-After'));
        const contentType = (response.headers.get('content-type') || '').toLowerCase();

        // 202 Accepted → cola: puede venir con o sin JSON
        if (status === 202) {
            if (contentType.includes('application/json')) {
                try {
                    const data = await response.json();
                    return data ?? {
                        error: 'queued',
                        retry_after: Number.isFinite(retryAfterHdr) ? retryAfterHdr : 1.5
                    };
                } catch {
                    return {
                        error: 'queued',
                        retry_after: Number.isFinite(retryAfterHdr) ? retryAfterHdr : 1.5
                    };
                }
            }
            // sin JSON
            return {
                error: 'queued',
                retry_after: Number.isFinite(retryAfterHdr) ? retryAfterHdr : 1.5
            };
        }

        // 204 No Content
        if (status === 204) {
            return null;
        }

        if (!response.ok) {
            const errorDetails = await response.text().catch(() => '');
            const err = new Error(`Error HTTP: ${status} - ${errorDetails}`);
            err.status = status;
            if (Number.isFinite(retryAfterHdr))
                err.retry_after = retryAfterHdr;
            throw err;
        }

        // OK 2xx “normal”
        if (contentType.includes('application/json')) {
            return await response.json();
        }
        const text = await response.text();
        return text ? text : null;

    } catch (error) {
        console.error("Error in fetchData:", error);
        throw error;
    } finally {
        clearTimeout(t);
    }
}

export async function fetchReverseGeocode(lat, lon) {
    if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lon))) {
        throw new Error("latitude and longitude must be finite numbers.");
    }
    const u = new URL(`${haUrl}/api/ha_tracker/reverse_geocode`);
    u.searchParams.set('lat', String(lat));
    u.searchParams.set('lon', String(lon));
    u.searchParams.set('nowait', '1');
    // payload mínimo desde el backend
    u.searchParams.set('brief', '1');

    try {
        const data = await fetchData(u.toString(), {
            timeoutMs: 15000
        });
        return data; // puede ser {error:'queued', retry_after:n} o {address:{display_name:'...'}}
    } catch (error) {
        console.error("Error getting reverse geocode:", error);
        throw error;
    }
}

export async function fetchResetReverseGeocodeCache() {
    const u = new URL(`${haUrl}/api/ha_tracker/reverse_geocode`);
    u.searchParams.set("reset", "all");

    try {
        const data = await fetchData(u.toString());
        return data;
    } catch (error) {
        console.error("Error getting reverse geocode:", error);
        throw error;
    }
}

export async function fetchManifest() {
    try {
        const url = `${haUrl}/manifest.json`;
        const data = await fetchData(url, {
            method: "GET",
        }, false);
        return data;
    } catch (error) {
        console.error("Error getting manifest:", error);
        throw error;
    }
}

export async function fetchConfig() {
    const url = `${haUrl}/api/ha_tracker/config`;
    try {
        const data = await fetchData(url);
        return data;
    } catch (error) {
        console.error("Error getting configuration:", error);
        throw error;
    }
}

export async function fetchAdmin() {
    const url = `${haUrl}/api/ha_tracker/is_admin`;
    try {
        const data = await fetchData(url);
        return data?.is_admin ?? false;
    } catch (error) {
        console.error("Error checking admin status:", error);
        throw error;
    }
}

export async function fetchConnection() {
    try {
        const url = `${haUrl}/api/config`;
        const data = await fetchData(url);

        if (!data || typeof data !== "object") {
            console.log("Home Assistant responds, but doesn't seem ready.");
            return false;
        }
        return true;
    } catch (error) {
        console.error('Error checking Home Assistant status:', error);
        throw error;
    }
}

export async function fetchDevices() {
    const url = `${haUrl}/api/ha_tracker/devices`;
    try {
        const data = await fetchData(url);
        await setDevices(data);
    } catch (error) {
        console.error("Error getting Devices:", error);
        throw error;
    }
}

export async function fetchPersons() {
    const url = `${haUrl}/api/ha_tracker/persons`;
    try {
        const data = await fetchData(url);
        await setPersons(data);
    } catch (error) {
        console.error("Error getting Persons:", error);
        throw error;
    }
}

export async function fetchZones() {
    const url = `${haUrl}/api/ha_tracker/zones`;
    try {
        const data = await fetchData(url);
        await setZones(data);
    } catch (error) {
        console.error("Error getting zones:", error);
        throw error;
    }
}

export async function deleteZone(zoneId) {
    if (!zoneId) {
        console.error("Zone ID is required.");
        return null;
    }
    const body = JSON.stringify({
        id: zoneId
    });

    const url = `${haUrl}/api/ha_tracker/zones`;
    try {
        const response = await fetchData(url, {
            method: 'DELETE',
            body: body,
        });

        if (response && response.success) {
            console.log(`Zone with ID ${zoneId} deleted successfully.`);
            return true;
        } else {
            console.error(`Error deleting zone: ${response?.error || "Unknown error"}`);
            return false;
        }
    } catch (error) {
        console.error("Error trying to delete zone:", error);
        return false;
    }
}

export async function updateZone(zoneId, name, radius, latitude, longitude, color = DEFAULT_COLOR, visible = true) {
    if (!zoneId || !name || !radius || !latitude || !longitude) {
        console.error("Parameters: zoneId, name, radius, latitude and longitude are mandatory.");
        return null;
    }

    const url = `${haUrl}/api/ha_tracker/zones`;
    const body = JSON.stringify({
        id: zoneId,
        name: name,
        radius: radius,
        latitude: latitude,
        longitude: longitude,
        color: color,
		visible: visible,
    });

    try {
        const response = await fetchData(url, {
            method: 'PUT',
            body: body,
        });

        if (response && response.success) {
            console.log(`Zone with ID ${zoneId} updated successfully.`);
            return response;
        } else {
            console.error(`Error updating zone: ${response?.error || "Unknown error"}`);
            return null;
        }
    } catch (error) {
        console.error("Error trying to update the zone:", error);
        return null;
    }
}

export async function createZone(name, radius, latitude, longitude, icon = "mdi:map-marker", passive = false, custom = true, color = DEFAULT_COLOR) {
    if (!name || !radius || !latitude || !longitude) {
        console.error("All parameters (name, radius, latitude, longitude) are mandatory.");
        return null;
    }

    const url = `${haUrl}/api/ha_tracker/zones`;
    const body = JSON.stringify({
        name: name,
        radius: radius,
        latitude: latitude,
        longitude: longitude,
        icon: icon,
        passive: passive,
        custom: custom,
        color: color,
    });

    try {
        const response = await fetchData(url, {
            method: 'POST',
            body: body,
        });

        if (response && response.success) {
            console.log(`Zone created successfully. ID: ${response.id}`);
            return response.id;
        } else {
            console.error(`Error creating zone: ${response?.error || "Unknown error"}`);
            return null;
        }
    } catch (error) {
        console.error("Error trying to create zone:", error);
        return null;
    }
}

export async function fetchFilteredPositions(person_id, startDate, endDate) {
    if (!person_id || !startDate || !endDate) {
        console.error("The person_id, startDate and endDate parameters are required.");
        return;
    }

    const url = `${haUrl}/api/ha_tracker/filtered_positions?person_id=${encodeURIComponent(person_id)}&start_date=${encodeURIComponent(startDate)}&end_date=${encodeURIComponent(endDate)}`;

    try {
        const data = await fetchData(url);
        await setFilter(data);
    } catch (error) {
        console.error("Error getting filtered positions:", error);
        throw error;
    }
}

export async function fetchAuthCallback(code) {
    if (!code) {
        console.error("No authorization code found in the URL.");
        return;
    }

    try {
        const tokenUrl = `${haUrl}/auth/token`;
        const body = new URLSearchParams({
            grant_type: "authorization_code",
            code: code,
            client_id: `${haUrl}/`,
        });

        const data = await fetchData(tokenUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded"
            },
            body: body,
        }, false);

        if (!data) {
            console.error("Error getting token");
            return;
        }

        console.log("************ Token Obtained ************", data);

        const tokenData = {
            ...data,
            hassUrl: haUrl,
            clientId: `${haUrl}/`,
            expires: Date.now() + data.expires_in * 1000,
        };

        try {
            localStorage.setItem("hassTokens", JSON.stringify(tokenData));
        } catch (error) {
            console.error("Error saving token to localStorage:", error);
            return;
        }

        const newUrl = `${haUrl}/local/ha-tracker/index.html`;
        window.history.replaceState({}, document.title, newUrl);
    } catch (error) {
        console.error("Error while obtaining token", error);
    }
}

export async function fetchTokenRefresh(refreshToken) {
    try {
        if (!haUrl || !refreshToken) {
            console.error(`The base URL or refresh_token is not defined correctly.	haUrl: ${haUrl}	refreshToken: ${refreshToken}`);
            return null;
        }

        const tokenUrl = `${haUrl}/auth/token`;
        const body = new URLSearchParams({
            grant_type: "refresh_token",
            refresh_token: refreshToken,
            client_id: `${haUrl}/`,
        });

        const data = await fetchData(tokenUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded"
            },
            body: body,
        }, false);

        if (!data) {
            console.error("Error renewing token");
            return;
        }

        console.log("************ Renewed Token ************", data);
        return data;
    } catch (error) {
        console.error("Error en la solicitud de renovación del token:", error);
        return null;
    }
}
