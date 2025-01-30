//  
// MAIN
//

import {isConnected, updateConnection, updateAdmin} from './globals.js';
import {map, initMap} from './map.js';
import {load, showWindowOverlay, hideWindowOverlay, configureConsoleLogging} from './utils.js';
import {authCallback} from './auth.js';
import {updatePersons, fitMapToAllPersons} from './persons.js';
import {updateZones} from './zones.js';
import {initializeI18n, t} from './i18n.js';


document.addEventListener("DOMContentLoaded", async() => {
    try {
		// Llamar a la función al inicio de tu aplicación
		configureConsoleLogging("development");

		console.log("************** INICIANDO **************");
	
		// Detecta el idioma y carga las traducciones
		await initializeI18n(); 
		
        // Manejar autenticación si hay un parámetro `code`
		await authCallback();

        // Inicializar la aplicación
        await init();
        await load();
    } catch (error) {
        console.error("Error durante la inicialización:", error);
    }
});

async function init() {
    try {
        console.log("************** INIT **************");

        await initMap();
        await update();

        // Zoom al conjunto de dispositivos
        await fitMapToAllPersons();

        // Inicia el ciclo de actualización
        startUpdateLoop();
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
        await delay(10000);
    }
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function update() {
    try {
		await updateConnection();
        if (!isConnected) {
            throw new Error("No está conectado");
        }

        // Ejecutar funciones en orden y detenerse si ocurre un error
        try {
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