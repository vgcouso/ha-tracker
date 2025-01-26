//
// FETCH
//

import {setAdmin, haUrl} from './globals.js';
import {getToken} from './auth.js';
import {setDevices, setPersons} from './devices.js';
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
                throw new Error("Token no válido.");
            }
        }

        console.log(`Usando token: ${token || "No requerido"}`);

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
        console.error("Error en fetchData:", error);
        return null;
    }
}

export async function fetchConnection() {
    try {
        const url = `${haUrl}/api/`;
        const data = await fetchData(url);

        console.log(data);

        if (data && data.message === 'API running.') {
            return true;
        } else {
            return false;
        }
    } catch (error) {
        console.error('Error al comprobar el estado de Home Assistant:', error);
        return false;
    }
}

export async function fetchAdmin() {
    const url = `${haUrl}/api/is_admin`;
    try {
        const data = await fetchData(url);
        await setAdmin(data);
    } catch (error) {
        console.error("Error al verificar el estado de administrador:", error);
        throw error; // Propagar el error para que el llamador pueda manejarlo
    }
}

export async function fetchDevices() {
    const url = `${haUrl}/api/devices`;
    try {
        const data = await fetchData(url);
        await setDevices(data);
    } catch (error) {
        console.error("Error al obtener Devices:", error);
        throw error; // Propagar el error para que el llamador pueda manejarlo
    }
}

export async function fetchPersons() {
    const url = `${haUrl}/api/persons`;
    try {
        const data = await fetchData(url);
        // Verificar si no hay personas en la respuesta
        if (!data || !Array.isArray(data) || data.length === 0) {
            throw new Error("La respuesta no contiene personas válidas.");
        }
        await setPersons(data);
    } catch (error) {
        console.error("Error al obtener Personas:", error);
        throw error; // Propagar el error para que el llamador pueda manejarlo
    }
}

export async function fetchZones() {
    const url = `${haUrl}/api/zones`;
    try {
        const data = await fetchData(url);
        await setZones(data);
    } catch (error) {
        console.error("Error al obtener zonas:", error);
        throw error; // Propagar el error para que el llamador pueda manejarlo
    }
}

export async function deleteZone(zoneId) {
    if (!zoneId) {
        console.error("El ID de la zona es obligatorio.");
        return null;
    }
    const body = JSON.stringify({
        id: zoneId
    });

    const url = `${haUrl}/api/zones`;
    try {
        const response = await fetchData(url, {
            method: 'DELETE', // Especificar el método DELETE
            body: body, // Incluir el ID de la zona en el cuerpo
        });

        if (response && response.success) {
            console.log(`Zona con ID ${zoneId} eliminada con éxito.`);
            return true; // Indicar que la operación fue exitosa
        } else {
            console.error(`Error al eliminar la zona: ${response?.error || "Error desconocido"}`);
            return false; // Indicar que falló
        }
    } catch (error) {
        console.error("Error al intentar eliminar la zona:", error);
        return false; // Indicar que falló
    }
}

export async function updateZone(zoneId, name, radius, latitude, longitude) {
    if (!zoneId || !name || !radius || !latitude || !longitude) {
        console.error("Todos los parámetros (zoneId, name, radius, latitude, longitude) son obligatorios.");
        return null;
    }

    const url = `${haUrl}/api/zones`;
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
            console.log(`Zona con ID ${zoneId} actualizada con éxito.`);
            return response; // Retornar la respuesta completa si fue exitosa
        } else {
            console.error(`Error al actualizar la zona: ${response?.error || "Error desconocido"}`);
            return null; // Retornar nulo si falló
        }
    } catch (error) {
        console.error("Error al intentar actualizar la zona:", error);
        return null; // Retornar nulo si ocurrió un error
    }
}

export async function createZone(name, radius, latitude, longitude, icon = "mdi:map-marker", passive = false, custom = true) {
    if (!name || !radius || !latitude || !longitude) {
        console.error("Todos los parámetros (name, radius, latitude, longitude) son obligatorios.");
        return null;
    }

    const url = `${haUrl}/api/zones`;
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
            console.log(`Zona creada con éxito. ID: ${response.id}`);
            return response.id; // Retornar el ID de la nueva zona
        } else {
            console.error(`Error al crear la zona: ${response?.error || "Error desconocido"}`);
            return null; // Retornar null si falló
        }
    } catch (error) {
        console.error("Error al intentar crear la zona:", error);
        return null; // Retornar null si ocurrió un error
    }
}

export async function fetchFilteredPositions(deviceId, startDate, endDate) {
    if (!deviceId || !startDate || !endDate) {
        console.error("Los parámetros deviceId, startDate y endDate son obligatorios.");
        return;
    }

    const url = `${haUrl}/api/filtered_positions?device_id=${encodeURIComponent(deviceId)}&start_date=${encodeURIComponent(startDate)}&end_date=${encodeURIComponent(endDate)}`;

    try {
        const data = await fetchData(url);
        await setFilter(data);
    } catch (error) {
        console.error("Error al obtener posiciones filtradas:", error);
        throw error; // Propagar el error para que el llamador pueda manejarlo
    }
}

export async function fetchAuthCallback(code) {

    if (!code) {
        console.error("No se encontró un code de autorización en la URL.");
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
            console.error("Error al obtener el token");
            return;
        }

        console.log("************ Token obtenido ************", data);

        // Guardar token en localStorage
        const tokenData = {
            ...data,
            hassUrl: haUrl,
            clientId: `${haUrl}/`,
            expires: Date.now() + data.expires_in * 1000, // Calcular la expiración
        };

        try {
            localStorage.setItem("hassTokens", JSON.stringify(tokenData));
            console.log("Token almacenado en localStorage:", tokenData);
        } catch (error) {
            console.error("Error al guardar el token en localStorage:", error);
            return;
        }

        // Limpia la URL eliminando el parámetro `code`
        const newUrl = `${haUrl}/local/ha-tracker/index.html`;
        window.history.replaceState({}, document.title, newUrl);
    } catch (error) {
        console.error("Error durante la obtención del token", error);
    }
}

export async function fetchTokenRefresh(refreshToken) {
    try {
        if (!haUrl || !refreshToken) {
            console.error("La URL base o el refresh_token no están definidos correctamente.");
            console.log("haUrl:", haUrl);
            console.log("refreshToken:", refreshToken);
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
            console.error("Error al renovar el token");
            return;
        }

        console.log("************ Token renovado ************", data);

        return data; // Devuelve el objeto del token
    } catch (error) {
        console.error("Error en la solicitud de renovación del token:", error);
        return null; // Devuelve null en caso de error
    }
}