//	
// GLOBALS
//


import {fetchAdmin, fetchConnection, fetchConfig} from './fetch.js';

export const haUrl = location.origin;

export let isAdmin = false;
export let isConnected = false;
export let updateInterval = 10;
export let enableDebug = false;
export let geocodeTime = 30;
export let geocodeDistance = 20;

export async function updateAdmin() {
    try {
		isAdmin = await fetchAdmin();
    } catch (error) {
        console.error("Error al verificar el establecer admin:", error);
		throw error;
    }
}

export async function updateConfig() {
    try {
		const config = await fetchConfig();
		console.log("Configuración obtenida:", config);
		
		if (config){
			if (typeof config.update_interval === "number" && config.update_interval >= 10) {
				updateInterval = config.update_interval;
			}		
			if (typeof config.enable_debug === "boolean") {
				enableDebug = config.enable_debug;
			}	
			if (typeof config.geocode_time === "number" && config.geocode_time >= 30) {
				geocodeTime = config.geocode_time;
			}	
			if (typeof config.geocode_distance === "number" && config.geocode_distance >= 20) {
				geocodeDistance = config.geocode_distance;
			}				
		}
    } catch (error) {
        console.error("Error al verificar el establecer admin:", error);
		throw error;
    }
}

export async function updateConnection() {
    try {
		isConnected = await fetchConnection();
    } catch (error) {
        console.error("Error al verificar el establecer connection:", error);
		throw error;
    }
}

export async function configureConsole() {
    if (!enableDebug) {
        const originalConsole = {
            log: console.log,
            debug: console.debug,
            info: console.info,
            warn: console.warn,
            error: console.error,
        };

        console.log = () => {};
        console.debug = () => {};
        console.info = () => {};
        console.warn = (...args) => originalConsole.warn("[WARNING]:", ...args);
        console.error = (...args) => originalConsole.error("[ERROR]:", ...args);
        console.log("Configuración de consola para producción activada.");
    } else {
        const originalConsole = {
            log: console.log,
            debug: console.debug,
            info: console.info,
            warn: console.warn,
            error: console.error,
        };

        const getTimeStamp = () => {
            try {
                const now = new Date();
                const hours = String(now.getHours()).padStart(2, '0');
                const minutes = String(now.getMinutes()).padStart(2, '0');
                const seconds = String(now.getSeconds()).padStart(2, '0');
                const milliseconds = String(now.getMilliseconds()).padStart(3, '0');
                return `[${hours}:${minutes}:${seconds}:${milliseconds}]`;
            } catch (e) {
                // Si ocurre algún error, devolver una marca de tiempo genérica
                return "[00:00:00:000]";
            }
        };

        console.log = (...args) => originalConsole.log(getTimeStamp(), ...args);
        console.debug = (...args) => originalConsole.debug(getTimeStamp(), ...args);
        console.info = (...args) => originalConsole.info(getTimeStamp(), ...args);
        console.warn = (...args) => originalConsole.warn(getTimeStamp(), "[WARNING]:", ...args);
        console.error = (...args) => originalConsole.error(getTimeStamp(), "[ERROR]:", ...args);
        console.log("Modo de desarrollo: mostrando todos los mensajes de consola con marcas de tiempo.");
    }
}
