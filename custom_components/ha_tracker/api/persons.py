"""Devuelve las personas de Home Assistant"""

import logging

from homeassistant.components.http import HomeAssistantView

_LOGGER = logging.getLogger(__name__)


class PersonsEndpoint(HomeAssistantView):
    """Punto de acceso a la API para obtener las persons"""

    url = "/api/ha_tracker/persons"
    name = "api:ha_tracker/persons"
    requires_auth = True

    async def get(self, request):
        """Devuelve las personas de Home Assistant"""
        hass = request.app["hass"]
        persons = hass.states.async_all()

        person_data = [
            {
                "entity_id": person.entity_id,
                "state": person.state,
                "attributes": person.attributes,
                "last_updated": person.last_updated,
                "last_changed": person.last_changed,
            }
            for person in persons
            if person.entity_id.startswith("person.")
        ]

        return self.json(person_data)
