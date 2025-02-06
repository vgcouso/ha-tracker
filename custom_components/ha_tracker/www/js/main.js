//  
// MAIN
//

import {isConnected, updateConnection, updateAdmin, updateConfig, updateInterval} from './globals.js';
import {initMap} from './map.js';
import {load, showWindowOverlay, hideWindowOverlay} from './utils.js';
import {authCallback} from './auth.js';
import {updatePersons, fitMapToAllPersons, processQueue} from './persons.js';
import {updateZones} from './zones.js';
import {initializeI18n, t} from './i18n.js';


document.addEventListener("DOMContentLoaded", async() => {
    try {
        // Manejar autenticación si hay un parámetro `code`
		await authCallback();

        // Inicializar la aplicación
        await init();
    } catch (error) {
        console.error("Error durante la inicialización:", error);
    }
});

async function init() {
    try {
		await initializeI18n(); 
        await initMap();
        await update();
        await load();
		
        // Zoom al conjunto de dispositivos
        await fitMapToAllPersons();

        // Inicia el ciclo de actualización
        startUpdateLoop();
		startGeocodeLoop();
    } catch (error) {
        console.error("Error durante la inicialización:", error);
    }
}

async function startUpdateLoop() {
    while (true) {
        try {
            await update();
        } catch (error) {
            console.error("Error durante la actualización, continuará el bucle:", error);
        }
        await delay(updateInterval*1000);
    }
}

async function startGeocodeLoop() {
    while (true) {
        try {
            await processQueue();
        } catch (error) {
            console.error("Error en el procesamiento de la cola, continuará el bucle:", error);
        }
        await delay(1000);
    }
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function update() {
    try {
		//await updateConnection();
        //if (!isConnected) {
        //    throw new Error("No está conectado");
        //}

        // Ejecutar funciones en orden y detenerse si ocurre un error
        try {	
			await updateConfig();			
            await updateAdmin();
            await updatePersons();
            await updateZones();
        } catch (error) {
            console.error("Error en una de las funciones:", error);
            throw new Error("Error en una de las funciones.");
        }

        // Ocultar el overlay al finalizar todas las tareas correctamente
        hideWindowOverlay();
    } catch (error) {
        console.error("Error durante la actualización principal:", error);
        showWindowOverlay(t('disconnected'), "rgba(255, 0, 0, 0.5)", "white", "rgba(200, 0, 0, 0.8)");
    }
}