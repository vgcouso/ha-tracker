//
// FILTER
//

import { map, createMarker, createDivIcon, createPopup, createPolyline, latLngBounds, removeOverlay } from '../utils/map.js';
import { formatDate, fmt0, fmt2, use_imperial, DEFAULT_ALPHA } from '../globals.js';
import { fetchFilteredPositions, fetchResetReverseGeocodeCache } from '../ha/fetch.js';
import { handleZonePosition, showZone, getZoneStyleById } from '../screens/zones.js';
import { handlePersonsSelection, updatePersonsFilter } from '../screens/persons.js';
import { requestAddress } from '../utils/geocode.js';
import { t } from '../utils/i18n.js';
import { showWindowOverlay, hideWindowOverlay, uiAlert, toRgba } from '../utils/dialogs.js';
import { initRangePicker, getSelectedLocalRange, clearRangeTextbox, updateDaterangeVisibility, setTimes, setRangeDates } from '../utils/calendar.js';
import { exportPositionsToKml } from '../export/kml.js';
import { exportPositionsToCsv } from '../export/csv.js';
import { exportPositionsToXlsx } from '../export/xlsx.js';
import { exportPositionsToPdf, blendedFill, reducePositionsForPdf } from '../export/pdf.js';
import { initPositionsChart, renderPositionsChart, clearPositionsChart, setPositionsMarker } from '../charts/positions.js';

let filterMarkers = [];
let currentPopup = null;
let cachedZoneStats = null;
let summaryZonesSortColumn = "zone";
let summaryZonesSortAscending = true;

const MIN_ZOOM_TO_SHOW = 16;
const FILTER_ICON = '/ha-tracker/images/filter.png';
const STOP_ICON_16_16 = '/ha-tracker/images/stop16x16.png';
const STOP_ICON_24_24 = '/ha-tracker/images/stop24x24.png';

const pad = n => String(n).padStart(2, '0');

const combo = document.getElementById('combo-select');
if (combo) 
    combo.addEventListener('change', () => {
		resetFilter();
		showPositionsTab();
	});
	
function showPositionsTab() {
    const positionsTabButton = document.querySelector('.tab-button[data-tab="positions"]');
    if (positionsTabButton) {
        openTab({
            currentTarget: positionsTabButton
        }, 'positions');
    }
}

function openTab(event, tabId) {
    document.querySelectorAll('.tab').forEach(tab => tab.classList.remove('active'));
    document.querySelectorAll('.tab-button').forEach(button => button.classList.remove('active'));
    document.getElementById(tabId).classList.add('active');
    if (event?.currentTarget)
        event.currentTarget.classList.add('active');
}

export async function initFilter() {
    updateExportFilterVisibility(false);
    ensureZoneTintCSS();
    updateDaterangeVisibility();

    const personSelect = document.getElementById("person-select");
    if (personSelect) {
        personSelect.addEventListener("focus", async() => {
            try {
                await updatePersonsFilter();
            } catch (e) {
                console.error(e);
            }
        });

        personSelect.addEventListener("change", () => {
            try {
                resetFilter(true, false);
                handlePersonsSelection(personSelect.value);
            } catch (e) {
                console.error(e);
            }
        });
    }

    const tabButtons = document.querySelectorAll(".tab-button");
    tabButtons.forEach(button => {
        button.addEventListener("click", (event) => {
            try {
                const tabName = button.getAttribute("data-tab");
                openTab(event, tabName);
            } catch (e) {
                console.error(e);
            }
        });
    });

    await initRangePicker({
        onApplyFilter: () => applyFilter().catch(console.error)
    });
	
	document.addEventListener('positions:select-by-id', (ev) => {
	  const id = ev?.detail?.uniqueId;
	  if (id) {
		try {
		  handleFilterRowSelection(id);
		} catch (e) {
		  console.error('No se pudo seleccionar la fila desde el gráfico:', e);
		}
	  }
	});
	
	initPositionsChart();
}

function retintFilterList() {
    if (!cachedZoneStats)
        return;
    const rows = document.querySelectorAll('#filter-table-body tr');
    rows.forEach(r => {
        const zoneName = r.dataset.zone || '';
        const meta = zoneName && cachedZoneStats.zonePositions?.[zoneName] || null;
        const z = zoneName ? {
            name: zoneName,
            color: meta?.color || null, // solo si hay color explícito
        }
         : null;
        applyRowZoneTint(r, z, DEFAULT_ALPHA);
    });
}

export async function setFilter(payload) {
    try {
        showPositionsTab();
		
		// Back-compat: si payload es array, actúa como antes
        const positions = Array.isArray(payload) ? payload : (payload?.positions || []);
        const summary = Array.isArray(payload) ? null : (payload?.summary || null);
        const zones = Array.isArray(payload) ? null : (payload?.zones || null);
		
        if (positions.length > 0) {
            console.log("Positions:", positions);

            await resetFilter(false, false);
			
			renderPositionsChart(positions);
			
            // Primero cacheamos zonas para tener los colores listos al pintar
            if (zones) {
                setCachedZoneStatsFromServer(zones);
            }

            // pintamos la tabla de posiciones con los colores correctos
            await updatePositionsTable(positions);

            // Resumen del servidor (si viene)
            if (summary) {
                applyServerSummary(summary);
            }
            await updateSummaryZonesTable();

            // Por si acaso algún color cambia dinámicamente, retintamos todo
            retintFilterList();

            await addFilterMarkers(positions);
            await addRouteLine(positions, undefined, undefined, undefined, undefined, undefined, {
                curved: true,
                curveAlg: 'catmull',
                subdivisions: 6,
                alpha: 0.5
            });
						

            updateExportFilterVisibility(true);
        } else {
            resetFilter(true, false);
            //updateExportFilterVisibility(false);
            uiAlert(t('no_positions'), {
                title: t('filter')
            });
        }
    } catch (error) {
        console.error("Error getting filtered positions:", error);
        uiAlert(t('filter_problem'), {
            title: t('filter')
        });
    }
}

async function updatePositionsTable(positions) {
    const tbody = document.getElementById('filter-table-body');
    if (!positions || positions.length === 0)
        return;

    // --- PREESCAN: detecta grupos consecutivos por zona ---
    const groupRanges = [];
    let prevZonePre = null;
    let startIdx = 0;
    const zonesByIndex = [];
    positions.forEach((pos, i) => {
        const zone = handleZonePosition(pos.attributes.latitude, pos.attributes.longitude);
        const zn = zone ? zone.name : '';
        zonesByIndex[i] = {
            zone,
            zn
        };
        if (i === 0) {
            prevZonePre = zn;
            startIdx = 0;
        } else if (zn !== prevZonePre) {
            groupRanges.push({
                start: startIdx,
                end: i - 1
            });
            prevZonePre = zn;
            startIdx = i;
        }
        if (i === positions.length - 1)
            groupRanges.push({
                start: startIdx,
                end: i
            });
    });

    // Observer para direcciones de paradas
    const io = ensureFilterAddrObserver();

    // --- PINTADO ---
    let prevZone = null;
    let groupClassIndex = 0;
    let isFirstInGroup = false;

    const frag = document.createDocumentFragment();

    positions.forEach((pos, i) => {
        const { zone, zn: zoneName } = zonesByIndex[i];
        if (zoneName !== prevZone) {
            groupClassIndex++;
            prevZone = zoneName;
            isFirstInGroup = true;
        } else {
            isFirstInGroup = false;
        }

        const groupClass = `group-${groupClassIndex}`;
        const stop = pos?.stop ? `<img src="${STOP_ICON_16_16}" alt="" style="width:16px;height:16px;">` : "";
        const fecha = formatDate(pos.last_updated);
        const velNum = Math.round((pos.attributes.speed || 0) * (use_imperial ? 2.23694 : 3.6));
        const vel = fmt0(velNum);
        const uniqueId = `${pos.entity_id}_${new Date(pos.last_updated).toISOString()}`;

        const row = document.createElement('tr');
        applyRowZoneTint(row, zone, DEFAULT_ALPHA);
        row.classList.add(groupClass, 'pos-main-row');
        row.dataset.entityId = uniqueId;
        row.dataset.latitude = pos.attributes.latitude;
        row.dataset.longitude = pos.attributes.longitude;
        row.dataset.lastUpdated = pos.last_updated;
        row.dataset.speed = String(velNum);
        row.dataset.battery = (extractBatteryPercent(pos?.attributes) ?? '').toString();
        row.dataset.isStop = (pos && pos.stop) ? '1' : '0';
        row.dataset.entity = pos?.entity_id || '';
        row.dataset.zone = zoneName || '';
        row.dataset.address = '';
        row.style.cursor = "pointer";

        if (isFirstInGroup) {
            // Rango del grupo para el botón filtro
            const range = groupRanges[groupClassIndex - 1];
            const startDate = new Date(positions[range.start].last_updated);
            const endDate = new Date(positions[range.end].last_updated);
            const startStr = formatForDatetimeLocal(startDate);
            const endStr = formatForDatetimeLocal(endDate);

            row.classList.add('group-header');
            row.innerHTML = `
				<td><button class="toggle-btn">►</button></td>
				<td>${stop}</td>
				<td>${fecha}</td>
				<td>${zoneName}</td>
				<td>${vel}</td>
				<td>
				  <button class="group-filter-btn" title="${t('filter') || 'Filtrar'}"
						  style="background:none;border:none;cursor:pointer;padding:0;line-height:0;">
						  <img src="${FILTER_ICON}" alt="" style="width:16px;height:16px;">
				  </button>
				</td>
			  `;

            // toggle
            const toggleButton = row.querySelector('.toggle-btn');
            toggleButton.addEventListener('click', (ev) => {
                ev.stopPropagation();
                toggleGroup(groupClass, toggleButton);
            });

            const filterBtn = row.querySelector('.group-filter-btn');
            filterBtn.addEventListener('click', async(ev) => {
                ev.stopPropagation();

                try {
                    const [sDatePart, sTimePart = '00:00:00'] = startStr.split('T');
                    const [eDatePart, eTimePart = '23:59:59'] = endStr.split('T');

                    const toDateOnly = (datePart) => {
                        const [y, m, d] = datePart.split('-').map(Number);
                        return new Date(y, m - 1, d, 0, 0, 0, 0);
                    };

                    // Actualiza el calendario (horas + días)
                    setTimes(sTimePart, eTimePart);
                    setRangeDates([toDateOnly(sDatePart), toDateOnly(eDatePart)], true);

                    await applyFilter();

                } catch (e) {
                    console.error('No se pudo aplicar el rango al calendario', e);
                }
            });

        } else {
            if (pos && pos.stop) {
                row.style.display = 'table-row'; // visible
                row.classList.add('pin-visible');
            } else {
                row.style.display = 'none';
            }

            row.innerHTML = `
				<td></td>
				<td>${stop}</td>
				<td>${fecha}</td>
				<td>${zoneName}</td>
				<td>${vel}</td>
				<td></td>
			  `;
        }

        row.onclick = () => selectRow(row);
        frag.appendChild(row);

        if (pos && pos.stop) {
            row.classList.add('has-address');
            // Fila de dirección (con lazy geocode)
            const addressRow = document.createElement('tr');
            addressRow.dataset.address = '';
            addressRow.classList.add(groupClass, 'position-address-row', 'pin-visible');
            addressRow.style.cursor = 'pointer';
            addressRow.dataset.entityId = uniqueId;
            addressRow.style.display = 'table-row';
            addressRow.dataset.zone = zoneName || '';

            // dataset necesarios para el observer
            const tsMs = new Date(pos.last_updated).getTime();
            addressRow.dataset.latitude = String(+pos.attributes.latitude);
            addressRow.dataset.longitude = String(+pos.attributes.longitude);
            addressRow.dataset.lastUpdated = String(tsMs);

            addressRow.innerHTML = `
        <td class="addr-spacer"></td>
        <td class="addr-cell" colspan="5" style="padding:4px 8px;">…</td>
      `;

            addressRow.onclick = () => selectRow(row);
            frag.appendChild(addressRow);
            applyRowZoneTint(addressRow, zone, DEFAULT_ALPHA);

            // Observa para pedir dirección cuando entre en viewport
            io.observe(addressRow);
        }
    });

    // Vuelca de una sola vez
    tbody.innerHTML = '';
    tbody.appendChild(frag);

    // Selección auto primera fila si existe
    if (positions.length > 0) {
        const firstRow = tbody.querySelector('tr');
        if (firstRow)
            selectRow(firstRow);
    }

    // Toggle iconos visibles sólo si hay colapsables
    const headers = tbody.querySelectorAll('.group-header');
    headers.forEach(headerRow => {
        const groupClass = Array.from(headerRow.classList).find(c => c.startsWith('group-'));
        if (!groupClass)
            return;

        // Solo lo que se expande/colapsa de verdad
        const nonPinned = tbody.querySelectorAll(`tr.${groupClass}:not(.group-header):not(.pin-visible)`);
        const hasToggleable = nonPinned.length > 0;
        const isCollapsed = hasToggleable && Array.from(nonPinned).some(r => r.style.display === 'none');

        const toggleBtn = headerRow.querySelector('.toggle-btn');
        const filterBtn = headerRow.querySelector('.group-filter-btn');

        if (toggleBtn) {
            toggleBtn.style.display = hasToggleable ? '' : 'none';
            toggleBtn.textContent = isCollapsed ? '►' : '▼';
        }
        if (filterBtn) {
            // si quieres que siempre esté, déjalo siempre visible; si no, átalo a hasToggleable
            filterBtn.style.display = hasToggleable ? '' : 'none';
        }
    });
}

function gotoMaxSpeedPosition() {
    const tbody = document.getElementById('filter-table-body');
    if (!tbody)
        return;

    // Filas “principales” (una por posición)
    const rows = Array.from(tbody.querySelectorAll('tr.pos-main-row'));
    if (!rows.length)
        return;

    // Elegimos la de mayor speed; si hay empate, la más reciente
    let best = null;
    for (const r of rows) {
        const s = Number(r.dataset.speed) || 0;
        const ts = Date.parse(r.dataset.lastUpdated) || 0;
        if (!best || s > best.s || (s === best.s && ts > best.ts)) {
            best = {
                id: r.dataset.entityId,
                s,
                ts
            };
        }
    }

    if (best && best.id) {
        // Esto ya se encarga de expandir el grupo si está oculto, seleccionar la fila,
        // cambiar a la pestaña de posiciones, centrar y abrir el popup.
        handleFilterRowSelection(best.id);
    } else {
        uiAlert(t('no_positions') || 'No hay posiciones.', {
            title: t('filter')
        });
    }
}

function applyServerSummary(summary) {
    // summary: { positions_count, total_time_s, distance_m, max_speed_mps, average_speed_mps, stops_count, stopped_time_s, ... }
    const factor = use_imperial ? 2.23694 : 3.6; // m/s -> mph o km/h
    const distValue = use_imperial ? (summary.distance_m / 1609.344) : (summary.distance_m / 1000);

    // helpers
    const fmtTime = (secs) => formatTotalTime(secs * 1000);

    document.getElementById('positions-count').textContent = fmt0(summary.positions_count);
    document.getElementById('total-time').textContent = fmtTime(summary.total_time_s);
    document.getElementById('distance').textContent = `${fmt0(distValue)} ${t(use_imperial ? 'miles' : 'kilometres')}`;
    document.getElementById('max-speed').textContent = `${fmt0(summary.max_speed_mps * factor)} ${t(use_imperial ? 'mi_per_hour' : 'km_per_hour')}`;
    document.getElementById('average-speed').textContent = `${fmt0(summary.average_speed_mps * factor)} ${t(use_imperial ? 'mi_per_hour' : 'km_per_hour')}`;
    document.getElementById('stops-count').textContent = fmt0(summary.stops_count);
    document.getElementById('stopped-time').textContent = fmtTime(summary.stopped_time_s);

    // Click a “máxima velocidad”: busca la posición más rápida.
    const maxSpeedRow = document.querySelector('#summary table tbody tr:nth-child(4)');
    if (maxSpeedRow) {
        maxSpeedRow.style.cursor = "pointer";
        maxSpeedRow.onclick = gotoMaxSpeedPosition;
    }
}

function setCachedZoneStatsFromServer(zones) {
    // zones: [{ zone, time_s, visits, stops, distance_m }]
    cachedZoneStats = {
        zoneDurations: {},
        zoneVisits: {},
        zonePositions: {},
        zoneStops: {},
        zoneDistanceMeters: {}
    };

    for (const z of zones) {
        const name = z.zone || '';
        cachedZoneStats.zoneDurations[name] = (z.time_s || 0) * 1000; // ms
        cachedZoneStats.zoneVisits[name] = z.visits || 0;
        cachedZoneStats.zoneStops[name] = z.stops || 0;
        cachedZoneStats.zoneDistanceMeters[name] = z.distance_m || 0;

        // Resolver color y flags desde zones.js usando el ID de zona
        if (z.id != null) {
            const style = getZoneStyleById(z.id);
            if (style) {
                cachedZoneStats.zonePositions[name] = {
                    id: style.id,
                    name: style.name || name,
                    lat: style.lat,
                    lon: style.lon,
                    color: style.color || null,
                };
            }
        }
    }
}

async function addFilterMarkers(positions) {
    if (!map.getPane('filterMarkers')) {
        map.createPane('filterMarkers');
        map.getPane('filterMarkers').style.zIndex = 400;
    }

    const minZoomToShow = MIN_ZOOM_TO_SHOW;

    positions.forEach(pos => {
        const lat = Number(pos?.attributes?.latitude);
        const lon = Number(pos?.attributes?.longitude);
        if (!Number.isFinite(lat) || !Number.isFinite(lon))
            return;

        const icon = pos.stop
             ? {
                className: 'filter-stop-icon',
                html: `<img src="${STOP_ICON_24_24}" alt="stop" style="width:24px;height:24px;"/>`,
                iconSize: [24, 24],
                iconAnchor: [12, 12],
            }
             : {
                className: 'filter-point-icon',
                html: `<div style="width:10px;height:10px;border:1px solid rgba(0,0,255,0.8);border-radius:50%;background-color: rgba(0,0,255,0.5);"></div>`,
                iconSize: [10, 10],
                iconAnchor: [5, 5],
            };

        const marker = createMarker([lat, lon], {
            icon: createDivIcon(icon),
            pane: 'filterMarkers',
        });
        marker.isStop = !!pos.stop;

        if (!pos.stop && map.getZoom() < minZoomToShow)
            marker.setVisible(false);
        else
            marker.setVisible(true);
        if (pos.stop)
            marker.setZIndexOffset(50);

        marker.on('click', () => {
            const uniqueId = `${pos.entity_id}_${new Date(pos.last_updated).toISOString()}`;
            handleFilterRowSelection(uniqueId);
        });

        filterMarkers.push(marker);
    });

    if (!_zoomHandlerBound) {
        map.on('zoomend', _zoomHandler);
        _zoomHandlerBound = true;
    }
    _zoomHandler();
}

async function applyFilter() {
    const selectedPersonId = document.getElementById('person-select').value;

    const { startLocal, endLocal } = getSelectedLocalRange();

    if (!selectedPersonId) {
        uiAlert(t('select_user_filter'), {
            title: t('filter')
        });
        clearRangeTextbox();
        return;
    }
    if (!startLocal || !endLocal) {
        uiAlert(t('select_dates'), {
            title: t('filter')
        });
        return;
    }

    const startUTC = toUtcISOStringFromLocal(startLocal, false);
    const endUTC = toUtcISOStringFromLocal(endLocal, !endLocal.includes('T'));
    if (!startUTC || !endUTC) {
        uiAlert(t('select_dates'), {
            title: t('filter')
        });
        return;
    }

    // sumar 1 segundo al fin (rango inclusivo)
    const endUTCPlus1s = new Date(Date.parse(endUTC) + 1000).toISOString();

    const startMs = Date.parse(startUTC);
    const endMsPlus1s = Date.parse(endUTCPlus1s);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMsPlus1s) || startMs >= endMsPlus1s) {
        uiAlert(t('invalid_dates'), {
            title: t('filter')
        });
        clearRangeTextbox();
        return;
    }

    const maxDifferenceMs = 31 * 24 * 60 * 60 * 1000;
    if (endMsPlus1s - startMs > maxDifferenceMs) {
        uiAlert(t('date_range'), {
            title: t('filter')
        });
        clearRangeTextbox();
        return;
    }

    try {
		showWindowOverlay(t('running_filter'));
		
        // PRUEBAS
        //await fetchResetReverseGeocodeCache();
        //console.log("***************** fetchResetReverseGeocodeCache ****************");
		
        await fetchFilteredPositions(selectedPersonId, startUTC, endUTCPlus1s);
    } catch (error) {
        console.error("Error during filter:", error);
        uiAlert(t('filter_error'), {
            title: t('filter')
        });
    } finally {
        hideWindowOverlay();
    }
}

export async function resetFilter(resetCalendar = true, resetUsers = true) {
    if (resetCalendar)
        clearRangeTextbox();
	
    if (resetUsers) {
        const sel = document.getElementById('person-select');
        if (sel) {
            sel.value = '';
            sel.dispatchEvent(new Event('change', {
                    bubbles: true
                }));
        }
    }

    closeInfoPopup();    

    // Reiniciar posiciones
    document.getElementById('filter-table-body').innerHTML = '';

    // Reiniciar resumen
    document.getElementById('positions-count').textContent = '--';
    document.getElementById('total-time').textContent = '--';
    document.getElementById('distance').textContent = '--';
    document.getElementById('max-speed').textContent = '--';
    document.getElementById('average-speed').textContent = '--';
    document.getElementById('stops-count').textContent = '--';
    document.getElementById('stopped-time').textContent = '--';
    document.getElementById('summary-zones-table-body').innerHTML = '';

    const maxSpeedRow = document.querySelector('#summary table tbody tr:nth-child(4)');
    if (maxSpeedRow) {
        maxSpeedRow.style.cursor = ''; // o 'default'
        maxSpeedRow.onclick = null;
    }

    // Marcadores
    filterMarkers.forEach(marker => {
        try {
            removeOverlay(marker);
        } catch {}
    });
    filterMarkers = [];

    // Ruta
    if (window.routeLineSegments) {
        window.routeLineSegments.forEach(seg => {
            try {
                removeOverlay(seg);
            } catch {}
        });
        window.routeLineSegments = [];
    }
    if (window.routeOutline) {
        try {
            removeOverlay(window.routeOutline);
        } catch {}
        window.routeOutline = null;
    }

    // Zoom handler
    if (_zoomHandlerBound) {
        map.off('zoomend', _zoomHandler);
        _zoomHandlerBound = false;
    }

    // Detener observer (las tareas activas se autogestionan por uniqueId)
    if (_filterAddrObserver) {
        _filterAddrObserver.disconnect();
        _filterAddrObserver = null;
    }

    // recalcula visibilidad del rango de fechas y oculta export SIEMPRE tras un reset
    updateDaterangeVisibility();
    updateExportFilterVisibility(false);
	
	clearPositionsChart();
}

async function toggleGroup(groupClass, btn) {
    const rows = document.querySelectorAll(`tr.${groupClass}:not(.group-header):not(.pin-visible)`);
    if (!rows.length) {
        btn.textContent = (btn.textContent === '►') ? '▼' : '►';
        return;
    }
    const wasCollapsed = rows[0].style.display === 'none';
    rows.forEach(row => {
        row.style.display = wasCollapsed ? 'table-row' : 'none';
    });
    btn.textContent = wasCollapsed ? '▼' : '►';

    if (wasCollapsed) {
        queueMicrotask(() => {
            const tbodySel = '#filter-table-body';
            let target = document.querySelector(`${tbodySel} tr.${groupClass}.selected`);
            if (target && target.classList.contains('position-address-row')) {
                const prev = target.previousElementSibling;
                if (prev && prev.classList.contains('pos-main-row'))
                    target = prev;
            }
            if (!target)
                target = document.querySelector(`${tbodySel} tr.${groupClass}:not(.group-header)`);
            if (target)
                target.scrollIntoView({
                    behavior: 'smooth',
                    block: 'center'
                });
        });
    }
}

async function selectRow(row) {	
    const rows = document.querySelectorAll('#filter-table-body tr');
    rows.forEach(r => r.classList.remove('selected'));
    row.classList.add('selected');

    const addr = row.nextElementSibling;
    if (addr && addr.classList.contains('position-address-row'))
        addr.classList.add('selected');

    const latitude = parseFloat(row.dataset.latitude);
    const longitude = parseFloat(row.dataset.longitude);
    const lastUpdated = row.dataset.lastUpdated;
    const speed = Math.round(row.dataset.speed || 0);
    const isStop = row.dataset.isStop === '1';

    openInfoPopup(latitude, longitude, lastUpdated, speed, isStop);
	
	setPositionsMarker(lastUpdated);
}

function openInfoPopup(lat, lon, lastUpdated, speed, isStop = false) {
    const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${lat},${lon}`;
    const stopLine = isStop ? `<strong>${t('stop') || 'Stop'}</strong><br>` : '';
    const html = `
	  ${stopLine}
	  ${formatDate(lastUpdated)}<br>${t('speed')}: ${fmt0(speed)} ${t(use_imperial ? 'mi_per_hour' : 'km_per_hour')}
	  <br><br><a href="${mapsUrl}" target="_blank" rel="noopener noreferrer"><strong>${t('open_location')}</strong></a>
	`;

    if (currentPopup)
        currentPopup.remove();

    currentPopup = createPopup({
        closeOnClick: true,
    })
        .setLatLng([lat, lon])
        .setContent(html);

    currentPopup.openOn(map);

    map.invalidateSize();
    map.setView([lat, lon], map.getZoom());
}

function closeInfoPopup() {
    if (currentPopup) {
        currentPopup.remove();
        currentPopup = null;
    }
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

    if (isHidden) {
        const groupHeader = document.querySelector(`tr.${groupClass}.group-header`);
        if (groupHeader) {
            const toggleBtn = groupHeader.querySelector('.toggle-btn');
            if (toggleBtn)
                toggleGroup(groupClass, toggleBtn);
        }
    }

    const comboSelect = document.getElementById('combo-select');
    if (comboSelect && comboSelect.value !== 'filter') {
        comboSelect.value = 'filter';
        const changeEvent = new Event('change', {
            bubbles: true
        });
        comboSelect.dispatchEvent(changeEvent);
    }

    selectRow(row);
    showPositionsTab();

    row.scrollIntoView({
        behavior: 'smooth',
        block: 'center'
    });
}

async function addRouteLine(
    positions,
    colorStart = [0, 200, 0, 0.8],
    colorEnd = [100, 100, 255, 0.8],
    outlineColor = '#ffffff',
    outlineWeight = 9,
    lineWeight = 6,
    opts = {}) {
    const { curved = false, // activar curvas
    curveAlg = 'catmull', // 'catmull' | 'chaikin'
    subdivisions = 8, // densidad por tramo (más => más suave)
    alpha = 0.5 // 0.5 centrípeta (mejor contra bucles)
     } = opts;

    if (!positions || positions.length < 2)
        return;

    let coords = positions
        .map(p => (p.attributes.latitude && p.attributes.longitude)
             ? [p.attributes.latitude, p.attributes.longitude]
             : null)
        .filter(Boolean);
    if (coords.length < 2)
        return;

    // === curva que pasa por los puntos ===
    if (curved) {
        if (curveAlg === 'catmull') {
            // límite de rendimiento: evita explotar en miles de segmentos
            const maxSegs = 4000;
            const desiredSegs = (coords.length - 1) * subdivisions;
            const safeSubs = desiredSegs > maxSegs
                 ? Math.max(1, Math.floor(maxSegs / Math.max(coords.length - 1, 1)))
                 : subdivisions;

            coords = catmullRomSpline(coords, safeSubs, alpha);
        }
    }

    // …(lo demás igual que ya tienes) limpiar, crear panes, etc.
    if (window.routeLineSegments) {
        window.routeLineSegments.forEach(seg => {
            try {
                removeOverlay(seg);
            } catch {}
        });
    }
    window.routeLineSegments = [];
    if (window.routeOutline) {
        try {
            removeOverlay(window.routeOutline);
        } catch {}
        window.routeOutline = null;
    }

    if (!map.getPane('routeOutline'))
        map.createPane('routeOutline');
    if (!map.getPane('routeColor'))
        map.createPane('routeColor');
    map.getPane('routeOutline').style.zIndex = 390;
    map.getPane('routeColor').style.zIndex = 391;

    const n = coords.length - 1;
    for (let i = 0; i < n; i++) {
        const t = i / n;
        const r = Math.round(colorStart[0] + t * (colorEnd[0] - colorStart[0]));
        const g = Math.round(colorStart[1] + t * (colorEnd[1] - colorStart[1]));
        const b = Math.round(colorStart[2] + t * (colorEnd[2] - colorStart[2]));
        const a = colorStart[3] + t * (colorEnd[3] - colorStart[3]);
        const color = `rgba(${r},${g},${b},${a})`;

        const p0 = coords[i],
        p1 = coords[i + 1];

        const segmentOutline = createPolyline([p0, p1], {
            color: outlineColor,
            weight: outlineWeight,
            opacity: 1,
            lineCap: 'round',
            lineJoin: 'round',
            pane: 'routeOutline',
        });
        window.routeLineSegments.push(segmentOutline);

        const segmentColor = createPolyline([p0, p1], {
            color,
            weight: lineWeight,
            opacity: 1,
            lineCap: 'round',
            lineJoin: 'round',
            pane: 'routeColor',
        });
        window.routeLineSegments.push(segmentColor);
    }

    const bounds = latLngBounds(coords);
    if (bounds)
        map.fitBounds(bounds);
}

// Curva Catmull-Rom centrípeta que INTERPOLA los puntos (pasa por ellos)
function catmullRomSpline(latlngs, subdivisions = 8, alpha = 0.5) {
    const eps = 1e-6;
    const pts = latlngs
        .map(p => [Number(p[0]), Number(p[1])])
        .filter(p => Number.isFinite(p[0]) && Number.isFinite(p[1]));
    if (pts.length < 2)
        return pts;

    const out = [];
    const lerp = (A, B, t) => [A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t];
    const td = (A, B) => Math.pow(Math.hypot(B[0] - A[0], B[1] - A[1]) || eps, alpha);

    out.push(pts[0]); // incluye el primer punto exactamente

    for (let i = 0; i < pts.length - 1; i++) {
        const p0 = i > 0 ? pts[i - 1] : pts[i];
        const p1 = pts[i];
        const p2 = pts[i + 1];
        const p3 = i + 2 < pts.length ? pts[i + 2] : pts[i + 1];

        const t0 = 0;
        const t1 = t0 + td(p0, p1);
        const t2 = t1 + td(p1, p2);
        const t3 = t2 + td(p2, p3);

        // generamos puntos entre p1..p2; j=1..subdivisions para no duplicar p1
        for (let j = 1; j <= subdivisions; j++) {
            const t = t1 + (j * (t2 - t1)) / subdivisions;

            const A1 = lerp(p0, p1, (t - t0) / (t1 - t0 + eps));
            const A2 = lerp(p1, p2, (t - t1) / (t2 - t1 + eps));
            const A3 = lerp(p2, p3, (t - t2) / (t3 - t2 + eps));
            const B1 = lerp(A1, A2, (t - t0) / (t2 - t0 + eps));
            const B2 = lerp(A2, A3, (t - t1) / (t3 - t1 + eps));
            const C = lerp(B1, B2, (t - t1) / (t2 - t1 + eps));

            const prev = out[out.length - 1];
            if (!prev || Math.hypot(C[0] - prev[0], C[1] - prev[1]) > eps)
                out.push(C);
        }

        // Asegura que p2 exacto queda incluido (interpolación estricta)
        const last = out[out.length - 1];
        if (!last || Math.hypot(p2[0] - last[0], p2[1] - last[1]) > eps)
            out.push(p2);
    }
    return out;
}

async function updateSummaryZonesTable() {
    const zonesTableBody = document.getElementById('summary-zones-table-body');

    if (!cachedZoneStats) {
        console.error("There are no saved statistics for zones. Make sure to apply the filter first.");
        return;
    }

    const { zoneDurations, zoneVisits, zonePositions, zoneStops, zoneDistanceMeters } = cachedZoneStats;

    const zoneKeys = new Set([
                ...Object.keys(zoneDurations || {}),
                ...Object.keys(zoneVisits || {}),
                ...Object.keys(zoneStops || {}),
                ...Object.keys(zoneDistanceMeters || {}),
            ]);

    const zones = [...zoneKeys];

    const sortedZones = zones.sort((zoneA, zoneB) => {
        switch (summaryZonesSortColumn) {
        case "zone":
            return summaryZonesSortAscending ? zoneA.localeCompare(zoneB) : zoneB.localeCompare(zoneA);
        case "time":
            return summaryZonesSortAscending
             ? ((zoneDurations?.[zoneA] || 0) - (zoneDurations?.[zoneB] || 0))
             : ((zoneDurations?.[zoneB] || 0) - (zoneDurations?.[zoneA] || 0));
        case "visits":
            return summaryZonesSortAscending
             ? ((zoneVisits?.[zoneA] || 0) - (zoneVisits?.[zoneB] || 0))
             : ((zoneVisits?.[zoneB] || 0) - (zoneVisits?.[zoneA] || 0));
        case "stops":
            return summaryZonesSortAscending
             ? ((zoneStops?.[zoneA] || 0) - (zoneStops?.[zoneB] || 0))
             : ((zoneStops?.[zoneB] || 0) - (zoneStops?.[zoneA] || 0));
        case "distance":
            return summaryZonesSortAscending
             ? ((zoneDistanceMeters?.[zoneA] || 0) - (zoneDistanceMeters?.[zoneB] || 0))
             : ((zoneDistanceMeters?.[zoneB] || 0) - (zoneDistanceMeters?.[zoneA] || 0));
        default:
            return 0;
        }
    });

    zonesTableBody.innerHTML = '';

    for (const zoneName of sortedZones) {
        const duration = zoneDurations?.[zoneName] || 0;
        const visits = zoneVisits?.[zoneName] || 0;
        const stops = zoneStops?.[zoneName] || 0;

        const meters = zoneDistanceMeters?.[zoneName] || 0;
        const distValue = use_imperial ? (meters / 1609.344) : (meters / 1000);
        const distText = `${fmt0(distValue)}`;
        const pretty = zoneName;

        const row = document.createElement('tr');
        row.innerHTML = `
		  <td>${pretty}</td>
		  <td>${formatTotalTime(duration)}</td>
		  <td>${fmt0(visits)}</td>
		  <td>${fmt0(stops)}</td>
		  <td>${distText}</td>
		`;

        // Solo hacer clic y mostrar puntero si existe id de zona
        const zoneData = zonePositions[zoneName];
        if (zoneData && zoneData.id != null) {
            row.style.cursor = 'pointer';
            row.addEventListener('click', () => showZone(zoneData.id));
        } else {
            // sin id: sin puntero ni click
            row.style.cursor = ''; // o 'default'
        }

        row.addEventListener('click', () => {
            const zoneData = zonePositions[zoneName];
            if (zoneData)
                showZone(zoneData.id);
        });

        const meta = zonePositions[zoneName];
        if (zoneName) {
            const z = {
                name: zoneName,
                color: meta?.color || null
            };
            applyRowZoneTint(row, z, DEFAULT_ALPHA);
        } else {
            row.classList.remove('zone-tinted');
            row.style.removeProperty('--color-bg');
        }

        zonesTableBody.appendChild(row);
    }

    updateSummaryZonesTableHeaders();
}

function updateSummaryZonesTableHeaders() {
    const table = document.querySelector("#summary-zones-table");
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
        case "stops":
            columnName = "stops";
            break;
        case "distance":
            columnName = "distance";
            break;
        }
        if (!columnName)
            return;

        header.style.cursor = "pointer";
        header.onclick = () => {
            if (summaryZonesSortColumn === columnName)
                summaryZonesSortAscending = !summaryZonesSortAscending;
            else {
                summaryZonesSortColumn = columnName;
                summaryZonesSortAscending = true;
            }
            updateSummaryZonesTable();
        };

        let arrow = (summaryZonesSortColumn === columnName) ? (summaryZonesSortAscending ? "▲" : "▼") : "";
        const label = columnKey === "distance"
             ? (use_imperial ? t("miles") : t("kilometres"))
             : t(columnKey);

        header.innerHTML = `
            <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:30px;">
                <span class="hdr-label">${label}</span>
                <span class="hdr-arrow" style="font-size:12px;">${arrow}</span>
            </div>`;
    });
}

function ensureZoneTintCSS() {
    if (document.getElementById('zone-tint-css'))
        return;
    const style = document.createElement('style');
    style.id = 'zone-tint-css';
    style.textContent = `
		/* Aplica tinte solo si la fila NO está seleccionada */
		#filter-table-body tr.zone-tinted:not(.selected),
		#summary-zones-table-body tr.zone-tinted:not(.selected) {
		  background-color: var(--color-bg);
		}
	  `;
    document.head.appendChild(style);
}

function applyRowZoneTint(el, zone, alpha = DEFAULT_ALPHA) {
    const hasZone = !!zone && (zone.name ?? '') !== '';
    if (!hasZone) {
        el.classList.remove('zone-tinted');
        el.style.removeProperty('--color-bg');
        return;
    }
    const bg = getZoneBgCssFromZone(zone, alpha);
    if (bg) {
        el.classList.add('zone-tinted');
        el.style.setProperty('--color-bg', bg);
    } else {
        el.classList.remove('zone-tinted');
        el.style.removeProperty('--color-bg');
    }
}

function getZoneBgCssFromZone(zone, alpha = DEFAULT_ALPHA) {
    if (!zone)
        return null;
    // 1) color explícito de la zona
    let hex = zone.color;
    // 2) fallback: busca color precalculado en cache (si la fila solo trae el nombre)
    if (!hex && zone.name && cachedZoneStats?.zonePositions?.[zone.name]?.color) {
        hex = cachedZoneStats.zonePositions[zone.name].color;
    }
    // 3) sin color => SIN tinte en tablas
    if (!hex)
        return null;
    return toRgba(hex, alpha);
}

// Formatear tiempo total en el formato "X días horas:minutos"
function formatTotalTime(totalTimeMs) {
    const totalSeconds = Math.floor(totalTimeMs / 1000);
    const days = Math.floor(totalSeconds / (24 * 3600));
    const hours = Math.floor((totalSeconds % (24 * 3600)) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    // Condicional para incluir "día" o "días"
    const daysText = days > 0 ? `${days} ${days === 1 ? t('day') : t('days')} ` : '';

    return `${daysText}${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function formatForDatetimeLocal(d) {
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function toUtcISOStringFromLocal(value, endOfDay = false) {
    if (!value)
        return null;

    const nums = value.match(/\d+/g)?.map(Number);
    if (!nums || nums.length < 3)
        return null;

    const [y, m, d] = nums;
    let hh = 0,
    mm = 0,
    ss = 0,
    ms = 0;

    if (nums.length >= 5) { // datetime-local
        hh = nums[3];
        mm = nums[4];
        ss = nums[5] ?? 0;
    } else if (endOfDay) { // date (fin de día)
        hh = 23;
        mm = 59;
        ss = 59;
        ms = 999;
    }

    const local = new Date(y, m - 1, d, hh, mm, ss, ms); // meses 0-based
    return local.toISOString(); // '...Z'
}

//
// EXPORT
//

function updateExportFilterVisibility(visible) {
    const sel = document.getElementById('export-filter');
    const box = sel?.closest('.group');
    if (!box || !sel)
        return;
    box.style.display = visible ? '' : 'none';
    sel.disabled = !visible;
    box.setAttribute('aria-hidden', visible ? 'false' : 'true');
}

function extractBatteryPercent(attrs) {
    if (!attrs || typeof attrs !== 'object')
        return null;

    // candidatos por orden de probabilidad
    const candidates = [
        'battery', 'battery_level', 'battery_percent', 'battery_percentage',
        'battery_level_pct', 'batteryLevel'
    ];

    let v = null;
    for (const k of candidates) {
        if (k in attrs) {
            v = attrs[k];
            break;
        }
    }
    if (v == null)
        return null;

    // "85%", " 85 % ", 85, 0.85, "0.85"
    if (typeof v === 'string') {
        const m = v.match(/(\d+(?:\.\d+)?)\s*%?/);
        if (m)
            v = Number(m[1]);
    }

    v = Number(v);
    if (!Number.isFinite(v))
        return null;

    // fracción 0–1 -> %
    if (v > 0 && v <= 1)
        return Math.round(v * 100);
    // 1–100 -> %
    if (v >= 1 && v <= 100)
        return Math.round(v);

    return null;
}

function readPositionsFromTable() {
    const tbody = document.getElementById('filter-table-body');
    if (!tbody)
        return [];

    const rows = Array.from(tbody.querySelectorAll('tr.pos-main-row'));
    const positions = [];

    for (const row of rows) {
        const lat = Number(row.dataset.latitude);
        const lon = Number(row.dataset.longitude);
        if (!Number.isFinite(lat) || !Number.isFinite(lon))
            continue;

        const lastUpdated = row.dataset.lastUpdated;
        const isStop = row.dataset.isStop === '1';
        const entityId = row.dataset.entity || '';

        // Zona: usa data-zone; si no existe por lo que sea, re-calcula
        let zoneName = row.dataset.zone || '';
        if (!zoneName && typeof handleZonePosition === 'function') {
            try {
                const z = handleZonePosition(lat, lon);
                zoneName = z?.name || '';
            } catch {}
        }

        // Dirección: usa data-address; si está vacía, prueba a leer la celda visible (si existe)
        let address = row.dataset.address || '';
        if (!address && isStop) {
            const addrRow = row.nextElementSibling;
            if (addrRow && addrRow.classList.contains('position-address-row')) {
                const td = addrRow.querySelector('td.addr-cell') || addrRow.querySelector('td');
                const txt = (td?.textContent || '').trim();
                if (txt && txt !== '…')
                    address = txt;
            }
        }

        // Velocidad: de la UI (km/h o mph) a m/s
        const shownSpeed = Number(row.dataset.speed);
        let speedMps = null;
        if (Number.isFinite(shownSpeed)) {
            const kmh = use_imperial ? (shownSpeed * 1.609344) : shownSpeed;
            speedMps = kmh / 3.6;
        }

        //batería
        const battery = row.dataset.battery && Number.isFinite(Number(row.dataset.battery))
             ? Number(row.dataset.battery)
             : null;

        positions.push({
            entity_id: entityId,
            last_updated: lastUpdated,
            stop: isStop,
            zone: zoneName,
            address: address,
            battery,
            attributes: {
                latitude: lat,
                longitude: lon,
                speed: speedMps
            }
        });
    }

    return positions;
}

function stampFromLocal(localStr) {
    if (!localStr)
        return 'unknown';
    const nums = localStr.match(/\d+/g)?.map(Number);
    if (!nums || nums.length < 3)
        return 'unknown';
    const [y, m, d, hh = 0, mm = 0] = nums;
    const hasTime = localStr.includes('T');
    return hasTime
     ? `${y}-${pad(m)}-${pad(d)}_${pad(hh)}-${pad(mm)}`
     : `${y}-${pad(m)}-${pad(d)}`;
}

function safeName(s) {
    return String(s)
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[\\/:*?"<>|]/g, '')
    .trim().replace(/\s+/g, '_');
}

function buildFilenameFromUI(ext = 'kml') {
    const sel = document.getElementById('person-select');
    const displayName = safeName(sel?.selectedOptions?.[0]?.text || sel?.value || 'person');
    const { startLocal, endLocal } = getSelectedLocalRange();
    return `${displayName}_${stampFromLocal(startLocal)}_${stampFromLocal(endLocal)}.${ext}`;
}

document.getElementById('export-filter')?.addEventListener('change', (e) => {
    const v = e.target.value;
    if (v === 'export-kml') {
        doExportKml();
    } else if (v === 'export-csv') {
        doExportCsv();
    } else if (v === 'export-xlsx') {
        doExportXlsx();
    } else if (v === 'export-pdf') {
        doExportPdf();
    }
    e.target.value = 'export-file';
});

function doExportKml() {
    const positions = readPositionsFromTable();
    if (!positions.length) {
        uiAlert(t('no_positions'), {
            title: 'KML'
        });
        return;
    }

    const filename = buildFilenameFromUI('kml');
    exportPositionsToKml(positions, {
        filename,
        stopIconHref: new URL(STOP_ICON_24_24, window.location.origin).href,
        includeRoute: true,
        nameStop: (p) => `${formatDate(p.last_updated)}`,
        describeStop: (p) => {
            const kmh = Math.round((p?.attributes?.speed || 0) * (use_imperial ? 2.23694 : 3.6));
            const unit = t(use_imperial ? 'mi_per_hour' : 'km_per_hour');
            const batt = Number.isFinite(p?.battery) ? `${p.battery}%` : '';
            return `<table cellspacing="0" cellpadding="0" style="border-collapse:collapse">
        ${p.zone ? `<tr><td>● ${p.zone}</td></tr>` : ''}
        ${p.address ? `<tr><td>● ${p.address}</td></tr>` : ''}
        <tr><td>● ${kmh} ${unit}</td></tr>
		${batt ? `<tr><td>● ${t('battery')}: ${batt}</td></tr>` : ''}
      </table>`;
        },
        formatLocal: (d) => formatDate(d),
        unitLabel: t(use_imperial ? 'mi_per_hour' : 'km_per_hour'),
        batteryLabel: t('battery')
    });
}

function doExportCsv() {
    const positions = readPositionsFromTable();
    if (!positions.length) {
        uiAlert(t('no_positions'), {
            title: 'CSV'
        });
        return;
    }

    // mismo nombre “bonito” que usas en KML, pero .csv
    const filename = buildFilenameFromUI('csv');

    exportPositionsToCsv(positions, {
        filename,
        useImperial: !!use_imperial,
        formatLocal: (d) => formatDate(d), // misma fecha local que en la tabla
        delimiter: ';', // recomendado para Excel ES; cambia a ',' si prefieres
        usePicker: false, // pon true si quieres forzar File Picker
    });
}

async function doExportXlsx() {
    const positions = readPositionsFromTable();
    if (!positions.length) {
        uiAlert(t('no_positions') || 'No hay posiciones para exportar.', {
            title: 'Excel'
        });
        return;
    }
    const filename = buildFilenameFromUI('xlsx');
    await exportPositionsToXlsx(positions, {
        filename,
        useImperial: !!use_imperial,
        formatLocal: (d) => formatDate(d),
        sheetName: 'Posiciones',
    });
}

async function doExportPdf() {
    const positions = readPositionsFromTable();
    if (!positions.length) {
        uiAlert(t('no_positions'), {
            title: 'PDF'
        });
        return;
    }

    // 1) RESUMEN (lee lo que ya tienes pintado)
    const summaryRows = [{
            label: t('positions'),
            value: document.getElementById('positions-count')?.textContent || ''
        }, {
            label: t('total_time'),
            value: document.getElementById('total-time')?.textContent || ''
        }, {
            label: t('distance'),
            value: document.getElementById('distance')?.textContent || ''
        }, {
            label: t('max_speed'),
            value: document.getElementById('max-speed')?.textContent || ''
        }, {
            label: t('average_speed'),
            value: document.getElementById('average-speed')?.textContent || ''
        }, {
            label: t('stops_count'),
            value: document.getElementById('stops-count')?.textContent || ''
        }, {
            label: t('stopped_time'),
            value: document.getElementById('stopped-time')?.textContent || ''
        },
    ];

    // 2) ZONAS visitadas
    const zonesRows = [];
    const zonePositions = cachedZoneStats?.zonePositions || {};
    if (cachedZoneStats) {
        const { zoneDurations, zoneVisits, zoneStops, zoneDistanceMeters } = cachedZoneStats;

        // (Opcional) si quieres incluir “fuera de zona” aunque no tenga tiempo:
        const zoneKeys = new Set([
                    ...Object.keys(zoneDurations || {}),
                    ...Object.keys(zoneDistanceMeters || {}),
                ]);

        const keys = [...zoneKeys].sort((a, b) => a.localeCompare(b)); // orden alfabético
        const unitShort = use_imperial ? 'mi' : 'km';

        for (const zoneName of keys) {
            const durationMs = zoneDurations?.[zoneName] || 0;
            const visits = zoneVisits?.[zoneName] || 0;
            const stops = zoneStops?.[zoneName] || 0;
            const meters = zoneDistanceMeters?.[zoneName] || 0;

            const distValue = use_imperial ? (meters / 1609.344) : (meters / 1000);
            const distance = `${fmt0(distValue)} ${unitShort}`;

            zonesRows.push({
                zone: zoneName,
                time: formatTotalTime(durationMs),
                visits,
                stops,
                distance, // ⬅️ string ya formateado para PDF
                _unitShort: unitShort,
                _fillColor: blendedFill(zoneName, zonePositions, {
                    alpha: DEFAULT_ALPHA,
                }),
            });
        }
    }

    // 3) POSICIONES (reducidas) + color de fondo por zona
    const reduced = reducePositionsForPdf(positions);
    const unit = t(use_imperial ? 'mi_per_hour' : 'km_per_hour') || (use_imperial ? 'mph' : 'km/h');

    const positionsRows = reduced.map(p => {
        const kmh = Math.round((p?.attributes?.speed || 0) * (use_imperial ? 2.23694 : 3.6));
        return {
            whenLocal: formatDate(p.last_updated), // ⬅️ local
            isStop: !!p.stop,
            zone: p.zone || '',
            speed: Number.isFinite(kmh) ? `${kmh} ${unit}` : '',
            battery: Number.isFinite(p?.battery) ? p.battery : '',
            address: p.address || '',
            _fillColor: p.zone ? blendedFill(p.zone, zonePositions, {
                alpha: DEFAULT_ALPHA,
            }) : null,
        };
    });

    // 4) TÍTULO (persona + fechas). Si UI no tiene fechas, PDF hace fallback.
    const sel = document.getElementById('person-select');
    const personName =
        (sel?.selectedOptions?.[0]?.text?.trim()) ||
    (sel?.value?.trim()) || '—';

    let { startLocal, endLocal } = getSelectedLocalRange() || {};
    if (startLocal)
        startLocal = formatDate(startLocal);
    if (endLocal)
        endLocal = formatDate(endLocal);

    const header = {
        personName,
        startLocal,
        endLocal
    };

    // 5) Exporta
    const filename = buildFilenameFromUI('pdf');
    await exportPositionsToPdf({
        filename,
        summaryRows,
        zonesRows,
        positionsRows,
        stopIconUrl: new URL('/ha-tracker/images/stop16x16.png', window.location.origin).href,
        header,
    });
}

// ============================
//  Reverse geocode (frontend) - usando geocodeQueue
// ============================

// Observer perezoso para las filas de dirección de paradas
let _filterAddrObserver = null;
function ensureFilterAddrObserver() {
    if (_filterAddrObserver)
        return _filterAddrObserver;

    // Si tienes un contenedor scroll específico para la tabla, ponlo aquí como root
    const root = document.querySelector('#positions .table-wrapper') || null;

    _filterAddrObserver = new IntersectionObserver((entries) => {
        for (const e of entries) {
            if (!e.isIntersecting)
                continue;
            const addrRow = e.target;
            _filterAddrObserver.unobserve(addrRow);

            const uniqueId = addrRow.dataset.entityId;
            const lat = Number(addrRow.dataset.latitude);
            const lon = Number(addrRow.dataset.longitude);
            const tsMs = Number(addrRow.dataset.lastUpdated);

            if (!(Number.isFinite(lat) && Number.isFinite(lon) && Number.isFinite(tsMs)))
                continue;

            const td = addrRow.querySelector('td.addr-cell') || addrRow.querySelector('td');
            if (td && td.textContent !== '…')
                td.textContent = '…';

            requestAddress(uniqueId, lat, lon, tsMs, (newAddress) => {
                // reconsigue la celda (puede haberse repintado el DOM)
                const again = document.querySelector(`tr.position-address-row[data-entity-id="${uniqueId}"] td.addr-cell`) || document.querySelector(`tr.position-address-row[data-entity-id="${uniqueId}"] td`);
                if (again)
                    again.textContent = (newAddress || '');
            });
        }
    }, {
            root,
            rootMargin: '200px'
        });

    return _filterAddrObserver;
}

// ============================
//  Zoom handler (markers)
// ============================
let _zoomHandlerBound = false;
function _zoomHandler() {
    const zoom = map.getZoom();
    filterMarkers.forEach(marker => {
        if (!marker.isStop)
            marker.setVisible(zoom >= MIN_ZOOM_TO_SHOW);
    });
}
