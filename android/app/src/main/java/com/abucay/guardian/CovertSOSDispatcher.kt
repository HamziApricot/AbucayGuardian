package com.abucay.guardian

import android.content.Context
import android.content.Intent
import android.util.Log
import androidx.core.content.ContextCompat
import com.facebook.react.HeadlessJsTaskService

/**
 * Single native dispatch coordinator for covert SOS triggers (volume, accessibility).
 * Enforces a shared 10-second cooldown and wakes the JS HeadlessJsTask without ever
 * launching MainActivity, waking the screen, or playing sound/vibration.
 */
object CovertSOSDispatcher {
    private const val TAG = "CovertSOSDispatcher"
    private const val COOLDOWN_MS = 10_000L

    @Volatile
    private var lastDispatchTimeMs = 0L

    @Synchronized
    fun dispatchCovertSOS(context: Context, source: String): Boolean {
        val appContext = context.applicationContext

        if (!CovertSOSPreferences.isLoggedIn(appContext)) {
            Log.d(TAG, "Skipped ($source): user not logged in")
            return false
        }
        if (source == "volume" && !CovertSOSPreferences.isVolumePatternEnabled(appContext)) {
            Log.d(TAG, "Skipped (volume): disabled in covert settings")
            return false
        }

        val now = System.currentTimeMillis()
        if (now - lastDispatchTimeMs < COOLDOWN_MS) {
            Log.d(TAG, "Skipped ($source): native cooldown active")
            return false
        }
        lastDispatchTimeMs = now

        return startHeadlessSOSTask(appContext, source, null)
    }

    @Synchronized
    fun dispatchCrashSOS(
        context: Context,
        lat: Double?,
        lng: Double?,
        speedKmh: Double,
        gForce: Double
    ): Boolean {
        val appContext = context.applicationContext
        if (!CovertSOSPreferences.isLoggedIn(appContext)) {
            Log.d(TAG, "Skipped crash SOS: user not logged in")
            return false
        }
        lastDispatchTimeMs = System.currentTimeMillis()
        val extras = mapOf(
            "crashSpeedKmh" to speedKmh,
            "crashGForce" to gForce,
            "crashLat" to lat,
            "crashLng" to lng
        )
        return startHeadlessSOSTask(appContext, "crash", extras)
    }

    private fun startHeadlessSOSTask(
        appContext: Context,
        source: String,
        crashExtras: Map<String, Double?>?
    ): Boolean {
        return try {
            HeadlessJsTaskService.acquireWakeLockNow(appContext)
            val taskIntent = Intent(appContext, CovertSOSHeadlessTaskService::class.java).apply {
                putExtra(CovertSOSHeadlessTaskService.EXTRA_SOURCE, source)
                crashExtras?.let { map ->
                    (map["crashSpeedKmh"])?.let { putExtra(CovertSOSHeadlessTaskService.EXTRA_CRASH_SPEED_KMH, it) }
                    (map["crashGForce"])?.let { putExtra(CovertSOSHeadlessTaskService.EXTRA_CRASH_GFORCE, it) }
                    (map["crashLat"])?.let { putExtra(CovertSOSHeadlessTaskService.EXTRA_CRASH_LAT, it) }
                    (map["crashLng"])?.let { putExtra(CovertSOSHeadlessTaskService.EXTRA_CRASH_LNG, it) }
                }
            }

            try {
                appContext.startService(taskIntent)
            } catch (bgEx: IllegalStateException) {
                // Fallback for Android 12+ if the foreground monitor service wasn't active yet
                taskIntent.putExtra(CovertSOSHeadlessTaskService.EXTRA_USE_FOREGROUND, true)
                ContextCompat.startForegroundService(appContext, taskIntent)
            }

            Log.i(TAG, "Dispatched SilentSOSTask headlessly for source=$source")
            true
        } catch (t: Throwable) {
            Log.w(TAG, "Failed to dispatch SilentSOSTask: ${t.message}")
            false
        }
    }
}
