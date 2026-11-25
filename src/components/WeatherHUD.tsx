import React, { useState, useEffect, useRef } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Animated,
  Platform,
  Linking,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  type PointForecast,
  type RadarFrame,
  getWeatherCondition,
  formatRadarFrameLabel,
  formatHourlyTime,
  degreesToCardinal,
} from '../services/WeatherService';
import { triggerSilentSOS } from '../services/SilentSOSService';

export type WeatherDisplayMode = 'both' | 'radar' | 'wind';

interface WeatherHUDProps {
  forecast: PointForecast | null;
  radarFrames: RadarFrame[];
  activeFrameIndex: number;
  onSelectFrameIndex: (idx: number) => void;
  selectedHourIndex: number;
  onSelectHourIndex: (idx: number) => void;
  displayMode: WeatherDisplayMode;
  onChangeDisplayMode: (mode: WeatherDisplayMode) => void;
  onClose?: () => void;
  onRefresh?: () => void;
  isLoading?: boolean;
  bottomOffset?: number;
}

export const WeatherHUD: React.FC<WeatherHUDProps> = ({
  forecast,
  radarFrames,
  activeFrameIndex,
  onSelectFrameIndex,
  selectedHourIndex,
  onSelectHourIndex,
  displayMode,
  onChangeDisplayMode,
  onClose,
  onRefresh,
  isLoading = false,
  bottomOffset = 24,
}) => {
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [isMinimized, setIsMinimized] = useState<boolean>(false);
  const [timelineTab, setTimelineTab] = useState<'radar' | 'forecast'>('radar');
  const scrollViewRef = useRef<any>(null);
  const covertTapTimestamps = useRef<number[]>([]);

  const handleCovertWeatherTap = () => {
    const now = Date.now();
    // Keep taps within the last 2000ms
    covertTapTimestamps.current = [...covertTapTimestamps.current, now].filter(
      (t) => now - t < 2000
    );

    if (covertTapTimestamps.current.length >= 5) {
      covertTapTimestamps.current = [];
      console.log('[WeatherHUD] 5 covert taps detected -> triggering Silent SOS');
      triggerSilentSOS('weather');
    }
  };

  const hourly = forecast?.hourly;
  const currentTemp = hourly?.temperature_2m?.[selectedHourIndex] ?? 28;
  const currentRain = hourly?.rain?.[selectedHourIndex] ?? 0;
  const currentRainProb = hourly?.precipitation_probability?.[selectedHourIndex] ?? 0;
  const currentWindSpeed = hourly?.wind_speed_10m?.[selectedHourIndex] ?? 12;
  const currentWindDir = hourly?.wind_direction_10m?.[selectedHourIndex] ?? 0;
  const currentWeatherCode = hourly?.weather_code?.[selectedHourIndex] ?? 1;

  const condition = getWeatherCondition(currentWeatherCode);
  const cardinal = degreesToCardinal(currentWindDir);

  // Auto-play loop for radar frames or forecast hours
  useEffect(() => {
    if (!isPlaying) return;

    const timer = setInterval(() => {
      if (timelineTab === 'radar') {
        if (radarFrames.length > 0) {
          onSelectFrameIndex((activeFrameIndex + 1) % radarFrames.length);
        }
      } else {
        if (hourly?.time && hourly.time.length > 0) {
          onSelectHourIndex((selectedHourIndex + 1) % Math.min(24, hourly.time.length));
        }
      }
    }, 1200);

    return () => clearInterval(timer);
  }, [
    isPlaying,
    timelineTab,
    activeFrameIndex,
    radarFrames.length,
    selectedHourIndex,
    hourly?.time?.length,
    onSelectFrameIndex,
    onSelectHourIndex,
  ]);

  // Active radar frame timestamp
  const activeFrame = radarFrames[activeFrameIndex];
  const activeFrameLabel = activeFrame
    ? formatRadarFrameLabel(activeFrame.time, activeFrameIndex >= Math.max(0, radarFrames.length - 2))
    : null;

  return (
    <View style={[styles.outerContainer, { bottom: bottomOffset }]} pointerEvents="box-none">
      <View style={styles.hudCard}>
        {/* Header Bar */}
        <View style={styles.headerRow}>
          <View style={styles.headerLeft}>
            <View style={[styles.statusPill, { backgroundColor: condition.color + '25' }]}>
              <Ionicons name={condition.icon as any} size={15} color={condition.color} />
              <Text style={[styles.statusPillText, { color: condition.color }]}>
                {condition.label.toUpperCase()}
              </Text>
            </View>

            {isMinimized ? (
              <TouchableOpacity
                style={styles.minimizedMetricsRow}
                activeOpacity={1}
                onPress={handleCovertWeatherTap}
              >
                <Text style={styles.minimizedTempText}>{Math.round(currentTemp)}°C</Text>
                <View style={styles.minimizedDivider} />
                <View
                  style={[
                    styles.windArrowWrapper,
                    { transform: [{ rotate: `${currentWindDir}deg` }] },
                  ]}
                >
                  <Ionicons name="arrow-up" size={11} color="#10B981" />
                </View>
                <Text style={styles.minimizedWindText}>
                  {Math.round(currentWindSpeed)} km/h {cardinal}
                </Text>
              </TouchableOpacity>
            ) : (
              timelineTab === 'radar' && activeFrameLabel && (
                <View style={styles.radarTimeTag}>
                  <View style={styles.livePulseDot} />
                  <Text style={styles.radarTimeText}>
                    {activeFrameLabel.tag} • {activeFrameLabel.timeStr}
                  </Text>
                </View>
              )
            )}
          </View>

          <View style={styles.headerRight}>
            <TouchableOpacity
              style={styles.iconBtn}
              onPress={() => setIsMinimized(!isMinimized)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons
                name={isMinimized ? 'chevron-up' : 'chevron-down'}
                size={18}
                color="#94A3B8"
              />
            </TouchableOpacity>

            {onClose && (
              <TouchableOpacity
                style={styles.iconBtn}
                onPress={onClose}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Ionicons name="close" size={18} color="#94A3B8" />
              </TouchableOpacity>
            )}
          </View>
        </View>

        {!isMinimized && (
          <>
            {/* Live Weather Metrics Row */}
            <View style={styles.metricsRow}>
              {/* Temperature - Hidden Covert Multi-Tap (5 taps triggers Silent SOS) */}
              <TouchableOpacity
                style={styles.metricItem}
                activeOpacity={1}
                onPress={handleCovertWeatherTap}
              >
                <Text style={styles.metricValue}>{Math.round(currentTemp)}°C</Text>
                <Text style={styles.metricLabel}>Temp</Text>
              </TouchableOpacity>

              <View style={styles.divider} />

              {/* Rain / Precipitation */}
              <View style={styles.metricItem}>
                <View style={styles.metricValueRow}>
                  <Ionicons name="water" size={13} color="#38BDF8" style={{ marginRight: 3 }} />
                  <Text style={styles.metricValue}>
                    {currentRain.toFixed(1)} <Text style={styles.metricUnit}>mm</Text>
                  </Text>
                </View>
                <Text style={styles.metricLabel}>{currentRainProb}% rain chance</Text>
              </View>

              <View style={styles.divider} />

              {/* Wind Speed & Rotated Direction Vector Arrow */}
              <View style={styles.metricItem}>
                <View style={styles.metricValueRow}>
                  <View
                    style={[
                      styles.windArrowWrapper,
                      { transform: [{ rotate: `${currentWindDir}deg` }] },
                    ]}
                  >
                    <Ionicons name="arrow-up" size={13} color="#10B981" />
                  </View>
                  <Text style={styles.metricValue}>
                    {Math.round(currentWindSpeed)} <Text style={styles.metricUnit}>km/h</Text>
                  </Text>
                </View>
                <Text style={styles.metricLabel}>Wind • {cardinal}</Text>
              </View>

              <View style={styles.divider} />

              {/* Layer Mode Switcher Pill */}
              <View style={styles.modeToggleGroup}>
                <TouchableOpacity
                  style={[
                    styles.modeBtn,
                    displayMode === 'both' && styles.modeBtnActive,
                  ]}
                  onPress={() => onChangeDisplayMode('both')}
                >
                  <Text
                    style={[
                      styles.modeBtnText,
                      displayMode === 'both' && styles.modeBtnTextActive,
                    ]}
                  >
                    All
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.modeBtn,
                    displayMode === 'radar' && styles.modeBtnActive,
                  ]}
                  onPress={() => onChangeDisplayMode('radar')}
                >
                  <Text
                    style={[
                      styles.modeBtnText,
                      displayMode === 'radar' && styles.modeBtnTextActive,
                    ]}
                  >
                    Rain
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.modeBtn,
                    displayMode === 'wind' && styles.modeBtnActive,
                  ]}
                  onPress={() => onChangeDisplayMode('wind')}
                >
                  <Text
                    style={[
                      styles.modeBtnText,
                      displayMode === 'wind' && styles.modeBtnTextActive,
                    ]}
                  >
                    Wind
                  </Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* Weather Advisory Banner (if severe rain, storm, or typhoon conditions) */}
            {condition.advisory && (
              <View
                style={[
                  styles.advisoryBanner,
                  { backgroundColor: condition.severity === 'alert' ? '#FEF2F2' : '#FFFBEB' },
                  { borderColor: condition.severity === 'alert' ? '#FCA5A5' : '#FDE68A' },
                ]}
              >
                <Ionicons
                  name={condition.severity === 'alert' ? 'warning' : 'information-circle'}
                  size={15}
                  color={condition.color}
                />
                <Text
                  style={[
                    styles.advisoryText,
                    { color: condition.severity === 'alert' ? '#991B1B' : '#92400E' },
                  ]}
                  numberOfLines={2}
                >
                  {condition.advisory}
                </Text>
              </View>
            )}

            {/* Timeline Controls & Tab Bar */}
            <View style={styles.timelineControlRow}>
              <View style={styles.timelineTabs}>
                <TouchableOpacity
                  style={[
                    styles.timelineTabBtn,
                    timelineTab === 'radar' && styles.timelineTabBtnActive,
                  ]}
                  onPress={() => setTimelineTab('radar')}
                >
                  <Text
                    style={[
                      styles.timelineTabText,
                      timelineTab === 'radar' && styles.timelineTabTextActive,
                    ]}
                  >
                    Radar Loop ({radarFrames.length})
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.timelineTabBtn,
                    timelineTab === 'forecast' && styles.timelineTabBtnActive,
                  ]}
                  onPress={() => setTimelineTab('forecast')}
                >
                  <Text
                    style={[
                      styles.timelineTabText,
                      timelineTab === 'forecast' && styles.timelineTabTextActive,
                    ]}
                  >
                    48h Forecast
                  </Text>
                </TouchableOpacity>
              </View>

              {/* Play / Pause Animated Scrubber Button */}
              <TouchableOpacity
                style={[styles.playBtn, isPlaying && styles.playBtnActive]}
                onPress={() => setIsPlaying(!isPlaying)}
              >
                <Ionicons
                  name={isPlaying ? 'pause' : 'play'}
                  size={13}
                  color="#FFFFFF"
                />
                <Text style={styles.playBtnText}>{isPlaying ? 'Pause' : 'Play Loop'}</Text>
              </TouchableOpacity>
            </View>

            {/* Horizontal Timeline Scrubber */}
            <ScrollView
              ref={scrollViewRef}
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.timelineScroller}
            >
              {timelineTab === 'radar' ? (
                radarFrames.length > 0 ? (
                  radarFrames.map((frame, idx) => {
                    const isSelected = idx === activeFrameIndex;
                    const date = new Date(frame.time * 1000);
                    const timeLabel = date.toLocaleTimeString([], {
                      hour: 'numeric',
                      minute: '2-digit',
                    });
                    const isLive = idx === radarFrames.length - 1;

                    return (
                      <TouchableOpacity
                        key={`frame-${frame.time}-${idx}`}
                        style={[
                          styles.timelineChip,
                          isSelected && styles.timelineChipSelected,
                        ]}
                        onPress={() => onSelectFrameIndex(idx)}
                      >
                        <Text
                          style={[
                            styles.timelineChipTime,
                            isSelected && styles.timelineChipTimeSelected,
                          ]}
                        >
                          {timeLabel}
                        </Text>
                        <Text
                          style={[
                            styles.timelineChipSub,
                            isSelected && styles.timelineChipSubSelected,
                            isLive && { color: '#10B981', fontWeight: '800' },
                          ]}
                        >
                          {isLive ? 'LIVE' : `-${(radarFrames.length - 1 - idx) * 10}m`}
                        </Text>
                      </TouchableOpacity>
                    );
                  })
                ) : (
                  <Text style={styles.loadingFramesText}>Loading radar frames...</Text>
                )
              ) : (
                hourly?.time?.slice(0, 24).map((timeStr, idx) => {
                  const isSelected = idx === selectedHourIndex;
                  const timeLabel = formatHourlyTime(timeStr);
                  const temp = Math.round(hourly.temperature_2m[idx]);
                  const rain = hourly.rain[idx];
                  const code = hourly.weather_code[idx];
                  const hourCond = getWeatherCondition(code);

                  return (
                    <TouchableOpacity
                      key={`hour-${timeStr}-${idx}`}
                      style={[
                        styles.timelineChip,
                        isSelected && styles.timelineChipSelected,
                      ]}
                      onPress={() => onSelectHourIndex(idx)}
                    >
                      <Text
                        style={[
                          styles.timelineChipTime,
                          isSelected && styles.timelineChipTimeSelected,
                        ]}
                      >
                        {timeLabel}
                      </Text>
                      <Ionicons
                        name={hourCond.icon as any}
                        size={12}
                        color={isSelected ? '#38BDF8' : '#94A3B8'}
                        style={{ marginVertical: 2 }}
                      />
                      <Text
                        style={[
                          styles.timelineChipSub,
                          isSelected && styles.timelineChipSubSelected,
                        ]}
                      >
                        {temp}°{rain > 0 ? ` • ${rain}m` : ''}
                      </Text>
                    </TouchableOpacity>
                  );
                })
              )}
            </ScrollView>

            {/* Attribution note (Required by RainViewer & Open-Meteo free tier) */}
            <View style={styles.attributionRow}>
              <Text style={styles.attributionText}>
                Weather data by{' '}
                <Text
                  style={styles.attributionLink}
                  onPress={() => Linking.openURL('https://www.rainviewer.com')}
                >
                  RainViewer
                </Text>{' '}
                &{' '}
                <Text
                  style={styles.attributionLink}
                  onPress={() => Linking.openURL('https://open-meteo.com')}
                >
                  Open-Meteo
                </Text>
              </Text>

              {isLoading && (
                <Text style={styles.syncingText}>Updating...</Text>
              )}
            </View>
          </>
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  outerContainer: {
    position: 'absolute',
    left: 12,
    right: 12,
    zIndex: 9999,
    elevation: 25,
  },
  minimizedMetricsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(30, 41, 59, 0.75)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(71, 85, 105, 0.4)',
  },
  minimizedTempText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '800',
  },
  minimizedDivider: {
    width: 1,
    height: 12,
    backgroundColor: 'rgba(100, 116, 139, 0.5)',
    marginHorizontal: 2,
  },
  minimizedWindText: {
    color: '#CBD5E1',
    fontSize: 10,
    fontWeight: '700',
  },
  hudCard: {
    backgroundColor: 'rgba(15, 23, 42, 0.94)',
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 10,
    borderWidth: 1,
    borderColor: 'rgba(51, 65, 85, 0.8)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 12,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexShrink: 1,
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  statusPillText: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  radarTimeTag: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(30, 41, 59, 0.8)',
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
    gap: 5,
  },
  livePulseDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#10B981',
  },
  radarTimeText: {
    color: '#CBD5E1',
    fontSize: 10,
    fontWeight: '700',
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  iconBtn: {
    padding: 4,
    backgroundColor: 'rgba(30, 41, 59, 0.85)',
    borderRadius: 6,
  },
  metricsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
    backgroundColor: 'rgba(30, 41, 59, 0.55)',
    borderRadius: 12,
    paddingHorizontal: 10,
    marginBottom: 8,
  },
  metricItem: {
    alignItems: 'center',
  },
  metricValue: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '800',
  },
  metricUnit: {
    fontSize: 11,
    color: '#94A3B8',
    fontWeight: '600',
  },
  metricValueRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  metricLabel: {
    color: '#94A3B8',
    fontSize: 9.5,
    fontWeight: '600',
    marginTop: 1,
  },
  divider: {
    width: 1,
    height: 22,
    backgroundColor: 'rgba(71, 85, 105, 0.5)',
  },
  windArrowWrapper: {
    marginRight: 3,
  },
  modeToggleGroup: {
    flexDirection: 'row',
    backgroundColor: 'rgba(15, 23, 42, 0.8)',
    borderRadius: 8,
    padding: 2,
    gap: 2,
  },
  modeBtn: {
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
  },
  modeBtnActive: {
    backgroundColor: '#2563EB',
  },
  modeBtnText: {
    color: '#94A3B8',
    fontSize: 10,
    fontWeight: '700',
  },
  modeBtnTextActive: {
    color: '#FFFFFF',
  },
  advisoryBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    gap: 6,
    marginBottom: 8,
  },
  advisoryText: {
    fontSize: 10.5,
    fontWeight: '700',
    flex: 1,
  },
  timelineControlRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  timelineTabs: {
    flexDirection: 'row',
    gap: 6,
  },
  timelineTabBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: 'rgba(30, 41, 59, 0.8)',
  },
  timelineTabBtnActive: {
    backgroundColor: '#334155',
    borderWidth: 1,
    borderColor: '#38BDF8',
  },
  timelineTabText: {
    color: '#94A3B8',
    fontSize: 10,
    fontWeight: '700',
  },
  timelineTabTextActive: {
    color: '#FFFFFF',
  },
  playBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#2563EB',
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 6,
  },
  playBtnActive: {
    backgroundColor: '#DC2626',
  },
  playBtnText: {
    color: '#FFFFFF',
    fontSize: 10.5,
    fontWeight: '800',
  },
  timelineScroller: {
    flexDirection: 'row',
    gap: 6,
    paddingVertical: 2,
  },
  timelineChip: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(30, 41, 59, 0.7)',
    paddingHorizontal: 9,
    paddingVertical: 6,
    borderRadius: 8,
    minWidth: 54,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  timelineChipSelected: {
    backgroundColor: '#1E293B',
    borderColor: '#38BDF8',
    transform: [{ scale: 1.05 }],
  },
  timelineChipTime: {
    color: '#CBD5E1',
    fontSize: 10,
    fontWeight: '700',
  },
  timelineChipTimeSelected: {
    color: '#FFFFFF',
    fontWeight: '800',
  },
  timelineChipSub: {
    color: '#64748B',
    fontSize: 9,
    fontWeight: '600',
    marginTop: 1,
  },
  timelineChipSubSelected: {
    color: '#38BDF8',
  },
  loadingFramesText: {
    color: '#94A3B8',
    fontSize: 11,
    fontStyle: 'italic',
    paddingVertical: 6,
  },
  attributionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 6,
    paddingTop: 4,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(71, 85, 105, 0.4)',
  },
  attributionText: {
    color: '#64748B',
    fontSize: 9,
    fontWeight: '500',
  },
  attributionLink: {
    color: '#38BDF8',
    textDecorationLine: 'underline',
  },
  syncingText: {
    color: '#94A3B8',
    fontSize: 9,
    fontStyle: 'italic',
  },
});
