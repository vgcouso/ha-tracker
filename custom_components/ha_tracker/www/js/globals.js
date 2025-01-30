//	
// GLOBALS
//


import {fetchAdmin, fetchConnection} from './fetch.js';

export const haUrl = location.origin;

export let isAdmin = false;
export let isConnected = false;

export async function updateAdmin() {
    try {
		isAdmin = await fetchAdmin();
    } catch (error) {
        console.error("Error al verificar el establecer admin:", error);
		isAdmin = false;
    }
}

export async function updateConnection() {
    try {
		isConnected = await fetchConnection();
    } catch (error) {
        console.error("Error al verificar el establecer connection:", error);
		isConnected = false;
    }
}