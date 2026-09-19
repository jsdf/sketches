import React from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';

import {colors, space} from '../theme';

export type TabKey = 'song' | 'play' | 'palette' | 'scale' | 'shapes' | 'drill';

export const TABS: {key: TabKey; label: string; glyph: string}[] = [
  {key: 'song', label: 'Song', glyph: '♫'},
  {key: 'play', label: 'Play', glyph: '▶'},
  {key: 'palette', label: 'Pads', glyph: '▦'},
  {key: 'scale', label: 'Scale', glyph: '⌇'},
  {key: 'shapes', label: 'Shapes', glyph: '⬒'},
  {key: 'drill', label: 'Drill', glyph: '◎'},
];

export function TabBar({active, onChange}: {active: TabKey; onChange: (key: TabKey) => void}) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.bar, {paddingBottom: Math.max(insets.bottom, space.sm)}]}>
      {TABS.map((tab) => {
        const selected = tab.key === active;
        return (
          <Pressable key={tab.key} onPress={() => onChange(tab.key)} style={styles.tab} hitSlop={4}>
            <Text style={[styles.glyph, selected && styles.glyphActive]}>{tab.glyph}</Text>
            <Text style={[styles.label, selected && styles.labelActive]} numberOfLines={1}>
              {tab.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: space.sm,
  },
  tab: {flex: 1, alignItems: 'center', gap: 2},
  glyph: {fontSize: 17, color: colors.textFaint},
  glyphActive: {color: colors.accent},
  label: {fontSize: 10, fontWeight: '700', color: colors.textFaint},
  labelActive: {color: colors.text},
});
