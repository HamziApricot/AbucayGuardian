package com.abucay.guardian

import android.content.Context
import android.content.Intent
import android.util.Log
import androidx.core.content.ContextCompat
import com.facebook.react.HeadlessJsTaskService

/**
 * Single native dispatch coordinator for all covert SOS triggers (shake, volume, accessibility).
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
        if (source == "shake" && !CovertSOSPreferences.isShakeEnabled(appContext)) {
            Log.d(TAG, "Skipped (shake): disabled in covert settings")
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

        return try {
            HeadlessJsTaskService.acquireWakeLockNow(appContext)
            val taskIntent = Intent(appContext, CovertSOSHeadlessTaskService::class.java).apply {
                putExtra(CovertSOSHeadlessTaskService.EXTRA_SOURCE, source)
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
