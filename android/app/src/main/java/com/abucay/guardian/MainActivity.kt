package com.abucay.guardian
import expo.modules.splashscreen.SplashScreenManager

import android.app.KeyguardManager
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.view.KeyEvent
import android.view.WindowManager

import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.ReactApplication
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate
import com.facebook.react.modules.core.DeviceEventManagerModule

import expo.modules.ReactActivityDelegateWrapper

class MainActivity : ReactActivity() {
  // Covert volume pattern state: UP -> UP -> DOWN -> UP within 4.0 seconds
  private val volumeMatcher = VolumePatternMatcher()
  private var suppressNextUpKeyCode: Int? = null

  override fun dispatchKeyEvent(event: KeyEvent): Boolean {
    val keyCode = event.keyCode
    if (keyCode == KeyEvent.KEYCODE_VOLUME_UP || keyCode == KeyEvent.KEYCODE_VOLUME_DOWN) {
      // Let AccessibilityService handle hardware keys globally without double-counting when enabled
      if (CovertVolumeAccessibilityService.isRunning) {
        return super.dispatchKeyEvent(event)
      }

      if (!CovertSOSPreferences.isLoggedIn(this) || !CovertSOSPreferences.isVolumePatternEnabled(this)) {
        volumeMatcher.reset()
        suppressNextUpKeyCode = null
        return super.dispatchKeyEvent(event)
      }

      // Consume the key-up event matching our suppressed final trigger press
      if (event.action == KeyEvent.ACTION_UP && suppressNextUpKeyCode == keyCode) {
        suppressNextUpKeyCode = null
        return true
      }

      // Only count fresh physical presses (ignore key-hold auto-repeats)
      if (event.action == KeyEvent.ACTION_DOWN && event.repeatCount == 0) {
        if (volumeMatcher.recordPress(keyCode)) {
          suppressNextUpKeyCode = keyCode
          if (!CovertSOSDispatcher.dispatchCovertSOS(this, "volume")) {
            emitCovertVolumeEvent()
          }
          return true // Consumes the event to suppress the Android system volume slider HUD
        }
      }
    }
    return super.dispatchKeyEvent(event)
  }

  private fun emitCovertVolumeEvent() {
    try {
      // Primary: emit through registered ReactApplicationContext (reliable in Bridgeless & New Architecture)
      if (EmergencyAudioModule.emitCovertVolumeEvent()) {
        return
      }
      // Fallback: ReactApplication.reactHost / reactInstanceManager
      val context = (application as? ReactApplication)?.reactHost?.currentReactContext
        ?: try { reactInstanceManager?.currentReactContext } catch (_: Throwable) { null }
      context
        ?.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
        ?.emit("onCovertVolumeSOS", null)
    } catch (_: Throwable) {}
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    // Set the theme to AppTheme BEFORE onCreate to support
    // coloring the background, status bar, and navigation bar.
    // This is required for expo-splash-screen.
    // setTheme(R.style.AppTheme);
    // @generated begin expo-splashscreen - expo prebuild (DO NOT MODIFY) sync-f3ff59a738c56c9a6119210cb55f0b613eb8b6af
    SplashScreenManager.registerOnActivity(this)
    // @generated end expo-splashscreen
    super.onCreate(null)
    wakeUpScreen()
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    setIntent(intent)
    wakeUpScreen()
  }

  private fun wakeUpScreen() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
      setShowWhenLocked(true)
      setTurnScreenOn(true)
      val keyguardManager = getSystemService(Context.KEYGUARD_SERVICE) as? KeyguardManager
      keyguardManager?.requestDismissKeyguard(this, null)
    } else {
      @Suppress("DEPRECATION")
      window.addFlags(
        WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
        WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD or
        WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
      )
    }

    window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

    // Force hardware screen wake-up when triggered while minimized/locked
    val powerManager = getSystemService(Context.POWER_SERVICE) as? PowerManager
    if (powerManager != null && !powerManager.isInteractive) {
      @Suppress("DEPRECATION")
      val wakeLock = powerManager.newWakeLock(
        PowerManager.FULL_WAKE_LOCK or
        PowerManager.ACQUIRE_CAUSES_WAKEUP or
        PowerManager.ON_AFTER_RELEASE,
        "EmergencyApp:AlertWakeLock"
      )
      wakeLock.acquire(10000) // Wakes screen for 10 seconds
    }
  }

  /**
   * Statically reference raw sound resources so Android R8 / ProGuard never prune them.
   */
  @Suppress("UNUSED_VARIABLE")
  private fun keepSoundResources() {
    val _alert = R.raw.alert
    val _notif = R.raw.notif
  }

  /**
   * Returns the name of the main component registered from JavaScript. This is used to schedule
   * rendering of the component.
   */
  override fun getMainComponentName(): String = "main"

  /**
   * Returns the instance of the [ReactActivityDelegate]. We use [DefaultReactActivityDelegate]
   * which allows you to enable New Architecture with a single boolean flags [fabricEnabled]
   */
  override fun createReactActivityDelegate(): ReactActivityDelegate {
    return ReactActivityDelegateWrapper(
          this,
          BuildConfig.IS_NEW_ARCHITECTURE_ENABLED,
          object : DefaultReactActivityDelegate(
              this,
              mainComponentName,
              fabricEnabled
          ){})
  }

  /**
    * Prevent app from closing / finishing when the user presses back.
    * Moves the task to the background instead of destroying the activity.
    */
  override fun invokeDefaultOnBackPressed() {
      if (!moveTaskToBack(true)) {
          super.invokeDefaultOnBackPressed()
      }
  }
}
