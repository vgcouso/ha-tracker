# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).


## [0.0.29] - 2025-06/30

### Changes
- Changed the README.md file to update the update from HACS


## [0.0.28] - 2025-06/26

### Changes
- version for HACS


## [0.0.27] - 2025-06/26

### Changes
- version for HACS


## [0.0.26] - 2025-06/26

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
