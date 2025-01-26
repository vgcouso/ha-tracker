
# HA-TRACKER

HA-Tracker is an application designed to track devices assigned to Home Assistant users.  
It also allows filtering the positions of these devices and managing zones specific to the application.

## INSTALLATION

### *HACS*

Follow the usual process to install the integration via HACS.

### *MANUAL INSTALLATION*

1. First, create the following folders in Home Assistant:  
   `/config/custom_components/ha_tracker/`  
   `/config/www/ha-tracker/`

2. Copy the contents of the downloaded folder from:  
   `/custom_components/ha_tracker/` to Home Assistant at:  
   `/config/custom_components/ha_tracker/`

3. Copy the contents of the downloaded folder from:  
   `/www/ha-tracker/` to Home Assistant at:  
   `/config/www/ha-tracker/`

4. Add the following to your `configuration.yaml` file and restart Home Assistant:  
   ```yaml
   ha-tracker:
   ```

The application can be accessed via the web or through an iframe within Home Assistant.  
The URL in both cases is:  
`https://<server_address>/local/ha-tracker/index.html`

## QUICK START

The application consists of:  
- A map where devices, filters, and zones are displayed.  
- Two screens on the right side of the application to manage filters and zones.

### *FILTERS*

A filter applied to a device between two dates displays the positions grouped by zone and provides a summary with the most relevant data.  
On the map, it is represented by:  
- A blue line  
- A marker indicating the selected position  
- Circular markers for each of the positions

### *ZONES*

- **Home Assistant zones**:  
  These cannot be edited and are displayed on the map in red.  

- **Zones created within the application**:  
  - These require admin permissions.  
  - They are displayed in green on the map.  
  - They can be moved and resized.  
  - Zones created in the application appear in Home Assistant but cannot be edited there.

