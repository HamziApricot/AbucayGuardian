import React, { useEffect, useRef, useState } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  AppState,
  Linking,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, BorderRadius, Spacing } from '../constants/theme';
import {
  type AppUpdateInfo,
  canInstallUnknownApps,
  cancelUpdateDownload,
  dismissUpdateVersion,
  downloadUpdateApk,
  installDownloadedApk,
  openUnknownAppsSettings,
  subscribeToDownloadProgress,
} from '../services/AppUpdateService';

type UpdateStage = 'idle' | 'downloading' | 'needs_permission' | 'ready' | 'error';

interface UpdatePromptModalProps {
  visible: boolean;
  updateInfo: AppUpdateInfo | null;
  onClose: () => void;
}

function formatMegabytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '';
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const UpdatePromptModal: React.FC<UpdatePromptModalProps> = ({
  visible,
  updateInfo,
  onClose,
}) => {
  const [stage, setStage] = useState<UpdateStage>('idle');
  const [progress, setProgress] = useState(0);
  const [bytesWritten, setBytesWritten] = useState(0);
  const [totalBytes, setTotalBytes] = useState(0);
  const [downloadedPath, setDownloadedPath] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const waitingForPermissionRef = useRef(false);

  // Reset modal state whenever a different update payload opens
  useEffect(() => {
    if (visible) {
      setStage('idle');
      setProgress(0);
      setBytesWritten(0);
      setTotalBytes(updateInfo?.assetSizeBytes || 0);
      setDownloadedPath(null);
      setErrorMessage(null);
      waitingForPermissionRef.current = false;
    }
  }, [visible, updateInfo?.latestVersion]);

  // Listen to native APK download progress events
  useEffect(() => {
    if (!visible) return;
    return subscribeToDownloadProgress((payload) => {
      setBytesWritten(payload.bytesWritten || 0);
      if (payload.totalBytes > 0) {
        setTotalBytes(payload.totalBytes);
      }
      if (payload.progress >= 0) {
        setProgress(payload.progress);
      }
    });
  }, [visible]);

  // Automatically resume installation once user returns from "Install unknown apps" Settings
  useEffect(() => {
    if (!visible) return;
    const sub = AppState.addEventListener('change', async (nextState) => {
      if (nextState === 'active' && waitingForPermissionRef.current && downloadedPath) {
        const allowed = await canInstallUnknownApps();
        if (allowed) {
          waitingForPermissionRef.current = false;
          try {
            const status = await installDownloadedApk(downloadedPath);
            if (status === 'STARTED') {
              setStage('ready');
            }
          } catch (err: any) {
            setStage('error');
            setErrorMessage(err?.message || 'Unable to launch APK installer.');
          }
        }
      }
    });
    return () => sub.remove();
  }, [visible, downloadedPath]);

  if (!visible || !updateInfo) return null;

  const triggerInstall = async (apkPath: string) => {
    const status = await installDownloadedApk(apkPath);
    if (status === 'NEEDS_PERMISSION') {
      waitingForPermissionRef.current = true;
      setStage('needs_permission');
    } else {
      setStage('ready');
    }
  };

  const handleDownloadAndInstall = async () => {
    if (stage === 'downloading') return;

    if (downloadedPath && stage === 'needs_permission') {
      waitingForPermissionRef.current = true;
      await openUnknownAppsSettings();
      return;
    }

    if (downloadedPath && stage === 'ready') {
      try {
        await triggerInstall(downloadedPath);
      } catch (err: any) {
        setStage('error');
        setErrorMessage(err?.message || 'Unable to open installer.');
      }
      return;
    }

    if (!updateInfo.downloadUrl) {
      Linking.openURL(updateInfo.releasePageUrl).catch(() => {});
      return;
    }

    setErrorMessage(null);
    setProgress(0);
    setBytesWritten(0);
    setStage('downloading');

    try {
      const result = await downloadUpdateApk(
        updateInfo.downloadUrl,
        updateInfo.assetName
      );
      setDownloadedPath(result.filePath);
      setProgress(1);
      await triggerInstall(result.filePath);
    } catch (err: any) {
      if (err?.code === 'CANCELLED') {
        setStage('idle');
        return;
      }
      setStage('error');
      setErrorMessage(
        err?.message || 'Download failed. Please check your connection and try again.'
      );
    }
  };

  const handleDismiss = async () => {
    if (stage === 'downloading') {
      await cancelUpdateDownload();
    }
    waitingForPermissionRef.current = false;
    await dismissUpdateVersion(updateInfo.latestVersion);
    onClose();
  };

  const pctDisplay = Math.round(progress * 100);
  const sizeLabel = formatMegabytes(totalBytes || updateInfo.assetSizeBytes);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={handleDismiss}
    >
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <View style={styles.header}>
            <View style={styles.iconBadge}>
              <Ionicons name="cloud-download" size={24} color={Colors.white} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.badgeLabel}>APP UPDATE AVAILABLE</Text>
              <Text style={styles.title} numberOfLines={2}>
                Abucay Guardian v{updateInfo.latestVersion}
              </Text>
              <Text style={styles.versionMeta}>
                Installed: v{updateInfo.currentVersion}
                {sizeLabel ? `  •  ${sizeLabel}` : ''}
              </Text>
            </View>
          </View>

          <View style={styles.notesBox}>
            <Text style={styles.notesHeader}>What&apos;s New</Text>
            <ScrollView style={styles.notesScroll} showsVerticalScrollIndicator>
              <Text style={styles.notesText}>{updateInfo.releaseNotes}</Text>
            </ScrollView>
          </View>

          {stage === 'downloading' && (
            <View style={styles.progressSection}>
              <View style={styles.progressRow}>
                <Text style={styles.progressLabel}>Downloading update...</Text>
                <Text style={styles.progressPct}>{pctDisplay}%</Text>
              </View>
              <View style={styles.progressTrack}>
                <View style={[styles.progressFill, { width: `${pctDisplay}%` }]} />
              </View>
              {bytesWritten > 0 && (
                <Text style={styles.progressBytes}>
                  {formatMegabytes(bytesWritten)}
                  {sizeLabel ? ` / ${sizeLabel}` : ''}
                </Text>
              )}
            </View>
          )}

          {stage === 'needs_permission' && (
            <View style={styles.permissionBanner}>
              <Ionicons name="shield-checkmark" size={18} color="#B45309" />
              <Text style={styles.permissionText}>
                Tap <Text style={{ fontWeight: '800' }}>Allow & Install</Text> to enable
                &quot;Install unknown apps&quot; for Abucay Guardian. Installation will resume
                automatically when you return.
              </Text>
            </View>
          )}

          {stage === 'error' && errorMessage && (
            <View style={styles.errorBanner}>
              <Ionicons name="alert-circle" size={18} color={Colors.sosDark} />
              <Text style={styles.errorText}>{errorMessage}</Text>
            </View>
          )}

          <View style={styles.actions}>
            <TouchableOpacity
              style={styles.laterBtn}
              onPress={handleDismiss}
              activeOpacity={0.75}
            >
              <Text style={styles.laterBtnText}>
                {stage === 'downloading' ? 'Cancel' : 'Later'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.downloadBtn,
                stage === 'downloading' && styles.downloadBtnBusy,
              ]}
              onPress={handleDownloadAndInstall}
              disabled={stage === 'downloading'}
              activeOpacity={0.85}
            >
              {stage === 'downloading' ? (
                <ActivityIndicator size="small" color={Colors.white} />
              ) : (
                <Ionicons
                  name={
                    stage === 'needs_permission'
                      ? 'settings-outline'
                      : stage === 'ready'
                      ? 'checkmark-circle'
                      : 'download-outline'
                  }
                  size={18}
                  color={Colors.white}
                />
              )}
              <Text style={styles.downloadBtnText}>
                {stage === 'downloading'
                  ? `Downloading ${pctDisplay}%`
                  : stage === 'needs_permission'
                  ? 'Allow & Install'
                  : stage === 'ready'
                  ? 'Install Update'
                  : stage === 'error'
                  ? 'Retry Download'
                  : 'Download & Install'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(9, 20, 50, 0.72)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.lg,
  },
  card: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: Colors.white,
    borderRadius: BorderRadius.xl,
    padding: Spacing.lg,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.25,
    shadowRadius: 20,
    elevation: 14,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: Spacing.md,
  },
  iconBadge: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: Colors.secondary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeLabel: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.9,
    color: Colors.family,
    marginBottom: 2,
  },
  title: {
    fontSize: 18,
    fontWeight: '800',
    color: Colors.text,
  },
  versionMeta: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.textLight,
    marginTop: 2,
  },
  notesBox: {
    backgroundColor: Colors.background,
    borderRadius: BorderRadius.md,
    padding: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: Spacing.md,
  },
  notesHeader: {
    fontSize: 12,
    fontWeight: '800',
    color: Colors.secondary,
    marginBottom: 6,
  },
  notesScroll: {
    maxHeight: 150,
  },
  notesText: {
    fontSize: 12.5,
    lineHeight: 18,
    color: '#334155',
  },
  progressSection: {
    marginBottom: Spacing.md,
  },
  progressRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  progressLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.secondary,
  },
  progressPct: {
    fontSize: 12,
    fontWeight: '800',
    color: Colors.family,
  },
  progressTrack: {
    height: 8,
    borderRadius: 4,
    backgroundColor: '#E2E8F0',
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: Colors.family,
    borderRadius: 4,
  },
  progressBytes: {
    fontSize: 11,
    color: Colors.textLight,
    marginTop: 4,
    textAlign: 'right',
  },
  permissionBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: '#FEF3C7',
    borderRadius: BorderRadius.md,
    padding: 10,
    marginBottom: Spacing.md,
  },
  permissionText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 17,
    color: '#92400E',
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FEE2E2',
    borderRadius: BorderRadius.md,
    padding: 10,
    marginBottom: Spacing.md,
  },
  errorText: {
    flex: 1,
    fontSize: 12,
    color: Colors.sosDark,
    fontWeight: '600',
  },
  actions: {
    flexDirection: 'row',
    gap: 10,
  },
  laterBtn: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: BorderRadius.md,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  laterBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.textLight,
  },
  downloadBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: BorderRadius.md,
    backgroundColor: Colors.secondary,
  },
  downloadBtnBusy: {
    opacity: 0.85,
  },
  downloadBtnText: {
    fontSize: 14,
    fontWeight: '800',
    color: Colors.white,
  },
});
