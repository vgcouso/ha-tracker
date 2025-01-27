//
// ZONES
//

import {isAdmin} from './globals.js';
import {map} from './map.js';
import {getDistanceFromLatLonInMeters, hideWindowOverlay} from './utils.js';
import {deleteZone, updateZone, createZone, fetchZones} from './fetch.js';
import {t, tWithVars} from './i18n.js';

let zones = [], zoneMarkers = {};

document.addEventListener("DOMContentLoaded", () => {
    const addZoneButton = document.getElementById("add-zone-button");
    const deleteZoneButton = document.getElementById("delete-zone-button");
    const editZoneButton = document.getElementById("edit-zone-button");

    if (addZoneButton) {
        addZoneButton.addEventListener("click", async() => {
            try {
                await handleCreateZone();
            } catch (error) {
                console.error("Error al añadir una zona:", error);
            }
        });
    }

    if (deleteZoneButton) {
        deleteZoneButton.addEventListener("click", async() => {
            try {
                await handleDeleteZone();
            } catch (error) {
                console.error("Error al eliminar una zona:", error);
            }
        });
    }

    if (editZoneButton) {
        editZoneButton.addEventListener("click", async() => {
            try {
                await handleEditZone();
            } catch (error) {
                console.error("Error al modificar una zona:", error);
            }
        });
    }
});

export async function setZones(data) {
    try {
        if (data && Array.isArray(data)) {
            zones = data; // Asigna los datos obtenidos a la variable global
            console.log("Zonas obtenidas:", zones);
        } else {
            console.warn("No se obtuvieron zonas válidas desde el servidor.");
            zones = []; // Asegura que `zones` sea un arreglo vacío en caso de error
        }
    } catch (error) {
        console.error("Error al obtener zonas:", error);
        zones = []; // Asegura que `zones` no quede indefinido si ocurre un error
    }
}

export async function updateZonesTable() {
    const zonesTableBody = document.getElementById('zones-table-body');

    if (!zonesTableBody) {
        console.error("No se encontró el cuerpo de la tabla de zonas.");
        return;
    }

    // Almacenar la fila seleccionada actual
    const selectedRow = zonesTableBody.querySelector('tr.selected');
    const selectedZoneId = selectedRow ? selectedRow.dataset.zoneId : null;

    // Ordenar las zonas alfabéticamente por `name`
    const sortedZones = [...zones].sort((a, b) => {
        const nameA = (a.name || '').toLowerCase();
        const nameB = (b.name || '').toLowerCase();
        return nameA.localeCompare(nameB);
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
            console.error("Coordenadas inválidas para la zona:", id);
            return;
        }

        let row = existingRows.find(row => row.dataset.zoneId === id);

        if (!row) {
            // Crear una nueva fila si no existe
            row = document.createElement('tr');
            row.dataset.zoneId = id;
            row.dataset.custom = custom;
            row.dataset.name = name;
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
                console.error("No se encontró un marcador para la zona:", id);
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
}

const editingZones = {};

export async function updateZoneMarkers() {
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
            console.error("Zona inválida:", zone.id);
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
                console.error("Error al manejar la selección de fila de zona:", error);
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
			<strong>${zone.name || 'Zona sin nombre'}</strong><br>
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
                        console.log(`Zona con ID ${zone.id} actualizada en el servidor.`);
                    } else {
                        console.error(`Error al actualizar la zona con ID ${zone.id} en el servidor.`);
                    }
                } catch (error) {
                    console.error("Error en la solicitud de actualización de la zona:", error);
                }
            }
        });

        // Guardar el círculo en los marcadores
        zoneMarkers[zone.id] = circle;
    });
}

export async function handleZoneRowSelection(zoneId) {
    console.log("Seleccionando fila para la zona");

    const zonesTableBody = document.getElementById('zones-table-body');
    const row = zonesTableBody.querySelector(`tr[data-zone-id="${zoneId}"]`);
    if (!row) {
        return;
        console.error("No se encontró la fila para la zona:", zoneId);
    }

    // Cambiar el combo a "Zonas"
    const comboSelect = document.getElementById('combo-select');
    if (comboSelect && comboSelect.value !== 'zones') {
        comboSelect.value = 'zones';

        // Disparar el evento de cambio manualmente
        const changeEvent = new Event('change', {
            bubbles: true
        });
        comboSelect.dispatchEvent(changeEvent);
    }

    // Resaltar la fila en la tabla de zonas
    const rows = zonesTableBody.querySelectorAll('tr');

    rows.forEach(r => r.classList.remove('selected')); // Limpiar selección previa
    row.classList.add('selected'); // Resaltar la fila seleccionada

    row.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
    });

    updateZoneActionButtons();
}

async function updateZoneActionButtons() {
    const zonesTable = document.getElementById('zones-table-body');
    const rows = zonesTable.querySelectorAll('tr');
    const addButton = document.getElementById('add-zone-button');
    const deleteButton = document.getElementById('delete-zone-button');
    const editButton = document.getElementById('edit-zone-button');
    const zoneActions = document.getElementById('zone-actions');

    // Ocultar todos los botones al inicio para evitar conflictos
    addButton.classList.add('hidden');
    deleteButton.classList.add('hidden');
    editButton.classList.add('hidden');

    if (isAdmin) {
        document.getElementById('zone-actions').style.display = 'flex';
    } else {
        document.getElementById('zone-actions').style.display = 'none';
        return;
    }

    // Si no hay filas en la tabla, solo mostrar el botón de añadir
    if (rows.length === 0) {
        addButton.classList.remove('hidden'); // Mostrar solo "Añadir"
        zoneActions.classList.add('single-button'); // Asegurar diseño de un solo botón
        addButton.style.flex = '1'; // Ocupa todo el ancho
    } else {
        const selectedRow = zonesTable.querySelector('tr.selected');
        if (!selectedRow) {
            // Si no hay fila seleccionada, solo mostrar "Añadir"
            addButton.classList.remove('hidden');
            zoneActions.classList.add('single-button'); // Asegurar diseño de un solo botón
            addButton.style.flex = '1'; // Ocupa todo el ancho
        } else {
            const isCustom = selectedRow.dataset.custom === "true";
            if (isCustom) {
                addButton.classList.remove('hidden');
                deleteButton.classList.remove('hidden');
                editButton.classList.remove('hidden');
                zoneActions.classList.remove('single-button'); // Quitar diseño de un solo botón
                addButton.style.flex = '1'; // Ajustar para compartir el ancho con los demás
            } else {
                addButton.classList.remove('hidden');
                zoneActions.classList.add('single-button'); // Asegurar diseño de un solo botón
                addButton.style.flex = '1'; // Ocupa todo el ancho
            }
        }
    }

    // Si solo hay un botón visible, asegúrate de que ocupe todo el ancho
    const visibleButtons = [addButton, deleteButton, editButton].filter(
        button => !button.classList.contains('hidden'));

    if (visibleButtons.length === 1) {
        zoneActions.classList.add('single-button'); // Asegurar que el diseño sea para un solo botón
        visibleButtons[0].style.flex = '1'; // Ocupa todo el ancho
    } else {
        zoneActions.classList.remove('single-button'); // Diseño para múltiples botones
        visibleButtons.forEach(button => (button.style.flex = '1')); // Distribuir el ancho uniformemente
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
        console.error("No se encontró el ID de la zona seleccionada.");
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
        console.error("Error al intentar eliminar la zona:", error);
        alert(t('error_deleting_zone'));
    }
}

async function handleEditZone() {
    const zonesTableBody = document.getElementById('zones-table-body');

    if (!zonesTableBody) {
        console.error("No se encontró el cuerpo de la tabla de zonas.");
        return;
    }

    // Obtener la fila seleccionada
    const selectedRow = zonesTableBody.querySelector('tr.selected');
    if (!selectedRow) {
        console.error("No hay ninguna zona seleccionada.");
        alert(t('select_zone'));
        return;
    }

    const zoneId = selectedRow.dataset.zoneId; // ID de la zona seleccionada
    const zone = zones.find(z => z.id === zoneId); // Buscar la zona en la lista global `zones`

    if (!zone) {
        console.error("No se encontró la zona seleccionada.");
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
            console.log(`Zona con ID ${zone.id} actualizada con éxito.`);

            // Actualizar el nombre en la lista `zones`
            zone.name = newName;

            await fetchZones();
            await updateZonesTable();
            await updateZoneMarkers();
            await handleZoneRowSelection(zone.id);
        } else {
            console.error(`Error al actualizar la zona con ID ${zone.id}. Respuesta:`, response);
            alert(t('error_updating_zone'));
        }
    } catch (error) {
        console.error("Error en la solicitud de actualización de la zona:", error);
        alert(t('error_updating_zone'));
    }
}

async function handleCreateZone() {
    if (!map) {
        console.error("El mapa no está inicializado.");
        return null;
    }

    // Solicitar el nombre de la zona al usuario
    const zoneName = prompt(t('enter_zone_name'));
    if (!zoneName || zoneName.trim() === "") {
        console.error("El nombre de la zona es obligatorio.");
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
        console.log(`Zona creada con éxito. ID: ${newZoneId}`);
        return newZoneId;
    } else {
        console.error("No se pudo crear la zona.");
        return null;
    }
}

export function getZoneForPosition(position) {
    const {
        latitude,
        longitude
    } = position.attributes;

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
        console.error("No se encontró el marcador para la zona.");
    }
}