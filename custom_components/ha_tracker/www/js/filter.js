//
//
// FILTER
//

import {map} from './map.js';
import {use_mph} from './globals.js';
import {showWindowOverlay, hideWindowOverlay, formatDate, formatTotalTime, isValidCoordinates} from './utils.js';
import {fetchFilteredPositions} from './fetch.js';
import {handleZonePosition, showZone} from './zones.js';
import {handlePersonsSelection, updatePersonsFilter} from './persons.js';
import {t} from './i18n.js';

let filterMarkers = [], routeLine, selectedMarker;
let cachedZoneStats = null;
let summaryZonesSortColumn = "zone"; // Columna predeterminada para ordenar
let summaryZonesSortAscending = true; // Orden ascendente por defecto

const DEFAULT_ICON_URL = '/local/ha-tracker/images/location-blue.png';
						 
document.addEventListener("DOMContentLoaded", () => {
    resetFilter();
	
	const personSelect = document.getElementById("person-select");
    personSelect.addEventListener("focus", async() => {
        try {
            await updatePersonsFilter();
        } catch (error) {
            console.error("Error updating user list:", error);
        }
    });

    personSelect.addEventListener("change", () => {
        try {
			resetFilter();
			handlePersonsSelection(document.getElementById('person-select').value);
        } catch (error) {
            console.error("Error selecting a user:", error);
        }
    });

    const tabButtons = document.querySelectorAll(".tab-button");

    tabButtons.forEach(button => {
        button.addEventListener("click", (event) => {
            try {
                const tabName = button.getAttribute("data-tab"); // Obtener el nombre de la pestaña
                openTab(event, tabName); // Llamar a la función con los parámetros necesarios
            } catch (error) {
                console.error("Error when changing tabs:", error);
            }
        });
    });
});

document.getElementById('filter-button').addEventListener('click', async() => {
    try {
        await applyFilter();
    } catch (error) {
        console.error("Error during filter application:", error);
    }
});

export async function setFilter(data) {
    try {
        if (data && Array.isArray(data) && data.length > 0) {
            await resetFilter(); // Limpia el filtro anterior
            await updatePositionsTable(data); // Actualiza la tabla de posiciones
			await calculateZoneStatistics(data);
            await updateSummaryTable(data); // Actualiza la tabla de resumen
            await updatesummaryZonesTable(data); // Actualiza la tabla de zonas
            await addFilterMarkers(data); // Añade marcadores al mapa
            await addRouteLine(data); // Dibuja la línea de ruta
        } else {
            alert(t('no_positions'));
        }
    } catch (error) {
        console.error("Error getting filtered positions:", error);
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
		const vel = Math.round((pos.attributes.speed || 0) * (use_mph ? 2.23694 : 3.6));

        const uniqueId = `${pos.entity_id}_${new Date(pos.last_updated).toISOString()}`;

        const row = document.createElement('tr');
        row.classList.add(groupClass);
        row.dataset.entityId = uniqueId;
        row.dataset.latitude = pos.attributes.latitude;
        row.dataset.longitude = pos.attributes.longitude;
        row.dataset.lastUpdated = pos.last_updated;
		row.dataset.speed = Math.round((pos.attributes.speed || 0) * (use_mph ? 2.23694 : 3.6));

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
            console.log("Discarded Marker: Position without coordinates:", pos);
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
            console.log("Clicked marker. Searching row with data-entity-id:", uniqueId);
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

    // Validar que el rango entre fechas no sea mayor a 31 días
    const maxDifferenceMs = 31 * 24 * 60 * 60 * 1000; // 31 días en milisegundos
    if (endDateTime - startDateTime > maxDifferenceMs) {
        alert(t('date_range'));
        return;
    }

    showWindowOverlay(t('running_filter')); // Mostrar ventana de carga

    try {
        await fetchFilteredPositions(selectedPersonId, startDate, endDate);
    } catch (error) {
        console.error("Error during filter:", error);
        alert(t('filter_error'));
    } finally {
        hideWindowOverlay(); // Ocultar ventana de carga
    }
}

export async function resetFilter() {
	const startInput = document.getElementById('start-date');
	if (!startInput.value) {
	  const now = new Date();          // fecha/hora locales
	  now.setHours(0, 0, 0, 0);        // 00:00:00.000
	  // ---- formateo manual “YYYY-MM-DDTHH:MM” ----
	  const pad = n => n.toString().padStart(2, '0');
	  const formatted =
		`${now.getFullYear()}-` +
		`${pad(now.getMonth() + 1)}-` +
		`${pad(now.getDate())}T00:00`;
	  startInput.value = formatted;
	}
	
	const endInput = document.getElementById('end-date');
	if (!endInput.value) {
	  const now = new Date();          // fecha/hora locales
	  now.setHours(0, 0, 0, 0);        // 00:00:00.000
	  now.setDate(now.getDate() + 1);  // +1 día
	  // ---- formateo manual “YYYY-MM-DDTHH:MM” ----
	  const pad = n => n.toString().padStart(2, '0');
	  const formatted =
		`${now.getFullYear()}-` +
		`${pad(now.getMonth() + 1)}-` +
		`${pad(now.getDate())}T00:00`;
	  endInput.value = formatted;
	}	
	
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
    console.log("Selected row:", row.dataset.entityId);

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
	const speed = Math.round(row.dataset.speed || 0);
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
        ${speed} ${t(use_mph ? 'mi_per_hour' : 'km_per_hour')}
    `)
    .openPopup();

    // Añadir evento `click` al marcador seleccionado
    selectedMarker.on('click', () => {
        console.log("Clicked marker. Searching row with data-entity-id:", uniqueId);
        handleFilterRowSelection(uniqueId);
    });

    // Centrar el mapa en la posición seleccionada
    map.setView([latitude, longitude], map.getZoom());
}

async function handleFilterRowSelection(uniqueId) {
    const filterTableBody = document.getElementById('filter-table-body');
    if (!filterTableBody) {
        console.error("Filter table tbody not found.");
        return;
    }	
	
    const row = filterTableBody.querySelector(`tr[data-entity-id="${uniqueId}"]`);
    if (!row) {
        console.error("Row not found for position:", uniqueId);
        return;
    }

    const isHidden = getComputedStyle(row).display === 'none' || row.style.display === 'none';
    const groupClass = [...row.classList].find(cls => cls.startsWith('group-'));

    if (!groupClass) {
        console.error("The row does not belong to any group:", row);
        return;
    }

    // Si la fila está oculta, expandimos su grupo
    if (isHidden) {
        console.log("Hidden row. We expand the group:", groupClass);
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

    console.log("Selected row in filter table:", uniqueId);
}

async function addRouteLine(positions) {
    if (!positions || positions.length === 0) {
        console.error("No valid positions found for the route.");
        return; // No continuar si no hay posiciones
    }

    // Asegurarnos de que todas las posiciones tengan latitud y longitud válidas
    const coordinates = positions.map(pos => {
        if (pos.attributes.latitude && pos.attributes.longitude) {
            return [pos.attributes.latitude, pos.attributes.longitude];
        }
        console.log("Invalid position found:", pos);
        return null; // Ignorar posiciones inválidas
    }).filter(coord => coord !== null); // Filtrar coordenadas inválidas

    if (coordinates.length === 0) {
        console.error("No valid coordinates found for the route.");
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
        console.error("There are no positions to calculate statistics.");
        return;
    }

    // Calcular estadísticas
    const totalPositions = positions.length;

    const firstDate = new Date(positions[0].last_updated).getTime();
    const lastDate = new Date(positions[positions.length - 1].last_updated).getTime();
    const totalTimeMs = lastDate - firstDate;

    const maxSpeedPos = positions.reduce((max, pos) => {
		const speed = Math.round((pos.attributes.speed || 0) * (use_mph ? 2.23694 : 3.6));
        return speed > max.speed ? {
            speed,
            position: pos
        }
         : max;
    }, {
        speed: 0,
        position: null
    });

    const averageSpeed = positions.reduce((sum, pos) => sum + (Math.round((pos.attributes.speed || 0) * (use_mph ? 2.23694 : 3.6)) || 0), 0) / totalPositions;
	
    // Formatear datos
    const totalTime = formatTotalTime(totalTimeMs);
    const maxSpeed = maxSpeedPos.speed.toFixed(0);
    const avgSpeed = averageSpeed.toFixed(2);

    // Actualizar las celdas del resumen
    document.getElementById('positions-count').textContent = totalPositions;
    document.getElementById('total-time').textContent = totalTime;
    document.getElementById('max-speed').textContent = `${maxSpeed} ${t(use_mph ? 'mi_per_hour' : 'km_per_hour')}`;
    document.getElementById('average-speed').textContent = `${avgSpeed} ${t(use_mph ? 'mi_per_hour' : 'km_per_hour')}`;

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


function calculateZoneStatistics(positions) {
    if (!positions || positions.length === 0) {
        console.error("There are no positions to calculate zone statistics.");
        return;
    }

    // Asignar los objetos directamente a cachedZoneStats
    cachedZoneStats = {
        zoneDurations: {},
        zoneVisits: {},
        zonePositions: {}
    };

    let previousZone = null;
    let previousTime = null;
	
	let totalTimeByZones = 0; // Tiempo total por zonas

    positions.forEach((pos, index) => {
        const zone = handleZonePosition(pos.attributes.latitude, pos.attributes.longitude);
        const currentZoneName = zone ? zone.name : '';
        const currentTime = new Date(pos.last_updated).getTime();

        if (zone && !cachedZoneStats.zonePositions[currentZoneName]) {
            cachedZoneStats.zonePositions[currentZoneName] = {
                lat: zone.latitude,
                lon: zone.longitude,
                id: zone.id
            };
        }

        if (previousZone !== null && currentZoneName !== previousZone) {
            const timeSpent = currentTime - previousTime;
            if (timeSpent > 0) {
                cachedZoneStats.zoneDurations[previousZone] = (cachedZoneStats.zoneDurations[previousZone] || 0) + timeSpent;
                cachedZoneStats.zoneVisits[previousZone] = (cachedZoneStats.zoneVisits[previousZone] || 0) + 1;
				totalTimeByZones += timeSpent;
            }
            previousZone = currentZoneName;
            previousTime = currentTime;
        } else if (index === 0) {
            previousZone = currentZoneName;
            previousTime = currentTime;
        }

        if (index === positions.length - 1) {
            const timeSpent = currentTime - previousTime;
            if (timeSpent > 0) {
                cachedZoneStats.zoneDurations[currentZoneName] = (cachedZoneStats.zoneDurations[currentZoneName] || 0) + timeSpent;
                cachedZoneStats.zoneVisits[currentZoneName] = (cachedZoneStats.zoneVisits[currentZoneName] || 0) + 1;
				totalTimeByZones += timeSpent;
            }
        }
    });
	
    // Verificar consistencia con el tiempo total
    const firstTime = new Date(positions[0].last_updated).getTime();
    const lastTime = new Date(positions[positions.length - 1].last_updated).getTime();
    const totalTime = lastTime - firstTime;

    console.log(`Total calculated time: ${totalTime}`);
    console.log(`Total time by zones: ${totalTimeByZones}`);	
}

async function updatesummaryZonesTable(positions) {
    const zonesTableBody = document.getElementById('summary-zones-table-body');

    if (!cachedZoneStats) {
        console.error("There are no saved statistics for zones. Make sure to apply the filter first.");
        return;
    }

    const { zoneDurations, zoneVisits, zonePositions } = cachedZoneStats;

    // Ordenar zonas según la columna seleccionada
    const sortedZones = Object.entries(zoneDurations).sort(([zoneA, durationA], [zoneB, durationB]) => {
        switch (summaryZonesSortColumn) {
            case "zone":
                return summaryZonesSortAscending ? zoneA.localeCompare(zoneB) : zoneB.localeCompare(zoneA);
            case "time":
                return summaryZonesSortAscending ? durationA - durationB : durationB - durationA;
            case "visits":
                return summaryZonesSortAscending 
                    ? (zoneVisits[zoneA] || 0) - (zoneVisits[zoneB] || 0)
                    : (zoneVisits[zoneB] || 0) - (zoneVisits[zoneA] || 0);
            default:
                return 0;
        }
    });

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
	
	updateSummaryZonesTableHeaders();
}

function updateSummaryZonesTableHeaders() {
    const table = document.querySelector("#summary-zones-table"); // Asegurarse de que busca en la tabla correcta
    if (!table) {
        console.error("Zone summary table not found.");
        return;
    }

    const headers = table.querySelectorAll("thead th");

    headers.forEach((header) => {
        const columnKey = header.getAttribute("data-i18n");
        let columnName = "";

        switch (columnKey) {
            case "zone":
                columnName = "zone";
                break;
            case "time":
                columnName = "time";
                break;
            case "visits":
                columnName = "visits";
                break;
        }

        if (!columnName) return;

        // **Aplicamos el cursor para indicar que se puede ordenar**
        header.style.cursor = "pointer";

        // **Evento de clic para cambiar el orden**
        header.onclick = () => {
            if (summaryZonesSortColumn === columnName) {
                summaryZonesSortAscending = !summaryZonesSortAscending;
            } else {
                summaryZonesSortColumn = columnName;
                summaryZonesSortAscending = true;
            }
            updatesummaryZonesTable();
        };

        // **Actualizar el ícono de flecha en los encabezados**
        let arrow = "";
        if (summaryZonesSortColumn === columnName) {
            arrow = summaryZonesSortAscending ? "▲" : "▼";
        }

        // **Actualizar la estructura del encabezado con el icono**
        header.innerHTML = `
            <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 30px;">
                <span>${t(columnKey)}</span>
                <span style="font-size: 12px;">${arrow}</span>
            </div>
        `;
    });
}
