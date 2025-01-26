import logging
from .http_api import DevicesEndpoint, PersonsEndpoint, FilteredPositionsEndpoint, IsAdminEndpoint, ZonesAPI, register_zones

_LOGGER = logging.getLogger(__name__)

async def async_setup(hass, config):
    """Configura la integración personalizada."""
    _LOGGER.info("Cargando la integración personalizada Tracker.")
    hass.http.register_view(DevicesEndpoint())
    hass.http.register_view(PersonsEndpoint())
    hass.http.register_view(FilteredPositionsEndpoint())
    hass.http.register_view(IsAdminEndpoint())    
    hass.http.register_view(ZonesAPI()) 
    await register_zones(hass)
    _LOGGER.info("Endpoints registrados exitosamente.")
    return True
