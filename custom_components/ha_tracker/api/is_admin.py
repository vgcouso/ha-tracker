import logging
from homeassistant.components.http import HomeAssistantView

_LOGGER = logging.getLogger(__name__)

class IsAdminEndpoint(HomeAssistantView):
    url = "/api/ha_tracker/is_admin"
    name = "api:ha_tracker/is_admin"
    requires_auth = True

    async def get(self, request):
        hass_user = request["hass_user"]
        if hass_user is None:
            return self.json({"error": "User not authenticated"}, status_code=401)

        return self.json({"is_admin": hass_user.is_admin})
