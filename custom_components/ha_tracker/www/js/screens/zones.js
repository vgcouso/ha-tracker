//
// ZONES
//

import { isAdmin, fmt0, fmt2, use_imperial, CUSTOM_DEFAULT_COLOR, NO_CUSTOM_DEFAULT_COLOR, DEFAULT_ALPHA } from '../globals.js';
import { map, getDistanceFromLatLonInMeters } from '../utils/map.js';
import { deleteZone, updateZone, createZone, fetchZones } from '../ha/fetch.js';
import { updatePersonsTable } from '../screens/persons.js';
import { t, tWithVars } from '../utils/i18n.js';
import { uiConfirm, uiPrompt, uiAlert, toRgba } from '../utils/dialogs.js';

let zones = [], zoneMarkers = {};
let zonesSortColumn = "name"; // Columna predeterminada para ordenación
let zonesSortAscending = true; // Orden ascendente predeterminado
let previousSortColumn = "";
let previousSortAscending = true;

const editingZones = {};
const MAX_ZONE_NAME_LENGTH = 30;
const DIACRITICS_RE = /\p{Diacritic}/gu;

export async function initZones() {
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
}

export async function updateZones() {
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
        const { latitude, longitude, radius, name, custom } = zone;
		
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

        const baseHex = custom ? (zone.color || CUSTOM_DEFAULT_COLOR) : NO_CUSTOM_DEFAULT_COLOR;
        const strokeColor = baseHex; // usa el hex tal cual para el borde
        const fillColor = toRgba(baseHex, 0.25); // relleno con alpha

        if (existingCircle) {
            // Actualizar el popup si el nombre ha cambiado
            const popupContent = `
			<strong>${name || t("zone_without_name")}</strong><br>
			 ${t('radius')}: ${use_imperial ? fmt0(radius * 3.28084) : fmt0(radius)} ${use_imperial ? t('feets') : t('meters')}
		    `;

            if (existingCircle.getPopup().getContent() !== popupContent) {
                existingCircle.setPopupContent(popupContent);
            }

            if (existingCircle.options.color !== strokeColor || existingCircle.options.fillColor !== fillColor) {
                existingCircle.setStyle({
                    color: strokeColor,
                    fillColor,
                    fillOpacity: 1
                });
            }
        }

        // Si no hay cambios y el marcador ya existe, omitir
        if (!hasChanged) {
            return;
        }

        // Si ya existe un círculo para la zona, guardamos el estado del popup
        let isPopupOpen = false;
        if (zoneMarkers[zone.id]) {
            const prevCircle = zoneMarkers[zone.id];
            const wasOpen = prevCircle.isPopupOpen();
            map.removeLayer(prevCircle);
            delete zoneMarkers[zone.id];
        }

        const circle = L.circle([latitude, longitude], {
            radius,
            color: strokeColor, // borde en hex
            fillColor, // relleno rgba(...)
            fillOpacity: 1, // ya llevamos la alpha en fillColor
            opacity: 0.8,
            pane: 'circlePane',
        }).addTo(map);

        // Habilitar edición
        if (isAdmin && custom) {
            circle.enableEdit();
        }

        // Añadir el popup y personalizar su comportamiento
        const newPopupContent = `
		 <strong>${name || t("zone_without_name")}</strong><br>
		 ${t('radius')}: ${use_imperial ? fmt0(radius * 3.28084) : fmt0(radius)} ${use_imperial ? t('feets') : t('meters')}
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
			 ${t('radius')}: ${use_imperial ? fmt0(radius * 3.28084) : fmt0(radius)} ${use_imperial ? t('feets') : t('meters')}
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
        const changeEvent = new Event('change', {
            bubbles: true
        });
        comboSelect.dispatchEvent(changeEvent);
    }

    // Resaltar la fila en la tabla de zonas
    zonesTableBody.querySelectorAll('tr').forEach(r => r.classList.remove('selected')); // Limpiar selección previa
    row.classList.add('selected'); // Resaltar la fila seleccionada

    // Asegurar que la fila sea visible antes de hacer scroll
    row.scrollIntoView({
        behavior: 'smooth',
        block: 'center'
    });

    // Llamar a updateZoneActionButtons solo si hay una fila seleccionada
    if (typeof updateZoneActionButtons === "function") {
        updateZoneActionButtons();
    }
}

export async function updateZoneActionButtons() {
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
        uiAlert(t('select_delete_zone'), {
            title: t('zones')
        });
        return;
    }

    const zoneId = selectedRow.dataset.zoneId;
    const name = selectedRow.dataset.name;

    if (!zoneId) {
        console.error("The selected zone ID was not found.");
        return;
    }

    const confirmDelete = await uiConfirm(
            tWithVars('confirm_delete_zone', {
                name
            }), {
            type: 'danger',
            okLabel: t('delete'),
            title: t('zones')
        });

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
        uiAlert(t('error_deleting_zone'), {
            title: t('zones')
        });
    }
}

async function handleEditZone() {
    const zonesTableBody = document.getElementById('zones-table-body');
    if (!zonesTableBody) {
        console.error("Zone table body not found.");
        return;
    }

    const selectedRow = zonesTableBody.querySelector('tr.selected');
    if (!selectedRow) {
        uiAlert(t('select_zone'), {
            title: t('zones')
        });
        return;
    }

    const zoneId = selectedRow.dataset.zoneId;
    const zone = zones.find(z => z.id === zoneId);
    if (!zone) {
        uiAlert(t('error_finding_zone'), {
            title: t('zones')
        });
        return;
    }

    const res = await uiPrompt(t('enter_zone_name'), zone.name || t('zone_without_name'), {
        title: t('zones'),
        withColor: true,
        defaultColor: zone.color,
        colorLabel: t('select_color'),
        colorOptions: {
            palette: [],
            allowAlpha: false,
            showNative: false
        },
    });
    if (res === null)
        return;

    const cleaned = normalizeZoneNameInput(res.value);
    if (cleaned === null)
        return;

    // Si no cambió ni el nombre (normalizado) ni el color, no hagas nada
    const newColor = res.color || zone.color || CUSTOM_DEFAULT_COLOR;
    if (canonZoneName(cleaned) === canonZoneName(zone.name) &&
        newColor === (zone.color || CUSTOM_DEFAULT_COLOR)) {
        return;
    }

    // Unicidad EXCLUYENDO la zona actual
    await fetchZones();
    if (isZoneNameTaken(cleaned, {
            excludeId: zone.id
        })) {
        uiAlert(t('zone_name_exists'), {
            title: t('zones')
        });
        return;
    }

    try {
        const response = await updateZone(
                zone.id,
                cleaned,
                zone.radius,
                zone.latitude,
                zone.longitude,
                newColor);

        if (response && response.success) {
            zone.name = cleaned; // refresco local
            zone.color = newColor;

            await fetchZones();
            await updateZonesTable();
            await updateZoneMarkers();
            await handleZoneRowSelection(zone.id);
        } else {
            uiAlert(t('error_updating_zone'), {
                title: t('zones')
            });
        }
    } catch (error) {
        console.error("Error in zone update request:", error);
        uiAlert(t('error_updating_zone'), {
            title: t('zones')
        });
    }
}

async function handleCreateZone() {
    if (!map) {
        console.error("The map is not initialized.");
        return null;
    }

    // Solicitar el nombre de la zona al usuario
    const res = await uiPrompt(t('enter_zone_name'), '', {
        title: t('zones'),
        withColor: true,
        defaultColor: CUSTOM_DEFAULT_COLOR,
        colorLabel: t('select_color'),
        colorOptions: {
            palette: [],
            allowAlpha: false,
            showNative: false
        },
    });
    if (res === null)
        return; // cancelado
    const cleaned = normalizeZoneNameInput(res.value);
    if (cleaned === null)
        return;

    // nombres de zona únicos
    await fetchZones();
    if (isZoneNameTaken(cleaned)) {
        uiAlert(t('zone_name_exists'), {
            title: t('zones')
        });
        return;
    }

    // Obtener el centro actual del mapa
    const center = map.getCenter();
    const latitude = center.lat;
    const longitude = center.lng;

    const radius = 100; // Radio fijo de 100 metros

    try {
        // Crear la zona con el nombre validado
        const color = res.color || CUSTOM_DEFAULT_COLOR;
        const newZoneId = await createZone(cleaned, radius, latitude, longitude, "mdi:map-marker", false, true, color)
            if (newZoneId) {
                await fetchZones();
                await updateZonesTable();
                await updateZoneMarkers();
                await handleZoneRowSelection(newZoneId);
                console.log(`Zone created successfully. ID: ${newZoneId}`);
                return newZoneId;
            } else {
                console.error("Failed to create zone.");
                uiAlert(t('error_creating_zone'), {
                    title: t('zones')
                });
                return null;
            }
    } catch (error) {
        console.error("Error in zone update request:", error);
        uiAlert(t('error_creating_zone'), {
            title: t('zones')
        });
    }
}

export function handleZonePosition(latitude, longitude, opts = {}) {
    const { accuracy = 0,
    includePassive = false,
    // Puedes tunearlas por llamada:
    epsilonM = 0.5, // tolerancia en metros para empates
    epsilonDeg = 1e-5, // ~1 m para agrupar centros
     } = opts;

    // Helpers locales
    const quant = v => Math.round(v / epsilonDeg);
    const centerKey = (lat, lon) => `${quant(lat)},${quant(lon)}`;

    // Validaciones
    if (
        latitude == null || longitude == null ||
        Number.isNaN(latitude) || Number.isNaN(longitude))
        return null;

    // 1) Candidatas que contienen el punto (radio + accuracy)
    const candidates = [];
    for (let i = 0; i < zones.length; i++) {
        const z = zones[i];
        if (!z)
            continue;
        if (z.passive && !includePassive)
            continue;

        // Usa tu función existente de distancia en metros:
        const d = getDistanceFromLatLonInMeters(latitude, longitude, z.latitude, z.longitude);
        const effectiveRadius = (Number(z.radius) || 0) + (Number(accuracy) || 0);

        if (d <= effectiveRadius) {
            candidates.push({
                zone: z,
                idx: i,
                distanceToCenter: d,
                key: centerKey(z.latitude, z.longitude),
                radius: Number(z.radius) || 0,
                id: z.entity_id || z.id || z.name || `idx:${i}`,
            });
        }
    }

    if (candidates.length === 0)
        return null;
    if (candidates.length === 1)
        return candidates[0].zone;

    // 2) Concéntricas: quedarse con la de menor radio para cada centro
    const byCenterBest = new Map();
    for (const c of candidates) {
        const prev = byCenterBest.get(c.key);
        if (!prev || c.radius < prev.radius - epsilonM) {
            byCenterBest.set(c.key, c);
        } else if (Math.abs(c.radius - prev.radius) <= epsilonM) {
            if (String(c.id) < String(prev.id))
                byCenterBest.set(c.key, c);
        }
    }
    const reduced = Array.from(byCenterBest.values());
    if (reduced.length === 1)
        return reduced[0].zone;

    // 3) Distintos centros: más cercana; luego menor radio; luego id estable
    reduced.sort((a, b) => {
        const dd = a.distanceToCenter - b.distanceToCenter;
        if (Math.abs(dd) > epsilonM)
            return dd;

        const dr = a.radius - b.radius;
        if (Math.abs(dr) > epsilonM)
            return dr;

        return String(a.id).localeCompare(String(b.id));
    });

    return reduced[0].zone;
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
        console.error("Marker for zone not found: ", idZone);
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
        let valueA,
        valueB;

        switch (zonesSortColumn) {
        case "type":
            valueA = a.custom ? 1 : 0; // `true` → 1, `false` → 0
            valueB = b.custom ? 1 : 0;
            return zonesSortAscending ? valueA - valueB : valueB - valueA; // Orden numérico
        case "radius": // NUEVO
            valueA = Number(a.radius) || 0;
            valueB = Number(b.radius) || 0;
            return zonesSortAscending ? valueA - valueB : valueB - valueA;
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
        const { id, latitude, longitude, name, custom } = zone;

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
        const color = custom ? (zone.color || CUSTOM_DEFAULT_COLOR) : NO_CUSTOM_DEFAULT_COLOR;
        row.style.setProperty('--color-bg', toRgba(color, DEFAULT_ALPHA));
        const adminColumnContent = `<div style="
		  width:10px; height:10px; border:2px solid ${color};
		  border-radius:50%;
		  background-color:${toRgba(color, 0.3)};
		  margin:auto;"></div>`;


		const radiusText = `${use_imperial ? fmt0(zone.radius * 3.28084) : fmt0(zone.radius)}`;
		
        // Actualizar el contenido de la fila si es necesario
        const newContent = `
		  <td>${adminColumnContent}</td>
		  <td>${name || t('zone_without_name')}</td>
		  <td>${radiusText}</td>
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
    const table = document.querySelector("#zones-table");
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
        case "radius": 
            columnName = "radius";
            break;
        }

        if (!columnName)
            return;

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
		
	   const label = (columnKey === 'radius')
		 ? `${use_imperial ? t('feets') : t('meters')}`
		 : t(columnKey);		

        header.innerHTML = `
		  <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; height:30px;">
			<span class="hdr-label">${label}</span>
			<span style="font-size:12px;">${arrow}</span>
		  </div>
		`;
    });
}

function normalizeZoneNameInput(name) {
    const trimmed = (name || "").trim();

    if (trimmed === "") {
        uiAlert(t('empty_name'), {
            title: t('zones')
        });
        return null;
    }
    if (trimmed.length > MAX_ZONE_NAME_LENGTH) {
        uiAlert(t('long_zone'), {
            title: t('zones')
        });
        return null;
    }
    return trimmed;
}

function canonZoneName(s) {
    return (s ?? "")
    .toLocaleLowerCase()
    .normalize("NFD")
    .replace(DIACRITICS_RE, "") // quita acentos
    .replace(/\s+/g, " ") // colapsa espacios
    .trim();
}

function isZoneNameTaken(name, {
    excludeId = null
} = {}) {
    const cand = canonZoneName(name);
    if (!cand)
        return false;
    return zones.some(z =>
        z &&
        canonZoneName(z.name) === cand &&
        (excludeId == null || String(z.id) !== String(excludeId)));
}
