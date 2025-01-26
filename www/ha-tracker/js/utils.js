//
//  UTILS
//

import {isAdmin} from './globals.js';
import {currentLang, t} from './i18n.js';

export async function load() {
    try {
        const filterContainer = document.getElementById('forms-container');
        if (window.innerWidth <= 400) {
            filterContainer.classList.add('hidden');
            filterContainer.classList.remove('visible');
        } else {
            filterContainer.classList.add('visible');
            filterContainer.classList.remove('hidden');
        }

        // Configura observadores al cargar la página
        observeTableContainers();
        observeZoneActions();

        // Garantizar que todo el contenido esté oculto hasta que las hojas de estilo y el DOM estén listos
        if (!document.body.classList.contains('loaded')) {
            document.body.classList.add('loaded');
        }
    } catch (error) {
        console.error("Error durante el load:", error);
    }
}

// Opción adicional: recalcular en redimensionado
window.addEventListener('resize', () => {
    document.querySelectorAll('.table-container').forEach(adjustTableContainerHeight);
});

document.getElementById('hamburger-button').addEventListener('click', async() => {
    try {
        await toggleContainer();
    } catch (error) {
        console.error("Error al manejar el botón de menú:", error);
    }
});

document.getElementById('combo-select').addEventListener('change', function () {
    try {
        const selectedValue = this.value; // Obtiene el valor seleccionado
        const filterContainer = document.getElementById('filter-container');
        const zonesContainer = document.getElementById('zones-container');

        if (selectedValue === 'filter') {
            // Mostrar filterContainer y ocultar zones
            filterContainer.style.display = 'block';
            zonesContainer.style.display = 'none';
        } else if (selectedValue === 'zones') {
            // Mostrar zones y ocultar filterContainer
            filterContainer.style.display = 'none';
            zonesContainer.style.display = 'block';
            if (isAdmin) {
                document.getElementById('zone-actions').style.display = 'flex';
            } else {
                document.getElementById('zone-actions').style.display = 'none';
            }
        }
    } catch (error) {
        console.error("Error durante el combo-select:", error);
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
        console.error("Error durante el toggleContainer:", error);
    }
}

async function adjustTableContainerHeight(container) {
    try {
        const viewportHeight = window.innerHeight; // Altura visible del viewport
        const containerTop = container.getBoundingClientRect().top; // Distancia desde el borde superior del viewport
        const newHeight = viewportHeight - containerTop - 20; // Ajusta el margen si es necesario
        container.style.height = `${newHeight}px`;
    } catch (error) {
        console.error("Error durante el adjustTableContainerHeight:", error);
    }
}

async function observeTableContainers() {
    try {
        const containers = document.querySelectorAll('.table-container');
        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    adjustTableContainerHeight(entry.target); // Ajusta la altura cuando el contenedor es visible
                }
            });
        });
        containers.forEach(container => {
            observer.observe(container); // Observa cada contenedor
        });
    } catch (error) {
        console.error("Error durante el observeTableContainers:", error);
    }
}

async function observeZoneActions() {
    try {
        const target = document.getElementById('zone-actions');
        if (!target) {
            console.error("No se encontró el elemento con ID 'zone-actions'.");
            return;
        }
        const observer = new MutationObserver(() => {
            document.querySelectorAll('.table-container').forEach(adjustTableContainerHeight);
        });
        observer.observe(target, {
            attributes: true,
            attributeFilter: ['style']
        });
    } catch (error) {
        console.error("Error durante el observeZoneActions:", error);
    }
}

// Formatear tiempo total en el formato "X días horas:minutos"
export function formatTotalTime(totalTimeMs) {
    const totalSeconds = Math.floor(totalTimeMs / 1000);
    const days = Math.floor(totalSeconds / (24 * 3600));
    const hours = Math.floor((totalSeconds % (24 * 3600)) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    // Condicional para incluir "día" o "días"
    const daysText = days > 0 ? `${days} ${days === 1 ? t('day') : t('days')} ` : '';

    return `${daysText}${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

export function formatDate(date) {
    const parsedDate = new Date(date);
    const options = {
        weekday: 'long',
        day: '2-digit',
        month: 'long',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
    };
    // Usa `currentLang` o un idioma por defecto (por ejemplo, 'en')
    return parsedDate.toLocaleString(currentLang || 'en', options);
}

export function getDistanceFromLatLonInMeters(lat1, lon1, lat2, lon2) {
    const R = 6371000; // Radio de la Tierra en metros
    const dLat = degToRad(lat2 - lat1);
    const dLon = degToRad(lon2 - lon1);
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(degToRad(lat1)) * Math.cos(degToRad(lat2)) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c; // Devuelve la distancia en metros
}

function degToRad(deg) {
    return deg * (Math.PI / 180);
}

export function showWindowOverlay(message = "Mensaje", bgColor = "rgba(0, 0, 255, 0.5)", textColor = "white", borderColor = "rgba(0, 0, 200, 0.8)") {
    const overlay = document.getElementById('window-overlay');
    const messageElement = document.getElementById('window-message');

    if (!overlay || !messageElement) {
        console.error('El overlay o el mensaje no se encuentra en el DOM.');
        return;
    }

    // Verificar si ya está visible
    if (overlay.style.display === 'flex') {
        return;
    }

    // Configurar el mensaje de texto
    messageElement.textContent = message;

    // Aplicar estilos personalizados
    messageElement.style.backgroundColor = bgColor;
    messageElement.style.color = textColor;
    messageElement.style.border = `2px solid ${borderColor}`;

    overlay.style.display = 'flex'; // Mostrar el overlay
}

export function hideWindowOverlay() {
    const overlay = document.getElementById('window-overlay');

    if (!overlay) {
        console.error('El overlay no se encuentra en el DOM.');
        return;
    }

    // Verificar si ya está oculto
    if (overlay.style.display === 'none' || overlay.style.display === '') {
        return;
    }

    overlay.style.display = 'none'; // Ocultar el overlay
}

export function configureConsoleLogging(environment) {
    if (environment === "production") {
        const originalConsole = {
            log: console.log,
            debug: console.debug,
            info: console.info,
            warn: console.warn,
            error: console.error,
        };

        console.log = () => {};
        console.debug = () => {};
        console.info = () => {};
        console.warn = (...args) => originalConsole.warn("[WARNING]:", ...args);
        console.error = (...args) => originalConsole.error("[ERROR]:", ...args);
        console.log("Configuración de consola para producción activada.");
    } else {
        const originalConsole = {
            log: console.log,
            debug: console.debug,
            info: console.info,
            warn: console.warn,
            error: console.error,
        };

        const getTimeStamp = () => {
            try {
                const now = new Date();
                const hours = String(now.getHours()).padStart(2, '0');
                const minutes = String(now.getMinutes()).padStart(2, '0');
                const seconds = String(now.getSeconds()).padStart(2, '0');
                const milliseconds = String(now.getMilliseconds()).padStart(3, '0');
                return `[${hours}:${minutes}:${seconds}:${milliseconds}]`;
            } catch (e) {
                // Si ocurre algún error, devolver una marca de tiempo genérica
                return "[00:00:00:000]";
            }
        };

        console.log = (...args) => originalConsole.log(getTimeStamp(), ...args);
        console.debug = (...args) => originalConsole.debug(getTimeStamp(), ...args);
        console.info = (...args) => originalConsole.info(getTimeStamp(), ...args);
        console.warn = (...args) => originalConsole.warn(getTimeStamp(), "[WARNING]:", ...args);
        console.error = (...args) => originalConsole.error(getTimeStamp(), "[ERROR]:", ...args);
        console.log("Modo de desarrollo: mostrando todos los mensajes de consola con marcas de tiempo.");
    }
}

