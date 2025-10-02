
import { t } from './i18n.js';
import { map } from './map.js';
import { use_imperial, SHOW_VISITS } from '../globals.js';
import { updateZoneActionButtons } from '../screens/zones.js';

const invalidateSoon = () => requestAnimationFrame(() => map?.invalidateSize(true));

export async function loadUI() {
    try {
        enhanceSelectWithIcons(document.getElementById('combo-select')); // pantalla

        const personSelect = document.getElementById('person-select');
        if (personSelect) {
            personSelect.dataset.defaultIcon = 'users';
            enhanceSelectWithIcons(personSelect);
        }

        const exportSelect = document.getElementById('export-filter');
        if (exportSelect) {
            exportSelect.dataset.defaultIcon = 'export';
            enhanceSelectWithIcons(exportSelect);
        }

        const filterContainer = document.getElementById('forms-container');
        if (window.innerWidth <= 600) {
            filterContainer.classList.add('hidden');
            filterContainer.classList.remove('visible');
        } else {
            filterContainer.classList.add('visible');
            filterContainer.classList.remove('hidden');
        }

        // Configura observadores al cargar la página
        observeTableContainers();

        // Garantizar que todo el contenido esté oculto hasta que las hojas de estilo y el DOM estén listos
        if (!document.body.classList.contains('loaded')) {
            document.body.classList.add('loaded');
        }
    } catch (error) {
        console.error("Error during load:", error);
    }
}

// recalcular en redimensionado
window.addEventListener('resize', () => {
    document.querySelectorAll('.table-container').forEach(adjustTableContainerHeight);
});

export async function updateUI() {
    //ocultar VISITAS en FILTRO-> ZONAS
    // Si ya existe el <style>, reutilízalo; si no, créalo
    let style = document.getElementById('visits-col-css');
    if (!style) {
        style = document.createElement('style');
        style.id = 'visits-col-css';
        document.head.appendChild(style);
    }

    // Cuando está oculta: ocultar <th data-i18n="visits"> y la 3ª columna del body
    style.textContent = SHOW_VISITS ? '' : `
        #summary-zones-table thead th[data-i18n="visits"] { display: none !important; }
        #summary-zones-table-body tr > td:nth-child(3) { display: none !important; }
    `;

    // FILTRO -> POSICIONES-> speed
    const unitSpeed = use_imperial ? t('mi_per_hour') : t('km_per_hour');
    const unitDistKm = use_imperial ? t('miles') : t('kilometres');
    const unitDistMeters = use_imperial ? t('feet') : t('meters');

    document
    .querySelectorAll('#positions-table thead th[data-i18n="speed"], #positions thead th[data-i18n="speed"]')
    .forEach(th => {
        const label = th.querySelector('.hdr-label');
        if (label)
            label.textContent = unitSpeed;
        else
            th.textContent = unitSpeed; // fallback si no hay estructura
    });

    // FILTRO -> ZONAS -> distance (con fallback igual)
    document
    .querySelectorAll('#summary-zones-table thead th[data-i18n="distance"]')
    .forEach(th => {
        const label = th.querySelector('.hdr-label');
        if (label)
            label.textContent = unitDistKm;
        else
            th.textContent = unitDistKm; // <- aquí estaba el problema
    });

    // ZONAS -> radio
    document
    .querySelectorAll('#zones-table thead th[data-i18n="radius"] .hdr-label')
    .forEach(el => {
        el.textContent = `${unitDistMeters}`;
    });

    // PERSONAS -> velocidad
    document
    .querySelectorAll('#persons-table thead th[data-i18n="speed"] .hdr-label')
    .forEach(el => {
        el.textContent = `${unitSpeed}`;
    });
}

window.addEventListener("message", (ev) => {
    if (ev.data?.type === "ping") {
        try {
            ev.source?.postMessage({
                type: "pong",
                id: ev.data.id
            }, ev.origin || "*");
        } catch {}
    }
});

document.getElementById('hamburger-button').addEventListener('click', async() => {
    try {
        await toggleContainer();
        invalidateSoon();
    } catch (error) {
        console.error("Error handling menu button:", error);
    }
});

document.getElementById('combo-select').addEventListener('change', function () {
    try {
        const selectedValue = this.value; // Obtiene el valor seleccionado
        const filterContainer = document.getElementById('filter-container');
        const zonesContainer = document.getElementById('zones-container');
        const personsContainer = document.getElementById('persons-container');

        if (selectedValue === 'filter') {
            // Mostrar filterContainer
            filterContainer.style.display = 'block';
            zonesContainer.style.display = 'none';
            personsContainer.style.display = 'none';
        } else if (selectedValue === 'zones') {
            // Mostrar zonesContainer
            filterContainer.style.display = 'none';
            zonesContainer.style.display = 'block';
            personsContainer.style.display = 'none';

            // No seleccionar ninguna zona al entrar en "zones"
            const zonesTableBody = document.getElementById('zones-table-body');
            if (zonesTableBody) {
                zonesTableBody.querySelectorAll('tr.selected')
                .forEach(r => r.classList.remove('selected'));
            }

            updateZoneActionButtons();

        } else if (selectedValue === 'users') {
            // Mostrar personsContainer
            filterContainer.style.display = 'none';
            zonesContainer.style.display = 'none';
            personsContainer.style.display = 'block';

            // No seleccionar ninguna persona al entrar en "persons"
            const personsTableBody = document.getElementById('persons-table-body');
            if (personsTableBody) {
                personsTableBody.querySelectorAll('tr.selected')
                .forEach(r => r.classList.remove('selected'));
            }
            if (typeof updatePersonsTable === 'function') {
                updatePersonsTable();
            }
        }

        // cerrar cualquier popup abierto en el mapa:
        if (typeof map !== 'undefined' && map && typeof map.closePopup === 'function')
            map.closePopup();

        invalidateSoon();
    } catch (error) {
        console.error("Error during combo-select:", error);
    }
});

async function toggleContainer() {
    try {
        const formsContainer = document.getElementById('forms-container');
        const isHidden = formsContainer.classList.contains('hidden');

        if (isHidden) {
            // Mostrar el contenedor de edición
            formsContainer.classList.remove('hidden');
            formsContainer.classList.add('visible');
        } else {
            // Ocultar el contenedor de edición
            formsContainer.classList.add('hidden');
            formsContainer.classList.remove('visible');
        }
    } catch (error) {
        console.error("Error during toggleContainer:", error);
    }
}

async function adjustTableContainerHeight(container) {
  try {
    // Evita tocar alturas si el contenedor está oculto
    const style = getComputedStyle(container);
    const isHidden = style.display === 'none' || container.offsetParent === null;
    if (isHidden) return;

    const viewportHeight = window.innerHeight;
    const containerTop = container.getBoundingClientRect().top;

    // Reserva espacio para el gráfico solo en Positions
    let reserved = 0;
    if (container.closest('#positions')) {
      const chart = document.getElementById('positions-chart');
      if (chart) reserved = (chart.offsetHeight || 50) + 10;
    }

    const newHeight = Math.max(viewportHeight - containerTop - 20 - reserved, 150);
    if (Math.abs(container.clientHeight - newHeight) > 2) {
      requestAnimationFrame(() => { container.style.height = `${newHeight}px`; });
    }
  } catch (error) {
    console.error("Error adjusting table height:", error);
  }
}

async function observeTableContainers() {
    try {
        const containers = document.querySelectorAll('.table-container');
        const parentContainer = document.getElementById('forms-container'); // Contenedor general

        // Crear ResizeObserver evitando loops
        const resizeObserver = new ResizeObserver(entries => {
            requestAnimationFrame(() => { // Evita ciclos infinitos
                entries.forEach(entry => adjustTableContainerHeight(entry.target));
            });
        });

        // Crear IntersectionObserver para detectar cuando una tabla aparece
        const intersectionObserver = new IntersectionObserver(entries => {
            requestAnimationFrame(() => {
                entries.forEach(entry => {
                    if (entry.isIntersecting)
                        adjustTableContainerHeight(entry.target);
                });
            });
        });

        // Crear MutationObserver para detectar cambios en el DOM (cuando desaparecen elementos)
        const mutationObserver = new MutationObserver(() => {
            requestAnimationFrame(() => {
                document.querySelectorAll('.table-container').forEach(adjustTableContainerHeight);
            });
        });

        // Aplicar observadores a cada tabla
        containers.forEach(container => {
            intersectionObserver.observe(container);
            resizeObserver.observe(container);
        });

        // Aplicar MutationObserver al contenedor padre
        if (parentContainer) {
            mutationObserver.observe(parentContainer, {
                childList: true,
                subtree: true
            });
        }

    } catch (error) {
        console.error("Error in observeTableContainers:", error);
    }
}

// Iconos SVG (puedes ampliar este mapa cuando quieras)
const ICONS = {
    users: '<path d="M12 12a5 5 0 1 0-5-5 5 5 0 0 0 5 5zm0 2c-4.42 0-8 2.24-8 5v1h16v-1c0-2.76-3.58-5-8-5z"/>',
    zones: '<path d="M12 2a7 7 0 0 0-7 7c0 5.25 7 13 7 13s7-7.75 7-13a7 7 0 0 0-7-7zm0 9.5A2.5 2.5 0 1 1 14.5 9 2.5 2.5 0 0 1 12 11.5z"/>',
    filter: '<path d="M3 4h18l-7 8v6l-4 2v-8z"/>',
    export: '<path d="M12 3v10"/><path d="M8 7l4-4 4 4"/><path d="M4 21h16v-2a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v2z"/>',
    dot: '<circle cx="12" cy="12" r="5"/>'
};
const svg = (name) =>
`<svg class="id-icon" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ICONS.dot}</svg>`;

function enhanceSelectWithIcons(select) {
    if (!select || select.dataset.enhanced === "1")
        return;

    // Envoltorio y botón
    const wrap = document.createElement('div');
    wrap.className = 'id-wrap';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'id-toggle';
    btn.setAttribute('aria-haspopup', 'listbox');
    btn.setAttribute('aria-expanded', 'false');
    btn.setAttribute('aria-controls', select.id + '-menu');

    const menu = document.createElement('div');
    menu.className = 'id-menu';
    menu.id = select.id + '-menu';
    menu.setAttribute('role', 'listbox');
    menu.setAttribute('aria-hidden', 'true');
    menu.hidden = true;

    // Inserta UI y oculta el select
    select.classList.add('id-visually-hidden');
    select.parentNode.insertBefore(wrap, select.nextSibling);
    wrap.appendChild(btn);
    wrap.appendChild(menu);

    function currentOption() {
        return select.selectedOptions[0] || select.options[0];
    }

    function iconFor(opt) {
        // Prioridad: data-icon de la opción -> data-default-icon del select -> value -> dot
        return (opt?.dataset.icon) || select.dataset.defaultIcon || (opt?.value) || 'dot';
    }

    function updateButtonLabel() {
        const opt = currentOption();
        const iconName = iconFor(opt);
        btn.innerHTML = `${svg(iconName)}<span class="id-text">${opt?.text || ''}</span><span class="id-caret" aria-hidden="true">▾</span>`;
    }

    function buildMenu() {
        menu.innerHTML = '';
        Array.from(select.options).forEach((opt, idx) => {
            const optBtn = document.createElement('button');
            optBtn.type = 'button';
            optBtn.className = 'id-option';
            optBtn.setAttribute('role', 'option');
            optBtn.dataset.value = opt.value;
            optBtn.setAttribute('aria-selected', String(opt.selected));
            optBtn.innerHTML = `${svg(iconFor(opt))}<span>${opt.text}</span>`;
            if (opt.disabled) {
                optBtn.disabled = true;
                optBtn.style.opacity = .5;
                optBtn.style.cursor = 'not-allowed';
            }
            optBtn.addEventListener('click', () => {
                if (opt.disabled)
                    return;
                select.value = opt.value;
                select.dispatchEvent(new Event('change', {
                        bubbles: true
                    }));
                closeMenu();
                btn.focus();
            });
            menu.appendChild(optBtn);
            // Roving tabindex dentro del menú
            optBtn.tabIndex = (opt.selected || (!select.value && idx === 0)) ? 0 : -1;
        });
    }

    function openMenu() {
        buildMenu();
        menu.hidden = false;
        menu.setAttribute('aria-hidden', 'false');
        btn.setAttribute('aria-expanded', 'true');
        // Enfoca la opción seleccionada
        const selected = menu.querySelector('.id-option[aria-selected="true"]') || menu.querySelector('.id-option');
        selected?.focus();
        document.addEventListener('click', onDocClick);
        document.addEventListener('keydown', onKeyNav);
    }

    function closeMenu() {
        menu.hidden = true;
        menu.setAttribute('aria-hidden', 'true');
        btn.setAttribute('aria-expanded', 'false');
        document.removeEventListener('click', onDocClick);
        document.removeEventListener('keydown', onKeyNav);
    }

    function toggleMenu() {
        if (menu.hidden)
            openMenu();
        else
            closeMenu();
    }

    function onDocClick(e) {
        if (!wrap.contains(e.target))
            closeMenu();
    }

    function onKeyNav(e) {
        const focusables = Array.from(menu.querySelectorAll('.id-option:not([disabled])'));
        const idx = focusables.indexOf(document.activeElement);
        if (e.key === 'Escape') {
            e.preventDefault();
            closeMenu();
            btn.focus();
        } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            (focusables[idx + 1] || focusables[0])?.focus();
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            (focusables[idx - 1] || focusables.at(-1))?.focus();
        } else if (e.key === 'Home') {
            e.preventDefault();
            focusables[0]?.focus();
        } else if (e.key === 'End') {
            e.preventDefault();
            focusables.at(-1)?.focus();
        } else if (e.key === 'Enter' || e.key === ' ') {
            if (document.activeElement?.classList.contains('id-option')) {
                e.preventDefault();
                document.activeElement.click();
            }
        }
    }

    // Sincronización si tu lógica cambia el <select>
    select.addEventListener('change', () => {
        updateButtonLabel();
        // Marcar seleccionado en menú si está abierto
        menu.querySelectorAll('.id-option').forEach(b => {
            b.setAttribute('aria-selected', String(b.dataset.value === select.value));
        });
    });

    // Apertura/cierre y navegación desde el botón
    btn.addEventListener('click', toggleMenu);
    btn.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            openMenu();
        }
    });

    // Observer: si agregas/eliminás/modificás opciones, se refleja solo
    const obs = new MutationObserver(() => {
        updateButtonLabel();
        if (!menu.hidden)
            buildMenu();
    });
    obs.observe(select, {
        childList: true,
        subtree: true,
        characterData: true
    });

    // Inicial
    updateButtonLabel();
    select.dataset.enhanced = "1";
}
