//	
// GLOBALS
//

import { fetchAdmin, fetchConnection, fetchConfig, fetchManifest } from './ha/fetch.js';
import { currentLang, t } from './utils/i18n.js';


export const haUrl = location.origin;

export const CUSTOM_DEFAULT_COLOR = '#008000';
export const NO_CUSTOM_DEFAULT_COLOR = "#FF5555"; // rojo
export const DEFAULT_ALPHA = 0.25

// Formateadores de números
export const fmt0 = formatNumber({
    max: 0
}); // enteros (auto locale -> en-GB fallback)
export const fmt2 = formatNumber({
    min: 2,
    max: 2
}); // 2 decimales (auto locale -> en-GB fallback)

export let isAdmin = false;
export let isConnected = false;
export let version = "";
export let updateInterval = 10;
export let geocodeTime = 30;
export let geocodeDistance = 20;
export let updatePos = 1;
export let enableDebug = false;
export let use_imperial = false;

// Almacén para las referencias originales de console
const originalConsole = {
    log: console.log,
    debug: console.debug,
    info: console.info,
    warn: console.warn,
    error: console.error,
};

export async function updateAdmin() {
    try {
		isAdmin = await fetchAdmin();
    } catch (error) {
        console.error("Error checking admin set:", error);
		throw error;
    }
}

export async function updateConfig() {
    try {
		const config = await fetchConfig();		
		
		if (config){

			version = config.version;

			if (typeof config.update_interval === "number" && config.update_interval >= 10) {
				updateInterval = config.update_interval;
			}		
			if (typeof config.geocode_time === "number" && config.geocode_time >= 10) {
				geocodeTime = config.geocode_time;
			}	
			if (typeof config.geocode_distance === "number" && config.geocode_distance >= 20) {
				geocodeDistance = config.geocode_distance;
			}	
			if (typeof config.enable_debug === "boolean") {
				enableDebug = config.enable_debug;
			}	
			if (typeof config.use_imperial === "boolean") {
				use_imperial = config.use_imperial;
			}
		}
		await configureConsole();		
		console.log("Configuration: ", config);
    } catch (error) {
        console.error("Error checking admin set: ", error);
		throw error;
    }
}

export async function updateConnection() {
    try {
		isConnected = await fetchConnection();
    } catch (error) {
        console.error("Error checking the connection establishment:", error);
		throw error;
    }
}

export async function isActive() {
    try {
        await fetchManifest();
        return true;
    } catch (error) {
        console.warn(`HA is Inactive`);
        return false;
    }
}

export async function configureConsole() {
    if (!enableDebug) {
        // Modo producción: deshabilitar mensajes de consola excepto advertencias y errores
        console.log = () => {};
        console.debug = () => {};
        console.info = () => {};
        console.warn = (...args) => originalConsole.warn("[WARNING]:", ...args);
        console.error = (...args) => originalConsole.error("[ERROR]:", ...args);
    } else {
        // Modo desarrollo: habilitar mensajes con marcas de tiempo
        const getTimeStamp = () => {
            const now = new Date();
            const hours = String(now.getHours()).padStart(2, '0');
            const minutes = String(now.getMinutes()).padStart(2, '0');
            const seconds = String(now.getSeconds()).padStart(2, '0');
            const milliseconds = String(now.getMilliseconds()).padStart(3, '0');
            return `[${hours}:${minutes}:${seconds}:${milliseconds}]`;
        };

        console.log = (...args) => originalConsole.log(getTimeStamp(), ...args);
        console.debug = (...args) => originalConsole.debug(getTimeStamp(), ...args);
        console.info = (...args) => originalConsole.info(getTimeStamp(), ...args);
        console.warn = (...args) => originalConsole.warn(getTimeStamp(), "[WARNING]:", ...args);
        console.error = (...args) => originalConsole.error(getTimeStamp(), "[ERROR]:", ...args);
    }
}

export function formatDate(date) {
    const parsedDate = new Date(date);
    const options = {
        weekday: 'short',
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
    };
    // Usa `currentLang` o un idioma por defecto (por ejemplo, 'en')
    return parsedDate.toLocaleString(currentLang || 'en', options);
}

function formatNumber({
    locale,
    min = 0,
    max = 0,
    grouping = true
} = {}) {
  // Locale del navegador; si no existe, en-GB
  const L =
    locale ??
    ((typeof navigator !== "undefined" &&
      (navigator.languages?.[0] || navigator.language)) ||
      "en-GB");

  const nf = new Intl.NumberFormat(L, {
    style: "decimal",
    minimumFractionDigits: min,
    maximumFractionDigits: max,
    useGrouping: grouping,           // 👈 fuerza separadores (1,234 / 1.234 / 1 234… según locale)
  });

  return n => nf.format(Number(n) || 0);
}