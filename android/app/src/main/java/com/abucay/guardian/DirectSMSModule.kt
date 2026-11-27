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
import java.util.concurrent.Executors

@ReactModule(name = DirectSMSModule.NAME)
class DirectSMSModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    companion object {
        const val NAME = "DirectSMS"
        private val smsExecutor = Executors.newSingleThreadExecutor()
    }

    override fun getName(): String = NAME

    @Suppress("DEPRECATION")
    private fun getSmsManager(): SmsManager {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            reactApplicationContext.getSystemService(SmsManager::class.java)
                ?: SmsManager.getDefault()
        } else {
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

            // Copy and deduplicate numbers on the caller thread before dispatching asynchronously
            val recipients = LinkedHashSet<String>()
            for (i in 0 until phoneNumbers.size()) {
                val phone = phoneNumbers.getString(i)?.trim()
                if (!phone.isNullOrEmpty()) {
                    recipients.add(phone)
                }
            }

            if (recipients.isEmpty()) {
                promise.resolve(0)
                return
            }

            // Dispatch individual 1-on-1 SMS messages (never a group MMS thread) in one native batch
            smsExecutor.execute {
                try {
                    val smsManager = getSmsManager()
                    val parts = smsManager.divideMessage(message)
                    var successCount = 0

                    for (phone in recipients) {
                        try {
                            if (parts.size > 1) {
                                smsManager.sendMultipartTextMessage(phone, null, parts, null, null)
                            } else {
                                smsManager.sendTextMessage(phone, null, message, null, null)
                            }
                            successCount++
                        } catch (_: Exception) {
                            // Individual message send error, continue queuing remaining recipients
                        }
                    }

                    promise.resolve(successCount)
                } catch (e: Exception) {
                    promise.reject("SMS_FAILED", e.message, e)
                }
            }
        } catch (e: Exception) {
            promise.reject("SMS_FAILED", e.message, e)
        }
    }
}
