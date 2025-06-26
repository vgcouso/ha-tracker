//
//  UTILS
//

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

document.getElementById('hamburger-button').addEventListener('click', async() => {
    try {
        await toggleContainer();
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
            // Mostrar zones 
            filterContainer.style.display = 'none';
            zonesContainer.style.display = 'block';
			personsContainer.style.display = 'none';			
        } else if (selectedValue === 'users') {
			// Mostrar zones 
            filterContainer.style.display = 'none';
            zonesContainer.style.display = 'none';
			personsContainer.style.display = 'block';			
		}
    } catch (error) {
        console.error("Error during combo-select:", error);
    }
});


export function isValidCoordinates(lat, lng) {
    return lat != null && lng != null && !isNaN(lat) && !isNaN(lng);
}

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
        const viewportHeight = window.innerHeight;
        const containerTop = container.getBoundingClientRect().top;
        const newHeight = Math.max(viewportHeight - containerTop - 20, 150); // Altura mínima de 150px

        // Reducido el umbral a 2px para minimizar parpadeo sin causar loops
        if (Math.abs(container.clientHeight - newHeight) > 2) {
            requestAnimationFrame(() => {
                container.style.height = `${newHeight}px`;
            });
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
                    if (entry.isIntersecting) adjustTableContainerHeight(entry.target);
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
            mutationObserver.observe(parentContainer, { childList: true, subtree: true });
        }

    } catch (error) {
        console.error("Error in observeTableContainers:", error);
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
        weekday: 'short',
        day: '2-digit',
        month: 'short',
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
        console.error('The overlay or message is not in the DOM.');
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
        console.error('The overlay is not in the DOM.');
        return;
    }

    // Verificar si ya está oculto
    if (overlay.style.display === 'none' || overlay.style.display === '') {
        return;
    }

    overlay.style.display = 'none'; // Ocultar el overlay
}

