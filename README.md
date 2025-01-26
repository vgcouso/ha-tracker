# ha-tracker
Integration with Home Assistant that allows device tracking

HA-TRACKER:
This is an application designed to track devices assigned to Home Assistant users.
It also allows you to filter the positions of these devices and manage areas of the application.

INSTALLATION:
Add the following to your configuration.yaml file and then restart Home Assistant:
ha_tracker:

The application can be run from a web page or from an iframe within Home Assistant.
The URL is: https://<server address>/local/ha-tracker/index.html
This same address is the one that must be entered into Home Assistant when it is integrated into an iframe.

QUICK START:
* FILTERS:
The filter made for a device and between two dates shows the positions grouped by area and a summary with the most relevant data.
On the map it is represented by a blue line, a marker with the selected position and circular markers for each of the positions.

* ZONES:
Home Assistant zones cannot be edited and appear on the map in red.
Zones created from the application itself, with administrator permissions, appear in green.
In addition, these zones can be moved and their radius changed.
Zones created in the application can be seen in Home Assistant but cannot be modified there.
