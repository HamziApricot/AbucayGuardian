package com.abucay.guardian

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.media.AudioManager
import android.os.Build
import android.os.IBinder
import android.util.Log
import android.view.KeyEvent
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat

/**
 * 24/7 Foreground Service keeping the covert hardware volume SOS trigger active
 * even when the app is minimized:
 * Background volume-change sequence detection (UP -> DOWN -> UP -> DOWN -> UP -> DOWN).
 */
class CovertSOSService : Service() {
    companion object {
        private const val TAG = "CovertSOSService"
        const val CHANNEL_ID = "guardian_covert_sos_channel"
        private const val NOTIFICATION_ID = 91102
        const val ACTION_REFRESH_CONFIG = "com.abucay.guardian.ACTION_REFRESH_COVERT_CONFIG"

        private const val VOLUME_CHANGED_ACTION = "android.media.VOLUME_CHANGED_ACTION"
        private const val EXTRA_VOLUME_STREAM_TYPE = "android.media.EXTRA_VOLUME_STREAM_TYPE"
        private const val EXTRA_VOLUME_STREAM_VALUE = "android.media.EXTRA_VOLUME_STREAM_VALUE"
        private const val EXTRA_PREV_VOLUME_STREAM_VALUE = "android.media.EXTRA_PREV_VOLUME_STREAM_VALUE"
        private const val VOLUME_EVENT_DEBOUNCE_MS = 120L

        @Volatile
        var isRunning: Boolean = false
            private set

        fun startOrUpdate(context: Context) {
            val appContext = context.applicationContext
            if (!CovertSOSPreferences.shouldRunBackgroundService(appContext)) {
                stop(appContext)
                return
            }
            val intent = Intent(appContext, CovertSOSService::class.java).apply {
                action = ACTION_REFRESH_CONFIG
            }
            try {
                ContextCompat.startForegroundService(appContext, intent)
            } catch (t: Throwable) {
                Log.w(TAG, "Unable to start CovertSOSService: ${t.message}")
            }
        }

        fun stop(context: Context) {
            try {
                context.applicationContext.stopService(Intent(context.applicationContext, CovertSOSService::class.java))
            } catch (_: Throwable) {}
        }
    }

    private val volumeMatcher = VolumePatternMatcher()
    private var lastVolumeBroadcastMs = 0L
    private var lastVolumeBroadcastKeyCode: Int? = null
    private var isVolumeReceiverRegistered = false

    private val volumeReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent?) {
            if (intent?.action != VOLUME_CHANGED_ACTION) return
            if (!CovertSOSPreferences.isLoggedIn(context) || !CovertSOSPreferences.isVolumePatternEnabled(context)) {
                return
            }
            // AccessibilityService handles physical KeyEvents directly when enabled (including lock screen & min/max bounds)
            if (CovertVolumeAccessibilityService.isRunning) {
                return
            }

            val streamType = intent.getIntExtra(EXTRA_VOLUME_STREAM_TYPE, -1)
            // Ignore internal alarm / voice call / accessibility / DTMF stream shifts
            if (streamType == AudioManager.STREAM_ALARM ||
                streamType == AudioManager.STREAM_VOICE_CALL ||
                streamType == AudioManager.STREAM_DTMF ||
                streamType == AudioManager.STREAM_ACCESSIBILITY
            ) {
                return
            }

            val newVal = intent.getIntExtra(EXTRA_VOLUME_STREAM_VALUE, -1)
            val prevVal = intent.getIntExtra(EXTRA_PREV_VOLUME_STREAM_VALUE, -1)
            if (newVal < 0 || prevVal < 0 || newVal == prevVal) return

            val keyCode = if (newVal > prevVal) {
                KeyEvent.KEYCODE_VOLUME_UP
            } else {
                KeyEvent.KEYCODE_VOLUME_DOWN
            }

            val now = System.currentTimeMillis()
            // Deduplicate simultaneous RING + NOTIFICATION broadcasts in the same direction without dropping rapid UP/DOWN presses
            if (keyCode == lastVolumeBroadcastKeyCode && (now - lastVolumeBroadcastMs) < VOLUME_EVENT_DEBOUNCE_MS) {
                return
            }
            lastVolumeBroadcastMs = now
            lastVolumeBroadcastKeyCode = keyCode

            if (volumeMatcher.recordPress(keyCode, now)) {
                Log.i(TAG, "Background volume pattern matched -> dispatching Silent SOS")
                CovertSOSDispatcher.dispatchCovertSOS(context, "volume")
            }
        }
    }

    override fun onCreate() {
        super.onCreate()
        isRunning = true
        promoteForeground()
        applyConfiguration()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        promoteForeground()
        if (!CovertSOSPreferences.shouldRunBackgroundService(this)) {
            stopSelf()
            return START_NOT_STICKY
        }
        applyConfiguration()
        return START_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        isRunning = false
        unregisterVolumeReceiver()
        super.onDestroy()
    }

    private fun applyConfiguration() {
        if (CovertSOSPreferences.isVolumePatternEnabled(this)) {
            registerVolumeReceiverIfEnabled()
        } else {
            unregisterVolumeReceiver()
        }
    }

    private fun promoteForeground() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val nm = getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager
            if (nm != null && nm.getNotificationChannel(CHANNEL_ID) == null) {
                val channel = NotificationChannel(
                    CHANNEL_ID,
                    "Covert Safety Trigger Monitor",
                    NotificationManager.IMPORTANCE_MIN
                ).apply {
                    description = "Monitors covert hardware volume button SOS shortcut in background."
                    setSound(null, null)
                    enableVibration(false)
                    enableLights(false)
                    setShowBadge(false)
                    lockscreenVisibility = Notification.VISIBILITY_SECRET
                }
                nm.createNotificationChannel(channel)
            }
        }

        val launchIntent = packageManager.getLaunchIntentForPackage(packageName)
        val pendingFlags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        } else {
            PendingIntent.FLAG_UPDATE_CURRENT
        }
        val contentIntent = launchIntent?.let {
            PendingIntent.getActivity(this, 0, it, pendingFlags)
        }

        val notification = NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("Abucay Guardian • Covert SOS Ready")
            .setContentText("Background volume trigger active")
            .setSmallIcon(R.drawable.notification_icon)
            .setPriority(NotificationCompat.PRIORITY_MIN)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setSilent(true)
            .setOngoing(true)
            .setVisibility(NotificationCompat.VISIBILITY_SECRET)
            .apply {
                if (contentIntent != null) setContentIntent(contentIntent)
            }
            .build()

        startForeground(NOTIFICATION_ID, notification)
    }

    private fun registerVolumeReceiverIfEnabled() {
        if (isVolumeReceiverRegistered) return
        val filter = IntentFilter(VOLUME_CHANGED_ACTION)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(volumeReceiver, filter, Context.RECEIVER_EXPORTED)
        } else {
            registerReceiver(volumeReceiver, filter)
        }
        isVolumeReceiverRegistered = true
    }

    private fun unregisterVolumeReceiver() {
        if (!isVolumeReceiverRegistered) return
        try {
            unregisterReceiver(volumeReceiver)
        } catch (_: Throwable) {}
        isVolumeReceiverRegistered = false
        volumeMatcher.reset()
    }
}
