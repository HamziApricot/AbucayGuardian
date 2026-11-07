# Add project specific ProGuard rules here.
# By default, the flags in this file are appended to flags specified
# in /usr/local/Cellar/android-sdk/24.3.3/tools/proguard/proguard-android.txt
# You can edit the include path and order by changing the proguardFiles
# directive in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# React Native Core & TurboModules
-keep class com.swmansion.reanimated.** { *; }
-keep class com.facebook.react.turbomodule.** { *; }
-keep class com.facebook.react.bridge.** { *; }

# Notifee (Full-Screen Intents & Notifications)
-keep class app.notifee.** { *; }
-keep class com.facebook.react.modules.core.DeviceEventManagerModule$RCTDeviceEventEmitter { *; }

# MapLibre Native 3D Maps
-keep class org.maplibre.android.** { *; }
-keep class com.maplibre.** { *; }
-dontwarn org.maplibre.android.**

# Expo Modules & Notifications
-keep class expo.modules.** { *; }
-keep class expo.modules.notifications.** { *; }
-keep class expo.modules.intentlauncher.** { *; }

# Background Geolocation
-keep class com.transistorsoft.locationmanager.** { *; }
-dontwarn com.transistorsoft.locationmanager.**
