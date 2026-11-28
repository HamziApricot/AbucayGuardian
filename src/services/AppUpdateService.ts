import { NativeModules, Platform, DeviceEventEmitter } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';

const GITHUB_LATEST_RELEASE_URL =
  'https://api.github.com/repos/HamziApricot/AbucayGuardian/releases/latest';
const DISMISSED_UPDATE_KEY = '@abucay_dismissed_update_v1';
const DISMISS_COOLDOWN_MS = 6 * 60 * 60 * 1000; // 6 hours

export interface AppUpdateInfo {
  hasUpdate: boolean;
  currentVersion: string;
  latestVersion: string;
  releaseTitle: string;
  releaseNotes: string;
  downloadUrl: string | null;
  assetName: string;
  assetSizeBytes: number;
  releasePageUrl: string;
}

export interface DownloadProgressPayload {
  bytesWritten: number;
  totalBytes: number;
  progress: number; // 0..1, or -1 if indeterminate
}

/**
 * Normalizes a tag like "v1.0.2" -> [1, 0, 2] for numeric comparison.
 */
function parseVersionParts(raw: string): number[] {
  const cleaned = raw.trim().replace(/^v/i, '').split(/[-+]/)[0];
  return cleaned.split('.').map((seg) => {
    const num = parseInt(seg, 10);
    return Number.isFinite(num) ? num : 0;
  });
}

/**
 * Returns > 0 if remote > local, 0 if equal, < 0 if remote < local.
 */
export function compareVersions(remote: string, local: string): number {
  const a = parseVersionParts(remote);
  const b = parseVersionParts(local);
  const maxLen = Math.max(a.length, b.length);
  for (let i = 0; i < maxLen; i++) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    if (av !== bv) return av - bv;
  }
  return 0;
}

export async function getCurrentAppVersion(): Promise<{
  versionName: string;
  versionCode: number;
}> {
  if (Platform.OS === 'android' && NativeModules?.AppUpdater?.getInstalledVersion) {
    try {
      const info = await NativeModules.AppUpdater.getInstalledVersion();
      if (info?.versionName) {
        return {
          versionName: String(info.versionName),
          versionCode: Number(info.versionCode) || 1,
        };
      }
    } catch {}
  }

  return {
    versionName: Constants.expoConfig?.version || '2.0.0',
    versionCode: Number(Constants.expoConfig?.android?.versionCode) || 1,
  };
}

/**
 * Checks GitHub Releases for a newer Android APK build.
 */
export async function checkForAppUpdate(options?: {
  force?: boolean;
}): Promise<AppUpdateInfo | null> {
  if (Platform.OS !== 'android') return null;

  const { versionName: currentVersion } = await getCurrentAppVersion();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);

  try {
    const res = await fetch(GITHUB_LATEST_RELEASE_URL, {
      headers: {
        Accept: 'application/vnd.github+json',
      },
      signal: controller.signal,
    });

    if (!res.ok) return null;
    const release = await res.json();
    const rawTag = String(release?.tag_name || '');
    const latestVersion = rawTag.replace(/^v/i, '').trim();
    if (!latestVersion) return null;

    const assets: any[] = Array.isArray(release?.assets) ? release.assets : [];
    const apkAsset =
      assets.find(
        (a) =>
          typeof a?.name === 'string' && a.name.toLowerCase().endsWith('.apk')
      ) ||
      assets.find(
        (a) => a?.content_type === 'application/vnd.android.package-archive'
      );

    const hasUpdate =
      compareVersions(latestVersion, currentVersion) > 0 &&
      Boolean(apkAsset?.browser_download_url);

    if (hasUpdate && !options?.force) {
      try {
        const rawDismiss = await AsyncStorage.getItem(DISMISSED_UPDATE_KEY);
        if (rawDismiss) {
          const parsed = JSON.parse(rawDismiss);
          if (
            parsed?.version === latestVersion &&
            Date.now() - Number(parsed?.at || 0) < DISMISS_COOLDOWN_MS
          ) {
            return null;
          }
        }
      } catch {}
    }

    return {
      hasUpdate,
      currentVersion,
      latestVersion,
      releaseTitle: String(release?.name || `Version ${latestVersion}`),
      releaseNotes: String(release?.body || 'Bug fixes and stability improvements.'),
      downloadUrl: apkAsset?.browser_download_url || null,
      assetName: String(apkAsset?.name || `AbucayGuardian-v${latestVersion}.apk`),
      assetSizeBytes: Number(apkAsset?.size) || 0,
      releasePageUrl: String(
        release?.html_url || 'https://github.com/HamziApricot/AbucayGuardian/releases'
      ),
    };
  } catch (err) {
    console.log('[AppUpdateService] Update check skipped:', (err as any)?.message || err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function dismissUpdateVersion(version: string): Promise<void> {
  try {
    await AsyncStorage.setItem(
      DISMISSED_UPDATE_KEY,
      JSON.stringify({ version, at: Date.now() })
    );
  } catch {}
}

export async function canInstallUnknownApps(): Promise<boolean> {
  if (Platform.OS !== 'android' || !NativeModules?.AppUpdater?.canRequestPackageInstalls) {
    return false;
  }
  try {
    return Boolean(await NativeModules.AppUpdater.canRequestPackageInstalls());
  } catch {
    return false;
  }
}

export async function openUnknownAppsSettings(): Promise<boolean> {
  if (Platform.OS !== 'android' || !NativeModules?.AppUpdater?.openInstallUnknownAppsSettings) {
    return false;
  }
  try {
    return Boolean(await NativeModules.AppUpdater.openInstallUnknownAppsSettings());
  } catch {
    return false;
  }
}

export async function downloadUpdateApk(
  downloadUrl: string,
  fileName: string
): Promise<{ filePath: string; sizeBytes: number }> {
  if (!NativeModules?.AppUpdater?.downloadApk) {
    throw new Error('In-app updater requires a native Android build.');
  }
  return await NativeModules.AppUpdater.downloadApk(downloadUrl, fileName);
}

export async function cancelUpdateDownload(): Promise<void> {
  try {
    await NativeModules?.AppUpdater?.cancelDownload?.();
  } catch {}
}

export async function installDownloadedApk(
  filePath: string
): Promise<'STARTED' | 'NEEDS_PERMISSION'> {
  if (!NativeModules?.AppUpdater?.installApk) {
    throw new Error('In-app installer requires a native Android build.');
  }
  return await NativeModules.AppUpdater.installApk(filePath);
}

export function subscribeToDownloadProgress(
  listener: (payload: DownloadProgressPayload) => void
): () => void {
  const sub = DeviceEventEmitter.addListener('onUpdateDownloadProgress', listener);
  return () => sub.remove();
}
