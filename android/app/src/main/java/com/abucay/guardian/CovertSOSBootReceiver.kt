package com.abucay.guardian

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * Restarts the background covert SOS monitor service automatically after device reboot
 * or app update if the user is logged in and has covert triggers enabled.
 */
class CovertSOSBootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent?) {
        val action = intent?.action ?: return
        if (action == Intent.ACTION_BOOT_COMPLETED || action == Intent.ACTION_MY_PACKAGE_REPLACED) {
            if (CovertSOSPreferences.shouldRunBackgroundService(context)) {
                CovertSOSService.startOrUpdate(context)
            }
        }
    }
}
