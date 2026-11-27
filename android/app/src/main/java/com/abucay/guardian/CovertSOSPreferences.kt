package com.abucay.guardian

import android.content.Context
import android.view.KeyEvent

/**
 * Persists covert SOS settings in SharedPreferences so native background services,
 * AccessibilityService, and BootReceiver can access them without booting JS first.
 */
object CovertSOSPreferences {
    private const val PREFS_NAME = "abucay_covert_sos_prefs"
    private const val KEY_IS_LOGGED_IN = "is_logged_in"
    private const val KEY_USER_ID = "user_id"
    private const val KEY_SHAKE_ENABLED = "shake_enabled"
    private const val KEY_VOLUME_ENABLED = "volume_pattern_enabled"
    private const val KEY_WEATHER_TAP_ENABLED = "weather_tap_enabled"

    private fun prefs(context: Context) =
        context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    fun saveSettings(
        context: Context,
        isLoggedIn: Boolean,
        userId: String?,
        shakeEnabled: Boolean,
        volumePatternEnabled: Boolean,
        weatherTapEnabled: Boolean
    ) {
        prefs(context).edit()
            .putBoolean(KEY_IS_LOGGED_IN, isLoggedIn)
            .putString(KEY_USER_ID, userId)
            .putBoolean(KEY_SHAKE_ENABLED, shakeEnabled)
            .putBoolean(KEY_VOLUME_ENABLED, volumePatternEnabled)
            .putBoolean(KEY_WEATHER_TAP_ENABLED, weatherTapEnabled)
            .apply()
    }

    fun isLoggedIn(context: Context): Boolean =
        prefs(context).getBoolean(KEY_IS_LOGGED_IN, false)

    fun getUserId(context: Context): String? =
        prefs(context).getString(KEY_USER_ID, null)

    fun isShakeEnabled(context: Context): Boolean =
        prefs(context).getBoolean(KEY_SHAKE_ENABLED, true)

    fun isVolumePatternEnabled(context: Context): Boolean =
        prefs(context).getBoolean(KEY_VOLUME_ENABLED, true)

    fun isWeatherTapEnabled(context: Context): Boolean =
        prefs(context).getBoolean(KEY_WEATHER_TAP_ENABLED, true)

    fun shouldRunBackgroundService(context: Context): Boolean {
        return isLoggedIn(context) && (isShakeEnabled(context) || isVolumePatternEnabled(context))
    }
}

/**
 * Shared sliding-window detector for the covert volume sequence:
 * VOLUME_UP -> VOLUME_UP -> VOLUME_DOWN -> VOLUME_UP within 4.0 seconds.
 */
class VolumePatternMatcher(private val windowMs: Long = 4000L) {
    private val timestamps = mutableListOf<Long>()
    private val sequence = mutableListOf<Int>()

    private val targetPattern = listOf(
        KeyEvent.KEYCODE_VOLUME_UP,
        KeyEvent.KEYCODE_VOLUME_UP,
        KeyEvent.KEYCODE_VOLUME_DOWN,
        KeyEvent.KEYCODE_VOLUME_UP
    )

    @Synchronized
    fun recordPress(keyCode: Int, nowMs: Long = System.currentTimeMillis()): Boolean {
        if (keyCode != KeyEvent.KEYCODE_VOLUME_UP && keyCode != KeyEvent.KEYCODE_VOLUME_DOWN) {
            return false
        }

        while (timestamps.isNotEmpty() && (nowMs - timestamps.first()) > windowMs) {
            timestamps.removeAt(0)
            sequence.removeAt(0)
        }

        timestamps.add(nowMs)
        sequence.add(keyCode)

        if (sequence.size >= targetPattern.size) {
            val tail = sequence.takeLast(targetPattern.size)
            if (tail == targetPattern) {
                timestamps.clear()
                sequence.clear()
                return true
            }
        }
        return false
    }

    @Synchronized
    fun reset() {
        timestamps.clear()
        sequence.clear()
    }
}
