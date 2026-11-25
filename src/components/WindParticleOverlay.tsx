import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, View, LayoutChangeEvent, Platform } from 'react-native';
import Svg, { Line, Defs, LinearGradient, Stop } from 'react-native-svg';
import { windToUV } from '../services/WeatherService';

interface WindParticle {
  id: number;
  x: number;
  y: number;
  length: number;
  speed: number;
  opacity: number;
  age: number;
  maxAge: number;
  width: number;
}

interface WindParticleOverlayProps {
  windSpeedMs: number; // Wind speed in m/s (from Open-Meteo wind_speed_10m / 3.6 or direct)
  windDirectionDeg: number; // Meteorological direction in degrees (0 = from North)
  isActive?: boolean;
  isPaused?: boolean; // True during camera drag/pitch/zoom gestures
  mapBearing?: number; // Compensate for map rotation so wind flows in true geographical direction!
  particleCount?: number;
}

const DEFAULT_PARTICLE_COUNT = Platform.OS === 'android' ? 45 : 60;

export const WindParticleOverlay: React.FC<WindParticleOverlayProps> = ({
  windSpeedMs,
  windDirectionDeg,
  isActive = true,
  isPaused = false,
  mapBearing = 0,
  particleCount = DEFAULT_PARTICLE_COUNT,
}) => {
  const [dimensions, setDimensions] = useState<{ width: number; height: number }>({
    width: 0,
    height: 0,
  });

  const particlesRef = useRef<WindParticle[]>([]);
  const [, setFrameTick] = useState(0);
  const animFrameIdRef = useRef<number | null>(null);
  const isPausedRef = useRef(isPaused);
  isPausedRef.current = isPaused;

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    if (width > 0 && height > 0) {
      setDimensions({ width, height });
    }
  };

  // Mathematical (u, v) vector components
  const { u, v } = windToUV(Math.max(1, windSpeedMs), windDirectionDeg);

  // Compute screen movement angle: meteorological wind blows FROM windDirectionDeg.
  // To show particles drifting with the wind, flow direction is (windDirectionDeg + 180).
  // In screen space: y increases downwards, so we account for map bearing & screen coordinate space.
  const flowAngleDeg = (windDirectionDeg + 180 - mapBearing + 360) % 360;
  const flowAngleRad = (flowAngleDeg * Math.PI) / 180;
  const dxNorm = Math.sin(flowAngleRad);
  const dyNorm = -Math.cos(flowAngleRad);

  // Initialize particles when dimensions change
  useEffect(() => {
    if (dimensions.width <= 0 || dimensions.height <= 0) return;

    const particles: WindParticle[] = [];
    for (let i = 0; i < particleCount; i++) {
      particles.push({
        id: i,
        x: Math.random() * dimensions.width,
        y: Math.random() * dimensions.height,
        length: 18 + Math.random() * 28,
        speed: 1.2 + Math.random() * 2.2,
        opacity: 0.15 + Math.random() * 0.7,
        age: Math.floor(Math.random() * 100),
        maxAge: 70 + Math.floor(Math.random() * 60),
        width: Math.random() > 0.6 ? 2.0 : 1.4,
      });
    }
    particlesRef.current = particles;
  }, [dimensions.width, dimensions.height, particleCount]);

  // Animation frame loop
  useEffect(() => {
    if (!isActive || dimensions.width <= 0 || dimensions.height <= 0) {
      if (animFrameIdRef.current) {
        cancelAnimationFrame(animFrameIdRef.current);
        animFrameIdRef.current = null;
      }
      return;
    }

    let lastTime = Date.now();

    const loop = () => {
      const now = Date.now();
      const elapsed = now - lastTime;

      // Throttle to ~40-60 FPS for battery and GPS tracker performance
      if (elapsed > 24) {
        lastTime = now;

        // Skip physics update when camera is moving to lock 60 FPS on 3D terrain gestures
        if (!isPausedRef.current && particlesRef.current.length > 0) {
          const { width, height } = dimensions;
          const speedFactor = Math.min(6, Math.max(1.0, windSpeedMs * 0.45));

          for (let i = 0; i < particlesRef.current.length; i++) {
            const p = particlesRef.current[i];
            p.age += 1;

            p.x += dxNorm * p.speed * speedFactor;
            p.y += dyNorm * p.speed * speedFactor;

            // Respawn particle if it exceeded its lifespan or drifted out of map viewport
            if (
              p.age >= p.maxAge ||
              p.x < -40 ||
              p.x > width + 40 ||
              p.y < -40 ||
              p.y > height + 40
            ) {
              p.age = 0;
              p.maxAge = 70 + Math.floor(Math.random() * 60);
              p.length = 18 + Math.random() * 28;
              p.speed = 1.2 + Math.random() * 2.2;
              p.opacity = 0.2 + Math.random() * 0.65;

              // Spawn along viewport edges according to flow direction
              if (Math.abs(dxNorm) > Math.abs(dyNorm)) {
                p.x = dxNorm > 0 ? -10 : width + 10;
                p.y = Math.random() * height;
              } else {
                p.x = Math.random() * width;
                p.y = dyNorm > 0 ? -10 : height + 10;
              }
            }
          }

          setFrameTick((t) => (t + 1) % 1000);
        }
      }

      animFrameIdRef.current = requestAnimationFrame(loop);
    };

    animFrameIdRef.current = requestAnimationFrame(loop);

    return () => {
      if (animFrameIdRef.current) {
        cancelAnimationFrame(animFrameIdRef.current);
        animFrameIdRef.current = null;
      }
    };
  }, [isActive, dimensions.width, dimensions.height, dxNorm, dyNorm, windSpeedMs]);

  if (!isActive) return null;

  return (
    <View style={styles.container} onLayout={onLayout} pointerEvents="none">
      {dimensions.width > 0 && dimensions.height > 0 && (
        <Svg width={dimensions.width} height={dimensions.height} style={StyleSheet.absoluteFill}>
          <Defs>
            <LinearGradient id="windStreamlineGrad" x1="0" y1="0" x2="1" y2="1">
              <Stop offset="0%" stopColor="#38BDF8" stopOpacity="0.05" />
              <Stop offset="50%" stopColor="#E0F2FE" stopOpacity="0.85" />
              <Stop offset="100%" stopColor="#FFFFFF" stopOpacity="1" />
            </LinearGradient>
          </Defs>

          {particlesRef.current.map((p) => {
            // Calculate tail position opposite to flow direction
            const tailX = p.x - dxNorm * p.length;
            const tailY = p.y - dyNorm * p.length;

            // Fade in and out with age
            const lifeRatio = p.age / p.maxAge;
            const dynamicOpacity =
              lifeRatio < 0.2
                ? (lifeRatio / 0.2) * p.opacity
                : lifeRatio > 0.8
                ? ((1 - lifeRatio) / 0.2) * p.opacity
                : p.opacity;

            return (
              <Line
                key={p.id}
                x1={tailX}
                y1={tailY}
                x2={p.x}
                y2={p.y}
                stroke="url(#windStreamlineGrad)"
                strokeWidth={p.width}
                strokeLinecap="round"
                strokeOpacity={Math.max(0.05, Math.min(1, dynamicOpacity))}
              />
            );
          })}
        </Svg>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFill,
    zIndex: 10,
  },
});
