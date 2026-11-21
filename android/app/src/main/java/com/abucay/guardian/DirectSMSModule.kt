package com.abucay.guardian

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.telephony.SmsManager
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.module.annotations.ReactModule

@ReactModule(name = DirectSMSModule.NAME)
class DirectSMSModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    companion object {
        const val NAME = "DirectSMS"
    }

    override fun getName(): String = NAME

    private fun getSmsManager(): SmsManager {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            reactApplicationContext.getSystemService(SmsManager::class.java)
        } else {
            @Suppress("DEPRECATION")
            SmsManager.getDefault()
        }
    }

    @ReactMethod
    fun sendDirectSMS(phoneNumber: String, message: String, promise: Promise) {
        try {
            val hasPermission = ContextCompat.checkSelfPermission(
                reactApplicationContext,
                Manifest.permission.SEND_SMS
            ) == PackageManager.PERMISSION_GRANTED

            if (!hasPermission) {
                promise.reject("PERMISSION_DENIED", "SEND_SMS permission not granted")
                return
            }

            val smsManager = getSmsManager()
            val parts = smsManager.divideMessage(message)
            if (parts.size > 1) {
                smsManager.sendMultipartTextMessage(phoneNumber, null, parts, null, null)
            } else {
                smsManager.sendTextMessage(phoneNumber, null, message, null, null)
            }
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("SMS_FAILED", e.message, e)
        }
    }

    @ReactMethod
    fun sendDirectSMSToMultiple(phoneNumbers: ReadableArray, message: String, promise: Promise) {
        try {
            val hasPermission = ContextCompat.checkSelfPermission(
                reactApplicationContext,
                Manifest.permission.SEND_SMS
            ) == PackageManager.PERMISSION_GRANTED

            if (!hasPermission) {
                promise.reject("PERMISSION_DENIED", "SEND_SMS permission not granted")
                return
            }

            val smsManager = getSmsManager()
            val parts = smsManager.divideMessage(message)

            var successCount = 0
            for (i in 0 until phoneNumbers.size()) {
                val phone = phoneNumbers.getString(i)
                if (!phone.isNullOrBlank()) {
                    try {
                        if (parts.size > 1) {
                            smsManager.sendMultipartTextMessage(phone, null, parts, null, null)
                        } else {
                            smsManager.sendTextMessage(phone, null, message, null, null)
                        }
                        successCount++
                    } catch (err: Exception) {
                        // Individual message send error, continue with remaining recipients
                    }
                }
            }

            promise.resolve(successCount)
        } catch (e: Exception) {
            promise.reject("SMS_FAILED", e.message, e)
        }
    }
}
