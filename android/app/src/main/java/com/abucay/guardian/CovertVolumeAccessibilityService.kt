package com.abucay.guardian

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.AccessibilityServiceInfo
import android.content.Intent
import android.util.Log
import android.view.KeyEvent
import android.view.accessibility.AccessibilityEvent

/**
 * Optional system-wide AccessibilityService that intercepts hardware volume button presses
 * (UP -> UP -> DOWN -> UP) when the app is minimized, over other apps, on the lock screen,
 * or even when device volume is already at 0% or 100%.
 *
 * Configured with `canRetrieveWindowContent="false"` so it never reads screen content.
 */
class CovertVolumeAccessibilityService : AccessibilityService() {
    companion object {
        private const val TAG = "CovertVolAccessSvc"

        @Volatile
        var isRunning: Boolean = false
            private set
    }

    private val matcher = VolumePatternMatcher()
    private var suppressNextUpKeyCode: Int? = null

    override fun onServiceConnected() {
        super.onServiceConnected()
        isRunning = true
        val info = serviceInfo ?: AccessibilityServiceInfo()
        info.flags = info.flags or AccessibilityServiceInfo.FLAG_REQUEST_FILTER_KEY_EVENTS
        serviceInfo = info
        Log.i(TAG, "CovertVolumeAccessibilityService connected")
    }

    override fun onKeyEvent(event: KeyEvent?): Boolean {
        if (event == null) return false

        val keyCode = event.keyCode
        if (keyCode != KeyEvent.KEYCODE_VOLUME_UP && keyCode != KeyEvent.KEYCODE_VOLUME_DOWN) {
            return false
        }

        if (!CovertSOSPreferences.isLoggedIn(this) || !CovertSOSPreferences.isVolumePatternEnabled(this)) {
            matcher.reset()
            suppressNextUpKeyCode = null
            return false
        }

        if (event.action == KeyEvent.ACTION_UP && suppressNextUpKeyCode == keyCode) {
            suppressNextUpKeyCode = null
            return true
        }

        if (event.action == KeyEvent.ACTION_DOWN && event.repeatCount == 0) {
            if (matcher.recordPress(keyCode)) {
                suppressNextUpKeyCode = keyCode
                Log.i(TAG, "AccessibilityService matched covert volume sequence -> dispatching Silent SOS")
                CovertSOSDispatcher.dispatchCovertSOS(this, "volume")
                return true // Consume the final trigger press silently
            }
        }

        return false
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        // Not used; we only filter hardware volume KeyEvents
    }

    override fun onInterrupt() {
        matcher.reset()
        suppressNextUpKeyCode = null
    }

    override fun onUnbind(intent: Intent?): Boolean {
        isRunning = false
        matcher.reset()
        suppressNextUpKeyCode = null
        return super.onUnbind(intent)
    }

    override fun onDestroy() {
        isRunning = false
        matcher.reset()
        suppressNextUpKeyCode = null
        super.onDestroy()
    }
}
