package com.abucay.guardian

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import android.text.TextUtils
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.module.annotations.ReactModule

@ReactModule(name = CovertSOSModule.NAME)
class CovertSOSModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    companion object {
        const val NAME = "CovertSOS"
    }

    override fun getName(): String = NAME

    @ReactMethod
    fun syncSettings(
        isLoggedIn: Boolean,
        userId: String?,
        shakeEnabled: Boolean,
        volumePatternEnabled: Boolean,
        weatherTapEnabled: Boolean,
        promise: Promise
    ) {
        try {
            val ctx = reactApplicationContext
            CovertSOSPreferences.saveSettings(
                ctx,
                isLoggedIn = isLoggedIn,
                userId = userId,
                shakeEnabled = shakeEnabled,
                volumePatternEnabled = volumePatternEnabled,
                weatherTapEnabled = weatherTapEnabled
            )
            CovertSOSService.startOrUpdate(ctx)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("SYNC_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun isServiceRunning(promise: Promise) {
        promise.resolve(CovertSOSService.isRunning)
    }

    @ReactMethod
    fun isAccessibilityServiceEnabled(promise: Promise) {
        try {
            if (CovertVolumeAccessibilityService.isRunning) {
                promise.resolve(true)
                return
            }
            val ctx = reactApplicationContext
            val enabledServices = Settings.Secure.getString(
                ctx.contentResolver,
                Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES
            ) ?: ""
            val expectedName = ComponentName(ctx, CovertVolumeAccessibilityService::class.java)
            val splitter = TextUtils.SimpleStringSplitter(':')
            splitter.setString(enabledServices)
            while (splitter.hasNext()) {
                val component = ComponentName.unflattenFromString(splitter.next())
                if (component == expectedName) {
                    promise.resolve(true)
                    return
                }
            }
            promise.resolve(false)
        } catch (_: Exception) {
            promise.resolve(false)
        }
    }

    @ReactMethod
    fun openAccessibilitySettings(promise: Promise) {
        try {
            val intent = Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            reactApplicationContext.startActivity(intent)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("ACCESSIBILITY_SETTINGS_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun isIgnoringBatteryOptimizations(promise: Promise) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                val pm = reactApplicationContext.getSystemService(Context.POWER_SERVICE) as? PowerManager
                promise.resolve(pm?.isIgnoringBatteryOptimizations(reactApplicationContext.packageName) == true)
            } else {
                promise.resolve(true)
            }
        } catch (_: Exception) {
            promise.resolve(false)
        }
    }

    @ReactMethod
    fun requestIgnoreBatteryOptimization(promise: Promise) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                val ctx = reactApplicationContext
                val intent = Intent(
                    Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
                    Uri.parse("package:${ctx.packageName}")
                ).apply {
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }
                ctx.startActivity(intent)
                promise.resolve(true)
            } else {
                promise.resolve(true)
            }
        } catch (_: Exception) {
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    val fallback = Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS).apply {
                        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    }
                    reactApplicationContext.startActivity(fallback)
                    promise.resolve(true)
                } else {
                    promise.resolve(false)
                }
            } catch (e: Exception) {
                promise.reject("BATTERY_SETTINGS_ERROR", e.message, e)
            }
        }
    }
}
