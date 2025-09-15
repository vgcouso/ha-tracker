// export/excel_xlsx.js
// Genera un .xlsx con ExcelJS:
// - Cabeceras azul oscuro, texto blanco (Verdana 9)
// - Primera fila congelada
// - Ancho de columnas ajustado al contenido
// - Fuente Verdana 9 en todo el libro
// - Todas las celdas alineadas verticalmente al centro y horizontalmente a la izquierda
// - Solo “Dirección” con wrap

import { t } from '../utils/i18n.js';

const EXCELJS_CDN = "https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js";

async function ensureExcelJS() {
  if (window.ExcelJS) return;
  await new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = EXCELJS_CDN;
    s.async = true;
    s.onload = () => res();
    s.onerror = (e) => rej(e);
    document.head.appendChild(s);
  });
}

function toFixed6(n) {
  const v = Number(n);
  return Number.isFinite(v) ? Number(v.toFixed(6)) : null; // como número
}

function speedInConfiguredUnits(mps, useImperial) {
  if (!Number.isFinite(mps)) return null;
  const kmh = mps * 3.6;
  const mph = kmh * 0.621371192;
  return Math.round(useImperial ? mph : kmh);
}

// Longitud máxima por líneas (para auto ancho)
function maxLineLen(s) {
  return String(s || '').split('\n').reduce((m, line) => Math.max(m, line.length), 0);
}

// Calcula anchos (en "char width") a partir del contenido
function computeColWidths(rows, headers) {
  // índices: 0 fecha, 1 parada, 2 lat, 3 lon, 4 vel, 5 bat, 6 zona, 7 dir
  const mins = [19, 6, 11, 11, 12, 8, 18, 30];  // mínimos razonables
  const maxs = [40,10, 16, 16, 16,10, 50, 80];  // límites para no desbordar
  const lens = headers.map(h => maxLineLen(h));

  for (const r of rows) {
    lens[0] = Math.max(lens[0], maxLineLen(r.date));
    lens[1] = Math.max(lens[1], maxLineLen(r.stop));
    lens[2] = Math.max(lens[2], maxLineLen(r.latStr));
    lens[3] = Math.max(lens[3], maxLineLen(r.lonStr));
    lens[4] = Math.max(lens[4], maxLineLen(r.speedStr));
    lens[5] = Math.max(lens[5], maxLineLen(r.battStr));
    lens[6] = Math.max(lens[6], maxLineLen(r.zone));
    lens[7] = Math.max(lens[7], maxLineLen(r.address));
  }

  // margen extra (+2)
  return lens.map((L, i) => Math.min(maxs[i], Math.max(mins[i], L + 2)));
}

export async function exportPositionsToXlsx(positions, {
  filename = 'ha-tracker.xlsx',
  useImperial = false,
  formatLocal = (d) => new Date(d).toLocaleString(),
  sheetName = t('positions'),
} = {}) {
  await ensureExcelJS();
  const ExcelJS = window.ExcelJS;

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheetName);

  // —— Estilo base (Verdana 9) ——
  const BASE_FONT  = { name: 'Verdana', size: 9 };
  const BASE_ALIGN = { vertical: 'middle', horizontal: 'left' };

  const speedHeader = useImperial ? t('mi_per_hour') : t('km_per_hour');

  const headers = [
    t('date'),
    t('stops'),
    t('latitude'),
    t('longitude'),
    speedHeader,
    t('battery'),
    t('zone'),
    t('address'),
  ];

  // Normaliza filas
  const rows = (positions || []).map(p => {
    const date  = formatLocal ? formatLocal(p?.last_updated) : (p?.last_updated || '');
    const stop  = p?.stop ? t('stop') : '';
    const lat   = toFixed6(p?.attributes?.latitude);
    const lon   = toFixed6(p?.attributes?.longitude);
    const speed = speedInConfiguredUnits(Number(p?.attributes?.speed), useImperial);
    const batt  = Number.isFinite(p?.battery) ? p.battery : null;
    const zone  = p?.zone || '';
    const address = (p?.address || '').replace(/\u00A0/g, ' ');

    return {
      date,
      stop,
      lat,
      lon,
      speed,
      batt,
      latStr:   lat   == null ? '' : String(lat),
      lonStr:   lon   == null ? '' : String(lon),
      speedStr: speed == null ? '' : String(speed),
      battStr:  batt  == null ? '' : String(batt),
      zone,
      address
    };
  });

  // Cabeceras: azul oscuro + blanco, Verdana 9, vertical middle + left
  const headFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF003E78' } };
  const headFont = { ...BASE_FONT, bold: true, color: { argb: 'FFFFFFFF' } };
  const headAlignment = { ...BASE_ALIGN, wrapText: true };

  ws.addRow(headers);
  const headerRow = ws.getRow(1);
  headerRow.height = 18;
  headerRow.font = headFont;
  headerRow.alignment = headAlignment;
  headerRow.eachCell(c => {
    c.fill = headFill;
    c.font = headFont;
    c.alignment = headAlignment;
  });

  // Datos (números como números; wrap solo en Dirección)
  for (const r of rows) {
    const row = ws.addRow([
      r.date,
      r.stop,
      r.lat,
      r.lon,
      r.speed,
      r.batt,
      r.zone,
      r.address
    ]);
    row.font = BASE_FONT;
    row.alignment = BASE_ALIGN; // todas las celdas: middle + left
  }

  // Congelar primera fila
  ws.views = [{ state: 'frozen', ySplit: 1 }];

  // Ajuste de anchos + estilo/ALINEACIÓN por columna (con wrap en Dirección)
  const widths = computeColWidths(rows, headers);
  ws.columns = widths.map((w, i) => ({
    width: w,
    style: {
      font: BASE_FONT,
      alignment: { ...BASE_ALIGN, wrapText: i === 7 } // i===7 -> “Dirección”
    }
  }));

  // Reafirma la cabecera tras definir columnas
  ws.getRow(1).eachCell(c => {
    c.font = headFont;
    c.alignment = headAlignment;
    c.fill = headFill;
  });

  // Descargar
  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(a.href);
}
