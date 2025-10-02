// ./charts/positions.js
import { handleZonePosition, getZoneStyleById } from '../screens/zones.js';
import { toRgba } from '../utils/dialogs.js';

let canvas, ctx, lastData = null, resizeObs = null;
let clickBound = false;


const ALPHA = 0.3;

export function initPositionsChart() {
    const host = document.getElementById('positions-chart');
    if (!host)
        return;

    if (!canvas) {
        canvas = document.createElement('canvas');
        canvas.style.width = '100%';
        canvas.style.height = '50px'; // el slot ya mide 50px
        canvas.setAttribute('aria-hidden', 'true');
        host.innerHTML = '';
        host.appendChild(canvas);
        ctx = canvas.getContext('2d');

        resizeObs = new ResizeObserver(() => {
            if (lastData)
                draw(lastData.positions, lastData.opts);
        });
        resizeObs.observe(host);
    }
	
	ensureClickHandler();
}

export function clearPositionsChart() {
    if (!canvas || !ctx)
        return;
    const dpr = window.devicePixelRatio || 1;
    const { width: cssW, height: cssH } = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, Math.floor(cssW * dpr));
    canvas.height = Math.max(1, Math.floor(cssH * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    lastData = null;
	
	if (canvas) canvas.style.cursor = 'default';
}

/**
 * Dibuja/actualiza el gráfico.
 */
export function renderPositionsChart(positions, opts = {}) {
    initPositionsChart();
    if (!canvas || !ctx)
        return;
    if (!Array.isArray(positions) || positions.length < 1) {
        clearPositionsChart();
        return;
    }
    lastData = {
        positions,
        opts
    };
    draw(positions, opts);
	
	canvas.style.cursor = (Array.isArray(positions) && positions.length > 0) ? 'pointer' : 'default';
	ensureClickHandler();
}

/**
 * Permite marcar una posición temporal en el gráfico con una línea vertical.
 * Acepta Date, número (ms epoch) o string ISO.
 */
export function setPositionsMarker(tsLike) {
    initPositionsChart();
    if (!lastData)
        return; // no hay datos aún
    const t = _toTsMs(tsLike);
    lastData.opts = {
        ...(lastData.opts || {}),
        markerTs: t
    };
    draw(lastData.positions, lastData.opts);
}

/**
 * Limpia el marcador vertical, si lo hubiese.
 */
export function clearPositionsMarker() {
    if (!lastData)
        return;
    if (lastData.opts)
        delete lastData.opts.markerTs;
    draw(lastData.positions, lastData.opts || {});
}

function _toTsMs(v) {
    if (v == null)
        return null;
    if (v instanceof Date)
        return v.getTime();
    if (typeof v === 'number')
        return Number.isFinite(v) ? v : null;
    if (typeof v === 'string') {
        if (/^\d+$/.test(v))
            return parseInt(v, 10);
        const n = Date.parse(v);
        return Number.isFinite(n) ? n : null;
    }
    return null;
}

function draw(positions, opts) {
    const dpr = window.devicePixelRatio || 1;
    const { width: cssW, height: cssH } = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, Math.floor(cssW * dpr));
    canvas.height = Math.max(1, Math.floor(cssH * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const W = cssW,
    H = cssH;

    // Layout: dos filas con separación de 5px
    const GAP = 5;
    const trackH = (H - GAP) / 2;
    const topY = 0;
    const botY = topY + trackH + GAP;

    // Ordenamos por tiempo
    const data = [...positions].sort(
        (a, b) => +new Date(a.last_updated) - +new Date(b.last_updated));
    if (!data.length) {
        ctx.clearRect(0, 0, W, H);
        return;
    }

    // ==== Extremos temporales alineados con el resumen del backend ====
    // t0 = min(last_updated, stop_start); tn = max(last_updated, stop_end)
    const startOf = (p) => {
        const tLU = +new Date(p.last_updated);
        const tSS = (p.stop && p.stop_start) ? +new Date(p.stop_start) : NaN;
        return Number.isFinite(tSS) ? Math.min(tLU, tSS) : tLU;
    };
    const endOf = (p) => {
        const tLU = +new Date(p.last_updated);
        const tSE = (p.stop && p.stop_end) ? +new Date(p.stop_end) : NaN;
        return Number.isFinite(tSE) ? Math.max(tLU, tSE) : tLU;
    };

    let t0 = startOf(data[0]);
    let tn = endOf(data[0]);
    for (let i = 1; i < data.length; i++) {
        t0 = Math.min(t0, startOf(data[i]));
        tn = Math.max(tn, endOf(data[i]));
    }
	
	if (lastData) {
		lastData.meta = { t0, tn };
	}	

    const spanT = Math.max(1, tn - t0);
    const xAt = (t) => ((t - t0) / spanT) * W;

    // Velocidad máxima para escalar la línea (m/s)
    let vmax = 0;
    for (const p of data) {
        const v = Number(p?.attributes?.speed) || 0;
        if (v > vmax)
            vmax = v;
    }
    if (!Number.isFinite(vmax) || vmax <= 0)
        vmax = 1;

    // Helpers de color (con alpha ALPHA)
    const zoneColorFor = (p) => {
        const lat = Number(p?.attributes?.latitude);
        const lon = Number(p?.attributes?.longitude);
        if (!Number.isFinite(lat) || !Number.isFinite(lon))
            return toRgba('#ffffff', ALPHA);
        try {
            const z = handleZonePosition(lat, lon);
            if (z && z.id != null) {
                const style = getZoneStyleById(z.id);
                if (style?.color)
                    return toRgba(style.color, ALPHA);
            }
        } catch {}
        return toRgba('#ffffff', ALPHA);
    };
    const colStop = toRgba('#ff0000', ALPHA); // rojo
    const colMove = toRgba('#00ff00', ALPHA); // verde

    // Fondo
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, W, H);

    // === Fila superior: ZONAS ===
    let segStartX = 0;
    let currentZoneCol = zoneColorFor(data[0]);
    for (let i = 1; i < data.length; i++) {
        const cur = data[i];
        const x = xAt(+new Date(cur.last_updated));
        const zcol = zoneColorFor(cur);
        if (zcol !== currentZoneCol) {
            drawFilledRect(segStartX, x, topY, trackH, currentZoneCol);
            segStartX = x;
            currentZoneCol = zcol;
        }
    }
    drawFilledRect(segStartX, W, topY, trackH, currentZoneCol);

    // === Fila inferior: PARADO/MOVIMIENTO ===
    segStartX = 0;
    let curStop = !!data[0].stop;
    for (let i = 1; i < data.length; i++) {
        const cur = data[i];
        const x = xAt(+new Date(cur.last_updated));
        const s = !!cur.stop;
        if (s !== curStop) {
            drawFilledRect(segStartX, x, botY, trackH, curStop ? colStop : colMove);
            segStartX = x;
            curStop = s;
        }
    }
    drawFilledRect(segStartX, W, botY, trackH, curStop ? colStop : colMove);

    // === Línea de velocidad (escalonada por posiciones, SIN halo) ===
    if (data.length >= 1) {
        const yFromV = (v) => {
            const vv = Math.max(0, Number(v) || 0);
            const yRel = vv / vmax; // 0..1
            return botY + (1 - yRel) * trackH; // 0 => abajo; vmax => arriba
        };

        ctx.beginPath();
        ctx.lineJoin = 'miter';
        ctx.lineCap = 'butt';
        ctx.strokeStyle = '#227722';
        ctx.lineWidth = 1.2;

        const first = data[0];
        let xPrev = xAt(+new Date(first.last_updated));
        let yPrev = yFromV(first?.attributes?.speed);

        if (data.length === 1) {
            ctx.moveTo(xPrev, yPrev);
            ctx.lineTo(W, yPrev);
        } else {
            ctx.moveTo(xPrev, yPrev);
            for (let i = 1; i < data.length; i++) {
                const p = data[i];
                const xCur = xAt(+new Date(p.last_updated));
                const yCur = yFromV(p?.attributes?.speed);

                // Horizontal con la velocidad previa hasta el instante del punto i
                ctx.lineTo(xCur, yPrev);
                // Salto vertical en el instante i
                ctx.lineTo(xCur, yCur);

                xPrev = xCur;
                yPrev = yCur;
            }
            // Último tramo horizontal hasta tn
            ctx.lineTo(W, yPrev);
        }
        ctx.stroke();
    }

    // === MARCADOR VERTICAL (línea y triángulo azul, sin borde) ===
    const markerTs = _toTsMs(opts?.markerTs);
    if (Number.isFinite(markerTs)) {
        const xRaw = xAt(markerTs);
        if (xRaw >= 0 && xRaw <= W) {
            // Para lineWidth=2, alinea a entero (no .5) para máxima nitidez
            const x = Math.round(xRaw);

            // Tamaño del triángulo
            const triW = 10; // ancho
            const triH = 10; // alto

            ctx.save();
            ctx.lineCap = 'butt';

            // Triángulo superior apuntando hacia abajo (base en y=0, punta en y=triH)
            ctx.beginPath();
            ctx.moveTo(x - triW / 2, 0); // base izquierda
            ctx.lineTo(x + triW / 2, 0); // base derecha
            ctx.lineTo(x, triH); // punta hacia abajo
            ctx.closePath();
            ctx.fillStyle = '#2563eb'; // azul
            ctx.fill();

            // Línea desde la punta del triángulo hasta la mitad del gráfico
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, H/2);
            ctx.lineWidth = 2; // grosor visible
            ctx.strokeStyle = '#2563eb'; // azul
            ctx.stroke();

            ctx.restore();
        }
    }

    function drawFilledRect(x0, x1, y, h, fill) {
        const left = Math.min(x0, x1);
        const right = Math.max(x0, x1);
        const w = Math.max(1, right - left);
        ctx.fillStyle = fill || toRgba('#ffffff', ALPHA);
        ctx.fillRect(left, y, w, h);
    }
}

function ensureClickHandler() {
  if (clickBound || !canvas) return;
  canvas.addEventListener('click', (ev) => {
    if (!lastData || !Array.isArray(lastData.positions) || lastData.positions.length === 0) return;
    const meta = lastData.meta;
    if (!meta) return;

    const rect = canvas.getBoundingClientRect();
    const x = ev.clientX - rect.left;
    const W = rect.width || 1;

    // Timestamp estimado a partir del X
    const t = meta.t0 + (Math.max(0, Math.min(W, x)) / W) * (meta.tn - meta.t0);

    // Buscar posición con last_updated más cercana
    let best = null;
    for (const p of lastData.positions) {
      const ts = +new Date(p.last_updated);
      const d = Math.abs(ts - t);
      if (!best || d < best.d) best = { p, d };
    }
    if (!best) return;

    // Marca en el gráfico
    setPositionsMarker(best.p.last_updated);

    // Dispara evento global para que FILTER seleccione la fila
    const uniqueId = `${best.p.entity_id}_${new Date(best.p.last_updated).toISOString()}`;
    document.dispatchEvent(new CustomEvent('positions:select-by-id', {
      detail: { uniqueId }
    }));
  });
  clickBound = true;
}
