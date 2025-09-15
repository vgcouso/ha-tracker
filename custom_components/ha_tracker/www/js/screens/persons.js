//
// DEVICES
//

import { formatDate, geocodeTime, geocodeDistance, use_imperial, CUSTOM_DEFAULT_COLOR, NO_CUSTOM_DEFAULT_COLOR, DEFAULT_ALPHA } from '../globals.js';
import { fetchPersons, fetchDevices } from '../ha/fetch.js';
import { handleZonePosition } from '../screens/zones.js';
import { map, isValidCoordinates, getDistanceFromLatLonInMeters } from '../utils/map.js';
import { t } from '../utils/i18n.js';
import { requestAddress, cancelAddress } from '../utils/geocode.js';
import { toRgba } from '../utils/dialogs.js';

const DEFAULT_ICON_URL = '/local/ha-tracker/images/location-red.png';

export let persons = [];

let devices = [];
let personsDevicesMap = {};
let personsMarkers = {};

let sortColumn = "name";
let sortAscending = true;
let previousSortColumn = "";
let previousSortAscending = true;

const lastGeocodeRequests = {}; // { [personId]: {lat, lon, timestamp, address} }

// Observer perezoso para las filas de dirección de personas
let _personsAddrObserver = null;
function ensurePersonsAddrObserver() {
    if (_personsAddrObserver)
        return _personsAddrObserver;
    const root = document.querySelector('#users .table-wrapper') || null; // si no existe, usa viewport
    _personsAddrObserver = new IntersectionObserver((entries) => {
        for (const e of entries) {
            if (!e.isIntersecting)
                continue;
            const addrRow = e.target;
            _personsAddrObserver.unobserve(addrRow);

            const personId = addrRow.dataset.personId;
            const lat = Number(addrRow.dataset.latitude);
            const lon = Number(addrRow.dataset.longitude);
            const tsMs = Number(addrRow.dataset.lastUpdated);
            const uniqueId = `${personId}_${tsMs}`;

            const cell = addrRow.querySelector('td');
            if (!Number.isFinite(lat) || !Number.isFinite(lon) || !cell)
                continue;

            // dispara resolución (usa cachés/cola/backoff del módulo común)
			requestAddress(uniqueId, lat, lon, tsMs, (newAddress) => {
			  lastGeocodeRequests[personId] = { lat, lon, timestamp: tsMs, address: newAddress || "" };

			  const row = document.querySelector(`tr.person-address-row[data-person-id="${personId}"]`);
			  if (row && row.dataset.lastUpdated === String(tsMs)) {
				const cell = row.querySelector('td');
				if (cell) cell.textContent = newAddress || "";
			  }
			});
			
        }
    }, {
        root,
        rootMargin: '200px'
    });
    return _personsAddrObserver;
}

export async function updatePersons() {
    try {
        await fetchPersons();
        await fetchDevices();
        await updatePersonsDevicesMap();
        await updatePersonsTable();
        await updatePersonsMarkers();
        await updatePersonsFilter();
    } catch (error) {
        console.error("Error updating devices:", error);
        throw error;
    }
}

export async function setDevices(data) {
    try {
        devices = Array.isArray(data) ? data.filter(d => d.entity_id && d.attributes) : [];
        console.log("Devices:", devices);
    } catch (error) {
        console.error("Error processing devices:", error);
        devices = [];
    }
}

export async function setPersons(data) {
    try {
        persons = Array.isArray(data) ? data.filter(p => p.attributes?.friendly_name) : [];
        console.log("Persons:", persons);
    } catch (error) {
        console.error("Error processing persons:", error);
        persons = [];
    }
}

export async function handlePersonsSelection(personId) {
    if (!personId)
        return;

    const selectedPerson = personsMarkers[personId];
    if (!selectedPerson)
        return;

    const selectedDevice = personsDevicesMap[personId];
    if (!selectedDevice) {
        console.error(`No device was found for the person with ID: ${personId}`);
        return;
    }

    Object.values(personsMarkers).forEach(marker => marker.setZIndexOffset(500));
    selectedPerson.setZIndexOffset(600);

    const { latitude: lat, longitude: lng } = selectedDevice.attributes || {};
    if (!isValidCoordinates(lat, lng)) {
        console.error(`Invalid coordinates for ${personId}: lat=${lat}, lng=${lng}`);
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
    .filter(p => Boolean(personsDevicesMap[p.entity_id])) // <-- sólo con device
    .forEach(person => {
      const option = document.createElement('option');
      option.value = person.entity_id;
      const label = person.attributes.friendly_name || person.attributes.id || person.entity_id;
      option.textContent = (label || "").trim();
      fragment.appendChild(option);
    });

  select.innerHTML = '';
  select.appendChild(fragment);

  if (selectedPersonId && personsDevicesMap[selectedPersonId]) {
    select.value = selectedPersonId;
  }
}


export async function fitMapToAllPersons() {
    try {
        const coords = Object.values(personsDevicesMap)
            .filter(device => device.attributes.latitude && device.attributes.longitude)
            .map(device => [device.attributes.latitude, device.attributes.longitude]);

        if (!coords.length) {
            console.log("There are no devices with coordinates to adjust the map.");
            map.fitWorld();
            return;
        }

        const bounds = L.latLngBounds(coords);
        map.fitBounds(bounds);
    } catch (error) {
        console.error("Error doing fitMapToAllDevices:", error);
    }
}

async function updatePersonsDevicesMap() {
    personsDevicesMap = {};

    persons.forEach(person => {
        const source = person.attributes?.source;
        if (!source || typeof source !== "string" || source.trim() === "") {
            console.log(`The person ${person.attributes.friendly_name || person.entity_id} does not have a valid 'source'.`);
            return;
        }

        const device = devices.find(device => device.entity_id === source);
        if (!device) {
            console.error(`The 'source' (${source}) of ${person.attributes.friendly_name || person.entity_id} is not in device_trackers.`);
            return;
        }

        if (!device.attributes.latitude || !device.attributes.longitude) {
            console.log(`The device_tracker ${source} of ${person.attributes.friendly_name || person.entity_id} does not have lat/lng.`);
            return;
        }

        personsDevicesMap[person.entity_id] = device;
    });

    console.log("Devices to persons:", personsDevicesMap);
}

async function updatePersonsMarkers() {
    if (!map.getPane('personsMarkers')) {
        const pane = map.createPane('personsMarkers');
        pane.style.zIndex = 600; // por encima de circlePane (400)
        pane.style.pointerEvents = 'auto'; // habilita clics
    }

    const currentPersonIds = Object.keys(personsDevicesMap);

    Object.keys(personsMarkers).forEach(personId => {
        if (!currentPersonIds.includes(personId)) {
            map.removeLayer(personsMarkers[personId]);
            delete personsMarkers[personId];
        }
    });

    currentPersonIds.forEach(personId => {
        const device = personsDevicesMap[personId];
        const { latitude, longitude, friendly_name, speed } = device.attributes;
        const batteryLevel = device.battery_level ? `<br>${t('battery')}: ${device.battery_level}${t('percentage')}` : "";

        if (!isValidCoordinates(latitude, longitude))
            return;

        const formattedDate = formatDate(device.last_updated || t("date_unavailable"));
        const ownerName = persons.find(p => p.entity_id === personId)?.attributes.friendly_name || '';
        const iconUrl = persons.find(p => p.entity_id === personId)?.attributes.entity_picture || DEFAULT_ICON_URL;

        const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`;
        const popupContent = `
      <strong>${ownerName}</strong> (${friendly_name})<br>
      ${formattedDate}<br>
      ${t('speed')}: ${Math.round((speed || 0) * (use_imperial ? 2.23694 : 3.6))} ${t(use_imperial ? 'mi_per_hour' : 'km_per_hour')}
      ${batteryLevel}<br><br>
      <a href="${mapsUrl}" target="_blank" rel="noopener noreferrer"><strong>${t('open_location')}</strong></a>
    `;

        const markerIcon = L.divIcon({
            className: '',
            html: `<img src="${iconUrl}" style="width:48px;height:48px;border-radius:50%;object-fit:cover;" />`,
            iconSize: [48, 48],
            iconAnchor: [24, 24],
            popupAnchor: [0, -24],
        });

        if (personsMarkers[personId]) {
            const existing = personsMarkers[personId];
            existing.setLatLng([latitude, longitude]);
            existing.setIcon(markerIcon);
            existing.getPopup().setContent(popupContent);
        } else {
            personsMarkers[personId] = L.marker([latitude, longitude], {
                icon: markerIcon,
                pane: 'personsMarkers'
            })
                .addTo(map)
                .bindPopup(popupContent, {
                    autoPan: false
                })
                .on('click', async() => {
                    await handlePersonRowSelection(personId);
                    map.invalidateSize();
					const ll = personsMarkers[personId].getLatLng();
					map.setView(ll, map.getZoom());
					personsMarkers[personId].openPopup();
                });
        }
    });
}

export async function handlePersonRowSelection(personId) {
    // 1) Cambiar a la pestaña "users" antes de tocar el DOM
    const comboSelect = document.getElementById('combo-select');
    const switched = comboSelect && comboSelect.value !== 'users';
    if (switched) {
        comboSelect.value = 'users';
        comboSelect.dispatchEvent(new Event('change', {
                bubbles: true
            }));
        // Espera un frame para que el DOM de la tabla se renderice
        await new Promise(r => requestAnimationFrame(r));
    }

    // 2) Asegurar que el tbody existe (intenta dos veces por si aún se monta)
    let personTableBody = document.getElementById('persons-table-body');
    if (!personTableBody) {
        await new Promise(r => requestAnimationFrame(r));
        personTableBody = document.getElementById('persons-table-body');
    }
    if (!personTableBody) {
        console.error("Person table tbody not found.");
        return;
    }

    // 3) Buscar la fila de forma robusta (CSS.escape por si acaso)
    const safeId = (window.CSS && CSS.escape) ? CSS.escape(personId) : personId.replace(/"/g, '\\"');
    let row = personTableBody.querySelector(`tr[data-person-id="${safeId}"]`);
    if (!row) {
        // Fallback: búsqueda por dataset (por si hay renders intermedios)
        row = Array.from(personTableBody.querySelectorAll('tr')).find(r => r.dataset.personId === personId);
    }
    if (!row)
        return;

    const addressRow = row.nextElementSibling && row.nextElementSibling.classList.contains('person-address-row')
         ? row.nextElementSibling : null;

    // 4) Restaurar tintes de la selección previa y aplicar la nueva selección
	personTableBody.querySelectorAll('tr.selected').forEach(r => r.classList.remove('selected'));
	row.classList.add('selected');
	if (addressRow) addressRow.classList.add('selected');

    // 5) Scroll a la vista
    row.scrollIntoView({
        behavior: 'smooth',
        block: 'center'
    });
}

// ----------- Tabla -----------
export function updatePersonsTableHeaders() {
    const table = document.querySelector("#persons-table");
    if (!table) {
        console.error("Zone summary table not found.");
        return;
    }

    const headers = table.querySelectorAll("thead th");

    headers.forEach(header => {
        const columnKey = header.getAttribute("data-i18n");
        let columnName = "";

        switch (columnKey) {
        case "name":
            columnName = "name";
            break;
        case "date":
            columnName = "date";
            break;
        case "speed":
            columnName = "speed";
            break;
        case "percentage":
            columnName = "percentage";
            break;
        case "zone":
            columnName = "zone";
            break;
        }
        if (!columnName)
            return;

        header.style.cursor = "pointer";
        header.onclick = () => {
            if (sortColumn === columnName)
                sortAscending = !sortAscending;
            else {
                sortColumn = columnName;
                sortAscending = true;
            }
            updatePersonsTable();
        };

		const arrow = (sortColumn === columnName) ? (sortAscending ? "▲" : "▼") : "";

		// Etiqueta que se mostrará en el TH
		const label =
		  columnKey === "speed"
			? (use_imperial ? t("mi_per_hour") : t("km_per_hour"))
			: t(columnKey);

		header.innerHTML = `
		  <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:30px;">
			<span class="hdr-label">${label}</span>
			<span class="hdr-arrow" style="font-size:12px;">${arrow}</span>
		  </div>
		`;
    });
}

export async function updatePersonsTable() {
    try {
        const tableBody = document.getElementById("persons-table-body");
        if (!tableBody) {
            console.error("Person table tbody not found.");
            return;
        }

        const selectedRow = tableBody.querySelector("tr.selected");
        const selectedPersonId = selectedRow ? selectedRow.dataset.personId : null;

		const peopleWithDevice = persons.filter(p => personsDevicesMap[p.entity_id]);

        const sortedPersons = [...peopleWithDevice].sort((a, b) => {
            const deviceA = personsDevicesMap[a.entity_id] || {};
            const deviceB = personsDevicesMap[b.entity_id] || {};
            let valueA,
            valueB;

            switch (sortColumn) {
            case "name":
                valueA = a.attributes.friendly_name || a.entity_id;
                valueB = b.attributes.friendly_name || b.entity_id;
                return sortAscending ? valueA.localeCompare(valueB) : valueB.localeCompare(valueA);
            case "date":
                valueA = deviceA.last_updated ? new Date(deviceA.last_updated).getTime() : 0;
                valueB = deviceB.last_updated ? new Date(deviceB.last_updated).getTime() : 0;
                return sortAscending ? valueA - valueB : valueB - valueA;
            case "speed":
                valueA = parseFloat(deviceA.attributes?.speed) || 0;
                valueB = parseFloat(deviceB.attributes?.speed) || 0;
                return sortAscending ? valueA - valueB : valueB - valueA;
            case "percentage":
                valueA = parseFloat(deviceA.battery_level) || 0;
                valueB = parseFloat(deviceB.battery_level) || 0;
                return sortAscending ? valueA - valueB : valueB - valueA;
            case "zone":
                valueA = handleZonePosition(deviceA.attributes?.latitude, deviceA.attributes?.longitude)?.name || "";
                valueB = handleZonePosition(deviceB.attributes?.latitude, deviceB.attributes?.longitude)?.name || "";
                return sortAscending ? valueA.localeCompare(valueB) : valueB.localeCompare(valueA);
            default:
                return 0;
            }
        });

        const existingRows = Array.from(tableBody.querySelectorAll("tr"));
        const io = ensurePersonsAddrObserver();

        sortedPersons.forEach((person, index) => {
            const personId = person.entity_id;
            const friendlyName = person.attributes.friendly_name || personId;
            const source = person.attributes.source || null;

            let deviceName = "",
            time = "",
            speed = "",
            battery = "",
            currentZoneName = "",
            address = "";
            let zone = null;
            let lat,
            lon,
            lastUpdated;

            let shouldRequestGeocode = false;

            if (source && personsDevicesMap[personId]) {
                const device = personsDevicesMap[personId];
                deviceName = device.attributes.friendly_name ? `(${device.attributes.friendly_name})` : "";
                battery = device.battery_level;
                time = formatDate(device.last_updated);
                speed = Math.round((device.attributes.speed || 0) * (use_imperial ? 2.23694 : 3.6));
                zone = handleZonePosition(device.attributes.latitude, device.attributes.longitude);
                currentZoneName = zone ? zone.name : "";

                lat = Number(device.attributes.latitude);
                lon = Number(device.attributes.longitude);
                lastUpdated = new Date(device.last_updated).getTime();

                const last = lastGeocodeRequests[personId];
                address = last?.address || "";

                if (!last) {
                    shouldRequestGeocode = true;
                } else {
                    const dist = getDistanceFromLatLonInMeters(last.lat, last.lon, lat, lon);
                    const timeDiff = (lastUpdated - (last.timestamp || 0)) / 1000;
                    if (dist >= geocodeDistance && timeDiff >= geocodeTime) {
                        address = "";
                        shouldRequestGeocode = true;
                    }
                }
            }

            let row = existingRows.find(r => r.dataset.personId === personId && !r.classList.contains('person-address-row'));
            let addressRow = row ? row.nextElementSibling : null;

            if (!row) {
                row = document.createElement("tr");
                row.dataset.personId = personId;
                row.style.cursor = "pointer";

                addressRow = document.createElement("tr");
                addressRow.dataset.personId = personId;
                addressRow.classList.add("person-address-row");
                addressRow.style.cursor = "pointer";

                const addressCell = document.createElement("td");
                addressCell.setAttribute("colspan", "5");
                addressCell.textContent = address || "";
                addressCell.style.borderBottom = "1px solid rgba(0,0,0,0.1)";
                addressRow.appendChild(addressCell);

                tableBody.appendChild(row);
                tableBody.appendChild(addressRow);
            }

            const newContent = `
				<td><p style="font-weight:bold;color:#003366;margin:0;">${friendlyName}</p>${deviceName}</td>
				<td>${time}</td>
				<td>${currentZoneName}</td>
				<td>${speed}</td>
				<td>${battery}</td>
			  `;
            if (row.innerHTML !== newContent)
                row.innerHTML = newContent;

			// Tinte como en zonas (CSS var)
			const tint = zoneTintRgba(zone, DEFAULT_ALPHA);
			row.style.setProperty('--color-bg', tint || '');
			if (addressRow) addressRow.style.setProperty('--color-bg', tint || '');

			// Sustituye todo el bloque de "Datos para el observer..."
			const td = addressRow.querySelector("td");
			addressRow.dataset.latitude = Number.isFinite(lat) ? String(lat) : '';
			addressRow.dataset.longitude = Number.isFinite(lon) ? String(lon) : '';
			addressRow.dataset.lastUpdated = Number.isFinite(lastUpdated) ? String(lastUpdated) : '0';

			const hasLast = Boolean(lastGeocodeRequests[personId]);
			const needsGeocode = shouldRequestGeocode || (!hasLast && Number.isFinite(lat) && Number.isFinite(lon));

			if (needsGeocode) {
			  if (td && td.textContent !== "…") td.textContent = "…";
			  io.observe(addressRow);
			} else {
			  cancelAddress(`${personId}_${addressRow.dataset.lastUpdated}`);
			  if (td && td.textContent !== address) td.textContent = address || "";
			}


            // Click selection
			const selectPerson = () => {
			  tableBody.querySelectorAll("tr.selected").forEach(r => r.classList.remove("selected"));
			  row.classList.add("selected");
			  if (addressRow) addressRow.classList.add("selected");
			  handlePersonsSelection(personId);
			};
			
            row.onclick = selectPerson;
            if (addressRow)
                addressRow.onclick = selectPerson;

            // Mantener orden (2 filas por persona)
            if (tableBody.children[index * 2] !== row) {
                tableBody.insertBefore(row, tableBody.children[index * 2]);
                tableBody.insertBefore(addressRow, row.nextSibling);
            }

            // Mantener selección
			if (personId === selectedPersonId) {
			  row.classList.add("selected");
			  if (addressRow) addressRow.classList.add("selected");
			}
        });

        // limpiar filas huérfanas
        Array.from(tableBody.querySelectorAll("tr")).forEach(r => {
            const id = r.dataset.personId;
            if (!sortedPersons.some(p => p.entity_id === id)) {
                if (r.nextElementSibling && r.nextElementSibling.classList.contains("person-address-row")) {
                    r.nextElementSibling.remove();
                }
                r.remove();
            }
        });

        if (previousSortColumn !== sortColumn || previousSortAscending !== sortAscending) {
            updatePersonsTableHeaders();
            previousSortColumn = sortColumn;
            previousSortAscending = sortAscending;
        }
    } catch (error) {
        console.error("Error updating people table:", error);
    }
}

//
// Helper para el color de fondo según zona
//
export function zoneTintRgba(zone, alpha = DEFAULT_ALPHA) {
    if (!zone)
        return null;
    const baseHex = zone?.custom ? (zone.color || CUSTOM_DEFAULT_COLOR) : NO_CUSTOM_DEFAULT_COLOR;
    const a = Math.min(1, Math.max(0, Number(alpha) || 0));
    return toRgba(baseHex, a) || toRgba(NO_CUSTOM_DEFAULT_COLOR, a);
}
