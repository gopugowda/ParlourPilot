import React from 'react';
import { View, Text, StyleSheet, Dimensions } from 'react-native';
import Svg, { Path, Line, Circle, LinearGradient, Defs, Stop } from 'react-native-svg';
import { colors, getCurrencySymbol } from '@/src/theme';

type Point = { date: string; value: number };

export function MiniLineChart({
  data,
  height = 180,
  color = colors.brandPrimary,
  testID,
}: {
  data: Point[];
  height?: number;
  color?: string;
  testID?: string;
}) {
  const width = Dimensions.get('window').width - 40; // rough parent padding
  const padL = 32;
  const padR = 12;
  const padT = 12;
  const padB = 24;
  const w = Math.max(80, width - padL - padR);
  const h = height - padT - padB;

  const values = data.map(d => d.value);
  const maxV = Math.max(1, ...values);
  const minV = 0;

  const stepX = data.length > 1 ? w / (data.length - 1) : 0;
  const yFor = (v: number) => padT + h - ((v - minV) / (maxV - minV || 1)) * h;
  const xFor = (i: number) => padL + i * stepX;

  const linePath = data.map((d, i) => `${i === 0 ? 'M' : 'L'} ${xFor(i)} ${yFor(d.value)}`).join(' ');
  const areaPath = data.length > 0
    ? `${linePath} L ${xFor(data.length - 1)} ${padT + h} L ${xFor(0)} ${padT + h} Z`
    : '';

  // Y grid lines (4 divisions)
  const yTicks = 4;
  const gridLines: number[] = [];
  for (let i = 0; i <= yTicks; i++) {
    gridLines.push(padT + (h / yTicks) * i);
  }

  // Y labels
  const yLabels: { y: number; label: string }[] = [];
  for (let i = 0; i <= yTicks; i++) {
    const v = maxV - (maxV / yTicks) * i;
    yLabels.push({ y: padT + (h / yTicks) * i, label: fmtShort(v) });
  }

  // X labels — show first, middle, last only to avoid clutter
  const xLabelIdx = data.length <= 4
    ? data.map((_, i) => i)
    : [0, Math.floor(data.length / 2), data.length - 1];

  return (
    <View testID={testID} style={{ width: '100%' }}>
      <Svg width={width} height={height}>
        <Defs>
          <LinearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={color} stopOpacity={0.28} />
            <Stop offset="1" stopColor={color} stopOpacity={0} />
          </LinearGradient>
        </Defs>
        {gridLines.map((y, i) => (
          <Line key={`g-${i}`} x1={padL} y1={y} x2={padL + w} y2={y} stroke={colors.borderStrong} strokeOpacity={0.35} strokeWidth={1} strokeDasharray="4 4" />
        ))}
        {areaPath ? <Path d={areaPath} fill="url(#areaGrad)" /> : null}
        {linePath ? <Path d={linePath} stroke={color} strokeWidth={2} fill="none" /> : null}
        {data.map((d, i) => (
          <Circle key={`p-${i}`} cx={xFor(i)} cy={yFor(d.value)} r={2.5} fill={color} />
        ))}
      </Svg>
      {/* Y labels overlay */}
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        {yLabels.map((yl, i) => (
          <Text
            key={`yl-${i}`}
            style={[styles.yLabel, { top: yl.y - 7 }]}
            numberOfLines={1}
          >
            {yl.label}
          </Text>
        ))}
      </View>
      {/* X labels */}
      <View style={{ flexDirection: 'row', paddingLeft: padL, paddingRight: padR, marginTop: -18, marginBottom: 4 }}>
        {data.length > 0 && xLabelIdx.map(i => {
          const d = data[i];
          if (!d) return null;
          return (
            <Text
              key={`xl-${i}`}
              style={[styles.xLabel, { left: xFor(i) - padL - 18, width: 40 }]}
            >
              {fmtDateShort(d.date)}
            </Text>
          );
        })}
      </View>
    </View>
  );
}

function fmtShort(v: number): string {
  const s = getCurrencySymbol();
  if (v >= 100000) return `${s}${(v / 100000).toFixed(1)}L`;
  if (v >= 1000) return `${s}${(v / 1000).toFixed(1)}k`;
  return `${s}${Math.round(v)}`;
}

function fmtDateShort(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  if (isNaN(d.getTime())) return iso.slice(5);
  return `${String(d.getDate()).padStart(2, '0')} ${d.toLocaleDateString('en-IN', { month: 'short' })}`;
}

const styles = StyleSheet.create({
  yLabel: { position: 'absolute', left: 0, width: 28, fontSize: 9, color: colors.onSurfaceTertiary, textAlign: 'right' },
  xLabel: { position: 'absolute', top: 2, fontSize: 9, color: colors.onSurfaceTertiary, textAlign: 'center' },
});
