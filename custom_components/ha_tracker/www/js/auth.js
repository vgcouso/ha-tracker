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
        console.error("Error during authentication:", error);
		throw error;
    }		
}

export async function getToken() {
    try {
        // Verificar si estamos en un iframe
        const inIframe = window !== window.parent;

        if (inIframe) {
			const homeAssistantRoot = window.parent.document.querySelector("home-assistant");
			if (!homeAssistantRoot) {
				throw new Error("<home-assistant> not found in parent document.");
			}

			const panelResolver = homeAssistantRoot.shadowRoot
				?.querySelector("home-assistant-main")
				?.shadowRoot?.querySelector("partial-panel-resolver");

			if (!panelResolver) {
				throw new Error("<partial-panel-resolver> not found in Home Assistant.");
			}

			const panelCustom = panelResolver.querySelector("ha-panel-custom");
			if (!panelCustom) {
				throw new Error("<ha-panel-custom> not found inside <partial-panel-resolver>.");
			}

			const panel = panelCustom.querySelector("ha-tracker");
			if (!panel) {
				throw new Error("<ha-tracker> not found within <ha-panel-custom>.");
			}

			// Obtener el token y su expiración
			const token = panel.token;
			const expiration = panel.tokenExpiration;
			const now = Date.now(); 
		
			if (!token || token.trim() === '') {
				throw new Error("A valid token was not obtained from Panel.");
			}

			if (!expiration || isNaN(expiration) || expiration <= now) {
				throw new Error("The token has expired. An invalid token will not be returned.");
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
                throw new Error("Token has expired.");
            }
            return tokens.access_token;
        }

        console.error("No valid token found even after authenticating.");
        throw new Error("No valid token found even after authenticating.");
    } catch (error) {
        console.error("Error in getToken:", error);
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

            console.log("The token has expired. Trying to renew it...");
            const renewed = await renewToken(tokenData.refresh_token);
            if (renewed)
                return; // Detiene el flujo si el token se renueva correctamente
        }

        // Redirige si no hay token válido
        console.log("No valid token found. Redirecting to authorize...");

        const redirectUri = `${haUrl}/local/ha-tracker/index.html`;
        const authUrl = `${haUrl}/auth/authorize?client_id=${encodeURIComponent(`${haUrl}/`)}&redirect_uri=${encodeURIComponent(redirectUri)}`;
        window.location.href = authUrl;
    } catch (error) {
        console.error("Error during authenticate:", error);
    }
}

async function renewToken(refreshToken) {
    try {
        const tokenData = await fetchTokenRefresh(refreshToken);

        if (!tokenData) {
            console.error("Failed to renew token.");
            return false;
        }

        // Recuperar el token original para copiar datos faltantes
        const storedTokensRaw = localStorage.getItem("hassTokens");
        if (!storedTokensRaw) {
            console.error("No existing token found in local storage.");
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
        console.log("Token renewed and stored:", tokenData);

        return true;
    } catch (error) {
        console.error("Error processing renewed token:", error);
        return false; // Indica que la renovación falló
    }
}
