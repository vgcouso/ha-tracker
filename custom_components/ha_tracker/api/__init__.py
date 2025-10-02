from .config import ConfigEndpoint
from .devices import DevicesEndpoint
from .filtered_positions import FilteredPositionsEndpoint
from .nearest_position import NearestPositionEndpoint
from .is_admin import IsAdminEndpoint
from .persons import PersonsEndpoint
from .zones import ZonesAPI
from .reverse_geocode import ReverseGeocodeEndpoint

_VIEWS_REGISTERED = False

def register_api_views(hass):
    """Registra todos los endpoints de la API (idempotente)."""
    global _VIEWS_REGISTERED
    if _VIEWS_REGISTERED:
        return
    hass.http.register_view(ConfigEndpoint())
    hass.http.register_view(DevicesEndpoint())
    hass.http.register_view(PersonsEndpoint())
    hass.http.register_view(FilteredPositionsEndpoint())
    hass.http.register_view(NearestPositionEndpoint())
    hass.http.register_view(IsAdminEndpoint())
    hass.http.register_view(ZonesAPI())
    hass.http.register_view(ReverseGeocodeEndpoint())
    _VIEWS_REGISTERED = True
