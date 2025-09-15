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

   `https://<HOST>/local/ha-tracker/index.html`

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
  - **Refresh Interval (in seconds):** (Minimum value: 10 seconds) 
    - The time the client uses to update its information from the server
  - **Admin only** 
    - Make the integration accessible only by admin
  - **Enable Debugging:** 
    - Messages in the web browser console (F12 key)
  - **Use imperial units** 
    - Using Imperial Units in HA Tracker	
	
- **Geocoding:**	
  - **Geocoding Time (in seconds):** (Minimum value: 10 seconds) 
    - Time between positions to request a person's address from the server
  - **Minimum Distance for Geocoding (in meters):** (Minimum value: 20 meters) 
    - Distance between positions to request a person's address from the server 
		
- **Stops:**
  - **Stop radius (in meters):** (Minimum value: 0 meters) 
    - Radius around which positions are considered stopped. 
  - **Stop time (in seconds):** (Minimum value: 0 seconds) 
    - Time that a position must spend at a point to be considered stopped. 
	
  You must adjust these two parameters according to the application used to send the positions and the device on which it is installed.

  If either value is 0, stops are not calculated.
	
- **Anti-Spike:**
  - **Anti-Spike Radius (in meters):** (Minimum value: 0 meters) 
    - It is the minimum radius that determines which positions, around a central point, are discarded over a period of time.
  - **Anti-Spike Time (in seconds):** (Minimum value: 0 seconds) 
    - It is the maximum time within which positions that escape the minimum radius are discarded.

  You must adjust these two parameters according to the application used to send the positions and the device on which it is installed.

  If either value is 0, the Anti-Spike stops are not calculated.
	
- **Sources:**
  - **OwnTracks URL** 
    - Only lowercase letters and numbers are accepted. 
  - **GPSLogger URL** 
    - Only lowercase letters and numbers are accepted. 
  
  The values ​​of both must be different.
  
  **Important:** For **security** reasons, you must **change** the value of these two fields.

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

The first thing you need to do is install the Home Assistant integration:
 - Go to: **"Settings &rarr; Devices and Services &rarr; Add Integration"**
 - Search for **OwnTracks**, select it. The **configuration screen** will open.
 - If you want to manually configure the application on your mobile, write down the information provided on this screen in a safe place.
 - Press **Send** button and integration will be created
 
Before installing OwnTracks on your devices you can download the properties file called **"ha-tracker.otrc"** (if you want to make it automatic) from:

   `https://<HOST>/api/ha-tracker/<OwnTracks URL in options of HA Tracker>`

Then you can then install OwnTracks on your devices from **[iOS](https://apps.apple.com/us/app/owntracks/id692424691)** and **[Android](https://play.google.com/store/apps/details?id=org.owntracks.android)**. Then:
- Allow the permissions that the application requests for its correct operation
- In **Android**:
  - In **Preferences &rarr; Connection &rarr; Identification** set a unique **Device ID** and **Tracker ID** for each phone
  - In **Preferences &rarr; Configuration management &rarr; Import (top right menu)** open the previously downloaded file with the properties and accept (top right check). If you do not want to import the properties, you can do so manually using the data provided during the integration installation.
  - In sending positions it is configured at 30 seconds but if you have many devices it would be convenient to increase this time in: **Menu &rarr; Preferences &rarr; location interval**
- In **iOS**:
  - Locate the downloaded **"ha-tracker.otrc"** file and open it with OwnTracks to import the properties. If you do not want to import the properties, you can do so manually using the data provided during the integration installation.
  - In OwnTracks, click the icon with an "i" in the top left corner. In Parameters, open Settings and set a unique **DeviceID** and **UserID** for each phone
  - In sending positions it is configured at 30 seconds but if you have many devices it would be convenient to increase this time in: **i &rarr; Settings &rarr; locatorInterval**

- Finally, assign the device to a person in Home Assistant: **"Settings &rarr; People"**
- In Home Assistant, you'll find connected devices under **"Settings &rarr; Devices & services &rarr; OwnTracks"**

On some **Android** versions, restarting your phone requires you to open the app to send positions. 
- Sometimes setting the app to use the **battery without restrictions**, **always allow location** and **allow notifications** fixes it.
- You can also try the **MacroDroid** app after installing OwnTracks to resolve this. In the app you can download the file **"owntracks.macro"** with the macro that solves it from:

   `https://<HOST>/api/ha-tracker/macrodroid`
   
You can also configure the macro yourself manually: 
- Starts when the phone is turned on
- Pauses for one second when you turn on your phone
- Launches OwnTracks
- Pauses for another second
- Press the back key to hide OwnTracks

To send positions, on the map screen, in the top left icon, you can select between:
- **Significant Changes:** which saves battery but sends positions less frequently.
- **Travel:** which uses more battery but sends positions more often.

---

### GPSLogger

[GPSLogger](https://gpslogger.app/) is an **Android** app designed to store or send your phone's positions to a URL.

<div align="center">
  <img src="https://raw.githubusercontent.com/vgcouso/ha-tracker/main/docs/images/gpslogger-android.png" alt="GPSLogger Android screen" style="width: 300px; max-width: 100%; height: auto;" />
  <br>
  <em>This is the GPSLogger Android screen</em>
</div>

The first thing you need to do is install the Home Assistant integration:
 - Go to: **"Settings &rarr; Devices and Services &rarr; Add Integration"**
 - Search for **GPSLogger**, select it. The **configuration screen** will open.
 - If you want to manually configure the application on your mobile, write down the information provided on this screen in a safe place.
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

Allow the permissions that the application requests for its correct operation.

In the phone app, if you tap in the top left corner: **"Menu &rarr; profile name"**, the default settings for GPSLogger to connect to Home Assistant (if you want to make it automatic) will be available at the URL:

   `https://<HOST>/api/ha-tracker/<GPSLogger URL in options of HA Tracker>`

- If you do not want to import the properties, you can do so manually using the data provided during the integration installation.
- In sending positions it is configured at 30 seconds but if you have many devices it would be convenient to increase this time in: **Menu &rarr; Performance &rarr; Logging interval**
  
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

- **Home Assistant zones** They cannot be edited and are shown on the map and in the table in red.
- **Zones created within the application**, with admin permissions.
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
- The **second tab** contains a **summary** of the most relevant **statistics** for the filter.

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
