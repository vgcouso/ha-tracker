
# HA-TRACKER

HA-Tracker is an application designed to track devices assigned to Home Assistant users.
It also allows filtering the positions of those devices and managing zones specific to the application.

## INSTALLATION

### Using HACS
1. Ensure you have HACS installed.
2. Open HACS, go to the top right corner, and click on the three dots.
3. Select **"Custom repositories"**.
4. In the **"Repository"** field, enter: `https://github.com/vgcouso/ha-tracker` and select **"Integration"** as the type. Then click **"Add"**.
5. Search for **HA Tracker** in HACS and click on it.
6. Once it opens, click on **"Download"** in the bottom right corner and confirm the download in the pop-up window.
7. Finally, restart your Home Assistant.

### Manual Installation
1. Create the following folders in your Home Assistant:
   - `/config/custom_components/ha_tracker/`
   - `/config/www/ha-tracker/`
2. Copy the contents of the downloaded folder:
   - From `/custom_components/ha_tracker/` to `/config/custom_components/ha_tracker/` in Home Assistant.
   - From `/www/ha-tracker/` to `/config/www/ha-tracker/` in Home Assistant.

3. In both cases, add the following to your `configuration.yaml` file and restart Home Assistant:

   ```yaml
   ha-tracker:
   ```

The application can be accessed via a web browser or embedded in an iframe within Home Assistant.
In both cases, the URL is: `https://<server-address>/local/ha-tracker/index.html`

## QUICK START

The application consists of:
- A map displaying devices, filters, and zones.
- Two panels on the right side of the application for managing filters and zones.

### Filters
A filter applied to a device within a specific date range displays positions grouped by zone and a summary of the most relevant data.
On the map, the filter is represented by:
- A blue line.
- A marker for the selected position.
- Circular markers for each position.

### Zones
- **Home Assistant zones** cannot be edited and are displayed on the map in red.
- **Zones created within the application**, with admin permissions, are displayed in green.
  - These zones can be moved and have their radius changed.
  - Zones created within the application are visible in Home Assistant but cannot be modified there.
