//
// AUTH
//

import {haUrl} from './globals.js';
import {fetchTokenRefresh, fetchAuthCallback} from './fetch.js';

export async function authCallback() {
    try {
		const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.has("code")) {
            const code = urlParams.get("code");
            await fetchAuthCallback(code);
        }    
	} catch (error) {
        console.error("Error durante la autenticación:", error);
		throw error;
    }		
}

export async function getToken() {
    try {
        // Verificar si estamos en un iframe
        const inIframe = window !== window.parent;

        if (inIframe) {
            const token = await getTokenFromHassConnection();
            if (!token || token.trim() === '') {
                throw new Error("No se obtuvo un token válido desde iframe.");
            }
            return token;
        }

        // Asegurar que el token sea válido usando authenticate
        await authenticate();

        // Intentar obtener el token del almacenamiento local
        const storedTokensRaw = localStorage.getItem("hassTokens");
        const tokens = storedTokensRaw ? JSON.parse(storedTokensRaw) : null;

        if (tokens?.access_token) {
            if (Date.now() >= tokens.expires) {
                throw new Error("El token ha expirado.");
            }
            return tokens.access_token;
        }

        console.error("No se encontró un token válido incluso después de autenticar.");
        throw new Error("No se encontró un token válido.");
    } catch (error) {
        console.error("Error en getToken:", error);
        return null; // Retorna null en caso de error
    }
}

async function authenticate() {
    const storedTokensRaw = localStorage.getItem("hassTokens");

    try {
        if (storedTokensRaw) {
            const tokenData = JSON.parse(storedTokensRaw);

            // Verifica si el token aún es válido
            if (Date.now() < tokenData.expires) {
                return; // Detiene el flujo si el token es válido
            }

            console.log("El token ha expirado. Intentando renovarlo...");
            const renewed = await renewToken(tokenData.refresh_token);
            if (renewed)
                return; // Detiene el flujo si el token se renueva correctamente
        }

        // Redirige si no hay token válido
        console.log("No se encontró un token válido. Redirigiendo para autorizar...");

        const redirectUri = `${haUrl}/local/ha-tracker/index.html`;
        const authUrl = `${haUrl}/auth/authorize?client_id=${encodeURIComponent(`${haUrl}/`)}&redirect_uri=${encodeURIComponent(redirectUri)}`;
        window.location.href = authUrl;
    } catch (error) {
        console.error("Error durante authenticate:", error);
    }
}

async function renewToken(refreshToken) {
    try {
        const tokenData = await fetchTokenRefresh(refreshToken);

        if (!tokenData) {
            console.error("No se pudo renovar el token.");
            return false;
        }

        // Recuperar el token original para copiar datos faltantes
        const storedTokensRaw = localStorage.getItem("hassTokens");
        if (!storedTokensRaw) {
            console.error("No se encontró un token existente en el almacenamiento local.");
            return false;
        }

        const originalTokens = JSON.parse(storedTokensRaw);

        // Copiar campos faltantes desde el token original
        tokenData.refresh_token = originalTokens.refresh_token; // Mantener el refresh_token
        tokenData.hassUrl = originalTokens.hassUrl; // Asegurar que se mantenga hassUrl
        tokenData.clientId = originalTokens.clientId; // Mantener clientId
        tokenData.ha_auth_provider = originalTokens.ha_auth_provider; // Mantener ha_auth_provider

        // Calcular y almacenar la nueva expiración
        tokenData.expires = Date.now() + tokenData.expires_in * 1000;

        // Almacenar el token renovado en localStorage
        localStorage.setItem("hassTokens", JSON.stringify(tokenData));
        console.log("Token renovado y almacenado:", tokenData);

        return true;
    } catch (error) {
        console.error("Error al procesar el token renovado:", error);
        return false; // Indica que la renovación falló
    }
}

const getTokenFromHassConnection = async() => {
    let hassConnection = window.hassConnection || window.parent?.hassConnection;

    if (!hassConnection) {
        throw new Error("No se encontró una conexión existente");
    }

    try {
        // Asegúrate de que hassConnection sea una promesa y espera su resolución
        const config = typeof hassConnection.then === "function" ? await hassConnection : hassConnection;

        // Verifica si config tiene los datos esperados
        if (config?.auth?.data?.access_token) {
            let token = config.auth.data.access_token;
            const expires = config.auth.data.expires; // Fecha de expiración del token
            const refreshToken = config.auth.data.refresh_token; // Refresh token

            // Verificar si el campo 'expires' existe y tiene un formato válido
            if (!expires) {
                throw new Error("No se encontró la fecha de expiración en la respuesta");
            }

            // Intentar convertir 'expires' a un timestamp
            const expirationTime = new Date(expires).getTime();
            if (isNaN(expirationTime)) {
                throw new Error("Formato de fecha de expiración no válido");
            }

            // Obtener el tiempo actual
            const now = Date.now();

            // Verificar si el token ha expirado
            if (expirationTime <= now) {
                console.log("El token ha expirado, intentando renovarlo...");
                const tokenData = await fetchTokenRefresh(refreshToken);

                if (tokenData) {
                    console.log("Token renovado con éxito:", tokenData);

                    // Actualizar `hassConnection` con el nuevo token y expiración
                    config.auth.data.access_token = tokenData.access_token;
                    config.auth.data.expires = new Date(Date.now() + tokenData.expires_in * 1000).toISOString();
                    config.auth.data.refresh_token = tokenData.refresh_token;

                    token = tokenData.access_token;
                } else {
                    throw new Error("No se pudo renovar el token.");
                }
            }

            return token;
        } else {
            throw new Error("No se encontró el token en la respuesta de hassConnection");
        }
    } catch (err) {
        console.error("Error obteniendo el token de hassConnection:", err);
        return ``; // Token vacío en caso de error
    }
};