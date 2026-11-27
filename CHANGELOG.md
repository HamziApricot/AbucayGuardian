# Changelog

All notable changes to **Abucay Guardian** are documented in this file.

## [1.0.1] - 2026-11-27

### Added
- **Native Emergency Overlay Popup (`EmergencyPopupManager.kt`)**: Added native Android overlay popup handling (`launchEmergencyPopupOverlay`, `dismissEmergencyPopupOverlay`, `consumePendingEmergencyAlert`) and background/minimized SOS alert synchronization in `App.tsx`, `index.js`, `MainActivity.kt`, and `EmergencyNotificationService.ts` so incoming SOS alerts surface reliably even when the app is minimized or launched from the background.
- **Shared Map Marker Visuals (`MarkerVisuals.tsx`)**: Added reusable `HeadingBeamSvg` (`108×108` radial-gradient FOV sector + white-outlined directional chevron) and `PinPointerTipSvg` components.
- **Native Permission Verification (`EmergencyAudioService.ts`, `PermissionsOnboardingScreen.tsx`)**: Added direct Android checks (`isOverlayPermissionGranted`, `isBatteryOptimizationIgnored`) during permissions onboarding.

### Changed & Improved
- **Emergency SOS Map Markers & Heading Indicators (`FamilyMapNative3D.tsx`, `FamilyMapExpo.tsx`)**:
  - Centered the directional heading cone and chevron around the avatar hub (`avatarAnchor`) strictly outside the `52×52` double-ring profile halo (`avatarFrame` + `avatarColorRing`) so indicators no longer overlap faces in profile photos.
  - Added a pulsing red emergency beacon (`sosPulseRing`) and top-right SOS alert badge (`sosMarkerBadge`) for members with an active SOS state.
  - Moved the live online status dot (`statusDot`) to the top-right corner of the avatar ring and stacked the live battery percentage pill cleanly above the bottom pin pointer tip (`bottomPinStack`) to eliminate overlap.
- **Faster 1-on-1 Batch Emergency SMS (`DirectSMSModule.kt`, `EmergencySMSService.ts`, `supabase/functions/send-emergency-sms/index.ts`)**:
  - Updated native SMS dispatch to deduplicate recipients and send individual 1-on-1 SMS messages asynchronously on a background executor (`smsExecutor`) instead of creating group MMS threads.
  - Updated the `send-emergency-sms` Supabase Edge Function to process recipient requests in parallel batches (`Promise.allSettled`).
- **Full-Screen Splash Screen Flow (`App.tsx`, `app.json`, `styles.xml`, `ic_launcher_background.xml`)**:
  - Integrated `expo-splash-screen` (`preventAutoHideAsync`) with image `onLoad` synchronization and updated native `splashscreen_icon.png` assets so startup transitions smoothly without clipped logos or blank cloud frames.
- **Version Sync (`app.json`, `package.json`, `android/app/build.gradle`)**:
  - Aligned app version to `1.0.1` and Android `versionCode` to `2` (`build.gradle` & `app.json`).

### Fixed
- **Silent SOS Sender Name Resolution (`AuthContext.tsx`, `SilentSOSService.ts`, `EmergencyNotificationService.ts`, `FamilyTrackerScreen.tsx`)**: Resolved actual member names (falling back to matched family location/profile metadata) instead of displaying generic `"Family Member"` labels on silent SOS alerts and incoming distress toasts.

---

## [1.0.0] - Initial Baseline (`v1.0.0`)
- Real-time 3D/Expo family location tracking, covert SOS triggers, background location tracking, direct emergency SMS, and NDRRMC-style emergency alert workflows.
