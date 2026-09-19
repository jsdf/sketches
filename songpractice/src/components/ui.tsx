import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextStyle,
  View,
  ViewStyle,
} from 'react-native';

import {colors, radius, space, type} from '../theme';

export function Screen({children, style}: {children: React.ReactNode; style?: ViewStyle}) {
  return <View style={[styles.screen, style]}>{children}</View>;
}

export function ScreenScroll({children}: {children: React.ReactNode}) {
  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.scrollContent}
      keyboardShouldPersistTaps="handled">
      {children}
    </ScrollView>
  );
}

export function Card({children, style}: {children: React.ReactNode; style?: ViewStyle}) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function SectionLabel({children, right}: {children: React.ReactNode; right?: React.ReactNode}) {
  return (
    <View style={styles.sectionLabel}>
      <Text style={styles.sectionLabelText}>{children}</Text>
      {right}
    </View>
  );
}

export function Button({
  label,
  onPress,
  variant = 'default',
  disabled,
  busy,
  style,
}: {
  label: string;
  onPress: () => void;
  variant?: 'default' | 'primary' | 'ghost' | 'danger';
  disabled?: boolean;
  busy?: boolean;
  style?: ViewStyle;
}) {
  const tone =
    variant === 'primary'
      ? styles.btnPrimary
      : variant === 'ghost'
        ? styles.btnGhost
        : variant === 'danger'
          ? styles.btnDanger
          : styles.btnDefault;
  const textTone =
    variant === 'primary' ? styles.btnPrimaryText : variant === 'danger' ? styles.btnDangerText : styles.btnText;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || busy}
      style={({pressed}) => [styles.btn, tone, (disabled || busy) && styles.btnDisabled, pressed && styles.btnPressed, style]}>
      {busy ? <ActivityIndicator color={variant === 'primary' ? '#1a1405' : colors.text} size="small" /> : null}
      <Text style={[styles.btnTextBase, textTone]}>{label}</Text>
    </Pressable>
  );
}

/** Round icon-ish button for transport controls. */
export function RoundButton({
  label,
  onPress,
  active,
  size = 52,
}: {
  label: string;
  onPress: () => void;
  active?: boolean;
  size?: number;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({pressed}) => [
        styles.round,
        {width: size, height: size, borderRadius: size / 2},
        active && styles.roundActive,
        pressed && styles.btnPressed,
      ]}>
      <Text style={[styles.roundText, active && styles.roundTextActive]}>{label}</Text>
    </Pressable>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  style,
}: {
  options: {value: T; label: string}[];
  value: T;
  onChange: (value: T) => void;
  style?: ViewStyle;
}) {
  return (
    <View style={[styles.segmented, style]}>
      {options.map((opt) => {
        const selected = opt.value === value;
        return (
          <Pressable
            key={opt.value}
            onPress={() => onChange(opt.value)}
            style={[styles.segment, selected && styles.segmentActive]}>
            <Text style={[styles.segmentText, selected && styles.segmentTextActive]} numberOfLines={1}>
              {opt.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Toggle({label, value, onChange, tint}: {label: string; value: boolean; onChange: (v: boolean) => void; tint?: string}) {
  return (
    <Pressable
      onPress={() => onChange(!value)}
      style={[styles.toggle, value && styles.toggleOn, value && tint ? {borderColor: tint, backgroundColor: tint + '22'} : null]}>
      <View style={[styles.toggleDot, value && {backgroundColor: tint ?? colors.accent}]} />
      <Text style={[styles.toggleText, value && styles.toggleTextOn]}>{label}</Text>
    </Pressable>
  );
}

export function Row({children, style, gap = space.sm}: {children: React.ReactNode; style?: ViewStyle; gap?: number}) {
  return <View style={[styles.row, {gap}, style]}>{children}</View>;
}

export function Empty({title, hint}: {title: string; hint?: string}) {
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyTitle}>{title}</Text>
      {hint ? <Text style={styles.emptyHint}>{hint}</Text> : null}
    </View>
  );
}

export function Pill({label, tone = 'default'}: {label: string; tone?: 'default' | 'good' | 'warn' | 'bad'}) {
  const color =
    tone === 'good' ? colors.good : tone === 'warn' ? colors.accent : tone === 'bad' ? colors.bad : colors.textDim;
  return (
    <View style={[styles.pill, {borderColor: color + '55', backgroundColor: color + '18'}]}>
      <Text style={[styles.pillText, {color}]}>{label}</Text>
    </View>
  );
}

export const text: Record<string, TextStyle> = type as any;

const styles = StyleSheet.create({
  screen: {flex: 1, backgroundColor: colors.bg},
  scrollContent: {padding: space.lg, paddingBottom: space.xl, gap: space.md},
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.md,
    gap: space.sm,
  },
  sectionLabel: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'},
  sectionLabelText: {...type.tiny, textTransform: 'uppercase', letterSpacing: 0.8},
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    paddingVertical: 12,
    paddingHorizontal: space.lg,
    borderRadius: radius.md,
    borderWidth: 1,
  },
  btnDefault: {backgroundColor: colors.surfaceAlt, borderColor: colors.border},
  btnPrimary: {backgroundColor: colors.accent, borderColor: colors.accent},
  btnGhost: {backgroundColor: 'transparent', borderColor: colors.border},
  btnDanger: {backgroundColor: 'transparent', borderColor: colors.bad + '77'},
  btnDisabled: {opacity: 0.45},
  btnPressed: {opacity: 0.7},
  btnTextBase: {fontSize: 15, fontWeight: '600'},
  btnText: {color: colors.text},
  btnPrimaryText: {color: '#1a1405'},
  btnDangerText: {color: colors.bad},
  round: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
  },
  roundActive: {backgroundColor: colors.accent, borderColor: colors.accent},
  roundText: {color: colors.text, fontSize: 16, fontWeight: '700'},
  roundTextActive: {color: '#1a1405'},
  segmented: {
    flexDirection: 'row',
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    padding: 3,
    borderWidth: 1,
    borderColor: colors.border,
  },
  segment: {flex: 1, paddingVertical: 8, paddingHorizontal: 4, borderRadius: radius.sm, alignItems: 'center'},
  segmentActive: {backgroundColor: colors.accent},
  segmentText: {color: colors.textDim, fontSize: 13, fontWeight: '600'},
  segmentTextActive: {color: '#1a1405'},
  toggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 7,
    paddingHorizontal: 11,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceAlt,
  },
  toggleOn: {borderColor: colors.accent, backgroundColor: colors.accentDim},
  toggleDot: {width: 8, height: 8, borderRadius: 4, backgroundColor: colors.textFaint},
  toggleText: {color: colors.textDim, fontSize: 13, fontWeight: '600'},
  toggleTextOn: {color: colors.text},
  row: {flexDirection: 'row', alignItems: 'center'},
  empty: {alignItems: 'center', justifyContent: 'center', padding: space.xl, gap: space.xs},
  emptyTitle: {...type.body, color: colors.textDim, textAlign: 'center'},
  emptyHint: {...type.dim, color: colors.textFaint, textAlign: 'center'},
  pill: {paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill, borderWidth: 1},
  pillText: {fontSize: 11, fontWeight: '700'},
});
