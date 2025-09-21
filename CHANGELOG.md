# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).


## [0.0.32] - 2025-09-21

### Changes
- Possibility to hide zones on the map of both HA Tracker and Home Assistant #29
- Possibility to change the color of Home Assistant zones
- Added Map and Type columns to the Zones screen
- The GPS accuracy in meters is configurable in the options
- The maximum speed of the positions is configurable in the options
- Some device trackers send negative speeds. We set them to 0.
- We round the battery level since some tracker devices send decimals.

### Fixed
- Calculating "Stopped Time" on the Summary tab of the Filter screen


## [0.0.31] - 2025-09-18

### Changes
- Removed the antispike 
- Modified the way stops are calculated
- Added "Open Location" to the Pop-Ups on the Zone and Filter screens

### Fixed
- DB accessed without Recorder executor when querying past location history #28
- Refresh the radius in zones when moving it
- Calculating "Total Time" and "Time per Zone" in the Zones screen summary


## [0.0.30] - 2025-09-15

### Changes
- Added a Custom Card #22
- HA Tracker GPT for ChatGPT (beta version)
- Added a blueprint for creating automations
- Integration with OnwTracks and GPSLogger as device trackers
- Integration with MacroDroid to resolve the issue of OwnTracks starting after rebooting the phone.
- In options, the name used in the URL to download the properties of the OnwTracks and GPSLogger integrations to the mobile
- Column with stops on the Positions tab of the Filter screen
- Column with Auto Filter on the Positions tab of the Filter screen
- The route with the filter positions on the map appears in green at the start and blue at the end.
- Measure distance on the Summary tab of the Filter screen
- Added a link in the user popup to show the position on Google Maps
- On the map you can search for places
- On the filter screen there are three buttons to filter positions for today, yesterday or custom between two dates and times
- Changed the way to obtain the Home Assistant token for panels and cards
- Minified Javascript in the dist/ha-tracker.js file
- Automatic versioning in index.html, styles.css and ha-tracker.js 
- Geocoding is now done on the server that caches the addresses
- Changed the default Alert, Confirm and Prompt windows
- Changed the date/time picker in the filter window 
- Zones can be assigned a color that will be used when drawing them on the map and as a background on table lines
- The name of the zones must be unique and its size must be less than 30 characters
- Possibility of exporting filters to various file formats
- Do not show users without device tracker #26
- Updated README.md with all the changes in this version

### Fixed
- If HA Tracker is not active, it does not update to save resources.
- Excessive page reloads in HA Tracker panel. Now not reload
- Notifications with: "Login attempt or request with invalid authentication..."
- Problems with some characters in zone names when creating and modifying zones
- OpenStreetMaps not showing tiles anymore, only message: https://wiki.openstreetmap.org/wiki/Blocked_tiles #27


## [0.0.29] - 2025-06-30

### Changes
- Changed the README.md file to update the update from HACS


## [0.0.28] - 2025-06-26

### Changes
- version for HACS


## [0.0.27] - 2025-06-26

### Changes
- version for HACS


## [0.0.26] - 2025-06-26

### Changes
- version for HACS


## [0.0.25] - 2025-06-07

### Fixed
- Reload of panel
- If the website is not active, it does not update to save resources.


## [0.0.24] - 2025-05-25

### Added
- If the website is not active, it does not update to save resources.
- Default Filter settings #8
- Use default theme colors #2
- Make the integration accessible only by admin or selected users  #7
- Dashboard menu integration #3
- Measurement unit options: imperial or metric #11

### Fixed
- Speed value is metres per second and not km/hr #14
- Support users with multiple trackers #12


## [0.0.23] - 2025-02-21

### Fixed
- No Users in the normal Person menu #6
- Object NoneType can't be used in 'await' expression #5


## [0.0.22] - 2025-02-20

### Fixed
- HA Tracker won't load after creating new zones #4
  (Zones with non-alphanumeric names)


## [0.0.21] - 2025-02-15

### Added
- Remove non-relevant positions when filtering.

### Fixed
- Installation from Home Assistant integration
- Register zones in Home assistant when integrating and unregister when uninstalled
- Token renewal


## [0.0.20] - 2025-02-08

### Added
- Version for HACS


## [0.0.19] - 2025-02-08

### Fixed
- Some bugs in instalation files


## [0.0.18] - 2025-02-08

### Fixed
- Some bugs in translations and instalation files


## [0.0.17] - 2025-02-08

### Added
- Files removed when integration is uninstalled
- Add HA Tracker Dashboard after installing the integration

### Fixed
- Getting addresses on the user screen


## [0.0.16] - 2025-02-06

### Added
- Sorting in tables.
- Installation from: "Settings &rarr; Devices and Services &rarr; Add Integration". 
- Icon in HACS and in Integrations
- Translations for the options configuration screen.
- Changed the installation process in README.md


## [0.0.15] - 2025-02-01

### Added
- We get the address from: https://nominatim.openstreetmap.org

### Fixed
- Installing the application


## [0.0.14] - 2025-01-31

### Added
- Battery on the user screen and popups
- Address on the user screen
- Changes in README.md
- Changes in css
- Changes in translations

### Fixed
- Every time HA Tracker was updated, the zones were deleted
- zIndex of the markers


## [0.0.13] - 2025-01-30

### Added
- New screen with Home Assistant users
- Adjust map zoom on startup
- We changed the text of the filter and popups with the users
- Added translations
- Changes in css

### Fixed
- Check the connection with Home Assistant
- The line **ha_tracker** of `configuration.yaml` in README.md


## [0.0.12] - 2025-01-27

### Added
- Added translations
- Changes in css

### Fixed
- Text in popups
- Images in README.md


## [0.0.11] - 2025-01-27

### Added
- Support for multiple languages
- Visual improvements

### Fixed
- Installation


## [0.0.1] - 2025-01-25

### Added
- First version of the project.
- Initial user interface with support for zones and filters.
- API for devices, filters and zones in Home Assistant.
