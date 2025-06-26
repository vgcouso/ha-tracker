"""Se usa para saber si un usuario es administrador"""

import logging

from homeassistant.components.http import HomeAssistantView

_LOGGER = logging.getLogger(__name__)


class IsAdminEndpoint(HomeAssistantView):
    """Punto de acceso a la API para saber si un ser es admin"""

    url = "/api/ha_tracker/is_admin"
    name = "api:ha_tracker/is_admin"
    requires_auth = True

    async def get(self, request):
        """Devuelve si un usuario es administrador"""
        hass_user = request["hass_user"]
        if hass_user is None:
            error_msg = {"error": "User not authenticated"}
            return self.json(error_msg, status_code=401)

        return self.json({"is_admin": hass_user.is_admin})
