import React from 'react';
import Svg, { Defs, RadialGradient, Stop, Path, Polygon } from 'react-native-svg';

/**
 * Radial FOV beam cone and crisp white-outlined directional chevron rendered strictly
 * outside the 52x52 avatar halo within a 108x108 centered coordinate box.
 */
export const HeadingBeamSvg: React.FC<{
  color: string;
  gradientId: string;
}> = React.memo(({ color, gradientId }) => (
  <Svg width={108} height={108} viewBox="0 0 108 108">
    <Defs>
      <RadialGradient
        id={gradientId}
        cx="54"
        cy="54"
        r="51"
        gradientUnits="userSpaceOnUse"
      >
        <Stop offset="0.48" stopColor={color} stopOpacity="0.58" />
        <Stop offset="0.82" stopColor={color} stopOpacity="0.22" />
        <Stop offset="1" stopColor={color} stopOpacity="0.02" />
      </RadialGradient>
    </Defs>
    <Path
      d="M 38.90 31.62 L 25.48 11.72 A 51 51 0 0 1 82.52 11.72 L 69.10 31.62 A 27 27 0 0 0 38.90 31.62 Z"
      fill={`url(#${gradientId})`}
    />
    <Polygon
      points="54,13 61.5,24.5 54,21.5 46.5,24.5"
      fill={color}
      stroke="#FFFFFF"
      strokeWidth={2}
      strokeLinejoin="round"
    />
  </Svg>
));

/**
 * Crisp white-outlined downward pin tip anchored below the avatar / battery stack.
 */
export const PinPointerTipSvg: React.FC<{
  color: string;
}> = React.memo(({ color }) => (
  <Svg width={16} height={10} viewBox="0 0 16 10">
    <Polygon
      points="1,0 15,0 8,9"
      fill={color}
      stroke="#FFFFFF"
      strokeWidth={1.8}
      strokeLinejoin="round"
    />
  </Svg>
));
