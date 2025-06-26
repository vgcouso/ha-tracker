//
// ZONES
//

import {isAdmin} from './globals.js';
import {map} from './map.js';
import {getDistanceFromLatLonInMeters} from './utils.js';
import {deleteZone, updateZone, createZone, fetchZones} from './fetch.js';
import {updatePersonsTable} from './persons.js';
import {t, tWithVars} from './i18n.js';

let zones = [], zoneMarkers = {};
let zonesSortColumn = "name"; // Columna predeterminada para ordenación
let zonesSortAscending = true; // Orden ascendente predeterminado
let previousSortColumn = "";
let previousSortAscending = true;

const editingZones = {};

document.addEventListener("DOMContentLoaded", () => {
    const addZoneButton = document.getElementById("add-zone-button");
    const deleteZoneButton = document.getElementById("delete-zone-button");
    const editZoneButton = document.getElementById("edit-zone-button");

    if (addZoneButton) {
        addZoneButton.addEventListener("click", async() => {
            try {
                await handleCreateZone();
            } catch (error) {
                console.error("Error adding a zone:", error);
            }
        });
    }

    if (deleteZoneButton) {
        deleteZoneButton.addEventListener("click", async() => {
            try {
                await handleDeleteZone();
            } catch (error) {
                console.error("Error deleting a zone:", error);
            }
        });
    }

    if (editZoneButton) {
        editZoneButton.addEventListener("click", async() => {
            try {
                await handleEditZone();
            } catch (error) {
                console.error("Error when modifying a zone:", error);
            }
        });
    }
});

export async function updateZones(){
	try {
		await fetchZones();
		await updateZonesTable();
		await updateZoneMarkers();
    } catch (error) {
		console.error("Error updating zones:", error);
		throw error;
    }
}

export async function setZones(data) {
    try {
        if (data && Array.isArray(data)) {
            zones = data; // Asigna los datos obtenidos a la variable global
            console.log("Zones:", zones);
        } else {
            console.log("No valid zones were obtained from the server.");
            zones = []; // Asegura que `zones` sea un arreglo vacío en caso de error
        }
    } catch (error) {
        console.error("Error getting zones:", error);
        zones = []; // Asegura que `zones` no quede indefinido si ocurre un error
    }
}

async function updateZoneMarkers() {
    // Asegúrate de que los panes estén configurados
    if (!map.getPane('circlePane')) {
        map.createPane('circlePane'); // Crear un pane para los círculos
        map.getPane('circlePane').style.zIndex = 400; // Z-Index bajo para los círculos
    }

    // Obtener los IDs de las zonas actuales
    const currentZoneIds = zones.map(zone => zone.id);

    // Eliminar círculos de zonas que ya no existen
    Object.keys(zoneMarkers).forEach(zoneId => {
        if (!currentZoneIds.includes(zoneId)) {
            map.removeLayer(zoneMarkers[zoneId]); // Eliminar el círculo del mapa
            delete zoneMarkers[zoneId]; // Eliminar de la memoria
            delete editingZones[zoneId]; // Eliminar de los estados de edición
        }
    });

    // Añadir o actualizar las zonas actuales
    zones.forEach(zone => {
        const {
            latitude,
            longitude,
            radius,
            name,
            custom
        } = zone;

        if (!latitude || !longitude || !radius) {
            console.error("Invalid zone:", zone.id);
            return;
        }

        // Omitir zonas en edición
        if (editingZones[zone.id]) {
            return;
        }

        // Verificar si ya existe un marcador y si los valores han cambiado
        const existingCircle = zoneMarkers[zone.id];
        const hasChanged = !existingCircle ||
            existingCircle.getLatLng().lat !== latitude ||
            existingCircle.getLatLng().lng !== longitude ||
            existingCircle.getRadius() !== radius;

        if (existingCircle) {
            // Actualizar el popup si el nombre ha cambiado
            const popupContent = `
			<strong>${name || t("zone_without_name")}</strong><br>
			 ${t('radius')}: ${radius.toFixed(2)} ${t('meters')}
		    `;
			
            if (existingCircle.getPopup().getContent() !== popupContent) {
                existingCircle.setPopupContent(popupContent);
            }
        }

        // Si no hay cambios y el marcador ya existe, omitir
        if (!hasChanged) {
            return;
        }

        // Si ya existe un círculo para la zona, guardamos el estado del popup
        let isPopupOpen = false;
        if (zoneMarkers[zone.id]) {
            const existingCircle = zoneMarkers[zone.id];
            isPopupOpen = existingCircle.isPopupOpen(); // Verificar si el popup está abierto
            map.removeLayer(existingCircle); // Eliminar el círculo del mapa
            delete zoneMarkers[zone.id]; // Eliminar de la memoria
        }

        // Determinar el color en función de `custom`
        const color = custom ? 'green' : 'red';

        // Crear un nuevo círculo
        const circle = L.circle([latitude, longitude], {
            radius: radius, // Radio del círculo
            color: color, // Color del borde
            fillColor: color, // Color de relleno
            fillOpacity: 0.2, // Opacidad del relleno
            opacity: 0.5, // Opacidad del borde
            pane: 'circlePane', // Asigna el pane personalizado
        }).addTo(map);

        // Habilitar edición
        if (isAdmin && custom) {
            circle.enableEdit();
        }

        // Añadir el popup y personalizar su comportamiento
        const newPopupContent = `
		 <strong>${name || t("zone_without_name")}</strong><br>
		 ${t('radius')}: ${radius.toFixed(2)} ${t('meters')}
		`;
		
        circle.bindPopup(newPopupContent, {
            autoPan: false
        }); // Vincular el popup al círculo

        // Si el popup estaba abierto, abrirlo de nuevo con el contenido actualizado
        if (isPopupOpen) {
            circle.openPopup();
        }

        // Personalizar el evento de clic para centrar y abrir el popup
        circle.on('click', async() => {
            try {
                // Ajustar el zoom para encuadrar el círculo
                map.fitBounds(circle.getBounds());

                // Abre el popup del círculo
                circle.openPopup();

                // Llama a la función asíncrona para manejar la selección de fila
                await handleZoneRowSelection(zone.id);
            } catch (error) {
                console.error("Error handling zone row selection:", error);
            }
        });

        // Detectar movimiento de vértices
        circle.on('editable:vertex:dragstart', () => {
            editingZones[zone.id] = true; // Marcar como en edición
            map.closePopup(); // Cierra cualquier popup abierto en el mapa
        });

        circle.on('editable:vertex:dragend', async() => { // Asegúrate de que esta función sea async
            editingZones[zone.id] = false; // Marcar como no en edición

            const updatedLatLng = circle.getLatLng(); // Obtén la nueva posición
            const updatedRadius = circle.getRadius(); // Obtén el nuevo radio

            const updatedPopupContent = `
			<strong>${zone.name || ''}</strong><br>
			 ${t('radius')}: ${updatedRadius.toFixed(2)} ${t('meters')}
		    `;
			
            circle.bindPopup(updatedPopupContent, {
                autoPan: false
            }); // Actualiza el popup
            circle.openPopup(); // Muestra el popup actualizado

            // Llama a updateZone solo si es admin y es una zona personalizada
            if (isAdmin && custom) {
                try {
                    const response = await updateZone(
						zone.id,
						zone.name, // Mantén el nombre
						updatedRadius,
						updatedLatLng.lat,
						updatedLatLng.lng);
                    await fetchZones();
                    await handleZoneRowSelection(zone.id);

                    if (response && response.success) {
                        console.log(`Zone with ID ${zone.id} updated on server.`);
                    } else {
                        console.error(`Error updating zone with ID ${zone.id} on server.`);
                    }
                } catch (error) {
                    console.error("Error in zone update request:", error);
                }
            }
        });

        // Guardar el círculo en los marcadores
        zoneMarkers[zone.id] = circle;
    });
}

export async function handleZoneRowSelection(zoneId) {
    console.log("Selecting row for zone:", zoneId);

    const zonesTableBody = document.getElementById('zones-table-body');
    if (!zonesTableBody) {
        console.error("The zone table tbody was not found.");
        return;
    }	
	
    const row = zonesTableBody.querySelector(`tr[data-zone-id="${zoneId}"]`);
    if (!row) {
        console.error("No row found for the zone:", zoneId);
        return;
    }

    // Cambiar el combo a "Zonas" solo si es necesario
    const comboSelect = document.getElementById('combo-select');
    if (comboSelect && comboSelect.value !== 'zones') {
        comboSelect.value = 'zones';

        // Disparar el evento de cambio manualmente para actualizar la UI
        const changeEvent = new Event('change', { bubbles: true });
        comboSelect.dispatchEvent(changeEvent);
    }

    // Resaltar la fila en la tabla de zonas
    zonesTableBody.querySelectorAll('tr').forEach(r => r.classList.remove('selected')); // Limpiar selección previa
    row.classList.add('selected'); // Resaltar la fila seleccionada

    // Asegurar que la fila sea visible antes de hacer scroll
    row.scrollIntoView({ behavior: 'smooth', block: 'center' });

    // Llamar a updateZoneActionButtons solo si hay una fila seleccionada
    if (typeof updateZoneActionButtons === "function") {
        updateZoneActionButtons();
    }
}

async function updateZoneActionButtons() {
    const zonesTableBody = document.getElementById('zones-table-body');
    if (!zonesTableBody) {
        console.error("Zone table body not found.");
        return;
    }

    const rows = zonesTableBody.querySelectorAll('tr');
    const addButton = document.getElementById('add-zone-button');
    const deleteButton = document.getElementById('delete-zone-button');
    const editButton = document.getElementById('edit-zone-button');
    const zoneActions = document.getElementById('zone-actions');

    // Ocultar todos los botones al inicio para evitar conflictos
    [addButton, deleteButton, editButton].forEach(button => button.classList.add('hidden'));
    
    // Manejo de visibilidad del contenedor de botones según permisos de admin
    if (isAdmin) {
        zoneActions.style.display = 'flex';
    } else {
        zoneActions.style.display = 'none';
        return;
    }

    // Si no hay filas, solo mostrar el botón "Añadir"
    if (rows.length === 0) {
        addButton.classList.remove('hidden');
    } else {
        const selectedRow = zonesTableBody.querySelector('tr.selected');

        if (!selectedRow) {
            // Si no hay fila seleccionada, solo mostrar "Añadir"
            addButton.classList.remove('hidden');
        } else {
            const isCustom = selectedRow.dataset.custom === "true";
            if (isCustom) {
                addButton.classList.remove('hidden');
                deleteButton.classList.remove('hidden');
                editButton.classList.remove('hidden');
            } else {
                addButton.classList.remove('hidden');
            }
        }
    }

    // Determinar cuántos botones están visibles
    const visibleButtons = [addButton, deleteButton, editButton].filter(button => !button.classList.contains('hidden'));

    // Si hay un solo botón visible, aplicamos la clase 'single-button'
    if (visibleButtons.length === 1) {
        zoneActions.classList.add('single-button');
        visibleButtons[0].style.flex = '1';
    } else {
        zoneActions.classList.remove('single-button');
        visibleButtons.forEach(button => (button.style.flex = '1'));
    }
}

async function handleDeleteZone() {
    const zonesTableBody = document.getElementById('zones-table-body');
    const selectedRow = zonesTableBody.querySelector('tr.selected');

    if (!selectedRow) {
        alert(t('select_delete_zone'));
        return;
    }

    const zoneId = selectedRow.dataset.zoneId;
    const name = selectedRow.dataset.name;

    if (!zoneId) {
        console.error("The selected zone ID was not found.");
        return;
    }

    const confirmDelete = confirm(tWithVars("confirm_delete_zone", { name }));

    if (!confirmDelete) {
        return; // Cancelar la operación si el usuario no confirma
    }

    try {
        await deleteZone(zoneId); // Llama a la función para eliminar la zona

        // Actualizar
        await fetchZones();
        await updateZonesTable();
        await updateZoneMarkers();
    } catch (error) {
        console.error("Error trying to delete zone:", error);
        alert(t('error_deleting_zone'));
    }
}

async function handleEditZone() {
    const zonesTableBody = document.getElementById('zones-table-body');

    if (!zonesTableBody) {
        console.error("Zone table body not found.");
        return;
    }

    // Obtener la fila seleccionada
    const selectedRow = zonesTableBody.querySelector('tr.selected');
    if (!selectedRow) {
        console.error("There is no zone selected.");
        alert(t('select_zone'));
        return;
    }

    const zoneId = selectedRow.dataset.zoneId; // ID de la zona seleccionada
    const zone = zones.find(z => z.id === zoneId); // Buscar la zona en la lista global `zones`

    if (!zone) {
        console.error("The selected zone was not found.");
        alert(t('error_finding_zone'));
        return;
    }

    // Pedir el nuevo nombre al usuario
    const newName = prompt(t('enter_zone_name'), zone.name || t('zone_without_name'));

    if (!newName || newName.trim() === "") {
        alert(t('empty_name'));
        return;
    }

    // Llamar a `updateZone` para actualizar el nombre en el servidor
    try {
        const response = await updateZone(
                zone.id,
                newName, // Usar el nuevo nombre
                zone.radius,
                zone.latitude,
                zone.longitude);

        if (response && response.success) {
            console.log(`Zone with ID ${zone.id} successfully updated.`);

            // Actualizar el nombre en la lista `zones`
            zone.name = newName;

            await fetchZones();
            await updateZonesTable();
            await updateZoneMarkers();
            await handleZoneRowSelection(zone.id);
        } else {
            console.error(`Error updating zone with ID ${zone.id}. Response:`, response);
            alert(t('error_updating_zone'));
        }
    } catch (error) {
        console.error("Error in zone update request:", error);
        alert(t('error_updating_zone'));
    }
}

async function handleCreateZone() {
    if (!map) {
        console.error("The map is not initialized.");
        return null;
    }

    // Solicitar el nombre de la zona al usuario
    const zoneName = prompt(t('enter_zone_name'));
    if (!zoneName || zoneName.trim() === "") {
        console.error("The name of the zone is mandatory.");
		alert(t('empty_name'));
        return null;
    }

    // Obtener el centro actual del mapa
    const center = map.getCenter();
    const latitude = center.lat;
    const longitude = center.lng;

    // Parámetros de la zona
    const radius = 100; // Radio fijo de 100 metros

    // Crear la zona llamando a la función createZone
    const newZoneId = await createZone(zoneName.trim(), radius, latitude, longitude);

    await fetchZones();
    await updateZonesTable();
    await updateZoneMarkers();
    await handleZoneRowSelection(newZoneId);

    if (newZoneId) {
        console.log(`Zone created successfully. ID: ${newZoneId}`);
        return newZoneId;
    } else {
        console.error("Failed to create zone.");
        return null;
    }
}

export function handleZonePosition(latitude, longitude) {
    if (!latitude || !longitude)
        return null;

    for (const zone of zones) {
        const zoneLat = zone.latitude;
        const zoneLon = zone.longitude;
        const zoneRadius = zone.radius;

        // Calcula la distancia en metros entre la posición y el centro de la zona
        const distance = getDistanceFromLatLonInMeters(latitude, longitude, zoneLat, zoneLon);

        if (distance <= zoneRadius) {
            return zone; // Devuelve el nombre de la zona
        }
    }

    return null; // No se encontró ninguna zona
}

export async function showZone(idZone) {
    if (!idZone) {
        return;
    }
    if (zoneMarkers[idZone]) {
        const circle = zoneMarkers[idZone];
        map.setView(circle.getLatLng(), map.getZoom()); // Centrar el mapa en la zona
        circle.openPopup(); // Abrir el popup del círculo
    } else {
        console.error("Marker for zone not found.");
    }
}

async function updateZonesTable() {
    const zonesTableBody = document.getElementById('zones-table-body');

    if (!zonesTableBody) {
        console.error("Zone table body not found.");
		updatePersonsTable();
		updateZoneActionButtons();
        return;
    }

    // Almacenar la fila seleccionada actual
    const selectedRow = zonesTableBody.querySelector('tr.selected');
    const selectedZoneId = selectedRow ? selectedRow.dataset.zoneId : null;

	// Ordenar las zonas por la columna seleccionada
	const sortedZones = [...zones].sort((a, b) => {
		let valueA, valueB;

		switch (zonesSortColumn) {
			case "type":
				valueA = a.custom ? 1 : 0; // `true` → 1, `false` → 0
				valueB = b.custom ? 1 : 0;
				return zonesSortAscending ? valueA - valueB : valueB - valueA; // Orden numérico
			case "name":
			default:
				valueA = (a.name || "").toLowerCase();
				valueB = (b.name || "").toLowerCase();
				return zonesSortAscending ? valueA.localeCompare(valueB) : valueB.localeCompare(valueA); // Orden alfabético
		}
	});


    // Obtener las filas actuales de la tabla
    const existingRows = Array.from(zonesTableBody.querySelectorAll('tr'));
    const existingZoneIds = existingRows.map(row => row.dataset.zoneId);

    // Actualizar o agregar filas
    sortedZones.forEach((zone, index) => {
        const {
            id,
            latitude,
            longitude,
            name,
            custom
        } = zone;

        if (!latitude || !longitude) {
            console.error("Invalid coordinates for the zone:", id);
            return;
        }

        let row = existingRows.find(row => row.dataset.zoneId === id);

        if (!row) {
            // Crear una nueva fila si no existe
            row = document.createElement('tr');
            row.dataset.zoneId = id;
            row.dataset.custom = custom;
            row.dataset.name = name;
			row.style.cursor = 'pointer'; // Cambiar el cursor al pasar
            zonesTableBody.appendChild(row);
        }

        // Determinar el contenido de la primera columna
        const adminColumnContent = `<div style="width: 10px; height: 10px; border: 2px solid ${custom ? 'green' : 'red'}; border-radius: 50%; background-color: ${custom ? 'rgba(0, 255, 0, 0.3)' : 'rgba(255, 0, 0, 0.3)'}; margin: auto;" title="${custom ? 'Editable' : 'No editable'}"></div>`;

        // Actualizar el contenido de la fila si es necesario
        const newContent = `
		  <td>${adminColumnContent}</td>
		  <td>${name || t('zone_without_name')}</td>
		`;

        if (row.innerHTML !== newContent) {
            row.innerHTML = newContent;
			row.dataset.name = name;
        }

        // Asignar evento de clic para centrar en el mapa y mostrar el popup
        row.onclick = () => {
            const marker = zoneMarkers[id];
            if (marker) {
                const circleBounds = marker.getBounds(); // Obtener los límites del círculo
                map.fitBounds(circleBounds); // Ajustar el zoom para encuadrar el círculo
                marker.openPopup(); // Mostrar el popup
            } else {
                console.error("No marker found for the zone:", id);
            }

            // Gestionar la selección de la fila
            zonesTableBody.querySelectorAll('tr').forEach(r => r.classList.remove('selected'));
            row.classList.add('selected');

            // Actualizar botones después de seleccionar una fila
            updateZoneActionButtons();
        };

        // Asegurar que la fila esté en la posición correcta (reordenar si es necesario)
        if (zonesTableBody.children[index] !== row) {
            zonesTableBody.insertBefore(row, zonesTableBody.children[index]);
        }

        // Mantener la selección si la zona actual está seleccionada
        if (id === selectedZoneId) {
            row.classList.add('selected');
        }
    });

    // Eliminar filas de zonas que ya no existen
    existingRows.forEach(row => {
        if (!sortedZones.some(zone => zone.id === row.dataset.zoneId)) {
            row.remove();
        }
    });

    // Actualizar botones después de procesar las zonas
    updateZoneActionButtons();
	updatePersonsTable();
	
    // Actualizar encabezados con flechas de ordenación
	if (previousSortColumn !== zonesSortColumn || previousSortAscending !== zonesSortAscending) {
		updateZonesTableHeaders();	
		previousSortColumn = zonesSortColumn;
		previousSortAscending = zonesSortAscending;
	}
}

function updateZonesTableHeaders() {
    const table = document.querySelector("#zones-table"); // Asegurarse de que busca en la tabla correcta
    if (!table) {
        console.error("Zone summary table not found.");
        return;
    }

    const headers = table.querySelectorAll("thead th");

    headers.forEach((header) => {
        const columnKey = header.getAttribute("data-i18n");
        let columnName = "";

        switch (columnKey) {
            case "type":
                columnName = "type";
                break;
            case "name":
                columnName = "name";
                break;
        }

        if (!columnName) return;

        // Aplicamos el cursor solo en esta tabla
        header.style.cursor = "pointer";

        header.onclick = () => {
            if (zonesSortColumn === columnName) {
                zonesSortAscending = !zonesSortAscending;
            } else {
                zonesSortColumn = columnName;
                zonesSortAscending = true;
            }
            updateZonesTable();
        };

        let arrow = "";
        if (zonesSortColumn === columnName) {
            arrow = zonesSortAscending ? "▲" : "▼";
        }

        // Crear la estructura con un div para separar el título y la flecha con altura fija
        header.innerHTML = `
            <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 30px;">
                <span>${t(columnKey)}</span>
                <span style="font-size: 12px;">${arrow}</span>
            </div>
        `;
    });
}