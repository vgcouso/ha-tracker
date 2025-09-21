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
        """Devuelve las personas de Home Assistant (filtra por dominio 'person')"""

        hass = request.app["hass"]

        # Devuelve solo si es administrador o only_admin es false
        only_admin = False
        entries = hass.config_entries.async_entries(DOMAIN)
        if entries:  # Normalmente solo habrá una entrada
            entry = entries[0]
            only_admin = entry.options.get(
                "only_admin",
                entry.data.get("only_admin", False),
            )
        user = request["hass_user"]
        if only_admin and (user is None or not user.is_admin):
            return self.json([])

        persons = hass.states.async_all()

        person_data = []
        for person in persons:
            if not person.entity_id.startswith("person."):
                continue            
            attrs = dict(person.attributes)

            # Campo derivado útil (si existen lat/lon)
            lat = attrs.get("latitude")
            lon = attrs.get("longitude")
            has_location = False
            try:
                if lat is not None and lon is not None:
                    _lat = float(lat)
                    _lon = float(lon)
                    # Rango válido
                    if -90.0 <= _lat <= 90.0 and -180.0 <= _lon <= 180.0:
                        # Excluye solo (0,0) como caso nulo
                        has_location = not (_lat == 0.0 and _lon == 0.0)
            except (TypeError, ValueError):
                has_location = False

            person_data.append(
                {
                    "entity_id": person.entity_id,
                    "state": person.state,
                    "attributes": attrs,
                    "has_location": has_location,
                    "last_updated": person.last_updated.isoformat()
                    if hasattr(person.last_updated, "isoformat")
                    else person.last_updated,
                    "last_changed": person.last_changed.isoformat()
                    if hasattr(person.last_changed, "isoformat")
                    else person.last_changed,
                }
            )

        return self.json(person_data)
