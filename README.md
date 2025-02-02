<div style="text-align: center;">
  <img src="https://raw.githubusercontent.com/vgcouso/ha-tracker/main/docs/images/logo_512x512.png" alt="HA Tracker logo" width="128" height="128" style="display: block; margin: 0 auto;" />
</div>


# HA TRACKER

HA Tracker is an application designed to track the position of users created in Home Assistant and who have the application installed on their smartphone. 

It also allows you to filter the positions made by users between two dates and manage specific zones of the application.


## INSTALLATION USING HACS

1. Ensure you have HACS installed.
2. Open HACS, go to the top right corner, and click on the three dots.
3. Select **"Custom repositories"**.
4. In the **"Repository"** field, enter: `https://github.com/vgcouso/ha-tracker` and select **"Integration"** as the type. Then click **"Add"**.
5. Search for **HA Tracker** in HACS and click on it.
6. Once it opens, click on **"Download"** in the bottom right corner and confirm the download in the pop-up window.
7. Add the following line to your `configuration.yaml` file.

   ```yaml
   ha_tracker:
   ```

8. Restart Home Assistant to apply changes.
9. The application can be accessed via a web browser or embedded in an iframe within Home Assistant and the URL is:

   `https://<server-address>/local/ha-tracker/index.html`


## QUICK START

### Users

- These are the same ones created in Home Assistant and can have administrator permissions. In this case, they can manage the zones of HA Tracker.
- In addition, if users have the application installed on their mobile and it is assigned in Home Assistant, they will appear on the map and filters can be made with the positions stored over time.
- To see the battery, you need to go to the following screen in the Home Assistant app on your smartphone:

    **"Settings &rarr; Companion application &rarr; Manage sensors"**
  
    There you need to activate the **Battery level** sensor.

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
