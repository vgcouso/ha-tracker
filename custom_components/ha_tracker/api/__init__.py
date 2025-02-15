"""Registrar todos los endpoints de la API en Home Assistant"""

from .config import ConfigEndpoint
from .devices import DevicesEndpoint
from .filtered_positions import FilteredPositionsEndpoint
from .is_admin import IsAdminEndpoint
from .persons import PersonsEndpoint
from .zones import ZonesAPI


def register_api_views(hass):
    """Registra todos los endpoints de la API en Home Assistant."""
    hass.http.register_view(ConfigEndpoint())
    hass.http.register_view(DevicesEndpoint())
    hass.http.register_view(PersonsEndpoint())
    hass.http.register_view(FilteredPositionsEndpoint())
    hass.http.register_view(IsAdminEndpoint())
    hass.http.register_view(ZonesAPI())
