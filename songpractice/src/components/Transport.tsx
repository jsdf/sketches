import React from 'react';
import {StyleSheet, Text, View} from 'react-native';
import Slider from '@react-native-community/slider';

import {colors, radius, space, type} from '../theme';
import {Row, RoundButton, Toggle} from './ui';

export function Transport({
  playing,
  onToggle,
  bpm,
  tempoScale,
  onTempoScale,
  toggles,
}: {
  playing: boolean;
  onToggle: () => void;
  bpm: number;
  tempoScale: number;
  onTempoScale: (value: number) => void;
  toggles: {label: string; value: boolean; onChange: (v: boolean) => void; tint?: string}[];
}) {
  return (
    <View style={styles.wrap}>
      <Row gap={space.md}>
        <RoundButton label={playing ? '■' : '▶'} onPress={onToggle} active={playing} size={54} />
        <View style={styles.tempoBox}>
          <Row style={styles.tempoHead}>
            <Text style={type.tiny}>TEMPO</Text>
            <Text style={styles.bpm}>
              {bpm} <Text style={styles.bpmUnit}>bpm</Text>
              {Math.abs(tempoScale - 1) > 0.005 ? (
                <Text style={styles.bpmScale}>{`  ${Math.round(tempoScale * 100)}%`}</Text>
              ) : null}
            </Text>
          </Row>
          <Slider
            style={styles.slider}
            minimumValue={0.4}
            maximumValue={1.4}
            step={0.05}
            value={tempoScale}
            onValueChange={onTempoScale}
            minimumTrackTintColor={colors.accent}
            maximumTrackTintColor={colors.border}
            thumbTintColor={colors.accent}
          />
        </View>
      </Row>
      <Row style={styles.toggles} gap={space.xs}>
        {toggles.map((t) => (
          <Toggle key={t.label} label={t.label} value={t.value} onChange={t.onChange} tint={t.tint} />
        ))}
      </Row>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: space.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.md,
  },
  tempoBox: {flex: 1, gap: 2},
  tempoHead: {justifyContent: 'space-between'},
  bpm: {color: colors.text, fontSize: 15, fontWeight: '700'},
  bpmUnit: {color: colors.textFaint, fontSize: 11, fontWeight: '600'},
  bpmScale: {color: colors.accent, fontSize: 12, fontWeight: '700'},
  slider: {width: '100%', height: 32},
  toggles: {flexWrap: 'wrap'},
});
