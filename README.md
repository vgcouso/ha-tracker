<div style="text-align: center;">
  <img src="https://raw.githubusercontent.com/vgcouso/ha-tracker/main/docs/images/logo_512x512.png" alt="HA Tracker logo" width="128" height="128" style="display: block; margin: 0 auto;" />
</div>


# HA TRACKER

HA Tracker is an application designed to track the position of users registered in Home Assistant who have the app installed on their smartphones.
You can manage specific zones of the application.
It also allows you to filter positions between two dates with grouping by zone and detailed summary.


## REQUIREMENTS

To install this integration in Home Assistant, you will need:
- An installation of Home Assistant (see https://www.home-assistant.io/)
- HACS installed in your Home Assistant environment (see https://hacs.xyz/)
Installation


## INSTALLATION 

Once you have met the above objectives, the steps to install this integration are as follows:
1. Click [![hacs_badge](https://my.home-assistant.io/badges/hacs_repository.svg)](https://my.home-assistant.io/redirect/hacs_repository/?owner=vgcouso&repository=ha-tracker&category=integration)
2. Restart Home Assistant.
3. Go to: **"Settings &rarr; Devices and Services &rarr; Add Integration"**
4. Search for **HA Tracker**, select it and on the **Configuration screen** press **Send**

You can access the application by opening the panel from the menu on the left or also from a web browser at the address:

   `https://<server-address>/local/ha-tracker/index.html`


## OPTIONS

- **Refresh Interval:** (Minimum value: 10 seconds) The time the client uses to update its information from the server.
- **Geocoding Time:** (Minimum value: 30 seconds) Time between positions to request a person's address.
- **Minimum Distance for Geocoding:** (Minimum value: 20 meters) Distance between positions to request a person's address.
- **Enable Debugging:** Messages in the web browser console (F12 key).
- **Admin only** Make the integration accessible only by admin.
- **Speed in miles per hour** Speed visible in miles per hour.
    
## QUICK START

### Users

- These are the same ones created in Home Assistant and can have administrator permissions. In this case, they can manage the zones of HA Tracker.
- In addition, if users have the application installed on their mobile and it is assigned in Home Assistant, they will appear on the map and filters can be made with the positions stored over time.
- To see the address and battery, you need to go to the following screen in the Home Assistant app on your smartphone:

    **"Settings &rarr; Companion application &rarr; Manage sensors"**
  
  There you need to activate the Battery level sensor.

<div align="center">
  <img src="https://raw.githubusercontent.com/vgcouso/ha-tracker/main/docs/images/users.png" alt="HA Tracker users screen" style="width: 80%; max-width: 100%; height: auto;" />
  <br>
  <em>This is the users screen</em>
</div>

### Zones

- **Home Assistant zones** cannot be edited and are displayed on the map in red.
- **Zones created within the application**, with admin permissions, are displayed in green.
  - These zones can be moved and have their radius changed.
  - Zones created within the application are visible in Home Assistant but cannot be modified there.

<div align="center">
  <img src="https://raw.githubusercontent.com/vgcouso/ha-tracker/main/docs/images/zones.png" alt="HA Tracker zones screen" style="width: 80%; max-width: 100%; height: auto;" />
  <br>
  <em>This is the zones screen</em>
</div>

### Filters

A filter applied to a user within a specific date range displays positions grouped by zone and a summary of the most relevant data.
On the map, the filter is represented by:
- A blue line.
- A marker for the selected position.
- Circular markers for each position.


There are two tabs on this screen:
- The first tab shows the list of filtered positions grouped by the zone in which they were found.
- The second tab contains a summary of the most relevant statistics for the filter.


<div align="center">
  <img src="https://raw.githubusercontent.com/vgcouso/ha-tracker/main/docs/images/filter.png" alt="HA Tracker filter screen" style="width: 80%; max-width: 100%; height: auto;" />
  <br>
  <em>This is the filter screen</em>
</div>
<br>
<br>
<div align="center">
  <img src="https://raw.githubusercontent.com/vgcouso/ha-tracker/main/docs/images/summary.png" alt="HA Tracker summary screen" style="width: 80%; max-width: 100%; height: auto;" />
  <br>
  <em>This is the summary screen</em>
</div>


## Changelog

See the [CHANGELOG](CHANGELOG.md) for details about changes and updates.
