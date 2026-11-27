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
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.media.AudioManager
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.util.Log
import android.view.KeyEvent
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import kotlin.math.sqrt

/**
 * 24/7 Foreground Service keeping covert SOS hardware triggers active even when
 * the app is minimized or the device screen is locked:
 * 1. Accelerometer 3-spike shake detection (with PARTIAL_WAKE_LOCK for screen-off/locked states).
 * 2. Background volume-change sequence detection (UP -> UP -> DOWN -> UP) when minimized.
 */
class CovertSOSService : Service(), SensorEventListener {
    companion object {
        private const val TAG = "CovertSOSService"
        const val CHANNEL_ID = "guardian_covert_sos_channel"
        private const val NOTIFICATION_ID = 91102
        const val ACTION_REFRESH_CONFIG = "com.abucay.guardian.ACTION_REFRESH_COVERT_CONFIG"

        private const val SHAKE_THRESHOLD_G = 2.7f
        private const val SHAKE_MIN_SPACING_MS = 180L
        private const val SHAKE_WINDOW_MS = 1500L
        private const val SHAKE_REQUIRED_PEAKS = 3
        private const val SENSOR_SAMPLING_US = 50_000 // 20 Hz

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

    private var sensorManager: SensorManager? = null
    private var accelerometer: Sensor? = null
    private var isSensorRegistered = false
    private var wakeLock: PowerManager.WakeLock? = null

    private val shakePeaks = mutableListOf<Long>()
    private var lastShakePeakMs = 0L

    private val volumeMatcher = VolumePatternMatcher()
    private var lastVolumeBroadcastMs = 0L
    private var isVolumeReceiverRegistered = false
    private var isScreenReceiverRegistered = false

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

            val now = System.currentTimeMillis()
            // Android often emits simultaneous RING + NOTIFICATION stream updates for one physical button press
            if (now - lastVolumeBroadcastMs < VOLUME_EVENT_DEBOUNCE_MS) {
                return
            }
            lastVolumeBroadcastMs = now

            val keyCode = if (newVal > prevVal) {
                KeyEvent.KEYCODE_VOLUME_UP
            } else {
                KeyEvent.KEYCODE_VOLUME_DOWN
            }

            if (volumeMatcher.recordPress(keyCode, now)) {
                Log.i(TAG, "Background volume pattern matched -> dispatching Silent SOS")
                CovertSOSDispatcher.dispatchCovertSOS(context, "volume")
            }
        }
    }

    private val screenReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent?) {
            when (intent?.action) {
                Intent.ACTION_SCREEN_OFF, Intent.ACTION_SCREEN_ON -> {
                    if (CovertSOSPreferences.isLoggedIn(context) && CovertSOSPreferences.isShakeEnabled(context)) {
                        ensureWakeLockHeld()
                        // Re-assert accelerometer listener across OEM power state transitions
                        unregisterAccelerometer()
                        registerAccelerometerIfEnabled()
                    }
                }
            }
        }
    }

    override fun onCreate() {
        super.onCreate()
        isRunning = true
        sensorManager = getSystemService(Context.SENSOR_SERVICE) as? SensorManager
        accelerometer = sensorManager?.getDefaultSensor(Sensor.TYPE_ACCELEROMETER)
        promoteForeground()
        registerScreenReceiver()
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
        unregisterAccelerometer()
        unregisterVolumeReceiver()
        unregisterScreenReceiver()
        releaseWakeLock()
        super.onDestroy()
    }

    private fun applyConfiguration() {
        if (CovertSOSPreferences.isShakeEnabled(this)) {
            ensureWakeLockHeld()
            registerAccelerometerIfEnabled()
        } else {
            unregisterAccelerometer()
            releaseWakeLock()
        }

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
                    description = "Monitors silent shake and hardware button SOS shortcuts in background."
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
            .setContentText("Background shake & volume triggers active")
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

    private fun ensureWakeLockHeld() {
        try {
            if (wakeLock == null) {
                val pm = getSystemService(Context.POWER_SERVICE) as? PowerManager
                wakeLock = pm?.newWakeLock(
                    PowerManager.PARTIAL_WAKE_LOCK,
                    "AbucayGuardian:CovertShakeLock"
                )?.apply {
                    setReferenceCounted(false)
                }
            }
            if (wakeLock?.isHeld == false) {
                wakeLock?.acquire()
            }
        } catch (t: Throwable) {
            Log.w(TAG, "WakeLock acquire failed: ${t.message}")
        }
    }

    private fun releaseWakeLock() {
        try {
            if (wakeLock?.isHeld == true) {
                wakeLock?.release()
            }
        } catch (_: Throwable) {}
    }

    private fun registerAccelerometerIfEnabled() {
        if (isSensorRegistered || accelerometer == null) return
        val registered = sensorManager?.registerListener(this, accelerometer, SENSOR_SAMPLING_US) == true
        isSensorRegistered = registered
    }

    private fun unregisterAccelerometer() {
        if (!isSensorRegistered) return
        try {
            sensorManager?.unregisterListener(this)
        } catch (_: Throwable) {}
        isSensorRegistered = false
        shakePeaks.clear()
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

    private fun registerScreenReceiver() {
        if (isScreenReceiverRegistered) return
        val filter = IntentFilter().apply {
            addAction(Intent.ACTION_SCREEN_OFF)
            addAction(Intent.ACTION_SCREEN_ON)
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(screenReceiver, filter, Context.RECEIVER_NOT_EXPORTED)
        } else {
            registerReceiver(screenReceiver, filter)
        }
        isScreenReceiverRegistered = true
    }

    private fun unregisterScreenReceiver() {
        if (!isScreenReceiverRegistered) return
        try {
            unregisterReceiver(screenReceiver)
        } catch (_: Throwable) {}
        isScreenReceiverRegistered = false
    }

    override fun onSensorChanged(event: SensorEvent?) {
        if (event == null || event.sensor.type != Sensor.TYPE_ACCELEROMETER) return
        if (!CovertSOSPreferences.isLoggedIn(this) || !CovertSOSPreferences.isShakeEnabled(this)) return

        val x = event.values[0]
        val y = event.values[1]
        val z = event.values[2]
        val magnitudeG = sqrt(x * x + y * y + z * z) / SensorManager.GRAVITY_EARTH
        val now = System.currentTimeMillis()

        if (magnitudeG > SHAKE_THRESHOLD_G && (now - lastShakePeakMs) >= SHAKE_MIN_SPACING_MS) {
            lastShakePeakMs = now
            shakePeaks.removeAll { (now - it) > SHAKE_WINDOW_MS }
            shakePeaks.add(now)

            if (shakePeaks.size >= SHAKE_REQUIRED_PEAKS) {
                shakePeaks.clear()
                Log.i(TAG, "3 distinct shake peaks detected in native service -> dispatching Silent SOS")
                CovertSOSDispatcher.dispatchCovertSOS(this, "shake")
            }
        }
    }

    override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) {
        // No-op
    }
}
