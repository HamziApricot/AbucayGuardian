package com.abucay.guardian

import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.media.MediaPlayer
import android.net.Uri
import android.os.Build
import android.provider.Settings
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.module.annotations.ReactModule

@ReactModule(name = EmergencyAudioModule.NAME)
class EmergencyAudioModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    companion object {
        const val NAME = "EmergencyAudio"
    }

    private var mediaPlayer: MediaPlayer? = null
    private var previousAlarmVolume: Int? = null
    private var audioFocusRequest: AudioFocusRequest? = null

    override fun getName(): String = NAME

    @ReactMethod
    fun playAlarmSound(soundName: String, loop: Boolean, promise: Promise) {
        try {
            stopAlarmInternal()

            val context = reactApplicationContext
            val resId = context.resources.getIdentifier(soundName, "raw", context.packageName)
            if (resId == 0) {
                promise.reject("RESOURCE_NOT_FOUND", "Raw sound '$soundName' not found")
                return
            }

            val audioManager = context.getSystemService(Context.AUDIO_SERVICE) as? AudioManager

            // 1. Ensure STREAM_ALARM is at an audible level (at least 85% of max)
            if (audioManager != null) {
                try {
                    val currentVol = audioManager.getStreamVolume(AudioManager.STREAM_ALARM)
                    val maxVol = audioManager.getStreamMaxVolume(AudioManager.STREAM_ALARM)
                    if (previousAlarmVolume == null) {
                        previousAlarmVolume = currentVol
                    }
                    val targetVol = (maxVol * 0.85).toInt().coerceAtLeast(1)
                    if (currentVol < targetVol) {
                        audioManager.setStreamVolume(AudioManager.STREAM_ALARM, targetVol, 0)
                    }
                } catch (_: Exception) {}
            }

            // 2. Build AudioAttributes with USAGE_ALARM & FLAG_AUDIBILITY_ENFORCED
            // This guarantees the hardware alarm stream is used, bypassing Silent and Vibrate modes.
            val audioAttributes = AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_ALARM)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .setFlags(AudioAttributes.FLAG_AUDIBILITY_ENFORCED)
                .build()

            // 3. Request transient audio focus so any other media playing ducks or pauses
            if (audioManager != null) {
                try {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                        val focusReq = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_EXCLUSIVE)
                            .setAudioAttributes(audioAttributes)
                            .build()
                        audioFocusRequest = focusReq
                        audioManager.requestAudioFocus(focusReq)
                    } else {
                        @Suppress("DEPRECATION")
                        audioManager.requestAudioFocus(null, AudioManager.STREAM_ALARM, AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)
                    }
                } catch (_: Exception) {}
            }

            // 4. Initialize MediaPlayer configured for hardware alarm playback
            val player = MediaPlayer()
            player.setAudioAttributes(audioAttributes)

            var configured = false
            try {
                val afd = context.resources.openRawResourceFd(resId)
                if (afd != null) {
                    player.setDataSource(afd.fileDescriptor, afd.startOffset, afd.length)
                    afd.close()
                    configured = true
                }
            } catch (_: Exception) {}

            if (!configured) {
                val uri = Uri.parse("android.resource://${context.packageName}/$resId")
                player.setDataSource(context, uri)
            }

            player.isLooping = loop
            player.setVolume(1.0f, 1.0f)
            player.setOnCompletionListener {
                if (!loop) {
                    stopAlarmInternal()
                }
            }
            player.prepare()
            player.start()
            mediaPlayer = player

            promise.resolve(true)
        } catch (e: Exception) {
            stopAlarmInternal()
            promise.reject("PLAYBACK_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun stopAlarmSound(promise: Promise? = null) {
        try {
            stopAlarmInternal()
            promise?.resolve(true)
        } catch (e: Exception) {
            promise?.resolve(false)
        }
    }

    @ReactMethod
    fun isPlaying(promise: Promise) {
        promise.resolve(mediaPlayer?.isPlaying == true)
    }

    @ReactMethod
    fun isDndAccessGranted(promise: Promise) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            val notificationManager =
                reactApplicationContext.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager
            promise.resolve(notificationManager?.isNotificationPolicyAccessGranted == true)
        } else {
            promise.resolve(true)
        }
    }

    @ReactMethod
    fun openDndSettings(promise: Promise) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                val intent = Intent(Settings.ACTION_NOTIFICATION_POLICY_ACCESS_SETTINGS).apply {
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }
                reactApplicationContext.startActivity(intent)
                promise.resolve(true)
            } else {
                promise.resolve(false)
            }
        } catch (e: Exception) {
            promise.reject("SETTINGS_ERROR", e.message, e)
        }
    }

    private fun stopAlarmInternal() {
        try {
            mediaPlayer?.let {
                if (it.isPlaying) {
                    it.stop()
                }
                it.release()
            }
            mediaPlayer = null

            val context = reactApplicationContext
            val audioManager = context.getSystemService(Context.AUDIO_SERVICE) as? AudioManager

            // Restore user's previous volume
            if (audioManager != null && previousAlarmVolume != null) {
                try {
                    audioManager.setStreamVolume(AudioManager.STREAM_ALARM, previousAlarmVolume!!, 0)
                } catch (_: Exception) {}
                previousAlarmVolume = null
            }

            // Release transient Audio Focus
            if (audioManager != null) {
                try {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && audioFocusRequest != null) {
                        audioManager.abandonAudioFocusRequest(audioFocusRequest!!)
                        audioFocusRequest = null
                    } else {
                        @Suppress("DEPRECATION")
                        audioManager.abandonAudioFocus(null)
                    }
                } catch (_: Exception) {}
            }
        } catch (_: Exception) {}
    }
}

