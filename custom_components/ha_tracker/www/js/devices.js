//	
// DEVICES
//

import {formatDate} from './utils.js';
import {map} from './map.js';
import {resetFilter} from './filter.js';
import {t} from './i18n.js';

const DEFAULT_ICON_URL = '/local/ha-tracker/images/location-red.png';

export let devices = [];
let persons = [];
let deviceToPersonMap = {};
let deviceMarkers = {};

document.addEventListener("DOMContentLoaded", () => {
    const deviceSelect = document.getElementById("device-select");

    deviceSelect.addEventListener("focus", async() => {
        try {
            await updateDeviceList();
        } catch (error) {
            console.error("Error al actualizar la lista de dispositivos:", error);
        }
    });

    deviceSelect.addEventListener("change", () => {
        try {
            selectDevice();
        } catch (error) {
            console.error("Error al seleccionar un dispositivo:", error);
        }
    });
});

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

async function selectDevice() {
    resetFilter();

    const select = document.getElementById('device-select');
    const selectedDeviceId = select.value;
    if (!selectedDeviceId)
        return;

    const selectedDevice = deviceMarkers[selectedDeviceId];
    if (!selectedDevice)
        return;

    const {
        lat,
        lng
    } = selectedDevice.getLatLng();
    if (!isValidCoordinates(lat, lng))
        return;

    selectedDevice.openPopup();
    map.invalidateSize();
    map.setView([lat, lng], map.getZoom());
}

export async function updateDevicePerson() {
    deviceToPersonMap = {};
    persons.forEach(person => {
        (person.attributes.device_trackers || []).forEach(tracker => {
            deviceToPersonMap[tracker] = person.attributes.friendly_name;
        });
    });
}

export function updateDeviceList() {
    const select = document.getElementById('device-select');
    const selectedDeviceId = select.value;

    const fragment = document.createDocumentFragment();
    const defaultOption = document.createElement('option');
    defaultOption.value = '';
    defaultOption.textContent = t('select_device');
    fragment.appendChild(defaultOption);

    devices.forEach(device => {
        const option = document.createElement('option');
        option.value = device.entity_id;
        const label = `${device.attributes.friendly_name || device.entity_id} (${deviceToPersonMap[device.entity_id] || ''})`;
        option.textContent = label.trim();
        fragment.appendChild(option);
    });

    select.innerHTML = '';
    select.appendChild(fragment);
    if (selectedDeviceId)
        select.value = selectedDeviceId;
}

export async function updateDeviceMarkers() {
    if (!map.getPane('topMarkers')) {
        map.createPane('topMarkers').style.zIndex = 500;
    }

    const currentDeviceIds = devices.map(device => device.entity_id);
    Object.keys(deviceMarkers).forEach(entityId => {
        if (!currentDeviceIds.includes(entityId)) {
            map.removeLayer(deviceMarkers[entityId]);
            delete deviceMarkers[entityId];
        }
    });

    devices.forEach(device => {
        const {
            latitude,
            longitude,
            friendly_name,
            speed
        } = device.attributes;
        if (!isValidCoordinates(latitude, longitude))
            return;

        const formattedDate = formatDate(device.last_updated || t("date_unavailable"));
        const ownerName = deviceToPersonMap[device.entity_id] || '';
        const iconUrl = persons.find(p => p.attributes.friendly_name === ownerName)?.attributes.entity_picture || DEFAULT_ICON_URL;
        const popupContent = generatePopupContent({
            friendly_name,
            ownerName,
            formattedDate,
            speed
        });

        if (deviceMarkers[device.entity_id]) {
            const existingMarker = deviceMarkers[device.entity_id];
            existingMarker.setLatLng([latitude, longitude]);
            existingMarker.setIcon(createMarkerIcon(iconUrl));
            existingMarker.getPopup().setContent(popupContent);
        } else {
            deviceMarkers[device.entity_id] = createDeviceMarker(device, createMarkerIcon(iconUrl), popupContent);
        }
    });
}

function isValidCoordinates(lat, lng) {
    return lat != null && lng != null && !isNaN(lat) && !isNaN(lng);
}

function generatePopupContent({
    friendly_name,
    ownerName,
    formattedDate,
    speed
}) {
    return `
    <strong>${friendly_name} ${ownerName ? `(${ownerName})` : ''}</strong><br>
    ${formattedDate}<br>
    ${speed || 0} ${t('km_per_hour')}
  `;
}

function createMarkerIcon(iconUrl) {
    return L.divIcon({
        className: '',
        html: `<img src="${iconUrl}" style="width:48px;height:48px;border-radius:50%;object-fit:cover;" />`,
        iconSize: [48, 48],
        iconAnchor: [24, 24],
        popupAnchor: [0, -24],
    });
}

function createDeviceMarker(device, markerIcon, popupContent) {
    const {
        latitude,
        longitude
    } = device.attributes;
    return L.marker([latitude, longitude], {
        icon: markerIcon,
        pane: 'topMarkers'
    })
    .addTo(map)
    .bindPopup(popupContent, {
        autoPan: false
    });
}