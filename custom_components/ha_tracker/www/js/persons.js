//	
// DEVICES
//

import {fetchPersons, fetchDevices} from './fetch.js';
import {formatDate, isValidCoordinates} from './utils.js';
import {handleZonePosition} from './zones.js';
import {map} from './map.js';
import {t} from './i18n.js';

const DEFAULT_ICON_URL = '/local/ha-tracker/images/location-red.png';

export let persons = [];
let devices = [];
let personsDevicesMap = {};
let personsMarkers = {};


export async function updatePersons(){
	try {
		await fetchPersons();
		await fetchDevices();
		await updatePersonsDevicesMap();
		await updatePersonsTable();
		await updatePersonsMarkers();
		await updatePersonsFilter();
    } catch (error) {
		console.error("Error al actualizar dispositivos:", error);
		throw error;
    }
}

export async function setDevices(data) {
    try {
        devices = Array.isArray(data) ? data.filter(d => d.entity_id && d.attributes) : [];
        console.log("Devices válidos obtenidos:", devices);
    } catch (error) {
        console.error("Error al procesar dispositivos:", error);
        devices = [];
    }
}

export async function setPersons(data) {
    try {
        persons = Array.isArray(data) ? data.filter(p => p.attributes?.friendly_name) : [];
        console.log("Personas válidas obtenidas:", persons);
    } catch (error) {
        console.error("Error al procesar personas:", error);
        persons = [];
    }
}

export async function handlePersonsSelection(personId) {
    if (!personId) return;

    const selectedPerson = personsMarkers[personId];
    if (!selectedPerson) return;

    // Verificar si personsDevicesMap[personId] existe antes de acceder a sus propiedades
    const selectedDevice = personsDevicesMap[personId];
    if (!selectedDevice) {
        console.error(`No se encontró un device para la persona con ID: ${personId}`);
        return;
    }

    // Obtener coordenadas desde el device_tracker almacenado
    const { latitude: lat, longitude: lng } = selectedDevice.attributes || {};
    if (!isValidCoordinates(lat, lng)) {
        console.error(`Coordenadas no válidas para ${personId}: lat=${lat}, lng=${lng}`);
        return;
    }

    selectedPerson.openPopup();
    map.invalidateSize();
    map.setView([lat, lng], map.getZoom());
}

export function updatePersonsFilter() {
    const select = document.getElementById('person-select');
    const selectedPersonId = select.value;

    const fragment = document.createDocumentFragment();
    const defaultOption = document.createElement('option');
    defaultOption.value = '';
    defaultOption.textContent = t('select_user');
    fragment.appendChild(defaultOption);

    persons
        .filter(person => person.attributes.source && person.attributes.source.trim() !== "") // Verifica si "source" existe y tiene valor
        .forEach(person => { 
            const option = document.createElement('option');
            option.value = person.entity_id;

            // Mostrar nombre amigable, ID o entity_id si no hay otro dato
            const label = person.attributes.friendly_name || person.attributes.id || person.entity_id;
            option.textContent = label ? label.trim() : "";

            fragment.appendChild(option);
        });

    select.innerHTML = ''; // Limpia el select antes de agregar nuevas opciones
    select.appendChild(fragment);

    if (selectedPersonId && persons.some(person => person.entity_id === selectedPersonId)) {
        select.value = selectedPersonId;
    }
}

export async function fitMapToAllPersons() {
    try {
        // Obtener sólo aquellos device_trackers en personsDevicesMap que tengan lat/long
        const coords = Object.values(personsDevicesMap)
            .filter(device => device.attributes.latitude && device.attributes.longitude)
            .map(device => [device.attributes.latitude, device.attributes.longitude]);

        if (!coords.length) {
            console.log("No hay dispositivos con coordenadas para ajustar el mapa.");
            map.setView([40.4168, -3.7038], 6); // Fallback a Madrid, por ejemplo
            return;
        }

        // Crear un LatLngBounds con todas las coordenadas
        const bounds = L.latLngBounds(coords);

        // Escuchar el evento "moveend" solo una vez
        map.once("moveend", () => {
            map.setZoom(map.getZoom() - 1); // Reducir el zoom en 1
        });

        // Ajustar el mapa para que todas las coordenadas encajen en la vista
        map.fitBounds(bounds);
    } catch (error) {
        console.error("Error al hacer fitMapToAllDevices:", error);
    }
}

async function updatePersonsDevicesMap() {
    personsDevicesMap = {};

    persons.forEach(person => {
        const source = person.attributes?.source; // Obtener el device_tracker de la persona

        // Verificar que source existe y tiene un valor válido
        if (!source || typeof source !== "string" || source.trim() === "") {
            console.warn(`La persona ${person.attributes.friendly_name || person.entity_id} no tiene un 'source' válido.`);
            return; // Salta esta persona y continúa con la siguiente
        }

        // Buscar el device_tracker completo en la lista de devices
        const device = devices.find(device => device.entity_id === source);

        if (!device) {
            throw new Error(`El 'source' (${source}) de ${person.attributes.friendly_name || person.entity_id} no está en devices_tracker.`);
        }

        // Asegurar que el device tiene latitud y longitud
        if (!device.attributes.latitude || !device.attributes.longitude) {
            console.warn(`El device_tracker ${source} de ${person.attributes.friendly_name || person.entity_id} no tiene lat/lng.`);
			return; // Salta esta persona y continúa con la siguiente
        }

        // Asignar el device_tracker completo al mapa usando el entity_id de la persona
        personsDevicesMap[person.entity_id] = device;
    });

    console.log("Mapeo de personas a dispositivos actualizado:", personsDevicesMap);
}

async function updatePersonsMarkers() {
    if (!map.getPane('topMarkers')) {
        map.createPane('topMarkers').style.zIndex = 500;
    }

    const currentPersonIds = Object.keys(personsDevicesMap);

    // Eliminar marcadores de personas que ya no existen en personsDevicesMap
    Object.keys(personsMarkers).forEach(personId => {
        if (!currentPersonIds.includes(personId)) {
            map.removeLayer(personsMarkers[personId]);
            delete personsMarkers[personId];
        }
    });

    // Recorrer todas las personas con un device_tracker asociado
    currentPersonIds.forEach(personId => {
        const device = personsDevicesMap[personId]; // Obtener el device_tracker asociado

        const {
            latitude,
            longitude,
            friendly_name,
            speed
        } = device.attributes;

        if (!isValidCoordinates(latitude, longitude))
            return;

        const formattedDate = formatDate(device.last_updated || t("date_unavailable"));
        const ownerName = persons.find(p => p.entity_id === personId)?.attributes.friendly_name || '';
        const iconUrl = persons.find(p => p.entity_id === personId)?.attributes.entity_picture || DEFAULT_ICON_URL;

        const popupContent = `
            <strong>${ownerName}</strong><br>
            ${formattedDate}<br>
            ${speed || 0} ${t('km_per_hour')}
        `;

        const markerIcon = L.divIcon({
            className: '',
            html: `<img src="${iconUrl}" style="width:48px;height:48px;border-radius:50%;object-fit:cover;" />`,
            iconSize: [48, 48],
            iconAnchor: [24, 24],
            popupAnchor: [0, -24],
        });

        if (personsMarkers[personId]) {
            // Si ya existe el marcador, actualizarlo
            const existingMarker = personsMarkers[personId];
            existingMarker.setLatLng([latitude, longitude]);
            existingMarker.setIcon(markerIcon);
            existingMarker.getPopup().setContent(popupContent);
        } else {
            // Crear un nuevo marcador si no existe
            personsMarkers[personId] = L.marker([latitude, longitude], {
                icon: markerIcon,
                pane: 'topMarkers'
            })
            .addTo(map)
            .bindPopup(popupContent, {
                autoPan: false
            })
            .on('click', () => {
                handlePersonRowSelection(personId); // Selecciona la fila en la tabla
                map.setView([latitude, longitude], map.getZoom(), { animate: true }); // Centra el mapa
                personsMarkers[personId].openPopup(); // Abre el popup del marcador
            });
        }
    });
}

export async function updatePersonsTable() {
    try {
        const tableBody = document.getElementById("persons-table-body");
        if (!tableBody) {
            console.error("No se encontró el tbody de la tabla de persons.");
            return;
        }

        // Almacenar la fila seleccionada actual
        const selectedRow = tableBody.querySelector("tr.selected");
        const selectedPersonId = selectedRow ? selectedRow.dataset.personId : null;

        // Ordenar las personas por nombre
        const sortedPersons = [...persons].sort((a, b) => {
            const nameA = (a.attributes.friendly_name || a.entity_id).toLowerCase();
            const nameB = (b.attributes.friendly_name || b.entity_id).toLowerCase();
            return nameA.localeCompare(nameB);
        });

        // Obtener las filas actuales de la tabla
        const existingRows = Array.from(tableBody.querySelectorAll("tr"));
        const existingPersonIds = existingRows.map(row => row.dataset.personId);

        // Actualizar o agregar filas
        sortedPersons.forEach((person, index) => {
            const personId = person.entity_id;
            const friendlyName = person.attributes.friendly_name || personId;
            const source = person.attributes.source || null; // El device_tracker vinculado

            let time = "";
            let speed = "";
            let currentZoneName = "";

            // Si la persona tiene un device_tracker en personsDevicesMap, extraer datos
            if (source && personsDevicesMap[personId]) {
                const device = personsDevicesMap[personId];

                time = formatDate(device.last_updated);
                speed = device.attributes.speed;
                const zone = handleZonePosition(device.attributes.latitude, device.attributes.longitude);
                currentZoneName = zone ? zone.name : "";
            }

            let row = existingRows.find(row => row.dataset.personId === personId);

            if (!row) {
                // Crear una nueva fila si no existe
                row = document.createElement("tr");
                row.dataset.personId = personId;
                row.style.cursor = "pointer"; // Cambia el cursor al pasar por encima
                tableBody.appendChild(row);
            }

            // Actualizar el contenido de la fila si es necesario
            const newContent = `
                <td>${friendlyName}</td>
                <td>${time}</td>
                <td>${speed}</td>
                <td>${currentZoneName}</td>
            `;

            if (row.innerHTML !== newContent) {
                row.innerHTML = newContent;
            }

            // Asignar evento de clic para centrar en el mapa
            row.onclick = () => {
                // Quitar selección de todas las filas
                tableBody.querySelectorAll("tr").forEach(r => r.classList.remove("selected"));
                row.classList.add("selected");

                handlePersonsSelection(personId);
            };

            // Asegurar que la fila esté en la posición correcta (reordenar si es necesario)
            if (tableBody.children[index] !== row) {
                tableBody.insertBefore(row, tableBody.children[index]);
            }

            // Mantener la selección si la persona actual estaba seleccionada
            if (personId === selectedPersonId) {
                row.classList.add("selected");
            }
        });

        // Eliminar filas de personas que ya no existen
        existingRows.forEach(row => {
            if (!sortedPersons.some(person => person.entity_id === row.dataset.personId)) {
                row.remove();
            }
        });

        console.log("Tabla de personas actualizada correctamente.");
    } catch (error) {
        console.error("Error al actualizar la tabla de personas:", error);
    }
}

export async function handlePersonRowSelection(personId) {
    console.log("Seleccionando fila para la persona:", personId);

    const personTableBody = document.getElementById('persons-table-body');
    if (!personTableBody) {
        console.error("No se encontró el tbody de la tabla de persons.");
        return;
    }

    const row = personTableBody.querySelector(`tr[data-person-id="${personId}"]`);
    if (!row) {
        console.warn("No se encontró la fila para la persona:", personId);
        return;
    }

    // Cambiar el combo a "users" si no está seleccionado
    const comboSelect = document.getElementById('combo-select');
    if (comboSelect && comboSelect.value !== 'users') {
        comboSelect.value = 'users';

        // Disparar evento de cambio para actualizar la interfaz
        comboSelect.dispatchEvent(new Event('change', { bubbles: true }));
    }

    // Resaltar la fila en la tabla de personas
    personTableBody.querySelectorAll('tr').forEach(r => r.classList.remove('selected'));
    row.classList.add('selected'); // Agregar clase de selección

    // Hacer scroll hacia la fila seleccionada
    row.scrollIntoView({ behavior: 'smooth', block: 'center' });

    console.log("Fila de la persona seleccionada correctamente.");
}
