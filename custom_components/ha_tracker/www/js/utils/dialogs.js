/************************************************************************/
/* UI DIalogs                                                           */
/************************************************************************/

import { t } from './i18n.js';
import { DEFAULT_COLOR, DEFAULT_ALPHA } from '../globals.js';

const ZONE_PALETTE_COLORS = ['#008000', '#09CB09', '#946F24', '#333333', '#999999', '#EEF077', '#BBB31A', '#ECAA77', '#981052', '#D265E4', '#854CD7', '#2196F3', '#28A289', '#0000FF', '#42DFD3', '#FF0000', '#D2A3A3'];

let _activeModal = null;

// utils/dialogs.js
let overlay = null;
let messageElement = null;
let stylesInjected = false;

function injectStyles() {
  if (stylesInjected) return;
  const style = document.createElement('style');
  style.id = 'window-overlay-styles';
  style.textContent = `
    #window-overlay{
      position: fixed; inset: 0; display: none;
      align-items: center; justify-content: center;
      background: rgba(0,0,0,.35);
      z-index: 2147483647;
    }
    #window-message{
      padding: 14px 18px;
      border-radius: 12px;
      border: 2px solid transparent;
      font: 600 15px/1.2 system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
      box-shadow: 0 8px 30px rgba(0,0,0,.2);
      user-select: none;
    }`;
  document.head.appendChild(style);
  stylesInjected = true;
}

function ensureOverlay() {
  if (overlay && messageElement) return;
  injectStyles();

  overlay = document.getElementById('window-overlay');
  messageElement = document.getElementById('window-message');

  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'window-overlay';
    document.body.appendChild(overlay);
  }
  if (!messageElement) {
    messageElement = document.createElement('div');
    messageElement.id = 'window-message';
    messageElement.dataset.i18n = 'loading';
    messageElement.textContent = 'Loading';
    overlay.appendChild(messageElement);
  }
}

export function showWindowOverlay(
  message = 'Mensaje',
  bgColor = 'rgba(0, 0, 255, 0.5)',
  textColor = 'white',
  borderColor = 'rgba(0, 0, 200, 0.8)',
  overlayBg = 'rgba(0,0,0,.35)'
) {
  ensureOverlay();
  if (overlay.style.display === 'flex') return;

  overlay.style.background = overlayBg;
  messageElement.textContent = message;
  messageElement.style.backgroundColor = bgColor;
  messageElement.style.color = textColor;
  messageElement.style.border = `2px solid ${borderColor}`;

  overlay.style.display = 'flex';
}

export function hideWindowOverlay() {
  if (!overlay) return;
  if (overlay.style.display === 'none' || overlay.style.display === '') return;
  overlay.style.display = 'none';
}



export function uiConfirm(message, opts = {}) {
    if (_activeModal)
        return Promise.resolve(false);
    _activeModal = 'confirm';
    return new Promise((resolve) => {
        const modal = buildModal({
            title: opts.title ?? t('confirmation'),
            message,
            type: opts.type ?? 'info',
            okLabel: opts.okLabel ?? t('accept'),
            cancelLabel: opts.cancelLabel ?? t('cancel'),
        });
        wireModalResolve(modal, {
            withInput: false,
            resolve
        });
        modal.focusDefault();
    });
}

export function uiPrompt(message, defaultValue = '', opts = {}) {
    if (_activeModal)
        return Promise.resolve(null);
    _activeModal = 'prompt';
    return new Promise((resolve) => {
        const modal = buildModal({
            title: opts.title ?? t('enter_value'),
            message,
            type: opts.type ?? 'info',
            withInput: true,
            inputValue: defaultValue,
			inputDisabled: opts.inputDisabled === true,
            placeholder: opts.placeholder ?? '',
            withColor: opts.withColor === true,
            colorValue: opts.defaultColor ?? DEFAULT_COLOR,
            colorLabel: opts.colorLabel,
            withVisibility: opts.withVisibility === true,
            visibilityValue: opts.visibilityValue !== false, // por defecto true
            visibilityLabel: opts.visibilityLabel || 'Mostrar en el mapa',			
            okLabel: opts.okLabel ?? t('save'),
            cancelLabel: opts.cancelLabel ?? t('cancel'),
            colorOptions: opts.colorOptions,
        });
        wireModalResolve(modal, {
            withInput: true,
            withColor: opts.withColor === true,
			withVisibility: opts.withVisibility === true,
            resolve
        });
        modal.focusDefault();
    });
}

export function uiAlert(message, opts = {}) {
    if (_activeModal)
        return Promise.resolve();
    _activeModal = 'alert';
    return new Promise((resolve) => {
        const modal = buildModal({
            title: opts.title ?? t('information'),
            message,
            type: opts.type ?? 'info',
            okLabel: opts.okLabel ?? t('accept'),
            cancelLabel: t('close'),
        });
        // Para alert, oculta el botón Cancel si se pide
        if (opts.hideCancel ?? true)
            modal.modal.querySelector('.btn-secondary')?.remove();
        wireModalResolve(modal, {
            withInput: false,
            resolve
        });
        modal.focusDefault();
    });
}

export function toast(message, {
    duration = 2500,
    type = 'info'
} = {}) {
    const { toastRoot } = ensureUiRoots();
    const el = document.createElement('div');
    el.className = `toast toast-${type}`; // info | warning | danger | success
    el.textContent = message;
    toastRoot.appendChild(el);
    // Auto-hide
    setTimeout(() => {
        el.classList.add('hide');
        el.addEventListener('transitionend', () => el.remove(), {
            once: true
        });
    }, Math.max(1000, duration));
}

export function toRgba(hex, alpha = DEFAULT_ALPHA) {
    const h = String(hex || '').trim().toLowerCase();
    const m3 = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(h);
    const m6 = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(h);
    const m8 = /^#([0-9a-f]{8})$/i.exec(h);
    let r,
    g,
    b;
    if (m3) {
        r = parseInt(m3[1] + m3[1], 16);
        g = parseInt(m3[2] + m3[2], 16);
        b = parseInt(m3[3] + m3[3], 16);
    } else if (m6) {
        r = parseInt(m6[1], 16);
        g = parseInt(m6[2], 16);
        b = parseInt(m6[3], 16);
    } else if (m8) {
        r = parseInt(m8[1].slice(0, 2), 16);
        g = parseInt(m8[1].slice(2, 4), 16);
        b = parseInt(m8[1].slice(4, 6), 16);
    } else
        return null;
    const a = Math.min(1, Math.max(0, Number(alpha) || 0));
    return `rgba(${r},${g},${b},${a})`;
}

function toRgb(hex) {
    const h = String(hex || '').trim().toLowerCase();
    const m3 = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(h);
    const m6 = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(h);
    const m8 = /^#([0-9a-f]{8})$/i.exec(h);
    let r,
    g,
    b;
    if (m3) {
        r = parseInt(m3[1] + m3[1], 16);
        g = parseInt(m3[2] + m3[2], 16);
        b = parseInt(m3[3] + m3[3], 16);
    } else if (m6) {
        r = parseInt(m6[1], 16);
        g = parseInt(m6[2], 16);
        b = parseInt(m6[3], 16);
    } else if (m8) {
        r = parseInt(m8[1].slice(0, 2), 16);
        g = parseInt(m8[1].slice(2, 4), 16);
        b = parseInt(m8[1].slice(4, 6), 16);
    } else {
        return null;
    }
    return {
        r,
        g,
        b
    };
}

function ensureUiRoots() {
    // Crea contenedores si no existen
    let modalRoot = document.getElementById('ui-modal-root');
    if (!modalRoot) {
        modalRoot = document.createElement('div');
        modalRoot.id = 'ui-modal-root';
        document.body.appendChild(modalRoot);
    }
    let toastRoot = document.getElementById('ui-toast-root');
    if (!toastRoot) {
        toastRoot = document.createElement('div');
        toastRoot.id = 'ui-toast-root';
        document.body.appendChild(toastRoot);
    }
    return {
        modalRoot,
        toastRoot
    };
}

function focusTrap(container) {
    const FOCUSABLE = [
        'a[href]', 'button:not([disabled])', 'textarea:not([disabled])',
        'input:not([disabled])', 'select:not([disabled])', '[tabindex]:not([tabindex="-1"])'
    ];
    const elements = container.querySelectorAll(FOCUSABLE.join(','));
    const first = elements[0];
    const last = elements[elements.length - 1];
    function onKey(e) {
        if (e.key === 'Tab' && elements.length) {
            if (e.shiftKey && document.activeElement === first) {
                e.preventDefault();
                last.focus();
            } else if (!e.shiftKey && document.activeElement === last) {
                e.preventDefault();
                first.focus();
            }
        }
    }
    container.addEventListener('keydown', onKey);
    return () => container.removeEventListener('keydown', onKey);
}

function buildModal({
    title,
    message,
    type = 'info',
    withInput = false,
    inputValue = '',
	inputDisabled = false,
    placeholder = '',
    withColor = false,
    colorValue = DEFAULT_COLOR,
    colorLabel,
    withVisibility = false,
    visibilityValue = true,
    visibilityLabel = 'Mostrar en el mapa',	
    okLabel,
    cancelLabel,
    colorOptions = {}
}) {
    const { modalRoot } = ensureUiRoots();

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');

    const modal = document.createElement('div');
    modal.className = `modal modal-${type}`;

    const header = document.createElement('div');
    header.className = 'modal-header';
    header.innerHTML = `<span class="modal-title">${title || ''}</span>`;

    const closeBtn = document.createElement('button');
    closeBtn.className = 'modal-close';
    closeBtn.setAttribute('aria-label', t('close'));
    closeBtn.textContent = '×';
    header.appendChild(closeBtn);

    const body = document.createElement('div');
    body.className = 'modal-body';
    const msg = document.createElement('div');
    msg.className = 'modal-message';
    msg.textContent = message || '';
    body.appendChild(msg);

    let inputEl = null;
    if (withInput) {
        inputEl = document.createElement('input');
        inputEl.className = 'modal-input';
        inputEl.type = 'text';
        inputEl.value = inputValue ?? '';
		if (inputDisabled) inputEl.disabled = true;
        if (placeholder)
            inputEl.placeholder = placeholder;
        body.appendChild(inputEl);
    }

	// Checkbox de visibilidad: justo después del texto del label
	let visibleEl = null;
	if (withVisibility) {
	  const row = document.createElement('div');
	  row.className = 'modal-message'; // mismo look que el label del color

	  const lbl = document.createElement('label');
	  // Texto + espacio no separable para que no quede pegado al check
	  lbl.append(document.createTextNode(visibilityLabel + ' '));

	  const chk = document.createElement('input');
	  chk.type = 'checkbox';
	  chk.checked = !!visibilityValue;
	  chk.autocomplete = 'off';

	  // check dentro del label ⇒ queda justo tras el texto
	  lbl.append(chk);
	  row.append(lbl);

	  body.appendChild(row);
	  visibleEl = chk;
	}


    // bloque de color opcional
    let colorEl = null;
    if (withColor) {
        const label = document.createElement('div');
        label.className = 'modal-message';
        label.textContent = colorLabel ?? (t ? t('select_color') : 'Seleccione un color');
        body.appendChild(label);

        const { palette = [], allowAlpha = false, showNative = false } = colorOptions || {};
        const picker = createColorPickerUI({
            initial: colorValue || DEFAULT_COLOR,
            palette,
            allowAlpha,
            showNative,
        });
        colorEl = picker.hiddenInput; // integra con wireModalResolve sin tocarlo
        body.appendChild(picker.root);
    }

    const actions = document.createElement('div');
    actions.className = 'modal-actions';

    const cancel = document.createElement('button');
    cancel.className = 'btn btn-secondary';
    cancel.textContent = cancelLabel ?? t('cancel');

    const ok = document.createElement('button');
    ok.className = 'btn ' + (type === 'danger' ? 'btn-danger' : 'btn-primary');
    ok.textContent = okLabel ?? t('accept');

    actions.append(cancel, ok);
    modal.append(header, body, actions);
    overlay.appendChild(modal);
    modalRoot.appendChild(overlay);

    const removeTrap = focusTrap(modal);
    const restore = () => {
        removeTrap();
        overlay.remove();
        document.body.classList.remove('no-scroll');
        _activeModal = null;
    };

    document.body.classList.add('no-scroll');

    return {
        overlay,
        modal,
        ok,
        cancel,
        closeBtn,
        inputEl,
        colorEl,
        visibleEl,
        focusDefault: () => {
            if (withInput && inputEl && !inputEl.disabled) {
                inputEl.focus();
            } else {
                ok.focus();
            }
        },
        destroy: restore,
    };
}

function wireModalResolve(modalObj, {
    withInput,
    withColor = false,
    withVisibility = false,
    resolve,
    reject
}) {
    const { overlay, modal, ok, cancel, closeBtn, inputEl, colorEl, visibleEl, destroy } = modalObj;

    const onKey = (e) => {
        if (!_activeModal)
            return;

        if (e.key === 'Escape') {
            e.preventDefault();
            onCancel();
            return;
        }
        if (e.key === 'Enter') {
            const tag = (document.activeElement?.tagName || '').toLowerCase();
            const isTyping =
                tag === 'input' ||
                tag === 'textarea' ||
                document.activeElement?.isContentEditable;
            if (!isTyping)
                onOk();
        }
    };

    function cleanup() {
        modal.removeEventListener('keydown', onKey);
    }

    function onOk() {
        const nameVal = withInput ? (inputEl?.value ?? '') : true;
        const colorVal = withColor ? (colorEl?.value ?? '') : undefined;
		const visVal = withVisibility ? !!visibleEl?.checked : undefined;
        cleanup();
        destroy();
        const payload = withInput ? { value: nameVal } : {};
        if (withColor) payload.color = colorVal;
        if (withVisibility) payload.visible = visVal;
        resolve(Object.keys(payload).length ? payload : nameVal);
    }

    function onCancel() {
        cleanup();
        destroy();
        // Mantener compatibilidad: prompt -> null, confirm/alert -> false
        resolve(withInput ? null : false);
    }

    ok.addEventListener('click', onOk);
    cancel.addEventListener('click', onCancel);
    closeBtn.addEventListener('click', onCancel);
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay)
            onCancel();
    });

    // Ahora escuchamos teclas SOLO dentro del modal
    modal.addEventListener('keydown', onKey);
}

function createColorPickerUI({
    initial = DEFAULT_COLOR,
    palette = [],
    allowAlpha = false,
    showNative = false,
} = {}) {
    // Raíz
    const wrap = document.createElement('div');
    wrap.className = 'modal-color';

    // Contenedor principal
    const cp = document.createElement('div');
    cp.className = 'cp';
    const left = document.createElement('div');
    left.className = 'cp-left';
    const right = document.createElement('div');
    right.className = 'cp-right';

    // Área SV (saturación/valor)
    const sv = document.createElement('div');
    sv.className = 'cp-sv';
    sv.tabIndex = 0;
    const svCursor = document.createElement('div');
    svCursor.className = 'cp-cursor';
    sv.appendChild(svCursor);

    // Hue
    const hue = document.createElement('div');
    hue.className = 'cp-hue';
    hue.tabIndex = 0;
    const hueCursor = document.createElement('div');
    hueCursor.className = 'cp-cursor h';
    hue.appendChild(hueCursor);

    // Alpha
    const alpha = document.createElement('div');
    alpha.className = 'cp-alpha';
    alpha.tabIndex = 0;
    const alphaCursor = document.createElement('div');
    alphaCursor.className = 'cp-cursor h';
    alpha.appendChild(alphaCursor);
    if (!allowAlpha)
        alpha.style.display = 'none';

    left.appendChild(sv);
    const sliders = document.createElement('div');
    sliders.style.display = 'flex';
    sliders.style.flexDirection = 'column';
    sliders.style.gap = '12px';
    sliders.appendChild(hue);
    sliders.appendChild(alpha);
    left.appendChild(sliders);

    // Vista previa + campos
    const fields = document.createElement('div');
    fields.className = 'cp-fields';

    const preview = document.createElement('div');
    preview.className = 'cp-preview';
    const previewFill = document.createElement('span');
    preview.appendChild(previewFill);

    const rowHex = document.createElement('div');
    rowHex.className = 'cp-row';
    const labHex = document.createElement('label');
    labHex.textContent = 'HEX';
    const inpHex = document.createElement('input');
    inpHex.type = 'text';
    inpHex.placeholder = '#RRGGBB';
    inpHex.autocomplete = 'off';
    rowHex.append(labHex, inpHex);

    const rowA = document.createElement('div');
    rowA.className = 'cp-row';
    const labA = document.createElement('label');
    labA.textContent = 'Alpha';
    const inpA = document.createElement('input');
    inpA.type = 'text';
    inpA.placeholder = '0–1';
    inpA.value = '1';
    rowA.append(labA, inpA);
    if (!allowAlpha)
        rowA.style.display = 'none';

    const palWrap = document.createElement('div');
    palWrap.className = 'cp-palette';
    const paletteDefault = palette.length ? palette : ZONE_PALETTE_COLORS;
    paletteDefault.forEach(col => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'cp-swatch';
        b.title = col;
        b.style.background = col;
        b.addEventListener('click', () => setFromHex(col));
        palWrap.appendChild(b);
    });

    const nativeWrap = document.createElement('div');
    nativeWrap.className = 'cp-native';
    if (showNative) {
        const det = document.createElement('details');
        const sum = document.createElement('summary');
        sum.textContent = 'Selector del sistema';
        const nat = document.createElement('input');
        nat.type = 'color';
        nat.addEventListener('input', () => setFromHex(nat.value));
        det.append(sum, nat);
        nativeWrap.appendChild(det);
    }

    fields.append(preview, rowHex, rowA, palWrap, nativeWrap);
    right.appendChild(fields);

    cp.append(left, right);
    wrap.appendChild(cp);

    // Input oculto (para devolver el valor al modal)
    const hidden = document.createElement('input');
    hidden.type = 'text';
    hidden.className = 'modal-input-color';
    hidden.style.display = 'none';
    wrap.appendChild(hidden);

    // Estado y sync
    let H = 120,
    S = 1,
    V = 0.5,
    A = 1;
    let typingHex = false; // <<-- declarar ANTES de enganchar listeners

    // === Listeners de HEX (respetan escritura y evitan cerrar el modal con Enter) ===
    inpHex.addEventListener('focus', () => {
        typingHex = true;
    });
    inpHex.addEventListener('blur', () => {
        typingHex = false;
        updateUI();
    });
    inpHex.addEventListener('keydown', (e) => {
        if (e.key === 'Enter')
            e.preventDefault();
        e.stopPropagation(); // no dejar que el modal lo capture
    });

    function setHueBg() {
        sv.style.background = `hsl(${H}, 100%, 50%)`;
    }
    function setAlphaBg() {
        const { r, g, b } = hsvToRgb(H, S, V);
        alpha.style.background =
            `conic-gradient(#ccc 25%, #fff 0 50%, #ccc 0 75%, #fff 0) 0 0/12px 12px,
       linear-gradient(to bottom, rgba(${r},${g},${b},0), rgba(${r},${g},${b},1))`;
    }
    function updateUI() {
        // Posiciones de cursores
        svCursor.style.left = `${S * 100}%`;
        svCursor.style.top = `${(1 - V) * 100}%`;
        hueCursor.style.top = `${(H / 360) * 100}%`;
        alphaCursor.style.top = `${(1 - A) * 100}%`;

        const { r, g, b } = hsvToRgb(H, S, V);
        const hex = rgbToHex({
            r,
            g,
            b
        });
        previewFill.style.background = `rgba(${r},${g},${b},${A})`;

        if (!typingHex)
            inpHex.value = hex; // no pisar mientras tecleas
        hidden.value = allowAlpha ? `rgba(${r}, ${g}, ${b}, ${A})` : hex;

        setHueBg();
        setAlphaBg();
    }

    function setFromHex(hex) {
        const rgb = parseAnyColor(hex);
        if (!rgb)
            return;
        const hsv = rgbToHsv(rgb.r, rgb.g, rgb.b);
        H = hsv.h;
        S = hsv.s;
        V = hsv.v;
        if (rgb.a !== undefined)
            A = clamp(+rgb.a, 0, 1);
        updateUI();
    }

    // Interacciones SV/Hue/Alpha
    function clamp(n, min, max) {
        return Math.min(max, Math.max(min, n));
    }
    function dragXY(el, cb) {
        const onMove = (e) => {
            const rect = el.getBoundingClientRect();
            const x = clamp(((e.touches ? e.touches[0].clientX : e.clientX) - rect.left) / rect.width, 0, 1);
            const y = clamp(((e.touches ? e.touches[0].clientY : e.clientY) - rect.top) / rect.height, 0, 1);
            cb(x, y);
        };
        const up = () => {
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('touchmove', onMove);
            window.removeEventListener('mouseup', up);
            window.removeEventListener('touchend', up);
        };
        const down = (e) => {
            e.preventDefault();
            onMove(e);
            window.addEventListener('mousemove', onMove);
            window.addEventListener('touchmove', onMove, {
                passive: false
            });
            window.addEventListener('mouseup', up, {
                once: true
            });
            window.addEventListener('touchend', up, {
                once: true
            });
        };
        el.addEventListener('mousedown', down);
        el.addEventListener('touchstart', down, {
            passive: false
        });
    }
    dragXY(sv, (x, y) => {
        S = x;
        V = 1 - y;
        updateUI();
    });
    dragXY(hue, (x, y) => {
        H = clamp(y, 0, 1) * 360;
        updateUI();
    });
    dragXY(alpha, (x, y) => {
        A = 1 - y;
        updateUI();
    });

    // Teclado accesible
    function stepKey(el, fn) {
        el.addEventListener('keydown', (e) => {
            const k = e.key.toLowerCase();
            let d = 0.02;
            if (k === 'arrowup')
                fn(0, -d);
            if (k === 'arrowdown')
                fn(0, d);
            if (k === 'arrowleft')
                fn(-d, 0);
            if (k === 'arrowright')
                fn(d, 0);
        });
    }
    stepKey(sv, (dx, dy) => {
        S = clamp(S + dx, 0, 1);
        V = clamp(V - dy, 0, 1);
        updateUI();
    });
    stepKey(hue, (dx, dy) => {
        H = clamp(H + dy * 360, 0, 360);
        updateUI();
    });
    stepKey(alpha, (dx, dy) => {
        A = clamp(A - dy, 0, 1);
        updateUI();
    });

    // Evita que Enter en SV/Hue/Alpha burbujee al modal
    [sv, hue, alpha].forEach(el => {
        el.addEventListener('keydown', (e) => {
            if (e.key === 'Enter')
                e.stopPropagation();
        });
    });

    // Campo HEX + Alpha manual
    inpHex.addEventListener('input', () => {
        const rgb = parseAnyColor(inpHex.value);
        if (rgb) {
            const hsv = rgbToHsv(rgb.r, rgb.g, rgb.b);
            H = hsv.h;
            S = hsv.s;
            V = hsv.v;
            updateUI();
        }
    });
    inpA.addEventListener('input', () => {
        const v = parseFloat(inpA.value.replace(',', '.'));
        if (!isNaN(v)) {
            A = clamp(v, 0, 1);
            updateUI();
        }
    });

    // Inicial
    setFromHex(initial || DEFAULT_COLOR);

    // Auto-resize (ajusta tamaños y apila si no cabe)
    function setupResponsiveSizing() {
        const MIN_SV = 110; // antes 150
        const MAX_SV = 210; // antes 380
        const RIGHT_MIN = 180; // antes 210
        const RAIL_W = 14; // antes 18
        const GAP = 10; // antes 12
        const RATIO = 0.62; // antes 0.72

        cp.style.minWidth = left.style.minWidth = right.style.minWidth = fields.style.minWidth = '0';

        const compute = () => {
            const rails = 1 + (allowAlpha ? 1 : 0);
            const totalW = cp.clientWidth || wrap.clientWidth;

            const needed = MIN_SV + (rails * RAIL_W) + (2 * GAP) + RIGHT_MIN + GAP;
            const stack = totalW < needed;

            cp.style.display = 'grid';
            cp.style.gap = GAP + 'px';
            cp.style.alignItems = 'start';
            cp.style.gridTemplateColumns = stack
                 ? '1fr'
                 : `minmax(0, 1fr) minmax(${RIGHT_MIN}px, 28ch)`;

            const leftW = stack ? totalW : (totalW - RIGHT_MIN - GAP);
            const svTarget = leftW - (rails * RAIL_W) - (2 * GAP);

            const svW = Math.max(MIN_SV, Math.min(svTarget, MAX_SV));
            const svH = Math.max(0, Math.round(svW * RATIO));
            sv.style.width = Math.max(0, Math.floor(svW)) + 'px';
            sv.style.height = svH + 'px';
            hue.style.height = svH + 'px';
            alpha.style.height = svH + 'px';
        };

        requestAnimationFrame(() => {
            compute();
            const ro = new ResizeObserver(compute);
            ro.observe(cp);
            ro.observe(left);
        });
    }
    setupResponsiveSizing();

    // API pública
    return {
        root: wrap,
        hiddenInput: hidden,
        getValue: () => hidden.value,
        setValue: setFromHex
    };
}

//
// Helpers for UI Windows
//

function clamp(n, min, max) {
    return Math.min(max, Math.max(min, n));
}
function rgbToHex({
    r,
    g,
    b
}) {
    const h = (n) => n.toString(16).padStart(2, '0');
    return `#${h(r)}${h(g)}${h(b)}`.toUpperCase();
}
function rgbToHsv(r, g, b) {
    r /= 255;
    g /= 255;
    b /= 255;
    const max = Math.max(r, g, b),
    min = Math.min(r, g, b),
    d = max - min;
    let h = 0,
    s = max ? d / max : 0,
    v = max;
    if (d !== 0) {
        switch (max) {
        case r:
            h = (g - b) / d + (g < b ? 6 : 0);
            break;
        case g:
            h = (b - r) / d + 2;
            break;
        case b:
            h = (r - g) / d + 4;
            break;
        }
        h *= 60;
    }
    return {
        h,
        s,
        v
    };
}
function hsvToRgb(h, s, v) {
    const c = v * s,
    x = c * (1 - Math.abs(((h / 60) % 2) - 1)),
    m = v - c;
    let r = 0,
    g = 0,
    b = 0;
    if (0 <= h && h < 60) {
        r = c;
        g = x;
    } else if (60 <= h && h < 120) {
        r = x;
        g = c;
    } else if (120 <= h && h < 180) {
        g = c;
        b = x;
    } else if (180 <= h && h < 240) {
        g = x;
        b = c;
    } else if (240 <= h && h < 300) {
        r = x;
        b = c;
    } else {
        r = c;
        b = x;
    }
    return {
        r: Math.round((r + m) * 255),
        g: Math.round((g + m) * 255),
        b: Math.round((b + m) * 255)
    };
}
export function parseAnyColor(str) {
    if (!str)
        return null;
    const s = String(str).trim();

    // Hex (#rgb, #rrggbb, #rrggbbaa)
    if (s.startsWith('#')) {
        const rgb = toRgb(s);
        return rgb ? {
            ...rgb,
            a: 1
        }
         : null;
    }

    // rgba()/rgb()
    const m = s.match(/rgba?\((\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([.\d]+))?\)/i);
    if (m) {
        return {
            r: +m[1],
            g: +m[2],
            b: +m[3],
            a: m[4] !== undefined ? +m[4] : 1
        };
    }

    return null;
}
