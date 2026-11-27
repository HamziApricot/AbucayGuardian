package com.abucay.guardian

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import com.facebook.react.HeadlessJsTaskService
import com.facebook.react.bridge.Arguments
import com.facebook.react.jstasks.HeadlessJsTaskConfig

/**
 * Executes the JS `SilentSOSTask` headlessly while holding a partial wake lock,
 * allowing covert SOS dispatch (GPS, Supabase, Push, Direct SMS) to complete
 * reliably even when the app is minimized, screen is locked, or Activity is closed.
 */
class CovertSOSHeadlessTaskService : HeadlessJsTaskService() {
    companion object {
        const val TASK_NAME = "SilentSOSTask"
        const val EXTRA_SOURCE = "source"
        const val EXTRA_USE_FOREGROUND = "use_foreground"
        private const val TASK_TIMEOUT_MS = 30_000L
        private const val FALLBACK_NOTIFICATION_ID = 91103
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.getBooleanExtra(EXTRA_USE_FOREGROUND, false) == true) {
            promoteSilentForeground()
        }
        return super.onStartCommand(intent, flags, startId)
    }

    override fun getTaskConfig(intent: Intent?): HeadlessJsTaskConfig? {
        val source = intent?.getStringExtra(EXTRA_SOURCE) ?: "manual"
        val data = Arguments.createMap().apply {
            putString("source", source)
        }
        // allowedInForeground = true allows uniform execution whether app is open, minimized, or locked
        return HeadlessJsTaskConfig(
            TASK_NAME,
            data,
            TASK_TIMEOUT_MS,
            true
        )
    }

    private fun promoteSilentForeground() {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                val nm = getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager
                if (nm != null && nm.getNotificationChannel(CovertSOSService.CHANNEL_ID) == null) {
                    val channel = NotificationChannel(
                        CovertSOSService.CHANNEL_ID,
                        "Covert Safety Trigger Monitor",
                        NotificationManager.IMPORTANCE_MIN
                    ).apply {
                        setSound(null, null)
                        enableVibration(false)
                        enableLights(false)
                        setShowBadge(false)
                        lockscreenVisibility = Notification.VISIBILITY_SECRET
                    }
                    nm.createNotificationChannel(channel)
                }
            }

            val notification = NotificationCompat.Builder(this, CovertSOSService.CHANNEL_ID)
                .setContentTitle("Abucay Guardian")
                .setContentText("Background safety monitor active")
                .setSmallIcon(R.drawable.notification_icon)
                .setPriority(NotificationCompat.PRIORITY_MIN)
                .setSilent(true)
                .setOngoing(true)
                .setVisibility(NotificationCompat.VISIBILITY_SECRET)
                .build()

            startForeground(FALLBACK_NOTIFICATION_ID, notification)
        } catch (_: Throwable) {}
    }
}
