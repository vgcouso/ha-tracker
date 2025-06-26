//	
// MAP
//


export let map; 

export async function initMap() {
    try {
        // Configuración predeterminada del mapa
        const mapOptions = {
            center: [40.4168, -3.7038], // Coordenadas iniciales (Madrid como ejemplo)
            zoom: 6, // Zoom inicial
            editable: true, // Permitir edición en el mapa
        };

        // Inicializar el mapa
        map = L.map('map', mapOptions);

        // Definir opciones de capas base
        const tileLayerOptions = {
            maxZoom: 19, // Zoom máximo permitido
            minZoom: 1, // Zoom mínimo permitido
        };

        // Crear capas base
        const baseLayers = {
            "OpenStreetMap": L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                ...tileLayerOptions,
                attribution: '© OpenStreetMap contributors',
            }),
            "Esri Satélite": L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
                ...tileLayerOptions,
                attribution: '© Esri, Maxar, Earthstar Geographics',
            }),
        };

        // Añadir la capa base predeterminada (OpenStreetMap)
        baseLayers["OpenStreetMap"].addTo(map);

        // Añadir control de capas
        const layersControl = L.control.layers(baseLayers, null, {
            position: 'topleft'
        });
        layersControl.addTo(map);

        // Añadir control de escala
        L.control.scale().addTo(map);

        // Personalizar posición del selector de capas con CSS
        const layersControlElement = document.querySelector('.leaflet-control-layers');
        const zoomControlElement = document.querySelector('.leaflet-control-zoom');

        if (layersControlElement && zoomControlElement) {
            const zoomControlRect = zoomControlElement.getBoundingClientRect();
            layersControlElement.style.position = 'absolute';
            layersControlElement.style.left = `${zoomControlRect.right}px`;
        }
    } catch (error) {
        console.error("Error starting map:", error);
    }
}
