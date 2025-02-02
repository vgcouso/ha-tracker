//	
// DEVICES
//

import {geocodeTime, geocodeDistance} from './globals.js';
import {fetchPersons, fetchDevices} from './fetch.js';
import {formatDate, isValidCoordinates, getDistanceFromLatLonInMeters} from './utils.js';
import {handleZonePosition} from './zones.js';
import {map} from './map.js';
import {t} from './i18n.js';

const DEFAULT_ICON_URL = '/local/ha-tracker/images/location-red.png';

export let persons = [];
let devices = [];
let personsDevicesMap = {};
let personsMarkers = {};

const lastGeocodeRequests = {}; // { deviceId: {lat, lon, timestamp, address} }
export let requestQueue = []; // Cola de solicitudes pendientes


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

    // Restablecer el zIndexOffset de todos los marcadores para evitar conflictos
    Object.values(personsMarkers).forEach(marker => marker.setZIndexOffset(500));

    // Aumentar el zIndexOffset del marcador seleccionado para que esté encima
    selectedPerson.setZIndexOffset(600);

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
            console.log(`La persona ${person.attributes.friendly_name || person.entity_id} no tiene un 'source' válido.`);
            return; // Salta esta persona y continúa con la siguiente
        }

        // Buscar el device_tracker completo en la lista de devices
        const device = devices.find(device => device.entity_id === source);

        if (!device) {
            throw new Error(`El 'source' (${source}) de ${person.attributes.friendly_name || person.entity_id} no está en devices_tracker.`);
        }

        // Asegurar que el device tiene latitud y longitud
        if (!device.attributes.latitude || !device.attributes.longitude) {
            console.log(`El device_tracker ${source} de ${person.attributes.friendly_name || person.entity_id} no tiene lat/lng.`);
			return; // Salta esta persona y continúa con la siguiente
        }

        // Asignar el device_tracker completo al mapa usando el entity_id de la persona
        personsDevicesMap[person.entity_id] = device;
    });

    console.log("Mapeo de personas a dispositivos actualizado:", personsDevicesMap);
}

async function updatePersonsMarkers() {
    if (!map.getPane('personsMarkers')) {
        map.createPane('personsMarkers').style.zIndex = 500;
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
		let batteryLevel = device.battery_level ? `<br>${t('battery')}: ${device.battery_level}${t('percentage')}` : "";

        if (!isValidCoordinates(latitude, longitude))
            return;

        const formattedDate = formatDate(device.last_updated || t("date_unavailable"));
        const ownerName = persons.find(p => p.entity_id === personId)?.attributes.friendly_name || '';
        const iconUrl = persons.find(p => p.entity_id === personId)?.attributes.entity_picture || DEFAULT_ICON_URL;

        const popupContent = `
            <strong>${ownerName}</strong> (${friendly_name})<br>
            ${formattedDate}<br>
            ${t('speed')}: ${speed || 0} ${t('km_per_hour')}
			${batteryLevel}
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
                pane: 'personsMarkers'
            })
            .addTo(map)
            .bindPopup(popupContent, {
                autoPan: false
            })
            .on('click', () => {
                handlePersonRowSelection(personId); // Selecciona la fila en la tabla
				map.invalidateSize();
				map.setView([latitude, longitude], map.getZoom());	
                personsMarkers[personId].openPopup(); // Abre el popup del marcador		
            });
        }
    });
}

export async function handlePersonRowSelection(personId) {
    console.log("Seleccionando fila para la persona:", personId);

    const selectedPerson = personsMarkers[personId];
    if (selectedPerson) {
        // Restablecer el zIndexOffset de todos los marcadores para evitar conflictos
        Object.values(personsMarkers).forEach(marker => marker.setZIndexOffset(500));
        // Aumentar el zIndexOffset del marcador seleccionado para que esté encima
        selectedPerson.setZIndexOffset(600);
    }

    const personTableBody = document.getElementById('persons-table-body');
    if (!personTableBody) {
        console.error("No se encontró el tbody de la tabla de persons.");
        return;
    }

    // Seleccionar la fila principal
    const row = personTableBody.querySelector(`tr[data-person-id="${personId}"]`);
    if (!row) {
        console.log("No se encontró la fila para la persona:", personId);
        return;
    }

    // Seleccionar la fila de dirección (la siguiente fila después de la principal)
    const addressRow = row.nextElementSibling;
    if (!addressRow || !addressRow.classList.contains("person-address-row")) {
        console.log("No se encontró la fila de dirección para la persona:", personId);
    }

    // Cambiar el combo a "users" si no está seleccionado
    const comboSelect = document.getElementById('combo-select');
    if (comboSelect && comboSelect.value !== 'users') {
        comboSelect.value = 'users';

        // Disparar evento de cambio para actualizar la interfaz
        comboSelect.dispatchEvent(new Event('change', { bubbles: true }));
    }

    // Quitar la selección de todas las filas
    personTableBody.querySelectorAll('tr').forEach(r => r.classList.remove('selected'));

    // Agregar la clase de selección a la fila principal y la de dirección
    row.classList.add('selected');
    if (addressRow) {
        addressRow.classList.add('selected');
    }

    // Hacer scroll hacia la fila principal (ajustado para que incluya la dirección)
    row.scrollIntoView({ behavior: 'smooth', block: 'center' });

    console.log("Fila de la persona y su dirección seleccionadas correctamente.");
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
        sortedPersons.forEach(async (person, index) => {
            const personId = person.entity_id;
            const friendlyName = person.attributes.friendly_name || personId;
            const source = person.attributes.source || null; // El device_tracker vinculado
			
			let deviceName = "";
            let time = "";
            let speed = "";
			let battery = "";
            let currentZoneName = "";
            let address = lastGeocodeRequests[personId]?.address || ""; // Usar la dirección almacenada si existe

            // Si la persona tiene un device_tracker en personsDevicesMap, extraer datos
            if (source && personsDevicesMap[personId]) {
                const device = personsDevicesMap[personId];
				
				deviceName = device.attributes.friendly_name ? `(${device.attributes.friendly_name})` : "";
				battery = device.battery_level;
                time = formatDate(device.last_updated);
                speed = device.attributes.speed;
				battery = device.battery_level;
                const zone = handleZonePosition(device.attributes.latitude, device.attributes.longitude);
                currentZoneName = zone ? zone.name : "";
                //address = device.geocoded_location; // Dirección de Home Assistant
				
                // Agregar la solicitud a la cola sin filtrar (será filtrada en `processQueue()`)
                requestQueue.push({
                    lat: device.attributes.latitude,
                    lon: device.attributes.longitude,
                    deviceId: personId,
                    updateCellCallback: (address) => {
                        const addressCell = tableBody.querySelector(`tr[data-person-id="${personId}"] + .person-address-row td`);
                        if (addressCell) {
                            addressCell.textContent = address;
                        }
                    }
                });				
            }

            let row = existingRows.find(row => row.dataset.personId === personId);
            let addressRow = row ? row.nextElementSibling : null;

            if (!row) {
                // Crear la fila principal si no existe
                row = document.createElement("tr");
                row.dataset.personId = personId;
                row.style.cursor = "pointer"; // Cambia el cursor al pasar por encima

				// Crear la fila para la dirección
				addressRow = document.createElement("tr");
				addressRow.dataset.personId = personId;
				addressRow.style.cursor = "pointer"; // Cambia el cursor al pasar por encima
				addressRow.classList.add("person-address-row");

				const addressCell = document.createElement("td");
				addressCell.setAttribute("colspan", "5");
				addressCell.textContent = address;
				addressCell.style.borderBottom = "1px solid rgba(0, 0, 0, 0.1)"; // Línea de separación debajo

				addressRow.appendChild(addressCell);

                // Agregar ambas filas a la tabla
                tableBody.appendChild(row);
                tableBody.appendChild(addressRow);
            }

            // Actualizar el contenido de la fila principal si es necesario
            const newContent = `
                <td><p style="font-weight: bold; color: #003366; margin: 0;">${friendlyName}</p>${deviceName}</td>
                <td>${time}</td>
                <td>${speed}</td>
				<td>${battery}</td>
                <td>${currentZoneName}</td>
            `;

            if (row.innerHTML !== newContent) {
                row.innerHTML = newContent;
            }

            // Actualizar la dirección si ya existe la fila
            if (addressRow) {
                addressRow.querySelector("td").textContent = address;
            }

			// Asignar evento de clic a ambas filas
			const selectPerson = () => {
				// Quitar selección de todas las filas
				tableBody.querySelectorAll("tr").forEach(r => r.classList.remove("selected"));

				// Seleccionar la fila principal y la fila de dirección
				row.classList.add("selected");
				if (addressRow) {
					addressRow.classList.add("selected");
				}

				// Llamar a la función para centrar en el mapa
				handlePersonsSelection(personId);
			};

			// Asignar el evento de clic a ambas filas
			row.onclick = selectPerson;
			if (addressRow) {
				addressRow.onclick = selectPerson;
			}

            // Asegurar que las filas están en la posición correcta
            if (tableBody.children[index * 2] !== row) {
                tableBody.insertBefore(row, tableBody.children[index * 2]);
                tableBody.insertBefore(addressRow, row.nextSibling);
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
                if (row.nextElementSibling && row.nextElementSibling.classList.contains("person-address-row")) {
                    row.nextElementSibling.remove();
                }
            }
        });

    } catch (error) {
        console.error("Error al actualizar la tabla de personas:", error);
    }
}

export async function processQueue() {
    if (requestQueue.length === 0) {
        return;
    }

    const now = Date.now();
    
    // Eliminar todas las solicitudes que no cumplen con los requisitos
    requestQueue = requestQueue.filter(({ lat, lon, deviceId }) => {
        if (!lastGeocodeRequests[deviceId]) return true;

        const { lat: lastLat, lon: lastLon, timestamp } = lastGeocodeRequests[deviceId];
        const timeDiff = (now - timestamp) / 1000; // Segundos
        const distance = getDistanceFromLatLonInMeters(lastLat, lastLon, lat, lon); // Metros

        if (timeDiff < geocodeTime || distance < geocodeDistance) {
            return false; // Lo elimina de la cola
        }

        return true; // Se mantiene en la cola
    });

    // Después de la limpieza, verificar si aún hay elementos en la cola
    if (requestQueue.length === 0) {
        return;
    }

    // Tomar la primera solicitud de la cola y procesarla
    const { lat, lon, deviceId, updateCellCallback } = requestQueue.shift();

    try {
        const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}`;
        console.log(`Haciendo solicitud a la API: ${url}`);

        const response = await fetch(url);
        if (!response.ok) throw new Error(`Error HTTP: ${response.status}`);

        const data = await response.json();
        const address = data.display_name || "Dirección no disponible";

        // Guardar la dirección en caché
        lastGeocodeRequests[deviceId] = { lat, lon, timestamp: Date.now(), address };

        console.log(`Dirección obtenida para ${deviceId}: ${address}`);
        updateCellCallback(address);
    } catch (error) {
        console.error(`Error al obtener dirección para ${deviceId}:`, error);
        updateCellCallback("Dirección no disponible");
    }
}
