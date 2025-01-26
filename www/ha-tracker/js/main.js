//  
// MAIN
//

import {isAdmin} from './globals.js';
import {map, initMap, fitMapToAllDevices} from './map.js';
import {load, showWindowOverlay, hideWindowOverlay, configureConsoleLogging} from './utils.js';
import {fetchAuthCallback,fetchConnection, fetchAdmin, fetchDevices, fetchZones, fetchPersons} from './fetch.js';
import {updateDevicePerson, updateDeviceList, updateDeviceMarkers} from './devices.js';
import {updateZonesTable, updateZoneMarkers} from './zones.js';
import {initializeI18n, t} from './i18n.js';


document.addEventListener("DOMContentLoaded", async() => {
    try {
		// Llamar a la función al inicio de tu aplicación
		configureConsoleLogging("development");

		console.log("************** INICIANDO **************");
	
		await initializeI18n(); // Detecta el idioma y carga las traducciones
		
        // Manejar autenticación si hay un parámetro `code`
		const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.has("code")) {
            const code = urlParams.get("code");
            await fetchAuthCallback(code);
        }

        // Inicializar la aplicación
        await init();
        await load();
    } catch (error) {
        console.error("Error durante la autenticación o inicialización:", error);
    }
});

async function init() {
    try {
        console.log("************** INIT **************");

        await initMap();
        await update();

        // Zoom al conjunto de dispositivos
        await fitMapToAllDevices();

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
        const isConnected = await fetchConnection();
        if (!isConnected) {
            throw new Error("No está conectado");
            return;
        }

        // Ejecutar funciones en orden y detenerse si ocurre un error
        try {
            await fetchAdmin();
            await fetchPersons();
            await fetchDevices();
            await updateDevicePerson();
            await updateDeviceList();
            await updateDeviceMarkers();
            await fetchZones();
            await updateZonesTable();
            await updateZoneMarkers();
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