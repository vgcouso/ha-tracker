//
// FETCH
//

import {haUrl} from './globals.js';
import {getToken} from './auth.js';
import {setDevices, setPersons} from './persons.js';
import {setZones} from './zones.js';
import {setFilter} from './filter.js';

async function fetchData(url, options = {
        "Content-Type": "application/json"
    }, authRequired = true) {
    try {
        let token = null;

        if (authRequired) {
            token = await getToken();
            if (!token || token.trim() === '') {
                throw new Error("Invalid token.");
            }
        }

        const response = await fetch(url, {
            method: options.method || 'GET',
            headers: {
                ...(authRequired ? {
                    Authorization: `Bearer ${token}`
                }
                     : {}),
                ...(options.headers || {}),
            },
            body: options.body,
        });

        if (!response.ok) {
            const errorDetails = await response.text();
            throw new Error(`Error HTTP: ${response.status} - ${errorDetails}`);
        }

        return await response.json();
    } catch (error) {
        console.error("Error in fetchData:", error);
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
        return data?.is_admin ?? false; // Usa optional chaining y nullish coalescing para mayor claridad
    } catch (error) {
        console.error("Error checking admin status:", error);
        throw error;
    }
}

export async function fetchConnection() {
    try {
        const url = `${haUrl}/api/config`; // Verifica la configuración de HA
        const data = await fetchData(url);

        if (!data || typeof data !== "object") {
            console.log("Home Assistant responds, but doesn't seem ready.");
            return false;
        }

        return true; // Si `api/config` devuelve datos, consideramos que HA está listo
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
        throw error; // Propagar el error para que el llamador pueda manejarlo
    }
}

export async function fetchPersons() {
    const url = `${haUrl}/api/ha_tracker/persons`;
    try {
        const data = await fetchData(url);
        await setPersons(data);
    } catch (error) {
        console.error("Error getting Persons:", error);
        throw error; // Propagar el error para que el llamador pueda manejarlo
    }
}

export async function fetchZones() {
    const url = `${haUrl}/api/ha_tracker/zones`;
    try {
        const data = await fetchData(url);
        await setZones(data);
    } catch (error) {
        console.error("Error getting zones:", error);
        throw error; // Propagar el error para que el llamador pueda manejarlo
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
            method: 'DELETE', // Especificar el método DELETE
            body: body, // Incluir el ID de la zona en el cuerpo
        });

        if (response && response.success) {
            console.log(`Zone with ID ${zoneId} deleted successfully.`);
            return true; // Indicar que la operación fue exitosa
        } else {
            console.error(`Error deleting zone: ${response?.error || "Unknown error"}`);
            return false; // Indicar que falló
        }
    } catch (error) {
        console.error("Error trying to delete zone:", error);
        return false; // Indicar que falló
    }
}

export async function updateZone(zoneId, name, radius, latitude, longitude) {
    if (!zoneId || !name || !radius || !latitude || !longitude) {
        console.error("All parameters (zoneId, name, radius, latitude, longitude) are mandatory.");
        return null;
    }

    const url = `${haUrl}/api/ha_tracker/zones`;
    const body = JSON.stringify({
        id: zoneId,
        name: name,
        radius: radius,
        latitude: latitude,
        longitude: longitude,
    });

    try {
        const response = await fetchData(url, {
            method: 'PUT', // Especificar el método PUT para actualizar
            body: body, // Enviar los datos en el cuerpo de la solicitud
        });

        if (response && response.success) {
            console.log(`Zone with ID ${zoneId} updated successfully.`);
            return response; // Retornar la respuesta completa si fue exitosa
        } else {
            console.error(`Error updating zone: ${response?.error || "Unknown error"}`);
            return null; // Retornar nulo si falló
        }
    } catch (error) {
        console.error("Error trying to update the zone:", error);
        return null; // Retornar nulo si ocurrió un error
    }
}

export async function createZone(name, radius, latitude, longitude, icon = "mdi:map-marker", passive = false, custom = true) {
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
        icon: icon, // Icono opcional, valor predeterminado "mdi:map-marker"
        passive: passive, // Campo opcional, valor predeterminado false
        custom: custom, // Campo opcional, valor predeterminado true
    });

    try {
        const response = await fetchData(url, {
            method: 'POST', // Método POST para crear una nueva zona
            body: body, // Enviar los datos en el cuerpo de la solicitud
        });

        if (response && response.success) {
            console.log(`Zone created successfully. ID: ${response.id}`);
            return response.id; // Retornar el ID de la nueva zona
        } else {
            console.error(`Error creating zone: ${response?.error || "Unknown error"}`);
            return null; // Retornar null si falló
        }
    } catch (error) {
        console.error("Error trying to create zone:", error);
        return null; // Retornar null si ocurrió un error
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
        throw error; // Propagar el error para que el llamador pueda manejarlo
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

        // Guardar token en localStorage
        const tokenData = {
            ...data,
            hassUrl: haUrl,
            clientId: `${haUrl}/`,
            expires: Date.now() + data.expires_in * 1000, // Calcular la expiración
        };

        try {
            localStorage.setItem("hassTokens", JSON.stringify(tokenData));
        } catch (error) {
            console.error("Error saving token to localStorage:", error);
            return;
        }

        // Limpia la URL eliminando el parámetro `code`
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

        return data; // Devuelve el objeto del token
    } catch (error) {
        console.error("Error en la solicitud de renovación del token:", error);
        return null; // Devuelve null en caso de error
    }
}