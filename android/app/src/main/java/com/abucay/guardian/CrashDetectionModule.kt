package com.abucay.guardian

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.hardware.Sensor
import android.hardware.SensorManager
import android.os.BatteryManager
import android.os.Build
import android.os.PowerManager
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.module.annotations.ReactModule

@ReactModule(name = CrashDetectionModule.NAME)
class CrashDetectionModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    companion object {
        const val NAME = "CrashDetection"
    }

    override fun getName(): String = NAME

    @ReactMethod
    fun syncCrashDetection(enabled: Boolean, promise: Promise) {
        try {
            val ctx = reactApplicationContext
            CovertSOSPreferences.setCrashDetectionEnabled(ctx, enabled)
            CrashDetectionService.startOrUpdate(ctx)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("CRASH_SYNC_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun isServiceRunning(promise: Promise) {
        promise.resolve(CrashDetectionService.isRunning)
    }

    @ReactMethod
    fun consumePendingCrashCheckIn(promise: Promise) {
        promise.resolve(CrashDetectionService.consumePendingCrashJson())
    }

    @ReactMethod
    fun confirmUserSafe(promise: Promise) {
        try {
            CrashDetectionService.confirmUserSafe(reactApplicationContext)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("CONFIRM_SAFE_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun escalateCrashNow(promise: Promise) {
        try {
            CrashDetectionService.escalateCrashNow(reactApplicationContext)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("ESCALATE_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun reportLocationSample(lat: Double, lng: Double, speedMps: Double, activityType: String?, promise: Promise) {
        try {
            CrashDetectionService.recordExternalLocation(lat, lng, speedMps.toFloat(), activityType)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.resolve(false)
        }
    }

    @ReactMethod
    fun simulateCrashAlert(lat: Double, lng: Double, promise: Promise) {
        try {
            val resolvedLat = if (lat != 0.0) lat else null
            val resolvedLng = if (lng != 0.0) lng else null
            CrashDetectionService.triggerCheckIn(
                context = reactApplicationContext,
                lat = resolvedLat,
                lng = resolvedLng,
                preImpactSpeedKmh = 52.4,
                peakGForce = 5.6,
                peakGyroRadSec = 3.2,
                isSimulated = true
            )
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("SIMULATE_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun getReadinessStatus(promise: Promise) {
        try {
            val ctx = reactApplicationContext
            val hasFine = ContextCompat.checkSelfPermission(ctx, Manifest.permission.ACCESS_FINE_LOCATION) ==
                PackageManager.PERMISSION_GRANTED
            val hasAlwaysLocation = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                ContextCompat.checkSelfPermission(ctx, Manifest.permission.ACCESS_BACKGROUND_LOCATION) ==
                    PackageManager.PERMISSION_GRANTED
            } else {
                hasFine
            }
            val hasActivityRecognition = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                ContextCompat.checkSelfPermission(ctx, Manifest.permission.ACTIVITY_RECOGNITION) ==
                    PackageManager.PERMISSION_GRANTED
            } else {
                true
            }

            val pm = ctx.getSystemService(Context.POWER_SERVICE) as? PowerManager
            val powerSaveMode = pm?.isPowerSaveMode == true
            val ignoringBatteryOpt = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                pm?.isIgnoringBatteryOptimizations(ctx.packageName) == true
            } else {
                true
            }

            var batteryPct = 100
            try {
                val intent = ctx.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
                if (intent != null) {
                    val lvl = intent.getIntExtra(BatteryManager.EXTRA_LEVEL, -1)
                    val scale = intent.getIntExtra(BatteryManager.EXTRA_SCALE, 100)
                    if (lvl >= 0 && scale > 0) batteryPct = (lvl * 100) / scale
                }
            } catch (_: Throwable) {}

            val sm = ctx.getSystemService(Context.SENSOR_SERVICE) as? SensorManager
            val hasAccelerometer = (sm?.getDefaultSensor(Sensor.TYPE_LINEAR_ACCELERATION)
                ?: sm?.getDefaultSensor(Sensor.TYPE_ACCELEROMETER)) != null
            val hasGyroscope = sm?.getDefaultSensor(Sensor.TYPE_GYROSCOPE) != null

            val map = Arguments.createMap().apply {
                putBoolean("enabled", CovertSOSPreferences.isCrashDetectionEnabled(ctx))
                putBoolean("serviceRunning", CrashDetectionService.isRunning)
                putBoolean("hasFineLocation", hasFine)
                putBoolean("hasAlwaysLocation", hasAlwaysLocation)
                putBoolean("hasActivityRecognition", hasActivityRecognition)
                putInt("batteryPct", batteryPct)
                putBoolean("batteryAbove10", batteryPct > 10)
                putBoolean("powerSaveMode", powerSaveMode)
                putBoolean("ignoringBatteryOptimization", ignoringBatteryOpt)
                putBoolean("hasAccelerometer", hasAccelerometer)
                putBoolean("hasGyroscope", hasGyroscope)
            }
            promise.resolve(map)
        } catch (e: Exception) {
            promise.reject("READINESS_ERROR", e.message, e)
        }
    }
}
