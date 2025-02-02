//
// FILTER
//

import {map} from './map.js';
import {showWindowOverlay, hideWindowOverlay, formatDate, formatTotalTime, isValidCoordinates} from './utils.js';
import {fetchFilteredPositions} from './fetch.js';
import {handleZonePosition, showZone} from './zones.js';
import {handlePersonsSelection, updatePersonsFilter} from './persons.js';
import {t} from './i18n.js';

let filterMarkers = [], routeLine, selectedMarker;

const DEFAULT_ICON_URL = '/local/ha-tracker/images/location-blue.png';
						 
document.addEventListener("DOMContentLoaded", () => {
    const personSelect = document.getElementById("person-select");

    personSelect.addEventListener("focus", async() => {
        try {
            await updatePersonsFilter();
        } catch (error) {
            console.error("Error al actualizar la lista de usuarios:", error);
        }
    });

    personSelect.addEventListener("change", () => {
        try {
			resetFilter();
			handlePersonsSelection(document.getElementById('person-select').value);
        } catch (error) {
            console.error("Error al seleccionar un usuario:", error);
        }
    });

    const tabButtons = document.querySelectorAll(".tab-button");

    tabButtons.forEach(button => {
        button.addEventListener("click", (event) => {
            try {
                const tabName = button.getAttribute("data-tab"); // Obtener el nombre de la pestaña
                openTab(event, tabName); // Llamar a la función con los parámetros necesarios
            } catch (error) {
                console.error("Error al cambiar de pestaña:", error);
            }
        });
    });
});

document.getElementById('filter-button').addEventListener('click', async() => {
    try {
        await applyFilter();
    } catch (error) {
        console.error("Error durante la aplicación del filtro:", error);
    }
});

export async function setFilter(data) {
    try {
        if (data && Array.isArray(data) && data.length > 0) {
            await resetFilter(); // Limpia el filtro anterior
            await updatePositionsTable(data); // Actualiza la tabla de posiciones
            await updateSummaryTable(data); // Actualiza la tabla de resumen
            await updatesummaryZonesTable(data); // Actualiza la tabla de zonas
            await addFilterMarkers(data); // Añade marcadores al mapa
            await addRouteLine(data); // Dibuja la línea de ruta
        } else {
            alert(t('no_positions'));
        }
    } catch (error) {
        console.error("Error al obtener posiciones filtradas:", error);
        alert(t('filter_problem'));
    }
}

async function updatePositionsTable(positions) {
    const tbody = document.getElementById('filter-table-body');

    if (!positions || positions.length === 0)
        return;

    let prevZone = null;
    let groupClassIndex = 0;
    let isFirstInGroup = false;

    positions.forEach((pos, index) => {
        const zone = handleZonePosition(pos.attributes.latitude,pos.attributes.longitude);
        const zoneName = zone ? zone.name : '';
        if (zoneName !== prevZone) {
            groupClassIndex++;
            prevZone = zoneName;
            isFirstInGroup = true;
        } else {
            isFirstInGroup = false;
        }

        const groupClass = `group-${groupClassIndex}`;
        const fecha = formatDate(pos.last_updated);
        const vel = pos.attributes.speed || 0;

        const uniqueId = `${pos.entity_id}_${new Date(pos.last_updated).toISOString()}`;

        const row = document.createElement('tr');
        row.classList.add(groupClass);
        row.dataset.entityId = uniqueId;
        row.dataset.latitude = pos.attributes.latitude;
        row.dataset.longitude = pos.attributes.longitude;
        row.dataset.lastUpdated = pos.last_updated;
        row.dataset.speed = pos.attributes.speed || 0;

        row.style.cursor = "pointer"; // Cambia el cursor al pasar por encima

        if (isFirstInGroup) {
            row.classList.add('group-header');
            row.innerHTML = `
        <td>
          <button class="toggle-btn">►</button>
        </td>
        <td>${fecha}</td>
        <td>${vel}</td>
        <td>${zoneName}</td>
      `;

            // Añade el evento al botón después de crearlo
            const toggleButton = row.querySelector('.toggle-btn');
            toggleButton.addEventListener('click', () => toggleGroup(groupClass, toggleButton));
        } else {
            row.style.display = 'none';
            row.innerHTML = `
        <td></td>
        <td>${fecha}</td>
        <td>${vel}</td>
        <td>${zoneName}</td>
      `;
        }

        row.onclick = () => selectRow(row);

        tbody.appendChild(row);
    });

    // Al finalizar, si hay filas, seleccionamos automáticamente la primera
    if (positions.length > 0) {
        const firstRow = tbody.querySelector('tr'); // la primera <tr>
        if (firstRow) {
            selectRow(firstRow); // Llamada para seleccionar y centrar
        }
    }
}

async function addFilterMarkers(positions) {
    // Crear un pane para los marcadores de filtro si no existe
    if (!map.getPane('filterMarkers')) {
        map.createPane('filterMarkers');
        map.getPane('filterMarkers').style.zIndex = 400; // zIndex más bajo que topMarkers
    }

    positions.forEach(pos => {
        const lat = pos.attributes.latitude;
        const lon = pos.attributes.longitude;

        if (!lat || !lon) {
            console.log("Marcador descartado: Posición sin coordenadas:", pos);
            return;
        }

        const icon = L.divIcon({
            className: '',
            html: `
			<div style="
			  width:6px; 
			  height:6px;
			  border:1px solid rgba(0,0,255,0.8);
			  border-radius:50%;
			  background-color: rgba(0,0,255,0.5);
			"></div>
		  `,
            iconSize: [8, 8],
            iconAnchor: [4, 4],
        });

        // Crear el marcador y asignarlo al pane personalizado
        const marker = L.marker([lat, lon], {
            icon,
            pane: 'filterMarkers'
        }).addTo(map);

        marker.on('click', () => {
            const uniqueId = `${pos.entity_id}_${new Date(pos.last_updated).toISOString()}`;
            console.log("Marcador clicado. Buscando fila con data-entity-id:", uniqueId);
            handleFilterRowSelection(uniqueId);
        });

        filterMarkers.push(marker);
    });
}

async function applyFilter() {
    const startDate = document.getElementById('start-date').value;
    const endDate = document.getElementById('end-date').value;
    const selectedPersonId = document.getElementById('person-select').value;

    // Validar que se haya seleccionado un usuario
    if (!selectedPersonId || selectedPersonId === t('select_user')) {
        alert(t('select_user_filter'));
        return;
    }

    if (!startDate || !endDate) {
        alert(t('select_dates'));
        return;
    }

    // Validar que la fecha de inicio sea menor que la de fin
    const startDateTime = new Date(startDate).getTime();
    const endDateTime = new Date(endDate).getTime();

    if (startDateTime >= endDateTime) {
        alert(t('invalid_dates'));
        return;
    }

    // Validar que el rango entre fechas no sea mayor a 7 días
    const maxDifferenceMs = 7 * 24 * 60 * 60 * 1000; // 7 días en milisegundos
    if (endDateTime - startDateTime > maxDifferenceMs) {
        alert(t('date_range'));
        return;
    }

    showWindowOverlay(t('running_filter')); // Mostrar ventana de carga

    try {
        await fetchFilteredPositions(selectedPersonId, startDate, endDate);
    } catch (error) {
        console.error("Error durante el filtro:", error);
        alert(t('filter_error'));
    } finally {
        hideWindowOverlay(); // Ocultar ventana de carga
    }
}

export async function resetFilter() {
    document.getElementById('filter-table-body').innerHTML = '';

    // Eliminar la línea de la ruta, si existe
    if (routeLine)
        map.removeLayer(routeLine);

    // Eliminar el marcador seleccionado, si existe
    if (selectedMarker)
        map.removeLayer(selectedMarker);

    // Eliminar los marcadores de filtro
    filterMarkers.forEach(marker => {
        map.removeLayer(marker);
    });
    filterMarkers = [];

    // Reiniciar valores del resumen
    document.getElementById('positions-count').textContent = '--';
    document.getElementById('total-time').textContent = '--';
    document.getElementById('max-speed').textContent = '--';
    document.getElementById('average-speed').textContent = '--';
    document.getElementById('summary-zones-table-body').innerHTML = '';
}

async function toggleGroup(groupClass, btn) {
    const rows = document.querySelectorAll(`tr.${groupClass}:not(.group-header)`);
    if (!rows.length)
        return;

    // Determinar si el grupo está colapsado
    const isCollapsed = rows[0].style.display === 'none';

    // Mostrar u ocultar las filas
    rows.forEach(row => {
        row.style.display = isCollapsed ? 'table-row' : 'none';
    });

    // Cambiar el icono del botón
    btn.textContent = isCollapsed ? '▼' : '►';
}

async function selectRow(row) {
    console.log("Fila seleccionada:", row.dataset.entityId);

    // Asegurar que el pane "selectedMarker" existe (si no, crearlo)
    if (!map.getPane('selectedMarker')) {
        map.createPane('selectedMarker').style.zIndex = 450; // 🔹 Menor que `personsMarkers` 
    }

    // Eliminar el marcador seleccionado anterior
    if (selectedMarker) {
        map.removeLayer(selectedMarker);
    }

    // Quitar la clase 'selected' de todas las filas y añadirla a la fila seleccionada
    const rows = document.querySelectorAll('#filter-table-body tr');
    rows.forEach(r => r.classList.remove('selected'));
    row.classList.add('selected');

    // Extraer datos de posición desde `row`
    const latitude = parseFloat(row.dataset.latitude);
    const longitude = parseFloat(row.dataset.longitude);
    const lastUpdated = row.dataset.lastUpdated;
    const speed = row.dataset.speed || 0;
    const uniqueId = row.dataset.entityId;

    // Crear el nuevo marcador 
    selectedMarker = L.marker([latitude, longitude], {
        icon: L.icon({
            iconUrl: DEFAULT_ICON_URL,
            iconSize: [32, 32],
            iconAnchor: [16, 32],
            popupAnchor: [0, -32],
        }),
        pane: 'selectedMarker', // 🔹 Asignamos al nuevo pane de menor prioridad
    })
    .addTo(map)
    .bindPopup(`
        ${formatDate(lastUpdated)}<br>
        ${t('speed')}: ${speed} ${t('km_per_hour')}
    `)
    .openPopup();

    // Añadir evento `click` al marcador seleccionado
    selectedMarker.on('click', () => {
        console.log("Marcador clicado. Buscando fila con data-entity-id:", uniqueId);
        handleFilterRowSelection(uniqueId);
    });

    // Centrar el mapa en la posición seleccionada
    map.setView([latitude, longitude], map.getZoom());
}

async function handleFilterRowSelection(uniqueId) {
    const filterTableBody = document.getElementById('filter-table-body');
    if (!filterTableBody) {
        console.error("No se encontró el tbody de la tabla de filter.");
        return;
    }	
	
    const row = filterTableBody.querySelector(`tr[data-entity-id="${uniqueId}"]`);
    if (!row) {
        console.error("No se encontró la fila para la posición:", uniqueId);
        return;
    }

    const isHidden = getComputedStyle(row).display === 'none' || row.style.display === 'none';
    const groupClass = [...row.classList].find(cls => cls.startsWith('group-'));

    if (!groupClass) {
        console.error("La fila no pertenece a ningún grupo:", row);
        return;
    }

    // Si la fila está oculta, expandimos su grupo
    if (isHidden) {
        console.log("Fila oculta. Expandimos el grupo:", groupClass);
        const groupHeader = document.querySelector(`tr.${groupClass}.group-header`);
        if (groupHeader) {
            const toggleBtn = groupHeader.querySelector('.toggle-btn');
            if (toggleBtn) {
                toggleGroup(groupClass, toggleBtn);
            }
        }
    }

    // Asegurar que "Filtro" esté seleccionado en el combo
    const comboSelect = document.getElementById('combo-select');
    if (comboSelect && comboSelect.value !== 'filter') {
        comboSelect.value = 'filter'; // Cambia la selección del combo a "Filtro"

        // Dispara el evento de cambio manualmente para reflejar la selección en la UI
        const changeEvent = new Event('change', { bubbles: true });
        comboSelect.dispatchEvent(changeEvent);
    }

    // Cambiar a la pestaña "Posiciones" si hay un marcador seleccionado
    if (typeof selectedMarker !== "undefined" && selectedMarker !== null) {
        const positionsTabButton = document.querySelector('.tab-button[data-tab="positions"]');
        if (positionsTabButton) {
            openTab({ currentTarget: positionsTabButton }, 'positions'); // Cambia a la pestaña "Posiciones"
        }
    }

    // Seleccionar la fila
    selectRow(row);

    // Asegurar que la fila sea visible antes de hacer scroll
    //if (!isHidden) {
        row.scrollIntoView({ behavior: 'smooth', block: 'center' });
    //}

    console.log("Fila seleccionada en la tabla de filtro:", uniqueId);
}

async function addRouteLine(positions) {
    if (!positions || positions.length === 0) {
        console.error("No se encontraron posiciones válidas para la ruta.");
        return; // No continuar si no hay posiciones
    }

    // Asegurarnos de que todas las posiciones tengan latitud y longitud válidas
    const coordinates = positions.map(pos => {
        if (pos.attributes.latitude && pos.attributes.longitude) {
            return [pos.attributes.latitude, pos.attributes.longitude];
        }
        console.log("Posición inválida encontrada:", pos);
        return null; // Ignorar posiciones inválidas
    }).filter(coord => coord !== null); // Filtrar coordenadas inválidas

    if (coordinates.length === 0) {
        console.error("No se encontraron coordenadas válidas para la ruta.");
        return; // No dibujar la línea si no hay coordenadas válidas
    }

    // Dibujar la línea de la ruta
    routeLine = L.polyline(coordinates, {
        color: 'rgba(0, 0, 255, 0.5)',
        weight: 4
    }).addTo(map);
    map.fitBounds(routeLine.getBounds()); // Asegura que la ruta sea visible completamente
}

async function updateSummaryTable(positions) {
    if (!positions || positions.length === 0) {
        console.error("No hay posiciones para calcular estadísticas.");
        return;
    }

    // Calcular estadísticas
    const totalPositions = positions.length;

    const firstDate = new Date(positions[0].last_updated).getTime();
    const lastDate = new Date(positions[positions.length - 1].last_updated).getTime();
    const totalTimeMs = lastDate - firstDate;

    const maxSpeedPos = positions.reduce((max, pos) => {
        const speed = pos.attributes.speed || 0;
        return speed > max.speed ? {
            speed,
            position: pos
        }
         : max;
    }, {
        speed: 0,
        position: null
    });

    const averageSpeed = positions.reduce((sum, pos) => sum + (pos.attributes.speed || 0), 0) / totalPositions;

    // Formatear datos
    const totalTime = formatTotalTime(totalTimeMs);
    const maxSpeed = maxSpeedPos.speed.toFixed(2);
    const avgSpeed = averageSpeed.toFixed(2);

    // Actualizar las celdas del resumen
    document.getElementById('positions-count').textContent = totalPositions;
    document.getElementById('total-time').textContent = totalTime;
    document.getElementById('max-speed').textContent = `${maxSpeed} ${t('km_per_hour')}`;
    document.getElementById('average-speed').textContent = `${avgSpeed} ${t('km_per_hour')}`;

    // Hacer clic en la fila de Velocidad Máxima para centrar en la posición correspondiente
    const maxSpeedRow = document.querySelector('#summary table tbody tr:nth-child(3)');

    // Cambiar el puntero al pasar el ratón
    maxSpeedRow.style.cursor = "pointer";

    // Agregar evento de clic
    maxSpeedRow.addEventListener('click', () => {
        if (maxSpeedPos.position) {
            // Ir a la fila correspondiente
            const uniqueId = `${maxSpeedPos.position.entity_id}_${new Date(maxSpeedPos.position.last_updated).toISOString()}`;
            handleFilterRowSelection(uniqueId);
        }
    });
}

async function updatesummaryZonesTable(positions) {
    const zonesTableBody = document.getElementById('summary-zones-table-body');

    // Verificar si hay posiciones
    if (!positions || positions.length === 0)
        return;

    const zoneDurations = {}; // Almacenar duración total por zona
    const zoneVisits = {}; // Almacenar cantidad de visitas por zona
    let zonePositions = {}; // Almacenar posiciones por zona
    let previousZone = null;
    let previousTime = null;

    let totalTimeByZones = 0; // Tiempo total por zonas

    positions.forEach((pos, index) => {
        const zone = handleZonePosition(pos.attributes.latitude,pos.attributes.longitude);
        const currentZoneName = zone ? zone.name : '';
        const currentTime = new Date(pos.last_updated).getTime();

        // Guardar posición de la zona
        if (zone && !zonePositions[currentZoneName]) {
            zonePositions[currentZoneName] = {
                lat: zone.latitude,
                lon: zone.longitude,
                id: zone.id
            };
        }

        // Cambiar de zona
        if (previousZone !== null && currentZoneName !== previousZone) {
            const timeSpent = currentTime - previousTime;
            if (timeSpent > 0) {
                zoneDurations[previousZone] = (zoneDurations[previousZone] || 0) + timeSpent;
                totalTimeByZones += timeSpent;
                zoneVisits[previousZone] = (zoneVisits[previousZone] || 0) + 1;
            }
            previousZone = currentZoneName;
            previousTime = currentTime;
        } else if (index === 0) {
            // Primera posición
            previousZone = currentZoneName;
            previousTime = currentTime;
        }

        // Última posición
        if (index === positions.length - 1) {
            const timeSpent = currentTime - previousTime;
            if (timeSpent > 0) {
                zoneDurations[currentZoneName] = (zoneDurations[currentZoneName] || 0) + timeSpent;
                totalTimeByZones += timeSpent;
                zoneVisits[currentZoneName] = (zoneVisits[currentZoneName] || 0) + 1;
            }
        }
    });

    // Ordenar zonas alfabéticamente
    const sortedZones = Object.entries(zoneDurations).sort(([zoneA], [zoneB]) => zoneA.localeCompare(zoneB));

    // Limpiar la tabla antes de agregar filas
    zonesTableBody.innerHTML = '';

    // Agregar filas a la tabla
    for (const [zoneName, duration] of sortedZones) {
        const visits = zoneVisits[zoneName] || 0;
        const row = document.createElement('tr');
        row.style.cursor = 'pointer'; // Cambiar el cursor al pasar
        row.innerHTML = `
		  <td>${zoneName}</td>
		  <td>${formatTotalTime(duration)}</td>
		  <td>${visits}</td>
		`;

        // Centrar el mapa en la zona y abrir el popup al hacer clic
        row.addEventListener('click', () => {
            const zoneData = zonePositions[zoneName];
            if (zoneData) {
                showZone(zoneData.id);
            }
        });

        zonesTableBody.appendChild(row);
    }

    // Verificar consistencia con el tiempo total
    const firstTime = new Date(positions[0].last_updated).getTime();
    const lastTime = new Date(positions[positions.length - 1].last_updated).getTime();
    const totalTime = lastTime - firstTime;

    console.log(`Tiempo total calculado: ${totalTime}`);
    console.log(`Tiempo total por zonas: ${totalTimeByZones}`);
}

function openTab(event, tabId) {
    // Ocultar todas las pestañas
    document.querySelectorAll('.tab').forEach(tab => tab.classList.remove('active'));

    // Eliminar clase activa de todos los botones
    document.querySelectorAll('.tab-button').forEach(button => button.classList.remove('active'));

    // Mostrar la pestaña seleccionada
    document.getElementById(tabId).classList.add('active');

    // Activar el botón correspondiente
    event.currentTarget.classList.add('active');
}