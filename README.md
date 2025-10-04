<p>
  <a href="https://paypal.me/vgcouso" target="_blank" rel="noreferrer noopener"><img src="https://www.paypalobjects.com/webstatic/mktg/logo/pp_cc_mark_37x23.jpg" alt="PayPal Logo"></a>
  <a href="https://www.buymeacoffee.com/vgcouso" target="_blank" rel="noreferrer noopener"><img src="https://bmc-cdn.nyc3.digitaloceanspaces.com/BMC-button-images/custom_images/orange_img.png" alt="Buy Me A Coffee"></a>
</p>
<div style="text-align: center;">
  <img src="https://raw.githubusercontent.com/vgcouso/ha-tracker/main/docs/images/logo_512x512.png" alt="HA Tracker logo" width="128" height="128" style="display: block; margin: 0 auto;" />
  <br>
  <img src="https://raw.githubusercontent.com/vgcouso/ha-tracker/main/docs/images/logo1.png" alt="HA Tracker logo" width="256" style="display: block; margin: 0 auto;" />
</div>

---

# CONTENTS
- [Introducion](#introduction)
- [Requirements](#requirements)
- [Installation](#installation)
  - [HA Tracker](#ha-tracker)
  - [Options](#options)
  - [Device Trackers](#device-trackers)
    - [Home Assistant](#home-assistant)
	- [OwnTracks](#owntracks)
    - [GPSLogger](#gpslogger)
	- [Traccar Client](#traccar-client)
	- [Traccar Server](#traccar-server)	
- [Quick Start](#quick-start)
  - [Screens](#screens)
    - [Users](#users)
    - [Zonas](#zones)
    - [Filters](#filters)
  - [ChatGPT](#chatgpt)
  - [Automations](#automations)
- [Changelog](#changelog)

---

# INTRODUCTION

- **HA Tracker** is an application designed to track the position of registered Home Assistant users who send positions through various **mobile applications**
- You can manage specific zones of the application
- It also allows you to filter positions between two dates, grouped by zone, and obtain a detailed summary with statistics
- It offers a **panel** and a **card** for home assistant as well as a **blueprint** to create **automations**
- It is also integrated with **ChatGPT** using a GPT to query users' positions over time

---

# REQUIREMENTS

To install this integration in Home Assistant, you will need:
- An installation of Home Assistant (see https://www.home-assistant.io/)
- HACS installed in your Home Assistant environment (see https://hacs.xyz/)
- For security, HA Tracker requires Home Assistant to work over **https**. For that you have several alternatives from **"Settings &rarr; Add-ons &rarr; Add-on store"**:
  - **Duck DNS**
  - **Let's Encrypt**
  
  It may be necessary to assign ports 80, 443 and 8123 of the router to the IP of the computer with Home Assistant installed (check the add-ons documentation)

---

# INSTALLATION 

## HA Tracker

The steps to install this integration are as follows:
1. Click [![hacs_badge](https://my.home-assistant.io/badges/hacs_repository.svg)](https://my.home-assistant.io/redirect/hacs_repository/?owner=vgcouso&repository=ha-tracker&category=integration)
2. Click on download and install
3. Restart Home Assistant.
4. Go to: **"Settings &rarr; Devices and Services &rarr; Add Integration"**
5. Search for **HA Tracker**, select it and on the **Configuration screen**, configure **[options](#options)** and press **Send**

You can access the application by opening the panel from the menu on the left or also from a web browser at the address:

   `https://<HOST>/ha-tracker/index.html`

<div align="center">
  <img src="https://raw.githubusercontent.com/vgcouso/ha-tracker/main/docs/images/install.png" alt="Install screen" style="width: 80%; max-width: 100%; height: auto;" />
  <br>
  <em>This is the install screen</em>
</div>

Once HA Tracker is installed a **Custom Card** will be available to place on the panels

<div align="center">
  <img src="https://raw.githubusercontent.com/vgcouso/ha-tracker/main/docs/images/card.png" alt="Card screen" style="width: 80%; max-width: 100%; height: auto;" />
  <br>
  <em>This is the card screen</em>
</div>

By default, Home Assistant stores **10 days**. You can increase this time, but keep in mind that this will increase the database size. It's also best to use **MariaDB** as your database. Here are the **instructions** for **Home Assistant OS** or **Supervised**:
- Go to: **Settings -> Add-ons -> Add-on Store -> MariaDB -> Install**
- Once MariaDB is installed, go to its settings and, under Logins, **enter a password** for the homeassistant user.
- To store **30 days**, add the following to the **"configuration.yaml"** file:

  recorder: <br>
    &nbsp;&nbsp;purge_keep_days: 30 <br>
    &nbsp;&nbsp;auto_purge: true <br>
    &nbsp;&nbsp;db_url: mysql://homeassistant:[PASSWORD]@core-mariadb/homeassistant?charset=utf8mb4 <br>

- Finally, **restart** Home Assistant

**Very important:** This change may increase the disk size of Home Assistant too much.

---

## Options

- **General:**
  Core behavior and units.
  - **Refresh Interval (in seconds):** (Minimum value: 10 seconds) 
    - The time the client uses to update its information from the server
  - **Admin only** 
    - Make the integration accessible only by admin
  - **Enable Debugging:** 
    - Messages in the web browser console (F12 key)
  - **Use imperial units** 
    - Using Imperial Units in HA Tracker	
	
- **Geocoding:**	
  Reverse geocoding parameters.
  - **Geocoding Time (in seconds):** (Minimum value: 10 seconds) 
    - Time between positions to request a person's address from the server
  - **Minimum Distance for Geocoding (in meters):** (Minimum value: 20 meters) 
    - Distance between positions to request a person's address from the server 
		
- **Stops:**
  Stop detection thresholds.
  - **Stop radius (in meters):** (Minimum value: 0 meters) 
    - Radius around which positions are considered stopped. 
	- If the value is 0, stops are not calculated.
  - **Stop time (in seconds):** (Minimum value: 0 seconds) 
    - Time that a position must spend at a point to be considered stopped. 
	- If the value is 0, stops are not calculated.
  - **Reentry gap (in seconds):** (Minimum value: 0 seconds) 
	- If you leave for a moment and return to the same place immediately, it counts as the same stop.
	- If the value is 0, stops are not calculated.
  - **Outside gap (in seconds):** (Minimum value: 0 seconds) 
	- The stop is not closed for an exit less than this time.
	- If the value is 0, stops are not calculated.

  You must adjust these two parameters according to the application used to send the positions and the device on which it is installed.

- **Accuracy:**
  Parameters for considering positions.
  - **GPS accuracy (meters):** (Minimum value: 10 meters) 
    - Positions with a GPS accuracy value greater than this parameter are discarded.
  - **Maximum speed (km/h):** (Minimum value: 100 km/h) 
    - Positions where the speed resulting from dividing space by time is greater than this parameter are discarded.
	
  You must adjust these two parameters according to the application used to send the positions and the device on which it is installed.

- **Anti-spike:**
  It filters out sporadic jumps in positions and uses the five points A->B->C->D->E for its calculation. C is eliminated if, based on the following parameters, it offers a significant change in its position with respect to A->B and D->E.
  - **Factor k:** (Minimum value: 1.5)
    - Detour speed threshold. C is cleared if the speed of section B->C->D is greater than speeds A->B and D->E. The higher the threshold, the fewer peaks are cleared.
  - **Detour ratio:** (Minimum value: 1.1)
    - Generic deviation threshold: (dBC + dCD)/dBD > R. This implies a clear "two-way" response. The higher the threshold, the fewer cases are considered peaks.
  - **Radius (meters):** (Minimum value: 0 meters)
    - Minimum lengths B->C and C->D in meters. Avoid erasing micro-oscillations below the noise level. The higher the value, the fewer peaks are erased.  
    - If the value is 0, Anti-spike is not calculated.
  - **Time (seconds):** (Minimum value: 0 seconds) 
    - Maximum time window in seconds for B->D to be fast. If it takes longer, it's not a spike. The lower the window, the faster the spikes.
    - If the value is 0, Anti-spike is not calculated.

  You must adjust these two parameters according to the application used to send the positions and the device on which it is installed.

- **Sources:**
  Copyable mobile app webhook URLs
  - **OwnTracks webhook URL** 
    - Copy this URL into the OwnTracks app
  - **GPSLogger webhook URL** 
    - Copy this URL into the GPSLogger app
  - **Traccar webhook URL** 
    - Copy this URL into the Traccar app

<br>

The server requests addresses from openstreetmap.org which has a limit of one request per second

Increase Geocoding Time and Minimum Distance for Geocoding if you have many open applications and connected devices

The URLs for OwnTracks and GPSLogger must be **changed** and are used in the mobile apps to access the properties that will connect it to the Home Assistant integration

<br>
  
<div align="center">
  <img src="https://raw.githubusercontent.com/vgcouso/ha-tracker/main/docs/images/options.png" alt="HA Tracker options screen" style="width: 80%; max-width: 100%; height: auto;" />
  <br>
  <em>This is the options screen</em>
</div>

---

## Device Trackers

You must install an app on your smartphone to send managed positions through Home Assistant **integrations**. We'll look at some of them below.

Integrations create Device Trackers in Home Assistant when connected and they are shown in the integration where you can rename them in:  **"Settings &rarr; Devices and Services &rarr; Integration &rarr; Pencil icon next to the device"**

<div align="center">
  <img src="https://raw.githubusercontent.com/vgcouso/ha-tracker/main/docs/images/gpslogger.png" alt="Change name screen" style="width: 80%; max-width: 100%; height: auto;" />
  <br>
  <em>This is the change name screen</em>
</div>

Device Trackers must be assigned to users: **"Settings &rarr; People &rarr; Username &rarr; Devices that belong to this person"**

---

### Home Assistant

Home Assistant for mobile is the official app and is available for both: **[iOS](https://apps.apple.com/es/app/home-assistant/id1099568401)** and **[Android](https://play.google.com/store/apps/details?id=io.homeassistant.companion.android&hl=es_419)** devices. Then:
  - The first thing to do is connect to Home Assistant and give the device a name
  - Then, grant it the permissions it requests 

- Then, assign the device to a person in Home Assistant: **"Settings &rarr; People"**
- In Home Assistant, you'll find connected devices under: **"Settings &rarr; Devices & services &rarr; Mobile App"**

<div align="center">
  <img src="https://raw.githubusercontent.com/vgcouso/ha-tracker/main/docs/images/home-assistant.png" alt="Home Assistant with HA Tracker" style="width: 300px; max-width: 100%; height: auto;" />
  <br>
  <em>This is Home Assistant with HA Tracker</em>
</div>

In **Android** make sure in the **"Settings &rarr; Companion app"** that:
- **Background access** is enabled
- **"Manage sensors &rarr; background location"** is enabled. Here you can activate **High precision mode** (consumes more battery but provides more positions) and define every how many seconds you want to receive positions.

---

### OwnTracks

[OwnTracks](https://owntracks.org/) is an **[iOS](https://apps.apple.com/us/app/owntracks/id692424691)** and **[Android](https://play.google.com/store/apps/details?id=org.owntracks.android)** app designed to send your phone's positions to a URL.

<div align="center">
  <img src="https://raw.githubusercontent.com/vgcouso/ha-tracker/main/docs/images/owntracks.png" alt="OwnTracks screen" style="width: 300px; max-width: 100%; height: auto;" />
  <br>
  <em>This is the OwnTracks screen</em>
</div>

The first thing you need to do is install the **OwnTracks integration**:
  - Go to: **"Settings &rarr; Devices and Services &rarr; Add Integration"**
  - Search for **OwnTracks**, select it. The **configuration screen** will open
  - Press **Send** button and integration will be created

Then you can then install OwnTracks on your devices from **[iOS](https://apps.apple.com/us/app/owntracks/id692424691)** and **[Android](https://play.google.com/store/apps/details?id=org.owntracks.android)**. Then:
  - Allow the permissions that the application requests for its correct operation.
  - On some **Android** versions, restarting your phone requires you to open the app to send positions. Sometimes setting the app to use the **battery without restrictions**, **always allow location** and **allow notifications** fixes it.
  - On some devices you must enable the option to run in the background

To configure the application: [here's a link](https://www.home-assistant.io/integrations/owntracks/)
  - Set a unique **Device ID** and **Tracker ID** for each phone
  - The URL provided to you when setting up the integration can also be found under **"Settings &rarr; Devices & services &rarr; HA TRacker &rarr; Configuration &rarr; Sources"**

- In Home Assistant, you'll find connected devices under **"Settings &rarr; Devices & services &rarr; OwnTracks"**
  - There you can change its name in Home Assistant
- Finally, assign the device to a person in Home Assistant: **"Settings &rarr; People"**

---

### GPSLogger

[GPSLogger](https://gpslogger.app/) is an **Android** app designed to store or send your phone's positions to a URL.

<div align="center">
  <img src="https://raw.githubusercontent.com/vgcouso/ha-tracker/main/docs/images/gpslogger-android.png" alt="GPSLogger Android screen" style="width: 300px; max-width: 100%; height: auto;" />
  <br>
  <em>This is the GPSLogger Android screen</em>
</div>

The first thing you need to do is install the **GPSLogger integration**:
  - Go to: **"Settings &rarr; Devices and Services &rarr; Add Integration"**
  - Search for **GPSLogger**, select it. The **configuration screen** will open.
  - Press **Send** button and integration will be created
 
Then you can then install GPSLogger on your devices through the **F-Droid** Android app store.

<p align="left">
  <a href="https://f-droid.org/packages/com.mendhak.gpslogger">
    <img
      src="https://fdroid.gitlab.io/artwork/badge/get-it-on.png"
      alt="Get it on F-Droid"
      width="200"
    />
  </a>
</p>

To install GpsLogger:
  - Allow the permissions that the application requests for its correct operation.
  - On some **Android** versions, restarting your phone requires you to open the app to send positions. Sometimes setting the app to use the **battery without restrictions**, **always allow location** and **allow notifications** fixes it.
  - On some devices you must enable the option to run in the background
  
To configure the application: [here's a link](https://www.home-assistant.io/integrations/gpslogger/)
  - The URL provided to you when setting up the integration can also be found under **"Settings &rarr; Devices & services &rarr; HA TRacker &rarr; Configuration &rarr; Sources"**

- In Home Assistant, you'll find connected devices under **"Settings &rarr; Devices & services &rarr; GPSLogger"**
  - There you can change its name in Home Assistant
- Finally, assign the device to a person in Home Assistant: **"Settings &rarr; People"**

### Traccar Client

[Traccar Client](https://www.traccar.org/) is an **[iOS](https://apps.apple.com/us/app/traccar-client/id843156974)** and **[Android](https://play.google.com/store/apps/details?id=org.traccar.client)** app designed to send your phone's positions to a URL.

The first thing you need to do is install the **Traccar Client integration**:
  - Go to: **"Settings &rarr; Devices and Services &rarr; Add Integration"**
  - Search for **Traccar Client**, select it. The **configuration screen** will open.
  - Press **Send** button and integration will be created
 
Then you can then install OwnTracks on your devices from **[iOS](https://apps.apple.com/us/app/traccar-client/id843156974))** and **[Android](https://play.google.com/store/apps/details?id=org.traccar.client)**. Then:
  - Allow the permissions that the application requests for its correct operation.
  - On some **Android** versions, restarting your phone requires you to open the app to send positions. Sometimes setting the app to use the **battery without restrictions**, **always allow location** and **allow notifications** fixes it.
  - On some devices you must enable the option to run in the background

To configure the application: [here's a link](https://www.traccar.org/client-configuration/)
  - Set a unique **Device identifier**
  - The URL provided to you when setting up the integration can also be found under **"Settings &rarr; Devices & services &rarr; HA TRacker &rarr; Configuration &rarr; Sources"**

- In Home Assistant, you'll find connected devices under **"Settings &rarr; Devices & services &rarr; OwnTracks"**
  - There you can change its name in Home Assistant
- Finally, assign the device to a person in Home Assistant: **"Settings &rarr; People"**

---  

### Traccar Server
[Traccar Server](https://www.traccar.org/) allows you to view the real-time location of your GPS devices.

In Traccar server you need to create two **Computed Attributes**:
  - For **Battery** with: 
    - Description: "batteryLevel"
	- Attribute: "Battery level"
	- Expression: "batteryLevel"
  - For **Speed** with:
    - Description: "speedMps"
	- Attribute: "Speed"
	- Expression: "speed * 0.514444"
	
These Computed Attributes need to be assigned to groups and/or devices.
	
The first thing you need to do in Home Assistant is install the **Traccar Server integration**:
  - Go to: **"Settings &rarr; Devices and Services &rarr; Add Integration"**
  - Search for **Traccar Server**, select it. The **configuration screen** will open.
  - Complete the fields with those of the Traccar server
  - Press **Send** button and integration will be created
 
- In Home Assistant, you'll find connected devices under **"Settings &rarr; Devices & services &rarr; Traccar Server"**
  - There you can change its name in Home Assistant
- Finally, assign the device to a person in Home Assistant: **"Settings &rarr; People"**

---  
	
# QUICK START

## Screens

### Users

- These are the same ones created in Home Assistant and may have an associated device tracker. In that case, they are displayed on the map.
- If you click on a user on the map, a popup will appear with the information of the last position and a link that directs to Google Maps.

<div align="center">
  <img src="https://raw.githubusercontent.com/vgcouso/ha-tracker/main/docs/images/users.png" alt="HA Tracker users screen" style="width: 80%; max-width: 100%; height: auto;" />
  <br>
  <em>This is the users screen</em>
</div>

---

### Zones

- **Home Assistant zones:** 
  - In these zones, you can only change their visibility and their color on the map. 
  - To change their name, radius, or location, you must do so in Home Assistant.
- **Zones created within the application:**
  - These zones can be moved and have their radius changed.
  - Zones created within the application are visible in Home Assistant but cannot be modified there.
  - The name of the zones must be unique and its size must be less than 30 characters.
  - You can assign a different color to each one.
  - The zone color is used as the background for cells in the user, zone, filter tables, and in the summary of visited zones.

<div align="center">
  <img src="https://raw.githubusercontent.com/vgcouso/ha-tracker/main/docs/images/zones.png" alt="HA Tracker zones screen" style="width: 80%; max-width: 100%; height: auto;" />
  <br>
  <em>This is the zones screen</em>
</div>
<br>
<br>
<div align="center">
  <img src="https://raw.githubusercontent.com/vgcouso/ha-tracker/main/docs/images/zones-dialog.png" alt="HA Tracker dialog in zones" style="width: 80%; max-width: 100%; height: auto;" />
  <br>
  <em>This is the dialog in zones</em>
</div>

---

### Filters

A filter applied to a user within a specific date range displays positions grouped by zone and a summary of the most relevant data.

There are **two tabs** on this screen:
- The **first tab** shows the list of **filtered positions** grouped by the zone in which they were found.
  - In the table with the positions they are grouped by the name of the zone in which they are located and can be expanded by clicking on the triangle icon on the left. 
  - You can filter the positions of a group by clicking on the filter icon to the right of the table. 
  - In this table, you'll also see the **stops** made. To correctly identify them, it's **very important** to adjust the **Speed ​​for stop** value in the server options.
  - Below the table with the positions is a **graph** that runs through the filter from start to finish, showing the zones visited by color, movement (green)/stationary (red), and speed. It also shows the selected row with a vertical blue line. If you click on the graph, the table of positions shows the selected row.
- The **second tab** contains a **summary** of the most relevant **statistics** for the filter and for each zone visited.

On the **map**, the filter is represented by:
- The route with the filter positions on the map appears in green at the start and blue at the end.  
- A Stop icon shows the stops made
- With enough zoom, markers appear that, when pressed, locate the row in the leaderboard.

In addition, there is the possibility of **exporting** the filters made to various file formats.

<div align="center">
  <img src="https://raw.githubusercontent.com/vgcouso/ha-tracker/main/docs/images/filter-calendar.png" alt="HA Tracker calendar on the filter screen" style="width: 80%; max-width: 100%; height: auto;" />
  <br>
  <em>This is the calendar on the filter screen</em>
</div>
<br>
<br>
<div align="center">
  <img src="https://raw.githubusercontent.com/vgcouso/ha-tracker/main/docs/images/filter.png" alt="HA Tracker filter with positions screen" style="width: 80%; max-width: 100%; height: auto;" />
  <br>
  <em>This is the filter with positions screen</em>
</div>
<br>
<br>
<div align="center">
  <img src="https://raw.githubusercontent.com/vgcouso/ha-tracker/main/docs/images/filter-summary.png" alt="HA Tracker summary screen" style="width: 80%; max-width: 100%; height: auto;" />
  <br>
  <em>This is the summary screen</em>
</div>

---

## ChatGPT

- At the moment **GPT for HA Tracker** is in **beta version**
- Due to restrictions set by **Cloudflare**, which acts as a proxy between GPT and your Home Assistant, the number of requests for all users is limited when using the **free** version
- You can find the GPT at this link: **[HA Tracker for Home Assistant](https://chatgpt.com/g/g-68ae8f968b2081918b9f7cb0e170c315-ha-tracker-for-home-assistant)** 
- When you open GPT, it will ask you for your Home Assistant's address, which must be **https**. Also, you **cannot** enter HOST names with port
- Once you have logged into the HOST and clicked the **"Continue"** button, you will be redirected to a screen to log in to your Home Assistant and connect it to the GPT for use.

<div align="center">
  <img src="https://raw.githubusercontent.com/vgcouso/ha-tracker/main/docs/images/gpt.png" alt="Home Assistant URL" style="width: 80%; max-width: 100%; height: auto;" />
  <br>
  <em>This is the screen to enter the Home Assistant URL</em>
</div>

- Within the GPT you can perform a multitude of queries:
  - Give me a summary of what [user] did yesterday
  - Where are the users now?
  - Where was [user] yesterday at 6:00 PM?
  - What zones did [user] visit?
  - What time were you in each area today [user]?
  - Give me [user]'s stops yesterday
  - Give me [user]'s stats for today

---

## Automations

In **"Settings &rarr; Automations & scenes &rarr; Create automation"**, a new **Blueprint** is available called: **"Persons in Zones Alert (HA Tracker)"**

Here you can create new automations that allow you to receive a custom text or voice notification, to the devices you define, when users enter or leave the zones.

<div align="center">
  <img src="https://raw.githubusercontent.com/vgcouso/ha-tracker/main/docs/images/automations.png" alt="Automations screen" style="width: 80%; max-width: 100%; height: auto;" />
  <br>
  <em>This is the automations screen</em>
</div>

---

# CHANGELOG

See the [CHANGELOG](CHANGELOG.md) for details about changes and updates.
