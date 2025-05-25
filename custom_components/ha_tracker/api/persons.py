"""Devuelve las personas de Home Assistant"""

import logging

from homeassistant.components.http import HomeAssistantView

from ..const import DOMAIN

_LOGGER = logging.getLogger(__name__)


class PersonsEndpoint(HomeAssistantView):
    """Punto de acceso a la API para obtener las persons"""

    url = "/api/ha_tracker/persons"
    name = "api:ha_tracker/persons"
    requires_auth = True

    async def get(self, request):
        """Devuelve las personas de Home Assistant"""
        
        hass = request.app["hass"]

     
        """Devuelve solo si es administrador o only_admin es false"""
        only_admin = False
        entries = hass.config_entries.async_entries(DOMAIN)
        if entries:                             # Normalmente solo habrá una entrada
            entry = entries[0]
            only_admin = entry.options.get(
                "only_admin",
                entry.data.get("only_admin", False),
            )
        user = request["hass_user"]             
        if only_admin and (user is None or not user.is_admin):
            return self.json([])

        
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
