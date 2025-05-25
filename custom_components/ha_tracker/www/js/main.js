//  
// MAIN
//

import {isActive, updateAdmin, updateConfig, updateInterval} from './globals.js';
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
        console.error("Error during DOMContentLoaded:", error);
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
        console.error("Error during init:", error);
    }
}

async function startUpdateLoop() {
    while (true) {
        try {
			if (document.visibilityState === 'visible') {
				await update();
			}
        } catch (error) {
            console.error("Error during update, loop will continue:", error);
        }
        await delay(updateInterval*1000);
    }
}

async function startGeocodeLoop() {
    while (true) {
        try {
			if (document.visibilityState === 'visible') {
				await processQueue();
			}
        } catch (error) {
            console.error("Error processing queue, loop will continue:", error);
        }
        await delay(1000);
    }
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function update() {
    try {
        // Ejecutar funciones en orden y detenerse si ocurre un error
		const active = await isActive();
		if (active){
			await updateConfig();			
			await updateAdmin();
			await updatePersons();
			await updateZones();
			hideWindowOverlay();
		} else {
			showWindowOverlay(t('disconnected'), "rgba(255, 0, 0, 0.5)", "white", "rgba(200, 0, 0, 0.8)");
		}
    } catch (error) {
        console.error("Error during major update:", error);
    }
}