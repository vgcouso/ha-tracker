// export/pdf.js

import { t } from '../utils/i18n.js';
import { DEFAULT_ALPHA, SHOW_VISITS, DEFAULT_COLOR } from '../globals.js'


const JSPDF_CDN = "https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js";
const AUTOTABLE_CDN = "https://cdn.jsdelivr.net/npm/jspdf-autotable@3.8.3/dist/jspdf.plugin.autotable.min.js";
const HTML2CANVAS_CDN = "https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js"; 

const HEAD_BG = [0, 62, 120]; // azul oscuro
const HEAD_TXT = [255, 255, 255]; // blanco

function loadScriptOnce(src) {
    return new Promise((resolve, reject) => {
        if ([...document.scripts].some(s => s.src === src))
            return resolve();
        const s = document.createElement('script');
        s.src = src;
        s.async = true;
        s.onload = () => resolve();
        s.onerror = (e) => reject(e);
        document.head.appendChild(s);
    });
}
async function ensureJsPdf() {
    if (window.jspdf?.jsPDF?.API?.autoTable) return;
    await loadScriptOnce(JSPDF_CDN);
    await loadScriptOnce(AUTOTABLE_CDN);
}

// helper para html2canvas
async function ensureHtml2Canvas() {
  if (window.html2canvas) return;
  await loadScriptOnce(HTML2CANVAS_CDN);
}

// saca PNG del div #map
async function captureMapPngDataURL() {
  await ensureHtml2Canvas();
  const el = document.getElementById('map');
  if (!el) return null;

  // escala 2x para que se vea nítido en el PDF
  const canvas = await window.html2canvas(el, {
    useCORS: true,
    backgroundColor: '#ffffff',
    logging: false,
    scale: 2
  });
  return canvas.toDataURL('image/jpeg', 0.92);
}

function blendWithWhite(hex, alpha = DEFAULT_ALPHA) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
    if (!m)
        return null;
    const v = parseInt(m[1], 16);
    const r = (v >> 16) & 0xff,
    g = (v >> 8) & 0xff,
    b = v & 0xff;
    const out = (c) => Math.round((1 - alpha) * 255 + alpha * c);
    return [out(r), out(g), out(b)];
}

function hexOfZone(meta, { defaultColor = DEFAULT_COLOR } = {}) {
  return (meta && meta.color) ? meta.color : defaultColor;
}

export function blendedFill(zoneName, zonePositions = {}, { alpha = DEFAULT_ALPHA } = {}) {
  if (!zoneName) return null;
  const meta = zonePositions[zoneName];
  const baseHex = hexOfZone(meta);
  return blendWithWhite(baseHex, alpha);
}

export function reducePositionsForPdf(positions = []) {
    const out = [];
    let lastZone = null;
    for (const p of positions) {
        const zone = (p.zone || '').trim();
        const isFirstOfZone = zone !== lastZone;
        if (p.stop || isFirstOfZone)
            out.push(p);
        lastZone = zone;
    }
    return out;
}

// --- helper para etiqueta+valor con estilos distintos en la misma línea ---
function drawLabelValueLine(doc, x, y, maxWidth, label, value, {
    font = 'helvetica',
    labelStyle = 'bold',
    valueStyle = 'normal',
    lineHeight = 14,
} = {}) {
    // Ancho del texto de la etiqueta
    doc.setFont(font, labelStyle);
    const labelW = doc.getTextWidth(label);

    // Partimos el valor para que no se salga del ancho disponible
    doc.setFont(font, valueStyle);
    const valueLines = doc.splitTextToSize(String(value || ''), Math.max(20, maxWidth - labelW));

    // Primera línea: etiqueta + primer fragmento del valor
    doc.setFont(font, labelStyle);
    doc.text(label, x, y);
    doc.setFont(font, valueStyle);
    doc.text(valueLines[0] || '', x + labelW, y);

    // Resto de líneas del valor, alineadas bajo el inicio del valor
    for (let i = 1; i < valueLines.length; i++) {
        y += lineHeight;
        doc.text(valueLines[i], x + labelW, y);
    }
    return y + lineHeight; // siguiente Y disponible
}

// ——— cabecera / título ———
function drawTitle(doc, {
    margin,
    pageW,
    personName,
    startLocal,
    endLocal,
    nameColor = [0, 62, 120], // azul oscuro
}) {
    const maxWidth = pageW - margin * 2;
    let y = margin;

    // Nombre (negrita, grande, azul)
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.setTextColor(nameColor[0], nameColor[1], nameColor[2]);
    const nameLines = doc.splitTextToSize(personName || '', maxWidth);
    doc.text(nameLines, margin, y);
    y += (nameLines.length * 18);

    // Fechas (mismo color azul). Etiqueta en negrita, valor en normal.
    doc.setFontSize(11);
    doc.setTextColor(nameColor[0], nameColor[1], nameColor[2]);

    y = drawLabelValueLine(doc, margin, y, maxWidth, `${t('start') || 'Inicio'}: `, startLocal || '', {
        lineHeight: 14,
        labelStyle: 'bold',
        valueStyle: 'normal',
    });

    y = drawLabelValueLine(doc, margin, y, maxWidth, `${t('end') || 'Fin'}: `, endLocal || '', {
        lineHeight: 14,
        labelStyle: 'bold',
        valueStyle: 'normal',
    });

    y += 6; // pequeña separación antes de la primera tabla
    return y;
}

// Centra una tabla y limita su ancho al % del área útil (página - márgenes)
function computeNarrowLayout(doc, margin, ratio = 0.90) {
    const pageW = doc.internal.pageSize.getWidth();
    const avail = pageW - margin * 2; // ancho útil
    const tableWidth = Math.floor(avail * ratio); // ancho de la tabla (narrow)
    const left = margin + Math.round((avail - tableWidth) / 2); // centrado
    return {
        tableWidth,
        left,
        pageW
    };
}

// Anchos de columnas de la tabla POSICIONES a partir del ancho real de la tabla
function computePositionColWidths(tableWidth) {
    // porcentajes (suman ~1.00)
    const pct = {
        date: 0.22,
        stop: 0.03,
        zone: 0.24,
        speed: 0.12,
        batt: 0.09,
        addr: 0.30
    };
    // mínimos duros en pt
    const min = {
        date: 90,
        stop: 12,
        zone: 90,
        speed: 54,
        batt: 40,
        addr: 90
    };

    let wDate = Math.max(min.date, Math.floor(tableWidth * pct.date));
    let wStop = Math.max(min.stop, Math.floor(tableWidth * pct.stop));
    let wZone = Math.max(min.zone, Math.floor(tableWidth * pct.zone));
    let wSpeed = Math.max(min.speed, Math.floor(tableWidth * pct.speed));
    let wBatt = Math.max(min.batt, Math.floor(tableWidth * pct.batt));
    let wAddr = Math.max(min.addr, Math.floor(tableWidth * pct.addr));

    // Ajuste fino: la suma debe ser EXACTAMENTE el ancho de la tabla
    const sum = wDate + wStop + wZone + wSpeed + wBatt + wAddr;
    const diff = tableWidth - sum;
    if (diff !== 0)
        wAddr = Math.max(min.addr, wAddr + diff); // absorbe en Dirección

    return {
        wDate,
        wStop,
        wZone,
        wSpeed,
        wBatt,
        wAddr
    };
}

/**
 * Exporta a PDF con:
 *  - summaryRows: [{ label, value }]
 *  - zonesRows:   [{ zone, time, visits, stops, distance?, distanceMeters?, _unitShort?, _fillColor:[r,g,b] }]
 *  - positionsRows: [{
 *        whenLocal, isStop, zone, speed, battery, address, _fillColor:[r,g,b]
 *    }]
 *  - header: { personName, startLocal, endLocal }
 */
export async function exportPositionsToPdf({
  filename,
  summaryRows,
  zonesRows,
  positionsRows,
  stopIconUrl,
  header
}) {
  await ensureJsPdf();
  const { jsPDF } = window.jspdf;

  const doc = new jsPDF({
    unit: 'pt',
    format: 'a4',
    compress: true
  }); // portrait A4

  const pageW = doc.internal.pageSize.getWidth();
  const margin = 36; // 0.5"
  const L = computeNarrowLayout(doc, margin, 0.90);

  // Icono stop
  let stopIconDataURL = null;
  if (stopIconUrl) {
    try {
      const res = await fetch(stopIconUrl, { cache: 'force-cache' });
      const blob = await res.blob();
      stopIconDataURL = await new Promise(r => {
        const fr = new FileReader();
        fr.onload = () => r(fr.result);
        fr.readAsDataURL(blob);
      });
    } catch {}
  }

  // — TÍTULO —
  let y = drawTitle(doc, {
    margin,
    pageW,
    personName: header?.personName || '',
    startLocal: header?.startLocal || '',
    endLocal: header?.endLocal || '',
    nameColor: HEAD_BG // azul oscuro
  });
  
  // — MAPA CON RUTA —
  try {
    const dataUrl = await captureMapPngDataURL();
    if (dataUrl) {
      // ajusta al ancho de tabla estrecha (centrado)
      const imgProps = doc.getImageProperties(dataUrl);
      const targetW = L.tableWidth;
      const targetH = (imgProps.height * targetW) / imgProps.width;
      doc.addImage(dataUrl, 'JPEG', L.left, y, targetW, targetH);
      y += targetH + 8; // separación inferior
    }
  } catch (e) {
    // si falla, seguimos sin imagen
    console.warn('No se pudo capturar el mapa:', e);
  }  

  // — RESUMEN —
  doc.autoTable({
    head: [[t('metric') || 'Métrica', t('value') || 'Valor']],
    body: (summaryRows || []).map(r => [r.label, r.value]),
    startY: y,
    theme: 'grid',
    tableWidth: L.tableWidth,
    margin: { left: L.left, right: L.left },
    styles: {
      font: 'helvetica',
      fontSize: 10,
      cellPadding: 4,
      overflow: 'linebreak'
    },
    headStyles: {
      fillColor: HEAD_BG,
      textColor: HEAD_TXT,
      fontStyle: 'bold',
      halign: 'left'
    },
    columnStyles: {
      0: { cellWidth: 170, fontStyle: 'bold' },
      1: { cellWidth: L.tableWidth - 170 }
    },
  });
  y = doc.lastAutoTable.finalY + 8;

  // — ZONAS (columna "Visitas" opcional según SHOW_VISITS) —
  {
    const hasVisits = !!SHOW_VISITS;

    const cwTime   = 100;
    const cwVisits = 60;
    const cwStops  = 60;
    const cwDist   = 60;

    // Reparto de anchos: si no hay "Visitas", ese espacio va a "Zona"
    const fixedNoZone = cwTime + cwStops + cwDist + (hasVisits ? cwVisits : 0);
    const cwZone = Math.max(160, L.tableWidth - fixedNoZone);

    // Definición de columnas dinámica
    const zoneColumns = [
      { key: 'zone',     header: t('zone')     || 'Zona',      width: cwZone,   halign: 'left'   },
      { key: 'time',     header: t('time')     || 'Tiempo',    width: cwTime,   halign: 'center' },
    ];
    if (hasVisits) {
      zoneColumns.push(
        { key: 'visits',   header: t('visits')   || 'Visitas',   width: cwVisits, halign: 'center' },
      );
    }
    zoneColumns.push(
      { key: 'stops',    header: t('stops')    || 'Paradas',   width: cwStops,  halign: 'center' },
      { key: 'distance', header: t('distance') || 'Distancia', width: cwDist,   halign: 'center' },
    );

    const head = [ zoneColumns.map(c => c.header) ];
    const body = (zonesRows || []).map(z =>
      zoneColumns.map(c => {
        if (c.key === 'distance') return formatZoneDistanceCell(z);
        if (c.key === 'stops' || c.key === 'visits') return String(z[c.key] ?? '');
        return z[c.key] || '';
      })
    );

    const columnStyles = zoneColumns.reduce((acc, c, idx) => {
      acc[idx] = { cellWidth: c.width, halign: c.halign };
      return acc;
    }, {});

    doc.autoTable({
      head,
      body,
      startY: y,
      theme: 'grid',
      tableWidth: L.tableWidth,
      margin: { left: L.left, right: L.left },
      styles: {
        font: 'helvetica',
        fontSize: 10,
        cellPadding: 4,
        overflow: 'linebreak'
      },
      headStyles: {
        fillColor: HEAD_BG,
        textColor: HEAD_TXT,
        fontStyle: 'bold',
        halign: 'left'
      },
      columnStyles,
      didParseCell: (data) => {
        if (data.section === 'body') {
          const row = zonesRows[data.row.index];
          if (row?._fillColor) data.cell.styles.fillColor = row._fillColor;
        }
      },
    });

    y = doc.lastAutoTable.finalY + 8;
  }

  // — POSICIONES —
  const { wDate, wStop, wZone, wSpeed, wBatt, wAddr } = computePositionColWidths(L.tableWidth);
  const hasMph = (positionsRows || []).some(r => /\bmph\b/i.test(String(r.speed || '')));
  const speedHeader = hasMph
    ? `${t('speed') || 'Velocidad'} (${t('mi_per_hour') || 'mph'})`
    : `${t('speed') || 'Velocidad'} (${t('km_per_hour') || 'km/h'})`;

  const body = (positionsRows || []).map(p => [
    p.whenLocal || '',
    '', // icono en didDrawCell
    p.zone || '',
    p.speed || '',
    (p.battery ?? '') === '' ? '' : `${p.battery}%`,
    (p.address || '').replace(/\u00A0/g, ' ') // evita NBSP
  ]);

  doc.autoTable({
    head: [[
      t('date') || 'Fecha/Hora',
      '',
      t('zone') || 'Zona',
      speedHeader,
      t('battery') || 'Batería',
      t('address') || 'Dirección'
    ]],
    body,
    startY: y,
    theme: 'grid',
    tableWidth: L.tableWidth,
    margin: { left: L.left, right: L.left },
    styles: {
      font: 'helvetica',
      fontSize: 9,
      cellPadding: { top: 3, right: 3, bottom: 3, left: 3 },
      halign: 'left',
      valign: 'top',
      overflow: 'linebreak',
      cellWidth: 'wrap',
    },
    headStyles: {
      fillColor: HEAD_BG,
      textColor: HEAD_TXT,
      fontStyle: 'bold',
      halign: 'left'
    },
    columnStyles: {
      0: { cellWidth: wDate },
      1: { cellWidth: wStop, halign: 'center' },
      2: { cellWidth: wZone },
      3: { cellWidth: wSpeed, halign: 'center' },
      4: { cellWidth: wBatt, halign: 'center' },
      5: { cellWidth: wAddr },
    },
    didParseCell: (data) => {
      if (data.section === 'body') {
        const row = positionsRows[data.row.index];
        if (row?._fillColor) data.cell.styles.fillColor = row._fillColor;
      }
    },
    didDrawCell: (data) => {
      if (data.section === 'body' && data.column.index === 1 && stopIconDataURL) {
        const row = positionsRows[data.row.index];
        if (row?.isStop) {
          const sz = 10;
          const x = data.cell.x + (data.cell.width - sz) / 2;
          const y = data.cell.y + (data.cell.height - sz) / 2;
          try {
            doc.addImage(stopIconDataURL, 'PNG', x, y, sz, sz);
          } catch {}
        }
      }
    },
    pageBreak: 'auto',
  });

  const outName = filename?.endsWith('.pdf') ? filename : `${filename || 'export'}.pdf`;
  doc.save(outName);
}


function formatZoneDistanceCell(z) {
    if (!z)
        return '';
    if (z.distance != null && z.distance !== '')
        return String(z.distance);

    const m = Number(z.distanceMeters ?? z.meters ?? NaN);
    if (!Number.isFinite(m))
        return '';

    const unitShort = (z._unitShort === 'mi' || z._unitShort === 'km') ? z._unitShort : 'km';
    const value = unitShort === 'mi' ? (m / 1609.344) : (m / 1000);
 
    return `${value.toFixed(0)}`;
}
