package com.abucay.guardian

import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.util.Log
import androidx.core.content.FileProvider
import androidx.core.content.pm.PackageInfoCompat
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.module.annotations.ReactModule
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.io.File
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors

@ReactModule(name = AppUpdaterModule.NAME)
class AppUpdaterModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    companion object {
        const val NAME = "AppUpdater"
        private const val TAG = "AppUpdaterModule"
        private const val PROGRESS_EVENT = "onUpdateDownloadProgress"
        private val downloadExecutor = Executors.newSingleThreadExecutor()
    }

    @Volatile
    private var cancelRequested = false

    override fun getName(): String = NAME

    @ReactMethod
    fun getInstalledVersion(promise: Promise) {
        try {
            val ctx = reactApplicationContext
            val pm = ctx.packageManager
            val info = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                pm.getPackageInfo(ctx.packageName, PackageManager.PackageInfoFlags.of(0))
            } else {
                @Suppress("DEPRECATION")
                pm.getPackageInfo(ctx.packageName, 0)
            }
            val map = Arguments.createMap().apply {
                putString("versionName", info.versionName ?: "1.0.0")
                putDouble("versionCode", PackageInfoCompat.getLongVersionCode(info).toDouble())
            }
            promise.resolve(map)
        } catch (e: Exception) {
            promise.reject("VERSION_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun canRequestPackageInstalls(promise: Promise) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                promise.resolve(reactApplicationContext.packageManager.canRequestPackageInstalls())
            } else {
                promise.resolve(true)
            }
        } catch (e: Exception) {
            promise.resolve(false)
        }
    }

    @ReactMethod
    fun openInstallUnknownAppsSettings(promise: Promise) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                val ctx = reactApplicationContext
                val intent = Intent(
                    Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                    Uri.parse("package:${ctx.packageName}")
                ).apply {
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }
                ctx.startActivity(intent)
            }
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("SETTINGS_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun cancelDownload(promise: Promise) {
        cancelRequested = true
        promise.resolve(true)
    }

    @ReactMethod
    fun downloadApk(downloadUrl: String, fileName: String, promise: Promise) {
        cancelRequested = false
        downloadExecutor.execute {
            var connection: HttpURLConnection? = null
            try {
                val ctx = reactApplicationContext
                val updatesDir = File(ctx.cacheDir, "updates").apply { mkdirs() }
                // Clean stale cached APKs before downloading a new release
                updatesDir.listFiles()?.forEach { oldFile ->
                    if (oldFile.isFile) oldFile.delete()
                }

                val safeName = fileName.replace(Regex("[^a-zA-Z0-9._-]"), "_").ifBlank { "update.apk" }
                val finalName = if (safeName.endsWith(".apk", ignoreCase = true)) safeName else "$safeName.apk"
                val tempFile = File(updatesDir, "$finalName.part")
                val targetFile = File(updatesDir, finalName)

                connection = openConnectionWithRedirects(downloadUrl)
                val statusCode = connection.responseCode
                if (statusCode !in 200..299) {
                    throw IllegalStateException("Download failed with HTTP $statusCode")
                }

                val totalBytes = connection.getHeaderField("Content-Length")?.toLongOrNull() ?: -1L
                var bytesWritten = 0L
                var lastEmitMs = 0L
                var lastPct = -1

                connection.inputStream.use { input ->
                    FileOutputStream(tempFile).use { output ->
                        val buffer = ByteArray(16 * 1024)
                        while (true) {
                            if (cancelRequested) {
                                tempFile.delete()
                                promise.reject("CANCELLED", "Download cancelled")
                                return@execute
                            }
                            val read = input.read(buffer)
                            if (read == -1) break
                            output.write(buffer, 0, read)
                            bytesWritten += read

                            val now = System.currentTimeMillis()
                            val pct = if (totalBytes > 0) ((bytesWritten * 100) / totalBytes).toInt() else -1
                            if (now - lastEmitMs >= 120 || (pct >= 0 && pct != lastPct && pct % 2 == 0)) {
                                lastEmitMs = now
                                lastPct = pct
                                emitProgress(bytesWritten, totalBytes)
                            }
                        }
                        output.flush()
                    }
                }

                if (bytesWritten < 100_000L) {
                    tempFile.delete()
                    throw IllegalStateException("Downloaded file is too small to be a valid APK")
                }

                if (targetFile.exists()) targetFile.delete()
                if (!tempFile.renameTo(targetFile)) {
                    tempFile.copyTo(targetFile, overwrite = true)
                    tempFile.delete()
                }

                emitProgress(bytesWritten, if (totalBytes > 0) totalBytes else bytesWritten)

                val result = Arguments.createMap().apply {
                    putString("filePath", targetFile.absolutePath)
                    putDouble("sizeBytes", targetFile.length().toDouble())
                }
                promise.resolve(result)
            } catch (e: Exception) {
                Log.w(TAG, "APK download failed: ${e.message}")
                promise.reject("DOWNLOAD_FAILED", e.message ?: "Download failed", e)
            } finally {
                try {
                    connection?.disconnect()
                } catch (_: Throwable) {}
            }
        }
    }

    @ReactMethod
    fun installApk(filePath: String, promise: Promise) {
        try {
            val ctx = reactApplicationContext
            val apkFile = File(filePath)
            if (!apkFile.exists() || apkFile.length() == 0L) {
                promise.reject("FILE_MISSING", "Downloaded APK file could not be found")
                return
            }

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
                !ctx.packageManager.canRequestPackageInstalls()
            ) {
                promise.resolve("NEEDS_PERMISSION")
                return
            }

            val authority = "${ctx.packageName}.FileSystemFileProvider"
            val contentUri = FileProvider.getUriForFile(ctx, authority, apkFile)

            val installIntent = Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(contentUri, "application/vnd.android.package-archive")
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            ctx.startActivity(installIntent)
            promise.resolve("STARTED")
        } catch (e: Exception) {
            Log.w(TAG, "APK install failed: ${e.message}")
            promise.reject("INSTALL_FAILED", e.message ?: "Unable to launch package installer", e)
        }
    }

    private fun openConnectionWithRedirects(initialUrl: String): HttpURLConnection {
        var currentUrl = initialUrl
        var redirects = 0
        while (redirects < 8) {
            val conn = (URL(currentUrl).openConnection() as HttpURLConnection).apply {
                instanceFollowRedirects = false
                connectTimeout = 15_000
                readTimeout = 30_000
                setRequestProperty("User-Agent", "AbucayGuardian-Updater")
                setRequestProperty("Accept", "application/octet-stream")
            }
            conn.connect()
            val code = conn.responseCode
            if (code == HttpURLConnection.HTTP_MOVED_PERM ||
                code == HttpURLConnection.HTTP_MOVED_TEMP ||
                code == HttpURLConnection.HTTP_SEE_OTHER ||
                code == 307 ||
                code == 308
            ) {
                val location = conn.getHeaderField("Location")
                conn.disconnect()
                if (location.isNullOrBlank()) {
                    throw IllegalStateException("Redirect missing Location header")
                }
                currentUrl = URL(URL(currentUrl), location).toString()
                redirects++
            } else {
                return conn
            }
        }
        throw IllegalStateException("Too many redirects while downloading update")
    }

    private fun emitProgress(bytesWritten: Long, totalBytes: Long) {
        try {
            val ratio = if (totalBytes > 0) {
                (bytesWritten.toDouble() / totalBytes.toDouble()).coerceIn(0.0, 1.0)
            } else {
                -1.0
            }
            val payload = Arguments.createMap().apply {
                putDouble("bytesWritten", bytesWritten.toDouble())
                putDouble("totalBytes", totalBytes.toDouble())
                putDouble("progress", ratio)
            }
            reactApplicationContext
                .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                .emit(PROGRESS_EVENT, payload)
        } catch (_: Throwable) {}
    }
}
