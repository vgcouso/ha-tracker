
# HA-TRACKER

HA-Tracker es una aplicación diseñada para realizar el seguimiento de dispositivos asignados a usuarios de Home Assistant.
También permite filtrar las posiciones de esos dispositivos y gestionar zonas específicas de la aplicación.

## INSTALACIÓN

### Usando HACS
1. Asegúrate de tener HACS instalado.
2. Abre HACS, ve a la esquina superior derecha y haz clic en los tres puntos.
3. Selecciona **"Repositorios personalizados"**.
4. En el campo **"Repositorio"**, introduce: `https://github.com/vgcouso/ha-tracker` y selecciona **"Integración"** como tipo. Luego haz clic en **"Añadir"**.
5. Busca **HA Tracker** en HACS y haz clic en él.
6. Una vez abierto, haz clic en **"Descargar"** en la esquina inferior derecha y confirma la descarga en la ventana emergente.
7. Finalmente, reinicia tu Home Assistant.

### Instalación manual
1. Crea las siguientes carpetas en tu Home Assistant:
   - `/config/custom_components/ha_tracker/`
   - `/config/www/ha-tracker/`
2. Copia el contenido de la carpeta descargada:
   - Desde `/custom_components/ha_tracker/` a `/config/custom_components/ha_tracker/` en Home Assistant.
   - Desde `/custom_components/ha_tracker/www/` a `/config/www/ha-tracker/` en Home Assistant.

3. En ambos casos, añade lo siguiente a tu archivo `configuration.yaml` y reinicia Home Assistant:

   ```yaml
   ha-tracker:
   ```

La aplicación se puede acceder mediante un navegador web o incrustada en un iframe dentro de Home Assistant.
En ambos casos, la URL es: `https://<dirección-del-servidor>/local/ha-tracker/index.html`

## INICIO RÁPIDO

La aplicación consiste en:
- Un mapa que muestra los dispositivos, filtros y zonas.
- Dos paneles en el lado derecho de la aplicación para gestionar filtros y zonas.

### Filtros
Un filtro aplicado a un dispositivo dentro de un rango de fechas específico muestra las posiciones agrupadas por zona y un resumen de los datos más relevantes.
En el mapa, el filtro se representa por:
- Una línea azul.
- Un marcador para la posición seleccionada.
- Marcadores circulares para cada posición.

### Zonas
- Las **zonas de Home Assistant** no se pueden editar y se muestran en el mapa en color rojo.
- Las **zonas creadas dentro de la aplicación**, con permisos de administrador, se muestran en color verde.
  - Estas zonas se pueden mover y cambiar su radio.
  - Las zonas creadas dentro de la aplicación son visibles en Home Assistant, pero no se pueden modificar allí.
