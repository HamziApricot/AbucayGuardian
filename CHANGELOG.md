# Changelog

All notable changes to **Abucay Guardian** are documented in this file.

## [2.0.0] - 2026-11-28

### Added
- **In-App Auto-Updater & Installer (`AppUpdaterModule.kt`, `AppUpdateService.ts`, `UpdatePromptModal.tsx`, `App.tsx`, `ProfileScreen.tsx`)**:
  - Automatically checks GitHub Releases (`releases/latest`) on startup and adds a manual **App Updates** check row in `ProfileScreen`.
  - Displays an update modal with version comparison, APK size, release notes preview, live download progress bar, automatic redirect/stream download into cached storage, *"Install unknown apps"* permission handling with auto-resume on return, and direct system APK installer launch via `FileProvider`.
- **`"SOS sent"` Toast Confirmation (`SilentSOSService.ts`, `App.tsx`, `SOSScreen.tsx`)**:
  - Added an `"SOS sent"` toast dialogue after SOS dispatch completes—shown in-app via `CustomToast` when active (`onSilentSOSSent` in `GlobalEmergencyWatcher` and `triggerSOS` on `SOSScreen`), and via Android `ToastAndroid` when Silent SOS triggers in the background or while minimized.

### Changed & Improved
- **Premium Avatar Map Markers & 3D Compass Indicator (`MarkerVisuals.tsx`, `FamilyMapNative3D.tsx`, `FamilyMapExpo.tsx`)**:
  - Upgraded the compass indicator (`HeadingBeamSvg` `136×136`) with a dual-layer radial FOV cone (wide outer peripheral beam + focused center ray), precision hairline orbit ring, and white-rimmed beveled 3D directional dart strictly outside the avatar bezel.
  - Upgraded profile markers (`AvatarPinHub`) to a triple-ring porcelain bezel (`56×56`), accent ring, crisp inner white portrait mat, translucent selection halo, elevated red SOS pulse beacon (`sosPulseRing`), top-right status/SOS alert badges, live battery capsule, and teardrop ground-anchored pointer (`PinPointerTipSvg`).
- **Updated Silent SOS Volume Sequence (`CovertSOSPreferences.kt`, `CovertSOSService.kt`, `MainActivity.kt`, `CovertVolumeAccessibilityService.kt`, `strings.xml`, `useCovertVolume.ts`, `DisguisedCalculator.tsx`, `PermissionsOnboardingScreen.tsx`)**:
  - Changed the covert hardware volume trigger sequence to **`UP → DOWN → UP → DOWN → UP → DOWN`** (6 alternating presses within a 5.0-second window).
- **Version Bump (`app.json`, `package.json`, `package-lock.json`, `android/app/build.gradle`)**:
  - Updated app version to `2.0.0` and Android `versionCode` to `4`.

### Fixed & Removed
- **Removed Shake-to-SOS Trigger (`useCovertShake.ts` removed, `App.tsx`, `SilentSOSService.ts`, `CovertSOSService.kt`, `CovertSOSPreferences.kt`, `CovertSOSModule.kt`, `CovertSOSDispatcher.kt`, `AndroidManifest.xml`, `DisguisedCalculator.tsx`, `ProfileScreen.tsx`)**:
  - Removed 3-spike accelerometer shake detection, settings toggles, and background accelerometer/WakeLock overhead to eliminate accidental SOS alerts caused by everyday phone movement or shaking.
- **Background Volume Broadcast Debouncing (`CovertSOSService.kt`)**:
  - Scoped `VOLUME_EVENT_DEBOUNCE_MS` by key direction (`keyCode == lastVolumeBroadcastKeyCode`) so simultaneous system stream updates remain deduplicated without dropping rapid alternating `UP`/`DOWN` presses.
- **Duplicate Update Row Cleanup (`ProfileScreen.tsx`)**:
  - Cleaned up `ProfileScreen` layout and synced `System Version` display dynamically with `getCurrentAppVersion()`.

---

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
