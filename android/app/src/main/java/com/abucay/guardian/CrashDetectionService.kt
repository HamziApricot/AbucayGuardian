package com.abucay.guardian

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.BatteryManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import org.json.JSONObject
import kotlin.math.abs
import kotlin.math.sqrt

/**
 * Sensor-fusion Car Crash Detection Foreground Service modeled after Life360/Arity:
 * 1. Drive State & Speed Gating: requires >= 25 mph (11.176 m/s / ~40.2 km/h) within 5s before impact.
 * 2. Multi-Axis Linear Acceleration + Gyroscope: checks severe G-force (>= 4.0G) paired with rotational dynamics.
 * 3. Post-Impact Stationary Verification: verifies vehicle stopped/dropped sharply after impact (~3.5s window).
 * 4. 30-second Check-In Countdown: wakes screen / launches UI; auto-escalates SOS + SMS if unresponded.
 */
class CrashDetectionService : Service(), SensorEventListener, LocationListener {

    private data class SpeedSample(
        val timestampMs: Long,
        val speedMps: Float,
        val lat: Double,
        val lng: Double
    )

    private data class PendingImpact(
        val impactTimeMs: Long,
        val preImpactSpeedMps: Float,
        val lat: Double?,
        val lng: Double?,
        var peakGForce: Float,
        var peakGyroRadSec: Float
    )

    companion object {
        private const val TAG = "CrashDetectionService"
        const val CHANNEL_ID = "guardian_crash_detection_channel"
        private const val NOTIFICATION_ID = 91104
        const val ACTION_REFRESH = "com.abucay.guardian.ACTION_REFRESH_CRASH_CONFIG"

        private const val GRAVITY = 9.80665f
        private const val MIN_ARMED_SPEED_MPS = 11.176f // 25 mph (~40.2 km/h)
        private const val SENSOR_ARM_SPEED_MPS = 4.0f   // ~14.4 km/h
        private const val MAX_PLAUSIBLE_SPEED_MPS = 65.0f // ~234 km/h (filters GPS jump spikes)
        private const val SPEED_GATE_WINDOW_MS = 5_000L
        private const val SPEED_BUFFER_RETENTION_MS = 20_000L
        private const val SENSOR_IDLE_UNREGISTER_MS = 60_000L

        private const val IMPACT_G_THRESHOLD = 4.0f
        private const val SEVERE_HEADON_G_THRESHOLD = 6.5f
        private const val GYRO_RAD_THRESHOLD = 2.2f
        private const val POST_IMPACT_VERIFY_DELAY_MS = 3_500L
        private const val POST_IMPACT_STOP_MAX_SPEED_MPS = 2.5f // <= 9 km/h
        private const val CRASH_COOLDOWN_MS = 60_000L
        private const val CHECKIN_COUNTDOWN_MS = 30_000L

        private val mainHandler = Handler(Looper.getMainLooper())

        @Volatile
        var isRunning: Boolean = false
            private set

        @Volatile
        private var activeInstance: CrashDetectionService? = null

        @Volatile
        private var pendingCrashJson: String? = null

        @Volatile
        private var activeCheckInExpiresAtMs: Long = 0L

        private var activeCheckInRunnable: Runnable? = null
        private var checkInWakeLock: PowerManager.WakeLock? = null

        private val speedHistory = ArrayDeque<SpeedSample>()
        private var lastLocationSample: SpeedSample? = null

        @Volatile
        private var latestSpeedMps: Float = 0f

        @Volatile
        private var latestSpeedTimeMs: Long = 0L

        @Volatile
        private var latestLat: Double? = null

        @Volatile
        private var latestLng: Double? = null

        @Volatile
        private var latestActivityType: String = "unknown"

        @Volatile
        private var lastCrashTriggerMs: Long = 0L

        fun startOrUpdate(context: Context) {
            val appContext = context.applicationContext
            if (!CovertSOSPreferences.shouldRunCrashDetectionService(appContext)) {
                stop(appContext)
                return
            }
            val intent = Intent(appContext, CrashDetectionService::class.java).apply {
                action = ACTION_REFRESH
            }
            try {
                ContextCompat.startForegroundService(appContext, intent)
            } catch (t: Throwable) {
                Log.w(TAG, "Unable to start CrashDetectionService: ${t.message}")
            }
        }

        fun stop(context: Context) {
            try {
                context.applicationContext.stopService(
                    Intent(context.applicationContext, CrashDetectionService::class.java)
                )
            } catch (_: Throwable) {}
        }

        fun consumePendingCrashJson(): String? {
            val now = System.currentTimeMillis()
            val current = pendingCrashJson ?: return null
            if (activeCheckInExpiresAtMs > 0L && now > activeCheckInExpiresAtMs + 5_000L) {
                pendingCrashJson = null
                return null
            }
            return current
        }

        fun recordExternalLocation(lat: Double, lng: Double, speedMps: Float, activityType: String?) {
            val now = System.currentTimeMillis()
            if (!activityType.isNullOrBlank()) {
                latestActivityType = activityType.lowercase()
            }
            recordSpeedSampleInternal(now, lat, lng, speedMps)
            activeInstance?.evaluateSensorArming()
        }

        @Synchronized
        private fun recordSpeedSampleInternal(nowMs: Long, lat: Double, lng: Double, rawSpeedMps: Float) {
            var resolvedSpeed = if (rawSpeedMps.isFinite() && rawSpeedMps >= 0f) rawSpeedMps else -1f
            val prev = lastLocationSample
            if (resolvedSpeed < 0f && prev != null) {
                val dtSec = (nowMs - prev.timestampMs) / 1000f
                if (dtSec in 0.8f..15.0f) {
                    val results = FloatArray(1)
                    Location.distanceBetween(prev.lat, prev.lng, lat, lng, results)
                    val derived = results[0] / dtSec
                    if (derived <= MAX_PLAUSIBLE_SPEED_MPS) {
                        resolvedSpeed = derived
                    }
                }
            }

            if (resolvedSpeed in 0f..MAX_PLAUSIBLE_SPEED_MPS) {
                latestSpeedMps = resolvedSpeed
                latestSpeedTimeMs = nowMs
                speedHistory.addLast(SpeedSample(nowMs, resolvedSpeed, lat, lng))
                while (speedHistory.isNotEmpty() && nowMs - speedHistory.first().timestampMs > SPEED_BUFFER_RETENTION_MS) {
                    speedHistory.removeFirst()
                }
            }

            latestLat = lat
            latestLng = lng
            lastLocationSample = SpeedSample(nowMs, resolvedSpeed.coerceAtLeast(0f), lat, lng)
        }

        @Synchronized
        private fun maxSpeedWithinWindow(nowMs: Long, windowMs: Long): Float {
            var maxSpd = 0f
            for (sample in speedHistory) {
                if (nowMs - sample.timestampMs <= windowMs && sample.speedMps > maxSpd) {
                    maxSpd = sample.speedMps
                }
            }
            return maxSpd
        }

        fun confirmUserSafe(context: Context) {
            clearCheckInState()
            EmergencyAudioModule.stopActiveAlarm()
            EmergencyAudioModule.emitNativeEvent("onCrashCheckInResolved", "safe")
        }

        fun escalateCrashNow(context: Context) {
            val currentJson = pendingCrashJson
            clearCheckInState()
            EmergencyAudioModule.stopActiveAlarm()

            val parsed = try {
                if (!currentJson.isNullOrBlank()) JSONObject(currentJson) else JSONObject()
            } catch (_: Throwable) {
                JSONObject()
            }
            val lat = if (parsed.has("lat") && !parsed.isNull("lat")) parsed.optDouble("lat") else latestLat
            val lng = if (parsed.has("lng") && !parsed.isNull("lng")) parsed.optDouble("lng") else latestLng
            val speedKmh = parsed.optDouble("preImpactSpeedKmh", 0.0)
            val gForce = parsed.optDouble("peakGForce", 0.0)

            CovertSOSDispatcher.dispatchCrashSOS(context.applicationContext, lat, lng, speedKmh, gForce)
            EmergencyAudioModule.emitNativeEvent("onCrashCheckInResolved", "escalated")
        }

        fun triggerCheckIn(
            context: Context,
            lat: Double?,
            lng: Double?,
            preImpactSpeedKmh: Double,
            peakGForce: Double,
            peakGyroRadSec: Double,
            isSimulated: Boolean = false
        ) {
            val appContext = context.applicationContext
            val now = System.currentTimeMillis()
            if (!isSimulated && now - lastCrashTriggerMs < CRASH_COOLDOWN_MS) {
                return
            }
            lastCrashTriggerMs = now

            clearCheckInState()

            val expiresAt = now + CHECKIN_COUNTDOWN_MS
            activeCheckInExpiresAtMs = expiresAt

            val payload = JSONObject().apply {
                put("crashId", "crash-$now")
                if (lat != null && lng != null) {
                    put("lat", lat)
                    put("lng", lng)
                }
                put("preImpactSpeedKmh", String.format(java.util.Locale.US, "%.1f", preImpactSpeedKmh).toDouble())
                put("peakGForce", String.format(java.util.Locale.US, "%.1f", peakGForce).toDouble())
                put("peakGyroRadSec", String.format(java.util.Locale.US, "%.1f", peakGyroRadSec).toDouble())
                put("detectedAtMs", now)
                put("expiresAtMs", expiresAt)
                put("countdownSeconds", (CHECKIN_COUNTDOWN_MS / 1000L).toInt())
                put("isSimulated", isSimulated)
            }
            val json = payload.toString()
            pendingCrashJson = json

            acquireCheckInWakeLock(appContext)

            // Bring MainActivity forward & wake screen so the user sees "ARE YOU OKAY?"
            EmergencyPopupManager.bringMainActivityToForeground(appContext)
            EmergencyAudioModule.emitNativeEvent("onCrashDetected", json)

            // Authoritative native escalation timer in case screen stays locked or user cannot respond
            val runnable = Runnable {
                Log.w(TAG, "30s Crash Check-In expired with no response -> auto-escalating SOS!")
                escalateCrashNow(appContext)
            }
            activeCheckInRunnable = runnable
            mainHandler.postDelayed(runnable, CHECKIN_COUNTDOWN_MS)
        }

        private fun acquireCheckInWakeLock(appContext: Context) {
            try {
                val pm = appContext.getSystemService(Context.POWER_SERVICE) as? PowerManager ?: return
                if (checkInWakeLock == null) {
                    checkInWakeLock = pm.newWakeLock(
                        PowerManager.PARTIAL_WAKE_LOCK,
                        "AbucayGuardian:CrashCheckInWakeLock"
                    ).apply { setReferenceCounted(false) }
                }
                checkInWakeLock?.acquire(CHECKIN_COUNTDOWN_MS + 5_000L)
            } catch (_: Throwable) {}
        }

        private fun clearCheckInState() {
            activeCheckInRunnable?.let { mainHandler.removeCallbacks(it) }
            activeCheckInRunnable = null
            pendingCrashJson = null
            activeCheckInExpiresAtMs = 0L
            try {
                if (checkInWakeLock?.isHeld == true) {
                    checkInWakeLock?.release()
                }
            } catch (_: Throwable) {}
        }
    }

    private var sensorManager: SensorManager? = null
    private var linearAccelSensor: Sensor? = null
    private var rawAccelSensor: Sensor? = null
    private var gyroSensor: Sensor? = null
    private var usingLinearAccel = false
    private var isSensorsRegistered = false

    private var locationManager: LocationManager? = null
    private var isLocationRegistered = false

    // High-pass gravity estimator when TYPE_LINEAR_ACCELERATION is absent
    private val gravityEst = FloatArray(3)
    private var hasGravityEst = false

    private var pendingImpact: PendingImpact? = null
    private var verifyImpactRunnable: Runnable? = null

    private var lastDrivingActivityMs = 0L
    private var latestGyroMag = 0f
    private var latestGyroTimeMs = 0L

    override fun onCreate() {
        super.onCreate()
        isRunning = true
        activeInstance = this
        sensorManager = getSystemService(Context.SENSOR_SERVICE) as? SensorManager
        linearAccelSensor = sensorManager?.getDefaultSensor(Sensor.TYPE_LINEAR_ACCELERATION)
        rawAccelSensor = sensorManager?.getDefaultSensor(Sensor.TYPE_ACCELEROMETER)
        gyroSensor = sensorManager?.getDefaultSensor(Sensor.TYPE_GYROSCOPE)
        locationManager = getSystemService(Context.LOCATION_SERVICE) as? LocationManager

        promoteForeground()
        registerLocationUpdates()
        evaluateSensorArming()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        promoteForeground()
        if (!CovertSOSPreferences.shouldRunCrashDetectionService(this)) {
            stopSelf()
            return START_NOT_STICKY
        }
        registerLocationUpdates()
        evaluateSensorArming()
        return START_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        isRunning = false
        if (activeInstance === this) activeInstance = null
        verifyImpactRunnable?.let { mainHandler.removeCallbacks(it) }
        verifyImpactRunnable = null
        unregisterImuSensors()
        unregisterLocationUpdates()
        super.onDestroy()
    }

    private fun promoteForeground() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val nm = getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager
            if (nm != null && nm.getNotificationChannel(CHANNEL_ID) == null) {
                val channel = NotificationChannel(
                    CHANNEL_ID,
                    "Car Crash Safety Sensor",
                    NotificationManager.IMPORTANCE_MIN
                ).apply {
                    description = "Monitors vehicle speed, G-forces, and rotation for emergency crash detection."
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
            .setContentTitle("Abucay Guardian • Crash Protection Active")
            .setContentText("Monitoring drive speed & impact sensors")
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

    private fun isPowerConditionHealthy(): Boolean {
        try {
            val pm = getSystemService(Context.POWER_SERVICE) as? PowerManager
            if (pm != null && pm.isPowerSaveMode) {
                return false
            }
            val batteryStatus = registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
            if (batteryStatus != null) {
                val level = batteryStatus.getIntExtra(BatteryManager.EXTRA_LEVEL, -1)
                val scale = batteryStatus.getIntExtra(BatteryManager.EXTRA_SCALE, 100)
                if (level >= 0 && scale > 0) {
                    val pct = (level * 100) / scale
                    if (pct <= 10) return false
                }
            }
        } catch (_: Throwable) {}
        return true
    }

    fun evaluateSensorArming() {
        val now = System.currentTimeMillis()
        if (!CovertSOSPreferences.shouldRunCrashDetectionService(this) || !isPowerConditionHealthy()) {
            unregisterImuSensors()
            return
        }

        val isMovingFast = (now - latestSpeedTimeMs <= 15_000L) && (latestSpeedMps >= SENSOR_ARM_SPEED_MPS)
        val isInVehicle = latestActivityType == "in_vehicle"
        if (isMovingFast || isInVehicle) {
            lastDrivingActivityMs = now
        }

        val shouldSampleHighFreq =
            pendingImpact != null || (now - lastDrivingActivityMs <= SENSOR_IDLE_UNREGISTER_MS)

        if (shouldSampleHighFreq) {
            registerImuSensors()
        } else {
            unregisterImuSensors()
        }
    }

    private fun registerImuSensors() {
        if (isSensorsRegistered) return
        val sm = sensorManager ?: return
        val accel = linearAccelSensor ?: rawAccelSensor ?: return
        usingLinearAccel = (accel.type == Sensor.TYPE_LINEAR_ACCELERATION)
        hasGravityEst = false

        val accelOk = sm.registerListener(this, accel, SensorManager.SENSOR_DELAY_GAME)
        gyroSensor?.let { sm.registerListener(this, it, SensorManager.SENSOR_DELAY_GAME) }
        isSensorsRegistered = accelOk
        if (accelOk) {
            Log.d(TAG, "High-freq crash IMU armed (linear=${usingLinearAccel}, gyro=${gyroSensor != null})")
        }
    }

    private fun unregisterImuSensors() {
        if (!isSensorsRegistered) return
        try {
            sensorManager?.unregisterListener(this)
        } catch (_: Throwable) {}
        isSensorsRegistered = false
    }

    private fun registerLocationUpdates() {
        if (isLocationRegistered) return
        val lm = locationManager ?: return
        val hasFine = ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) ==
            PackageManager.PERMISSION_GRANTED
        if (!hasFine) return

        try {
            if (lm.isProviderEnabled(LocationManager.GPS_PROVIDER)) {
                lm.requestLocationUpdates(LocationManager.GPS_PROVIDER, 2_000L, 2f, this, Looper.getMainLooper())
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && lm.allProviders.contains(LocationManager.FUSED_PROVIDER)) {
                lm.requestLocationUpdates(LocationManager.FUSED_PROVIDER, 2_000L, 2f, this, Looper.getMainLooper())
            } else if (lm.allProviders.contains(LocationManager.PASSIVE_PROVIDER)) {
                lm.requestLocationUpdates(LocationManager.PASSIVE_PROVIDER, 2_000L, 2f, this, Looper.getMainLooper())
            }
            isLocationRegistered = true
        } catch (t: Throwable) {
            Log.w(TAG, "Location updates unavailable: ${t.message}")
        }
    }

    private fun unregisterLocationUpdates() {
        if (!isLocationRegistered) return
        try {
            locationManager?.removeUpdates(this)
        } catch (_: Throwable) {}
        isLocationRegistered = false
    }

    override fun onLocationChanged(location: Location) {
        val speed = if (location.hasSpeed()) location.speed else -1f
        recordSpeedSampleInternal(System.currentTimeMillis(), location.latitude, location.longitude, speed)
        evaluateSensorArming()
    }

    @Deprecated("Deprecated in API 29")
    override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) {}

    override fun onProviderEnabled(provider: String) {}
    override fun onProviderDisabled(provider: String) {}

    override fun onSensorChanged(event: SensorEvent?) {
        if (event == null) return
        val now = System.currentTimeMillis()

        if (event.sensor.type == Sensor.TYPE_GYROSCOPE) {
            val wx = event.values[0]
            val wy = event.values[1]
            val wz = event.values[2]
            val omega = sqrt(wx * wx + wy * wy + wz * wz)
            latestGyroMag = omega
            latestGyroTimeMs = now

            pendingImpact?.let { candidate ->
                if (now - candidate.impactTimeMs <= 1_800L && omega > candidate.peakGyroRadSec) {
                    candidate.peakGyroRadSec = omega
                }
            }
            return
        }

        val isLinear = event.sensor.type == Sensor.TYPE_LINEAR_ACCELERATION
        val isAccel = event.sensor.type == Sensor.TYPE_ACCELEROMETER
        if (!isLinear && !isAccel) return

        val ax: Float
        val ay: Float
        val az: Float
        if (isLinear) {
            ax = event.values[0]
            ay = event.values[1]
            az = event.values[2]
        } else {
            val alpha = 0.8f
            if (!hasGravityEst) {
                gravityEst[0] = event.values[0]
                gravityEst[1] = event.values[1]
                gravityEst[2] = event.values[2]
                hasGravityEst = true
            } else {
                gravityEst[0] = alpha * gravityEst[0] + (1f - alpha) * event.values[0]
                gravityEst[1] = alpha * gravityEst[1] + (1f - alpha) * event.values[1]
                gravityEst[2] = alpha * gravityEst[2] + (1f - alpha) * event.values[2]
            }
            ax = event.values[0] - gravityEst[0]
            ay = event.values[1] - gravityEst[1]
            az = event.values[2] - gravityEst[2]
        }

        val linearG = sqrt(ax * ax + ay * ay + az * az) / GRAVITY

        // Update running peak if inside an active impact window
        val activeCandidate = pendingImpact
        if (activeCandidate != null && now - activeCandidate.impactTimeMs <= 1_500L) {
            if (linearG > activeCandidate.peakGForce) {
                activeCandidate.peakGForce = linearG
            }
            return
        }

        if (activeCandidate == null && linearG >= IMPACT_G_THRESHOLD) {
            if (now - lastCrashTriggerMs < CRASH_COOLDOWN_MS) return

            // Ignore if OS activity confirms on-foot walking/running with low speed
            val maxSpeed5s = maxSpeedWithinWindow(now, SPEED_GATE_WINDOW_MS)
            if (maxSpeed5s < MIN_ARMED_SPEED_MPS) {
                // Vehicle speed gate not met (< 25 mph / 40 km/h in last 5s) -> phone drop protection
                return
            }
            if ((latestActivityType == "walking" || latestActivityType == "running") && maxSpeed5s < MIN_ARMED_SPEED_MPS) {
                return
            }

            val initialGyro = if (abs(now - latestGyroTimeMs) <= 400L) latestGyroMag else 0f
            val candidate = PendingImpact(
                impactTimeMs = now,
                preImpactSpeedMps = maxSpeed5s,
                lat = latestLat,
                lng = latestLng,
                peakGForce = linearG,
                peakGyroRadSec = initialGyro
            )
            pendingImpact = candidate

            Log.i(
                TAG,
                "Impact candidate G=${"%.2f".format(linearG)} preSpeed=${"%.1f".format(maxSpeed5s * 3.6)}km/h -> verifying rotation & post-impact stop"
            )

            verifyImpactRunnable?.let { mainHandler.removeCallbacks(it) }
            val verifyTask = Runnable { verifyAndFinalizeImpact(candidate) }
            verifyImpactRunnable = verifyTask
            mainHandler.postDelayed(verifyTask, POST_IMPACT_VERIFY_DELAY_MS)
        }
    }

    override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) {}

    private fun verifyAndFinalizeImpact(candidate: PendingImpact) {
        if (pendingImpact !== candidate) return
        pendingImpact = null

        val now = System.currentTimeMillis()
        if (!CovertSOSPreferences.shouldRunCrashDetectionService(this)) return

        // 1. Verify rotational dynamics (unless severe head-on G-force >= 6.5G)
        val hasGyroSignature = if (gyroSensor != null) {
            candidate.peakGyroRadSec >= GYRO_RAD_THRESHOLD || candidate.peakGForce >= SEVERE_HEADON_G_THRESHOLD
        } else {
            candidate.peakGForce >= SEVERE_HEADON_G_THRESHOLD
        }

        if (!hasGyroSignature) {
            Log.d(TAG, "Impact rejected: insufficient rotational dynamics (gyro=${candidate.peakGyroRadSec}, G=${candidate.peakGForce})")
            return
        }

        // 2. Post-impact stationary / sharp deceleration verification
        val postSpeedFresh = (now - latestSpeedTimeMs) <= 6_000L
        val currentPostSpeed = if (postSpeedFresh) latestSpeedMps else 0f
        val preSpeed = candidate.preImpactSpeedMps
        val sharpDrop = preSpeed > 0f && ((preSpeed - currentPostSpeed) / preSpeed) >= 0.70f
        val cameToStop = currentPostSpeed <= POST_IMPACT_STOP_MAX_SPEED_MPS

        if (!cameToStop && !sharpDrop) {
            Log.d(TAG, "Impact rejected: vehicle remained in motion (postSpeed=${"%.1f".format(currentPostSpeed * 3.6)} km/h)")
            return
        }

        val preSpeedKmh = preSpeed * 3.6
        Log.w(
            TAG,
            "CONFIRMED CRASH SIGNATURE: preSpeed=${"%.1f".format(preSpeedKmh)} km/h, G=${"%.1f".format(candidate.peakGForce)}, gyro=${"%.1f".format(candidate.peakGyroRadSec)} rad/s"
        )

        triggerCheckIn(
            context = this,
            lat = latestLat ?: candidate.lat,
            lng = latestLng ?: candidate.lng,
            preImpactSpeedKmh = preSpeedKmh,
            peakGForce = candidate.peakGForce.toDouble(),
            peakGyroRadSec = candidate.peakGyroRadSec.toDouble(),
            isSimulated = false
        )
    }
}
