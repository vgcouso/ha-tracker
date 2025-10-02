//
// utils/calendar.js  (Flatpickr por CDN desde JS)
//
import { loadCSSOnce, loadScriptOnce } from './loader.js'; // ← misma carpeta
import { t } from './i18n.js';

const RANGE_SEP = " \u21D2 ";

// ---- URLs fijas (UMD) para garantizar window.flatpickr/confirmDatePlugin ----

const v = '4.6.13';

const FP_CDN = {
    coreJS: '/ha-tracker/vendor/flatpickr/flatpickr.min.js?v=' + v,
    coreCSS: '/ha-tracker/vendor/flatpickr/flatpickr.min.css?v=' + v,
    confirmJS: '/ha-tracker/vendor/flatpickr/plugins/confirmDate/confirmDate.js?v=' + v,
    confirmCSS: '/ha-tracker/vendor/flatpickr/plugins/confirmDate/confirmDate.css?v=' + v,
    l10nBase: '/ha-tracker/vendor/flatpickr/l10n', // p.ej. `${l10nBase}/es.js?v=${v}`
};

// ---- Estado interno ----
let _fpReady;
let FP = null; // alias a window.flatpickr
let Confirm = null; // alias a window.confirmDatePlugin

function detectFpLocale() {
    const supported = new Set(['ar', 'de', 'es', 'fr', 'hi', 'it', 'ja', 'pt', 'ru', 'zh']);
    const langs = (navigator.languages?.length ? navigator.languages : [navigator.language || 'en'])
    .map(l => String(l).toLowerCase());
    for (const lang of langs) {
        const two = lang.slice(0, 2);
        if (supported.has(two))
            return two;
    }
    return 'en';
}

async function ensureFlatpickrLoaded() {
    if (_fpReady)
        return _fpReady;

    _fpReady = (async() => {
        // 1) CSS
        await loadCSSOnce(FP_CDN.coreCSS);
        await loadCSSOnce(FP_CDN.confirmCSS);

        // 2) JS con verificación de globals
        await loadScriptOnce(FP_CDN.coreJS, {
            test: () => !!window.flatpickr
        });
        await loadScriptOnce(FP_CDN.confirmJS, {
            test: () => !!window.confirmDatePlugin
        });

        // 3) Localización opcional
        const loc = detectFpLocale();
        if (loc !== 'en') {
            await loadScriptOnce(`${FP_CDN.l10nBase}/${loc}.js?v=${v}`, {
                test: () => !!window.flatpickr?.l10ns?.[loc]
            }).catch(() => {});
        }

        // 4) Aliases
        FP = window.flatpickr;
        Confirm = window.confirmDatePlugin;

    })();

    return _fpReady;
}

// ========================= API pública / estado exportado =========================


export let lastAppliedRange = []; // [Date, Date]
let _onApplyFilter = null;

let fpStartTime, fpEndTime, fpRange;
let startTimeCache = "00:00:00";
let endTimeCache = "23:59:59";

// Helpers locales
const pad = n => String(n).padStart(2, '0');
const fmtLocal = d =>
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` + 
`T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;

function sameDay(a, b) {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
function hhmmFromHIS(his) {
    const [h = "00", m = "00"] = String(his || "").split(":");
    return `${pad(h)}:${pad(m)}`;
}

// ================================ Inicialización ================================
export async function initRangePicker(opts = {}) {
    _onApplyFilter = typeof opts.onApplyFilter === 'function' ? opts.onApplyFilter : null;
    if (window.__rangePickerInitDone)
        return;

    try {
        await ensureFlatpickrLoaded();
        injectFlatpickrShadowPatch();
    } catch (e) {
        console.error('[calendar] flatpickr could not be loaded:', e);
        return;
    }

    const daterangeEl = document.getElementById('daterange');
    if (!daterangeEl) {
        console.error('[calendar] #daterange does not exist');
        return;
    }

    const locKey = detectFpLocale();
    const localeObj = FP?.l10ns?.[locKey] || FP?.l10ns?.default ;

        fpRange = FP(daterangeEl, {
            mode: "range",
            enableTime: false,
            closeOnSelect: false,
            dateFormat: "Y-m-d",
            allowInput: false,
            locale: localeObj,
            plugins: [new Confirm({
                    confirmText: t('accept'),
                    showAlways: true,
                    theme: "light"
                })],

            onDayCreate(_dObj, _dStr, fp, dayElem) {
                dayElem.addEventListener('click', () => {
                    startTimeCache = "00:00:00";
                    endTimeCache = "23:59:59";
                    fpStartTime?.setDate(startTimeCache, false);
                    fpEndTime?.setDate(endTimeCache, false);
                    setTimeout(() => writeLocalizedRange(fp), 0);
                });
            },

            onReady(_sel, _str, inst) {
                mountPanel(inst);
                writeLocalizedRange(inst);
            },
            onOpen(_sel, _str, inst) {
                inst._prevTextboxValue = inst.input.value;
                inst._prevSelectedDates = Array.isArray(inst.selectedDates) ? [...inst.selectedDates] : [];
                inst.calendarContainer.classList.add('fp-at-top');
                mountPanel(inst);
                if (lastAppliedRange.length === 2)
                    inst.setDate(lastAppliedRange, true);
                else
                    writeLocalizedRange(inst);
            },
            onClose(_sel, _str, inst) {
                inst.calendarContainer.classList.remove('fp-at-top');
            },
            onValueUpdate() {
                writeLocalizedRange(fpRange);
            },
            onChange() {
                writeLocalizedRange(fpRange);
            },
        });

        window.addEventListener('resize', () => {
            const cal = fpRange?.calendarContainer;
            if (cal)
                syncTimePickersWidth(cal);
        });

        window.__rangePickerInitDone = true;
}

// ======================== API usada por screens/filter.js ========================
/** Devuelve { startLocal, endLocal } en formato YYYY-MM-DDTHH:mm:ss (local). */
export function getSelectedLocalRange() {
    let startRaw,
    endRaw;

    if (fpRange && Array.isArray(fpRange.selectedDates)) {
        const len = fpRange.selectedDates.length;
        if (len === 2) {
            const [sDate, eDate] = fpRange.selectedDates;
            const [sh, sm, ss] = (startTimeCache || "00:00:00").split(":").map(n => +n || 0);
            const [eh, em, es] = (endTimeCache || "23:59:59").split(":").map(n => +n || 0);
            const s = new Date(sDate);
            s.setHours(sh, sm, ss, 0);
            const e = new Date(eDate);
            e.setHours(eh, em, es, 0);
            startRaw = fmtLocal(s);
            endRaw = fmtLocal(e);
        } else if (len === 1) {
            const sDate = fpRange.selectedDates[0];
            const [sh, sm, ss] = (startTimeCache || "00:00:00").split(":").map(n => +n || 0);
            const [eh, em, es] = (endTimeCache || "23:59:59").split(":").map(n => +n || 0);
            const s = new Date(sDate);
            s.setHours(sh, sm, ss, 0);
            const e = new Date(sDate);
            e.setHours(eh, em, es, 0);
            startRaw = fmtLocal(s);
            endRaw = fmtLocal(e);
        }
    } else if (Array.isArray(lastAppliedRange) && lastAppliedRange.length === 2) {
        const [s, e] = lastAppliedRange;
        startRaw = fmtLocal(s);
        endRaw = fmtLocal(e);
    }

    return {
        startLocal: startRaw,
        endLocal: endRaw
    };
}

/** Establece las horas HH:mm:ss de inicio/fin y refresca los time pickers. */
export function setTimes(startHHMMSS = "00:00:00", endHHMMSS = "23:59:59") {
    startTimeCache = startHHMMSS || "00:00:00";
    endTimeCache = endHHMMSS || "23:59:59";
    fpStartTime?.setDate(startTimeCache, false);
    fpEndTime?.setDate(endTimeCache, false);
    if (fpRange)
        writeLocalizedRange(fpRange);
}

/** Establece el rango de fechas (objetos Date “día entero”). */
export function setRangeDates([startDate, endDate], updateInput = true) {
    if (!fpRange)
        return;
    fpRange.setDate([startDate, endDate], !!updateInput);
    if (!updateInput)
        writeLocalizedRange(fpRange);
    // Sincroniza el "aplicado" si el caller desea reflejarlo en la UI
    if (updateInput) {
        lastAppliedRange = [new Date(startDate), new Date(endDate || startDate)];
    }
}

/** Limpia el input del rango y el estado interno. */
export function clearRangeTextbox() {
    lastAppliedRange = [];
    if (fpRange) {
        fpRange.clear(false);
        fpRange.input.value = "";
    }
}

/** Muestra/oculta el bloque fecha según el selector de persona. */
export function updateDaterangeVisibility() {
    const personSelect = document.getElementById('person-select');
    const daterangeInput = document.getElementById('daterange');
    const daterangeBlock = daterangeInput?.closest('.group') || daterangeInput;

    if (!personSelect || !daterangeBlock)
        return;
    const empty = personSelect.value === '' || personSelect.selectedIndex === -1;
    daterangeBlock.style.display = empty ? 'none' : '';
    if (empty) {
        daterangeInput.value = '';
        fpRange?.clear(false);
    }
}

// ================================ Helpers UI =================================
function writeLocalizedRange(instance) {
    if (!instance)
        return;
    const fmtDate = new Intl.DateTimeFormat(undefined, {
        year: "2-digit",
        month: "2-digit",
        day: "2-digit"
    });
    const [s, e0] = instance.selectedDates || [];
    const startHHMM = hhmmFromHIS(startTimeCache || "00:00:00");
    const endHHMM = hhmmFromHIS(endTimeCache || "23:59:59");

    if (s && !e0) {
        instance.input.value = `${fmtDate.format(s)} ${startHHMM}`;
        return;
    }
    if (s && e0) {
        if (sameDay(s, e0)) {
            instance.input.value = `${fmtDate.format(s)} ${startHHMM}${RANGE_SEP}${endHHMM}`;
        } else {
            instance.input.value = `${fmtDate.format(s)} ${startHHMM}${RANGE_SEP}${fmtDate.format(e0)} ${endHHMM}`;
        }
        return;
    }
    instance.input.value = "";
}

function applySelection(instance) {
    const sd = instance.selectedDates || [];
    if (sd.length === 1) {
        const s = sd[0];
        instance.setDate([s, s], false);
    }
    // Actualiza lastAppliedRange con las fechas + horas actuales
    if (Array.isArray(instance.selectedDates) && instance.selectedDates.length) {
        const [sDate, eDate = instance.selectedDates[0]] = instance.selectedDates;
        const [sh, sm, ss] = (startTimeCache || "00:00:00").split(":").map(n => +n || 0);
        const [eh, em, es] = (endTimeCache || "23:59:59").split(":").map(n => +n || 0);
        const s = new Date(sDate);
        s.setHours(sh, sm, ss, 0);
        const e = new Date(eDate);
        e.setHours(eh, em, es, 0);
        lastAppliedRange = [s, e];
    }
    writeLocalizedRange(instance);
    instance.close();
    if (_onApplyFilter)
        _onApplyFilter();
}

function syncTimePickersWidth(mainCal) {
    const w = mainCal.getBoundingClientRect().width + "px";
    if (fpStartTime?.calendarContainer)
        fpStartTime.calendarContainer.style.width = w;
    if (fpEndTime?.calendarContainer)
        fpEndTime.calendarContainer.style.width = w;
}

function injectQuickbar(instance) {
    const bar = document.createElement("div");
    bar.className = "fp-quickbar";
    const _fmtHIS = d => `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;

    ["today", "yesterday", "last_24h", "last_7_days", "this_week"].forEach(key => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.textContent = t(key);
        btn.addEventListener("click", () => {
            const { start, end } = getQuickRange(key);
            if (!(start && end))
                return;

            if (key === "last_24h") {
                const endIncl = new Date(end.getTime() - 1000);
                setTimes(_fmtHIS(start), _fmtHIS(endIncl));
            } else {
                setTimes("00:00:00", "23:59:59");
            }

            setRangeDates([start, end], true);
            instance.close();
            if (_onApplyFilter)
                _onApplyFilter();
        });
        bar.appendChild(btn);
    });

    return bar;
}

function mountPanel(instance) {
    const cont = instance.calendarContainer;

    if (!cont.querySelector(".fp-quickbar"))
        cont.appendChild(injectQuickbar(instance));

    let panel = cont.querySelector(".fp-timepanel");
    if (!panel) {
        panel = document.createElement("div");
        panel.className = "fp-timepanel";

        const blockStart = document.createElement("div");
        blockStart.className = "fp-timeblock";
        const hostStart = document.createElement("div");
        hostStart.className = "fp-timehost";
        blockStart.appendChild(hostStart);

        const blockEnd = document.createElement("div");
        blockEnd.className = "fp-timeblock";
        const hostEnd = document.createElement("div");
        hostEnd.className = "fp-timehost";
        blockEnd.appendChild(hostEnd);

        panel.append(blockStart, blockEnd);
        cont.appendChild(panel);

        const localeKey = detectFpLocale();
        const localeObj = FP?.l10ns?.[localeKey] || FP?.l10ns?.default ;

            const prefers24h = !new Intl.DateTimeFormat(undefined, {
                hour: "numeric"
            })
                .formatToParts(new Date()).some(p => p.type === "dayPeriod");

            const startTimeAnchor = document.createElement("input");
            startTimeAnchor.type = "hidden";
            const endTimeAnchor = document.createElement("input");
            endTimeAnchor.type = "hidden";
            document.body.appendChild(startTimeAnchor);
            document.body.appendChild(endTimeAnchor);

            fpStartTime = FP(startTimeAnchor, {
                inline: true,
                noCalendar: true,
                enableTime: true,
                enableSeconds: true,
                time_24hr: prefers24h,
                dateFormat: "H:i:S",
                defaultDate: startTimeCache,
                locale: localeObj,
                onChange: (_, dateStr) => {
                    startTimeCache = dateStr || "00:00:00";
                }
            });
            fpEndTime = FP(endTimeAnchor, {
                inline: true,
                noCalendar: true,
                enableTime: true,
                enableSeconds: true,
                time_24hr: prefers24h,
                dateFormat: "H:i:S",
                defaultDate: endTimeCache,
                locale: localeObj,
                onChange: (_, dateStr) => {
                    endTimeCache = dateStr || "23:59:59";
                }
            });

            hostStart.appendChild(fpStartTime.calendarContainer);
            hostEnd.appendChild(fpEndTime.calendarContainer);
    }

    let actionbar = cont.querySelector(".fp-actionbar");
    if (!actionbar) {
        actionbar = document.createElement("div");
        actionbar.className = "fp-actionbar";
        cont.appendChild(actionbar);
    }

    const confirmBtn = cont.querySelector(".flatpickr-confirm");
    if (confirmBtn && !actionbar.contains(confirmBtn)) {
        confirmBtn.textContent = t('accept');
        confirmBtn.classList.add("fp-btn");
        actionbar.appendChild(confirmBtn);
        if (!confirmBtn.dataset._bound) {
            confirmBtn.addEventListener("click", () => applySelection(instance));
            confirmBtn.dataset._bound = "1";
        }
    }

    if (!actionbar.querySelector(".flatpickr-cancel")) {
        const cancelBtn = document.createElement("button");
        cancelBtn.type = "button";
        cancelBtn.className = "fp-btn flatpickr-cancel";
        cancelBtn.textContent = t('cancel');
        actionbar.insertBefore(cancelBtn, actionbar.querySelector('.flatpickr-confirm') || null);
        cancelBtn.addEventListener("click", () => {
            if (Array.isArray(instance._prevSelectedDates))
                instance.setDate(instance._prevSelectedDates, false);
            else
                instance.clear(false);

            if (typeof instance._prevTextboxValue === 'string')
                instance.input.value = instance._prevTextboxValue;
            else
                instance.input.value = "";

            instance.close();
        });
    }

    syncTimePickersWidth(cont);
}

// ================================ Quick ranges ================================
function startOfDay(d) {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x;
}
function addDays(d, n) {
    const x = new Date(d);
    x.setDate(x.getDate() + n);
    return x;
}
function firstOfMonth(d) {
    const x = new Date(d.getFullYear(), d.getMonth(), 1);
    x.setHours(0, 0, 0, 0);
    return x;
}
function firstOfNextMonth(d) {
    const x = new Date(d.getFullYear(), d.getMonth() + 1, 1);
    x.setHours(0, 0, 0, 0);
    return x;
}
function startOfISOWeek(d) {
    const x = new Date(d);
    const day = x.getDay();
    const diff = (day === 0 ? -6 : 1 - day);
    x.setDate(x.getDate() + diff);
    x.setHours(0, 0, 0, 0);
    return x;
}
function startOfNextISOWeek(d) {
    const start = startOfISOWeek(d);
    const next = new Date(start);
    next.setDate(start.getDate() + 7);
    return new Date(next.getTime() - 1000);
}

function getQuickRange(value) {
    const now = new Date();
    const today0 = startOfDay(now);

    switch (value) {
    case 'today':
        return {
            start: today0,
            end: today0
        };
    case 'yesterday':
        return {
            start: addDays(today0, -1),
            end: addDays(today0, -1)
        };
    case 'last_24h':
        return {
            start: new Date(now - 24 * 60 * 60 * 1000),
            end: new Date(now)
        };
    case 'last_7_days':
        return {
            start: new Date(now - 7 * 24 * 60 * 60 * 1000),
            end: now
        };
    case 'this_month':
        return {
            start: firstOfMonth(now),
            end: firstOfNextMonth(now)
        };
    case 'last_month': {
            const start = new Date(now.getFullYear(), now.getMonth() - 1, 1, 0, 0, 0, 0);
            const endExclusive = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
            const endInclusive = new Date(endExclusive.getTime() - 1000);
            return {
                start,
                end: endInclusive
            };
        }
    case 'this_week':
        return {
            start: startOfISOWeek(now),
            end: startOfNextISOWeek(now)
        };
    default:
        return {
            start: null,
            end: null
        };
    }
}

// ============================ Parche de sombra (UI) ============================
function injectFlatpickrShadowPatch() {
    if (document.getElementById('fp-shadow-patch'))
        return;
    const st = document.createElement('style');
    st.id = 'fp-shadow-patch';
    st.textContent = `
    .flatpickr-calendar{
      background:#fff !important;
      border:1px solid rgba(0,0,0,.12) !important;
      border-radius:12px !important;
      box-shadow:0 12px 28px rgba(0,0,0,.30) !important;
      overflow:hidden;
    }
    @media (max-width: 600px){
      .flatpickr-calendar.fp-at-top{
        left: 8px !important;
        right: 8px !important;
        width: auto !important;
        max-width: calc(100% - 16px) !important;
        margin: 0 auto !important;
      }
    }
  `;
    document.head.appendChild(st);
}
