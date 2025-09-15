# custom_components/ha_tracker/api/downloads.py

from homeassistant.components.http import HomeAssistantView
from aiohttp import web
import aiofiles
import logging

from ..const import DOMAIN

_LOGGER = logging.getLogger(__name__)

class MobileConfigEndpoint(HomeAssistantView):
    """Sirve los ficheros de configuración móvil según el slug actual."""
    # slug limitado a minúsculas y números (coherente con tu config_flow)
    url = r"/api/ha-tracker/{slug:[a-z0-9]+}"
    name = "api:ha-tracker:mobile-config"
    requires_auth = False  # Si el .otrc lleva encryptionKey, plantéate True

    async def get(self, request, slug):
        try:
            hass = request.app["hass"]

            domain_bucket = hass.data.get(DOMAIN)
            if not domain_bucket or "config" not in domain_bucket:
                _LOGGER.warning("Config not loaded yet for %s; slug=%s", DOMAIN, slug)
                return web.Response(status=503, text="Service not ready")

            cfg = domain_bucket.get("config") or {}
            owntracks_slug = cfg.get("owntracks", "owntracks")
            gpslogger_slug = cfg.get("gpslogger", "gpslogger")

            # Rutas dentro de /config (NO anteponer "config/")
            if slug == owntracks_slug:
                path = hass.config.path("custom_components/ha_tracker/integrations/owntracks")
                filename = "ha-tracker.otrc"
            elif slug == gpslogger_slug:
                path = hass.config.path("custom_components/ha_tracker/integrations/gpslogger")
                filename = "ha-tracker.properties"
            elif slug == "macrodroid":
                path = hass.config.path("custom_components/ha_tracker/integrations/macrodroid")
                filename = "owntracks.macro"
            else:
                return web.Response(status=404, text="Not found")

            # Lectura asíncrona para evitar bloqueos en el event loop
            try:
                async with aiofiles.open(path, "rb") as f:
                    data = await f.read()
            except FileNotFoundError:
                _LOGGER.warning("File not found for slug=%s path=%s", slug, path)
                return web.Response(status=404, text="Not found")

            # No uses content_type=... para que el SO no cambie extensión
            headers = {
                "Content-Disposition": f'attachment; filename="{filename}"; filename*=UTF-8\'\'{filename}',
                "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
                "Pragma": "no-cache",
                "Expires": "0",
                "X-Content-Type-Options": "nosniff",
                "Content-Type": "application/octet-stream",
            }
            return web.Response(body=data, headers=headers)

        except Exception:
            _LOGGER.exception("Error in MobileConfigEndpoint (slug=%s)", slug)
            return web.Response(status=500, text="Internal Server Error")
