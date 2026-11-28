package com.abucay.guardian

import android.app.Activity
import android.app.ActivityOptions
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.provider.Settings
import android.text.TextUtils
import android.util.Log
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import org.json.JSONObject

/**
 * Coordinates waking the device, bringing MainActivity to the foreground from a
 * minimized/background state, and displaying a native SYSTEM_ALERT_WINDOW fallback
 * emergency overlay if the OS or OEM blocks background Activity launches.
 */
object EmergencyPopupManager {
    private const val TAG = "EmergencyPopupManager"
    const val EXTRA_EMERGENCY_ALERT_JSON = "emergency_alert_json"

    private val mainHandler = Handler(Looper.getMainLooper())

    @Volatile
    private var isMainActivityResumed: Boolean = false

    @Volatile
    private var pendingAlertJson: String? = null

    private var overlayView: View? = null
    private var windowManager: WindowManager? = null
    private var overlayFallbackRunnable: Runnable? = null

    fun hasPendingAlert(): Boolean = !pendingAlertJson.isNullOrBlank()

    fun consumePendingAlertJson(): String? {
        val current = pendingAlertJson
        pendingAlertJson = null
        return current
    }

    fun handleLaunchIntent(activity: Activity, intent: Intent?) {
        val alertJson = intent?.getStringExtra(EXTRA_EMERGENCY_ALERT_JSON)
        if (!alertJson.isNullOrBlank()) {
            pendingAlertJson = alertJson
            EmergencyAudioModule.emitNativeEvent("onNativeEmergencyAlert", alertJson)
        }
    }

    fun onActivityResumed(activity: Activity) {
        isMainActivityResumed = true
        cancelPendingOverlayFallback()
        dismissOverlay(activity.applicationContext)

        val current = pendingAlertJson
        if (!current.isNullOrBlank()) {
            // Re-emit shortly after resume so React's AppState/listeners are guaranteed active
            mainHandler.postDelayed({
                pendingAlertJson?.let { json ->
                    EmergencyAudioModule.emitNativeEvent("onNativeEmergencyAlert", json)
                }
            }, 120L)
        }
    }

    fun onActivityPaused() {
        isMainActivityResumed = false
    }

    fun canDrawOverlays(context: Context): Boolean {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            Settings.canDrawOverlays(context.applicationContext)
        } else {
            true
        }
    }

    fun wakeUpScreen(context: Context) {
        try {
            val pm = context.applicationContext.getSystemService(Context.POWER_SERVICE) as? PowerManager
            if (pm != null && !pm.isInteractive) {
                @Suppress("DEPRECATION")
                val wakeLock = pm.newWakeLock(
                    PowerManager.FULL_WAKE_LOCK or
                        PowerManager.ACQUIRE_CAUSES_WAKEUP or
                        PowerManager.ON_AFTER_RELEASE,
                    "AbucayGuardian:EmergencyPopupWakeLock"
                )
                wakeLock.acquire(10_000L)
            }
        } catch (t: Throwable) {
            Log.w(TAG, "WakeLock acquire failed: ${t.message}")
        }
    }

    /**
     * Launches the emergency popup when an alert arrives (including while minimized/background).
     * 1. Stores pending alert JSON and emits to JS.
     * 2. Wakes the screen and attempts to bring MainActivity to foreground with BAL opt-in.
     * 3. If MainActivity has not resumed within 350ms and SYSTEM_ALERT_WINDOW is granted,
     *    displays a native TYPE_APPLICATION_OVERLAY card on top of any active app/launcher.
     */
    fun launchEmergencyAlert(context: Context, alertJson: String) {
        val appContext = context.applicationContext
        pendingAlertJson = alertJson
        EmergencyAudioModule.emitNativeEvent("onNativeEmergencyAlert", alertJson)

        mainHandler.post {
            wakeUpScreen(appContext)

            if (isMainActivityResumed) {
                // App is already in foreground; React modal will show directly
                dismissOverlay(appContext)
                return@post
            }

            // Attempt to bring MainActivity directly to foreground
            val launched = tryBringMainActivityToFront(appContext, alertJson)
            Log.i(TAG, "tryBringMainActivityToFront returned=$launched, resumed=$isMainActivityResumed")

            // Schedule a short check: if Android/OEM blocked background startActivity,
            // show the native SYSTEM_ALERT_WINDOW overlay over other apps.
            cancelPendingOverlayFallback()
            val fallback = Runnable {
                if (!isMainActivityResumed && canDrawOverlays(appContext)) {
                    Log.i(TAG, "MainActivity still in background -> showing native SYSTEM_ALERT_WINDOW overlay")
                    showOverlayInternal(appContext, alertJson)
                }
            }
            overlayFallbackRunnable = fallback
            mainHandler.postDelayed(fallback, 350L)
        }
    }

    fun dismissAll(context: Context) {
        pendingAlertJson = null
        cancelPendingOverlayFallback()
        dismissOverlay(context.applicationContext)
    }

    private fun cancelPendingOverlayFallback() {
        overlayFallbackRunnable?.let { mainHandler.removeCallbacks(it) }
        overlayFallbackRunnable = null
    }

    fun bringMainActivityToForeground(context: Context) {
        val appContext = context.applicationContext
        mainHandler.post {
            wakeUpScreen(appContext)
            if (!isMainActivityResumed) {
                tryBringMainActivityToFront(appContext, null)
            }
        }
    }

    private fun buildMainActivityIntent(appContext: Context, alertJson: String?): Intent {
        return Intent(appContext, MainActivity::class.java).apply {
            addFlags(
                Intent.FLAG_ACTIVITY_NEW_TASK or
                    Intent.FLAG_ACTIVITY_REORDER_TO_FRONT or
                    Intent.FLAG_ACTIVITY_SINGLE_TOP
            )
            if (!alertJson.isNullOrBlank()) {
                putExtra(EXTRA_EMERGENCY_ALERT_JSON, alertJson)
            }
        }
    }

    private fun tryBringMainActivityToFront(appContext: Context, alertJson: String?): Boolean {
        val intent = buildMainActivityIntent(appContext, alertJson)

        // 1. Direct startActivity with Android 14+ BAL allow option
        try {
            if (Build.VERSION.SDK_INT >= 34) {
                val options = ActivityOptions.makeBasic().apply {
                    setPendingIntentBackgroundActivityStartMode(
                        ActivityOptions.MODE_BACKGROUND_ACTIVITY_START_ALLOWED
                    )
                }
                appContext.startActivity(intent, options.toBundle())
            } else {
                appContext.startActivity(intent)
            }
            return true
        } catch (t: Throwable) {
            Log.w(TAG, "Direct startActivity failed: ${t.message}")
        }

        // 2. Fallback via PendingIntent.send() with explicit BAL opt-in
        try {
            val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            } else {
                PendingIntent.FLAG_UPDATE_CURRENT
            }
            val pendingIntent = PendingIntent.getActivity(appContext, 91109, intent, flags)
            if (Build.VERSION.SDK_INT >= 34) {
                val options = ActivityOptions.makeBasic().apply {
                    setPendingIntentBackgroundActivityStartMode(
                        ActivityOptions.MODE_BACKGROUND_ACTIVITY_START_ALLOWED
                    )
                }
                pendingIntent.send(appContext, 0, null, null, null, null, options.toBundle())
            } else {
                pendingIntent.send()
            }
            return true
        } catch (t: Throwable) {
            Log.w(TAG, "PendingIntent fallback failed: ${t.message}")
        }

        return false
    }

    private fun dp(context: Context, value: Int): Int {
        return TypedValue.applyDimension(
            TypedValue.COMPLEX_UNIT_DIP,
            value.toFloat(),
            context.resources.displayMetrics
        ).toInt()
    }

    private fun showOverlayInternal(appContext: Context, alertJson: String) {
        if (!canDrawOverlays(appContext)) return
        dismissOverlay(appContext)

        try {
            val parsed = try { JSONObject(alertJson) } catch (_: Throwable) { JSONObject() }
            val alertType = parsed.optString("alertType", "sos")
            val fromName = parsed.optString("fromName", "Family Member")
            val hasCoords = parsed.has("fromLat") && !parsed.isNull("fromLat") &&
                parsed.has("fromLng") && !parsed.isNull("fromLng")
            val lat = if (hasCoords) parsed.optDouble("fromLat", 0.0) else null
            val lng = if (hasCoords) parsed.optDouble("fromLng", 0.0) else null
            val hasBattery = parsed.has("battery") && !parsed.isNull("battery")
            val battery = if (hasBattery) parsed.optDouble("battery", -1.0) else null

            val isSOS = alertType == "sos"
            val isLoudPing = alertType == "loud_ping"

            val accentHex = when {
                isSOS -> "#DC2626"
                isLoudPing -> "#EA580C"
                else -> "#2563EB"
            }
            val headerTitle = when {
                isSOS -> "🚨 EMERGENCY SOS ALERT"
                isLoudPing -> "🚨 LOUD EMERGENCY PING"
                else -> "⚠️ ARE YOU SAFE?"
            }
            val bodyText = when {
                isSOS -> "$fromName broadcasted an EMERGENCY SOS! Tap below to open live distress tracking."
                isLoudPing -> "$fromName triggered an urgent loud alarm on your device!"
                else -> "$fromName is requesting your safety check-in status."
            }

            val wm = appContext.getSystemService(Context.WINDOW_SERVICE) as? WindowManager ?: return
            windowManager = wm

            val windowType = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
            } else {
                @Suppress("DEPRECATION")
                WindowManager.LayoutParams.TYPE_PHONE
            }

            @Suppress("DEPRECATION")
            val layoutFlags = WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or
                WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
                WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON or
                WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON

            val params = WindowManager.LayoutParams(
                WindowManager.LayoutParams.MATCH_PARENT,
                WindowManager.LayoutParams.MATCH_PARENT,
                windowType,
                layoutFlags,
                PixelFormat.TRANSLUCENT
            ).apply {
                gravity = Gravity.CENTER
            }

            val root = FrameLayout(appContext).apply {
                setBackgroundColor(Color.parseColor("#CC000000"))
                setPadding(dp(appContext, 20), dp(appContext, 24), dp(appContext, 20), dp(appContext, 24))
            }

            val card = LinearLayout(appContext).apply {
                orientation = LinearLayout.VERTICAL
                background = GradientDrawable().apply {
                    setColor(Color.parseColor("#0F172A"))
                    cornerRadius = dp(appContext, 20).toFloat()
                    setStroke(dp(appContext, 3), Color.parseColor(accentHex))
                }
                clipToOutline = true
            }

            val cardLp = FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.WRAP_CONTENT,
                Gravity.CENTER
            )

            // Header banner
            val header = LinearLayout(appContext).apply {
                orientation = LinearLayout.VERTICAL
                background = GradientDrawable().apply {
                    setColor(Color.parseColor(accentHex))
                    val r = dp(appContext, 17).toFloat()
                    cornerRadii = floatArrayOf(r, r, r, r, 0f, 0f, 0f, 0f)
                }
                setPadding(dp(appContext, 18), dp(appContext, 14), dp(appContext, 18), dp(appContext, 14))
            }

            val tagView = TextView(appContext).apply {
                text = if (isSOS) "NDRRMC LIFE DISTRESS BEACON" else "ABUCAY GUARDIAN EMERGENCY"
                setTextColor(Color.parseColor("#FEF08A"))
                setTextSize(TypedValue.COMPLEX_UNIT_SP, 11f)
                setTypeface(Typeface.DEFAULT_BOLD)
                gravity = Gravity.CENTER
            }
            val titleView = TextView(appContext).apply {
                text = headerTitle
                setTextColor(Color.WHITE)
                setTextSize(TypedValue.COMPLEX_UNIT_SP, 20f)
                setTypeface(Typeface.DEFAULT_BOLD)
                gravity = Gravity.CENTER
                setPadding(0, dp(appContext, 4), 0, 0)
            }
            header.addView(tagView)
            header.addView(titleView)
            card.addView(header)

            // Body container
            val body = LinearLayout(appContext).apply {
                orientation = LinearLayout.VERTICAL
                setPadding(dp(appContext, 20), dp(appContext, 18), dp(appContext, 20), dp(appContext, 20))
            }

            val senderView = TextView(appContext).apply {
                text = "From: $fromName"
                setTextColor(Color.WHITE)
                setTextSize(TypedValue.COMPLEX_UNIT_SP, 18f)
                setTypeface(Typeface.DEFAULT_BOLD)
                maxLines = 2
                ellipsize = TextUtils.TruncateAt.END
            }
            body.addView(senderView)

            val msgView = TextView(appContext).apply {
                text = bodyText
                setTextColor(Color.parseColor("#E2E8F0"))
                setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f)
                setPadding(0, dp(appContext, 8), 0, dp(appContext, 10))
            }
            body.addView(msgView)

            if (lat != null && lng != null) {
                val batSuffix = if (battery != null && battery >= 0) {
                    "  •  🔋 ${Math.round(battery * 100)}%"
                } else {
                    ""
                }
                val coordsView = TextView(appContext).apply {
                    text = String.format("📍 GPS: %.4f, %.4f%s", lat, lng, batSuffix)
                    setTextColor(Color.parseColor("#FCA5A5"))
                    setTextSize(TypedValue.COMPLEX_UNIT_SP, 12f)
                    setTypeface(Typeface.DEFAULT_BOLD)
                    setPadding(0, 0, 0, dp(appContext, 14))
                }
                body.addView(coordsView)
            }

            // Primary CTA: Open Full Alert inside MainActivity
            val openBtn = Button(appContext).apply {
                text = "🚨 OPEN EMERGENCY ALERT"
                isAllCaps = false
                setTextColor(Color.WHITE)
                setTextSize(TypedValue.COMPLEX_UNIT_SP, 15f)
                setTypeface(Typeface.DEFAULT_BOLD)
                background = GradientDrawable().apply {
                    setColor(Color.parseColor(accentHex))
                    cornerRadius = dp(appContext, 12).toFloat()
                }
                setPadding(dp(appContext, 14), dp(appContext, 12), dp(appContext, 14), dp(appContext, 12))
                setOnClickListener {
                    dismissOverlay(appContext)
                    tryBringMainActivityToFront(appContext, alertJson)
                }
            }
            val openLp = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply {
                bottomMargin = dp(appContext, 10)
            }
            body.addView(openBtn, openLp)

            // Secondary CTA: Silence & Dismiss
            val dismissBtn = Button(appContext).apply {
                text = "Silence & Dismiss"
                isAllCaps = false
                setTextColor(Color.parseColor("#CBD5E1"))
                setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f)
                setTypeface(Typeface.DEFAULT_BOLD)
                background = GradientDrawable().apply {
                    setColor(Color.parseColor("#1E293B"))
                    cornerRadius = dp(appContext, 12).toFloat()
                    setStroke(dp(appContext, 1), Color.parseColor("#475569"))
                }
                setPadding(dp(appContext, 14), dp(appContext, 10), dp(appContext, 14), dp(appContext, 10))
                setOnClickListener {
                    pendingAlertJson = null
                    dismissOverlay(appContext)
                    EmergencyAudioModule.stopActiveAlarm()
                    cancelSystemVibration(appContext)
                    EmergencyAudioModule.emitNativeEvent("onNativeEmergencyDismissed", null)
                }
            }
            val dismissLp = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            )
            body.addView(dismissBtn, dismissLp)

            card.addView(body)
            root.addView(card, cardLp)

            wm.addView(root, params)
            overlayView = root
        } catch (t: Throwable) {
            Log.w(TAG, "Failed to show SYSTEM_ALERT_WINDOW overlay: ${t.message}")
            overlayView = null
        }
    }

    fun dismissOverlay(context: Context) {
        val runnable = Runnable {
            val view = overlayView ?: return@Runnable
            overlayView = null
            try {
                val wm = windowManager
                    ?: (context.applicationContext.getSystemService(Context.WINDOW_SERVICE) as? WindowManager)
                wm?.removeViewImmediate(view)
            } catch (_: Throwable) {
                try {
                    val wm = windowManager
                        ?: (context.applicationContext.getSystemService(Context.WINDOW_SERVICE) as? WindowManager)
                    wm?.removeView(view)
                } catch (_: Throwable) {}
            }
        }
        if (Looper.myLooper() == Looper.getMainLooper()) {
            runnable.run()
        } else {
            mainHandler.post(runnable)
        }
    }

    private fun cancelSystemVibration(context: Context) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                val vm = context.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as? VibratorManager
                vm?.defaultVibrator?.cancel()
            } else {
                @Suppress("DEPRECATION")
                val vibrator = context.getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator
                vibrator?.cancel()
            }
        } catch (_: Throwable) {}
    }
}
