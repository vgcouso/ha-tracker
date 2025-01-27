//	
// GLOBALS
//


export const haUrl = location.origin;

export let isAdmin = false;

export async function setAdmin(data) {
    try {
        if (data && typeof data.is_admin !== "undefined") {
            isAdmin = data.is_admin; // Actualiza la variable global
            console.log("Estado de administrador:", isAdmin);
        } else {
            console.warn("No se pudo determinar el estado de administrador. Respuesta inválida:", data);
            isAdmin = false; // Valor predeterminado si no se puede determinar
        }
    } catch (error) {
        console.error("Error al verificar el estado de administrador:", error);
        isAdmin = false; // Valor predeterminado en caso de error
    }
}

