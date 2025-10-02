//
// AUTH
//

import { haUrl } from '../globals.js';
import { fetchTokenRefresh, fetchAuthCallback } from './fetch.js';

let inflight = null;

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
    // Evita solicitudes paralelas
    if (!inflight) {
        inflight = (async() => {
            const inIframe = window !== window.parent;
            if (inIframe) {
                const { token, exp } = await requestTokenFromParent(); // exp en ms o 0
                if (!token || !token.trim())
                    throw new Error("Empty token from parent");
                return token;
            } else {
                // Modo standalone (sin iframe): usa auth local de HA si la tienes
                await authenticate(); // tu función existente
                const raw = localStorage.getItem("hassTokens");
                const tokens = raw ? JSON.parse(raw) : null;
                if (!tokens?.access_token)
                    throw new Error("No access_token in hassTokens");

                const expMs = typeof tokens.expires === "number" ? tokens.expires : 0;
				const now = Date.now();
                if (expMs && now >= expMs) {
                    throw new Error("Token has expired");
                }
                return tokens.access_token;
            }
        })().finally(() => {
            inflight = null;
        });
    }
    return inflight;
}

function requestTokenFromParent(timeoutMs = 7000) {
    return new Promise((resolve, reject) => {
        const reqId = Math.random().toString(36).slice(2);
        const expectedSource = window.parent;

        // Intenta deducir el origin real del padre desde el referrer; si no, usa el del iframe
        let parentOrigin = "";
        try {
            parentOrigin = new URL(document.referrer).origin;
        } catch {}
        if (!parentOrigin)
            parentOrigin = window.location.origin;

        const timer = setTimeout(() => {
            window.removeEventListener("message", onMsg);
            reject(new Error("Token not returned"));
        }, timeoutMs);

        function onMsg(event) {
            // 1) comprueba que viene del parent
            if (event.source !== expectedSource)
                return;

            // 2) comprueba el origin (del padre). Permitimos tanto parentOrigin como el origin local por si estás en despliegues donde ambos coinciden.
            if (event.origin !== parentOrigin && event.origin !== window.location.origin)
                return;

            const d = event.data || {};
            if (d.type === "auth-token" && d.reqId === reqId && d.token) {
                clearTimeout(timer);
                window.removeEventListener("message", onMsg);
                // d.exp puede venir en ms (como envías desde la card/panel). Normalízalo a número o 0.
                const exp = (typeof d.exp === "number" && isFinite(d.exp)) ? d.exp : 0;
                resolve({
                    token: d.token,
                    exp
                });
            }
        }

        window.addEventListener("message", onMsg);

        // Envía la petición al origin deducido (si falla en tu entorno, cambia por "*" pero mantén las comprobaciones de seguridad en onMsg)
        window.parent.postMessage({
            type: "request-token",
            reqId
        }, parentOrigin || "*");
    });
}

async function authenticate() {
    const storedTokensRaw = localStorage.getItem("hassTokens");

    try {
        if (storedTokensRaw) {
            const tokenData = JSON.parse(storedTokensRaw);

            // Verifica si el token aún es válido
            const exp = Number(tokenData.expires || 0);
            if (exp && Date.now() < (exp - 15 * 60 * 1000)) {
                return; // Detiene el flujo si el token es válido
            }

            console.log("The token has expired. Trying to renew it...");
            const renewed = await renewToken(tokenData.refresh_token);
            if (renewed)
                return; // Detiene el flujo si el token se renueva correctamente
        }

        // Redirige si no hay token válido
        console.log("No valid token found. Redirecting to authorize...");

        const redirectUri = `${haUrl}/ha-tracker/index.html`;
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
