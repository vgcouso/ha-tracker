// kml_stops_export.js
// ES module for generating a KML (only stop placemarks) and triggering download from the browser.
//
// Usage example:
//   import { exportPositionsToKml } from './kml_stops_export.js';
//   exportPositionsToKml(positions, {
//     personId: 'alice',
//     stopIconHref: '/local/ha-tracker/images/stop24x24.png', // absolute/relative URL
//     includeRoute: true
//   });
//
// Assumptions about `positions` elements:
//   {
//     entity_id: 'device_tracker...',
//     last_updated: '2025-01-01T12:34:56.000Z' | Date | number,
//     stop: boolean,
//     attributes: { latitude: number, longitude: number, speed?: number (m/s) }
//   }

function toDateIso(d) {
    const date = d instanceof Date ? d : new Date(d);
    return date.toISOString();
}

function xmlEscape(s = '') {
    return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function kmlCData(s = '') {
    return `<![CDATA[${s}]]>`;
}

function kmhFromMps(v) {
    if (!Number.isFinite(v))
        return 0;
    return Math.round(v * 3.6);
}

// KML expects lon,lat[,alt]
function buildRouteCoordinatesKml(positions) {
    const coords = [];
    for (const p of(positions || [])) {
        const lat = Number(p?.attributes?.latitude);
        const lon = Number(p?.attributes?.longitude);
        if (!Number.isFinite(lat) || !Number.isFinite(lon))
            continue;
        coords.push(`${lon},${lat},0`);
    }
    return coords;
}

/**
 * Build a KML string that contains:
 *  - A single LineString for the whole route (optional, includeRoute=true)
 *  - A Placemark per STOP only (p.stop === true) with icon stopIconHref
 *
 * @param {Array} positions
 * @param {Object} options
 * @param {string} [options.stopIconHref]  URL to the stop icon (PNG/SVG/etc.) - required if you want an icon
 * @param {boolean} [options.includeRoute=true]  Whether to include the LineString
 * @param {string} [options.routeColor='ff0000ff']  KML ABGR color (default opaque blue). Format: aabbggrr
 * @param {number} [options.routeWidth=6]  Line width in pixels
 * @param {(pos: any) => string} [options.describeStop]  Optional HTML description builder for each stop
 * @param {(pos: any) => string} [options.nameStop]  Optional name builder for each stop
 * @returns {string} KML
 */
export function buildKmlPositionsOnly(positions, options = {}) {
    const { stopIconHref, includeRoute = true,
    routeColor = 'ff0000ff',
    routeWidth = 6,
    describeStop, nameStop, // ⬇️ añade estos dos con defaults
    unitLabel = 'km/h',
    formatLocal, // si no se pasa, se usará ISO
    batteryLabel = 'Battery',
     } = options;

    if (!positions || !positions.length) {
        throw new Error('No hay posiciones para exportar.');
    }

    const firstIso = toDateIso(positions[0].last_updated);
    const lastIso = toDateIso(positions[positions.length - 1].last_updated);

    const styles = `
    <Style id="stopStyle">
      <IconStyle>
        <scale>1.2</scale>
        ${stopIconHref ? `<Icon><href>${xmlEscape(stopIconHref)}</href></Icon>` : ''}
      </IconStyle>
      <LabelStyle><scale>0</scale></LabelStyle>
    </Style>
    <Style id="routeStyle">
      <LineStyle>
        <color>${xmlEscape(routeColor)}</color>
        <width>${Number(routeWidth) || 6}</width>
      </LineStyle>
    </Style>
  `;

    const routeCoords = includeRoute ? buildRouteCoordinatesKml(positions) : [];
    const routePlacemark = (includeRoute && routeCoords.length >= 2) ? `
    <Placemark>
      <name>Route</name>
      <styleUrl>#routeStyle</styleUrl>
      <LineString>
        <tessellate>1</tessellate>
        <coordinates>${routeCoords.join(' ')}</coordinates>
      </LineString>
    </Placemark>
  ` : '';

    const pointPlacemarks = (positions || [])
    .filter(p => !!p?.stop)
    .map((p, idx) => {
        const lat = Number(p?.attributes?.latitude);
        const lon = Number(p?.attributes?.longitude);
        if (!Number.isFinite(lat) || !Number.isFinite(lon))
            return '';

        const whenIso = toDateIso(p.last_updated);
        const whenLocal = formatLocal ? formatLocal(p.last_updated) : whenIso;
        const speedKmh = kmhFromMps(Number(p?.attributes?.speed));
        const defaultName = `${p?.entity_id || 'position'} #${idx + 1}`;
        const name = nameStop ? nameStop(p) : defaultName;
        const batteryPct = Number.isFinite(p?.battery) ? Math.round(p.battery) : null;

        // Lo que se ve en la columna izquierda (hasta 4 líneas)
        const bullet = '•';
        const zone = (p?.zone || '').trim();
        const address = (p?.address || '').trim();
        const speedLn = `${speedKmh} ${unitLabel}`;
        const battLn = (batteryPct != null) ? `${batteryLabel}: ${batteryPct}%` : '';

		const items = [zone, speedLn, battLn, address].filter(Boolean);
		const snipText = items.map(s => `${bullet} ${s}`).join('\n').trim(); // sin fecha

        const descHtml = describeStop
             ? describeStop(p)
             : `<table cellspacing="0" cellpadding="0" style="border-collapse:collapse">
			  <tr><td><b>${xmlEscape(whenLocal)}</b></td></tr>
			  ${zone ? `<tr><td>${xmlEscape(zone)}</td></tr>` : ''}
			  ${address ? `<tr><td>${xmlEscape(address)}</td></tr>` : ''}
			  <tr><td>${xmlEscape(speedLn)}</td></tr>
			  ${batteryPct != null ? `<tr><td>${xmlEscape(battLn)}</td></tr>` : ''}
			 </table>`;

        return `
		  <Placemark>
			<name>${xmlEscape(name)}</name>
			<Snippet maxLines="6"><![CDATA[${snipText}]]></Snippet>
			<styleUrl>#stopStyle</styleUrl>
			<TimeStamp><when>${whenIso}</when></TimeStamp>
			<ExtendedData>
			  <Data name="entity_id"><value>${xmlEscape(p?.entity_id || '')}</value></Data>
			  <Data name="speed_kmh"><value>${speedKmh}</value></Data>
			  <Data name="is_stop"><value>true</value></Data>
			  <Data name="zone"><value>${xmlEscape(zone)}</value></Data>
			  <Data name="address"><value>${xmlEscape(address)}</value></Data>
			  <Data name="when_local"><value>${xmlEscape(whenLocal)}</value></Data>
			  <Data name="unit"><value>${xmlEscape(unitLabel)}</value></Data>
			  ${batteryPct != null ? `<Data name="battery_pct"><value>${batteryPct}</value></Data>` : ''}
			</ExtendedData>
			<description>${kmlCData(descHtml)}</description>
			<Point><coordinates>${lon},${lat},0</coordinates></Point>
		  </Placemark>
		`;
    })
    .join('\n');

    const docName = `HA Tracker ${firstIso} - ${lastIso}`;
    const kml = `<?xml version="1.0" encoding="UTF-8"?>
  <kml xmlns="http://www.opengis.net/kml/2.2">
    <Document>
      <name>${xmlEscape(docName)}</name>
      ${styles}
      ${routePlacemark}
      <Folder>
        <name>Stops</name>
        ${pointPlacemarks}
      </Folder>
    </Document>
  </kml>`;

    return kml;
}

export function downloadKml(filename, kmlString) {
    const blob = new Blob([kmlString], {
        type: 'application/vnd.google-earth.kml+xml'
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename.endsWith('.kml') ? filename : `${filename}.kml`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
}

export async function saveKmlWithPicker(filename, kmlString) {
    const blob = new Blob([kmlString], {
        type: 'application/vnd.google-earth.kml+xml'
    });
    if ('showSaveFilePicker' in window) {
        const handle = await window.showSaveFilePicker({
            suggestedName: filename.endsWith('.kml') ? filename : `${filename}.kml`,
            types: [{
                    description: 'KML file',
                    accept: {
                        'application/vnd.google-earth.kml+xml': ['.kml']
                    }
                }
            ]
        });
        const w = await handle.createWritable();
        await w.write(blob);
        await w.close();
    } else {
        downloadKml(filename, kmlString);
    }
}

function pad(n) {
    return String(n).padStart(2, '0');
}
function stamp(d) {
    const x = d instanceof Date ? d : new Date(d);
    return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}_${pad(x.getHours())}-${pad(x.getMinutes())}`;
}

function defaultFilename(positions, personId = 'person') {
    if (!positions || !positions.length)
        return `ha-tracker_${personId}.kml`;
    const first = positions[0]?.last_updated;
    const last = positions[positions.length - 1]?.last_updated;
    return `ha-tracker_${personId}_${stamp(first)}_${stamp(last)}.kml`;
}

/**
 * Convenience wrapper to build + download the file.
 *
 * @param {Array} positions
 * @param {Object} options
 * @param {string} [options.personId='person']
 * @param {string} [options.filename]  If omitted, a default will be generated
 * @param {string} [options.stopIconHref]  URL to the stop icon
 * @param {boolean} [options.includeRoute=true]
 * @param {string} [options.routeColor='ff0000ff']
 * @param {number} [options.routeWidth=6]
 * @param {(pos: any) => string} [options.describeStop]
 * @param {(pos: any) => string} [options.nameStop]
 * @param {boolean} [options.usePicker=false]  Use File System Access API when available
 */
export async function exportPositionsToKml(positions, options = {}) {
    const { personId = 'person',
    filename, usePicker = false,
    ...rest } = options;

    const kml = buildKmlPositionsOnly(positions, rest);
    const outName = filename || defaultFilename(positions, personId);

    if (usePicker) {
        await saveKmlWithPicker(outName, kml);
    } else {
        downloadKml(outName, kml);
    }
}
