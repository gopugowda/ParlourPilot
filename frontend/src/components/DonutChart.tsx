import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Circle, G } from 'react-native-svg';
import { colors, getCurrencySymbol } from '@/src/theme';

type Slice = { key: string; label: string; amount: number; share_pct: number; color?: string };

const DEFAULT_COLORS: Record<string, string> = {
  cash: '#C42032',
  upi: '#E8B441',
  card: '#7A6DDB',
  other: '#8A8079',
};

export function DonutChart({
  data,
  size = 130,
  strokeWidth = 22,
  testID,
}: {
  data: Slice[];
  size?: number;
  strokeWidth?: number;
  testID?: string;
}) {
  const radius = (size - strokeWidth) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const c = 2 * Math.PI * radius;
  const total = data.reduce((s, x) => s + Math.max(0, x.amount), 0);
  // Build offsets
  let acc = 0;
  const arcs = data.map((s) => {
    const share = total > 0 ? s.amount / total : 0;
    const dash = share * c;
    const arc = { dash, offset: -acc, color: s.color || DEFAULT_COLORS[s.key] || colors.brandPrimary };
    acc += dash;
    return arc;
  });

  return (
    <View testID={testID} style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size}>
        {/* base ring for empty state */}
        <Circle cx={cx} cy={cy} r={radius} stroke={colors.surfaceTertiary} strokeWidth={strokeWidth} fill="none" />
        <G rotation={-90} origin={`${cx}, ${cy}`}>
          {arcs.map((a, i) => (
            <Circle
              key={i}
              cx={cx}
              cy={cy}
              r={radius}
              stroke={a.color}
              strokeWidth={strokeWidth}
              fill="none"
              strokeDasharray={`${a.dash} ${c - a.dash}`}
              strokeDashoffset={a.offset}
              strokeLinecap="butt"
            />
          ))}
        </G>
      </Svg>
      <View style={styles.center}>
        <Text style={styles.centerLabel}>Total</Text>
        <Text style={styles.centerValue}>{getCurrencySymbol()}{Math.round(total).toLocaleString('en-IN')}</Text>
      </View>
    </View>
  );
}

export function DonutLegend({ data, testID }: { data: Slice[]; testID?: string }) {
  const total = data.reduce((s, x) => s + Math.max(0, x.amount), 0);
  return (
    <View testID={testID} style={styles.legend}>
      {data.map(s => {
        const dot = s.color || DEFAULT_COLORS[s.key] || colors.brandPrimary;
        const share = total > 0 ? ((s.amount / total) * 100).toFixed(1) : '0.0';
        return (
          <View key={s.key} style={styles.legendRow} testID={`legend-${s.key}`}>
            <View style={[styles.dot, { backgroundColor: dot }]} />
            <Text style={styles.legendLabel}>{s.label}</Text>
            <Text style={styles.legendRight}>
              {getCurrencySymbol()}{Math.round(s.amount).toLocaleString('en-IN')}<Text style={styles.legendPct}>  ·  {share}%</Text>
            </Text>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
  centerLabel: { fontSize: 10, color: colors.onSurfaceTertiary, fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase' },
  centerValue: { fontSize: 15, color: colors.onSurface, fontWeight: '800', marginTop: 2 },
  legend: { flex: 1, gap: 8, marginLeft: 12 },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  legendLabel: { fontSize: 12, color: colors.onSurface, fontWeight: '600', minWidth: 42 },
  legendRight: { fontSize: 12, color: colors.onSurfaceSecondary, marginLeft: 'auto', fontWeight: '600' },
  legendPct: { fontSize: 10, color: colors.onSurfaceTertiary, fontWeight: '600' },
});
