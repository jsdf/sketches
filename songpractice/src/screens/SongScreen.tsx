import React, {useCallback, useMemo, useRef, useState} from 'react';
import {ActivityIndicator, Alert, Linking, Pressable, ScrollView, StyleSheet, Text, TextInput, View} from 'react-native';

import {findSong, missingKeyMessage, providerLabel} from '../agent/songAgent';
import {AgentLog} from '../agent/types';
import {useInstrumentSurface} from '../audio/InstrumentProvider';
import {buildTimeline, Song} from '../music/song';
import {keyLabel} from '../music/scales';
import {useStore} from '../state/store';
import {colors, radius, space, type} from '../theme';
import {Button, Card, Empty, Pill, Row, SectionLabel} from '../components/ui';

export function SongScreen({onOpenSettings, onPlay}: {onOpenSettings: () => void; onPlay: () => void}) {
  const {songs, currentSong, addSong, removeSong, selectSong, settings} = useStore();
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<AgentLog[]>([]);
  const [error, setError] = useState<string | null>(null);
  const logIdRef = useRef(0);

  // No instrument on this screen; collapse the panel so it is out of the way.
  useInstrumentSurface(useMemo(() => ({mode: 'none'}) as const, []), 0);

  const keyWarning = missingKeyMessage(settings);

  const search = useCallback(async () => {
    if (!query.trim() || busy) return;
    setBusy(true);
    setError(null);
    setLog([]);
    try {
      const {song} = await findSong(query, settings, (event) => {
        setLog((prev) => [...prev, {...event, id: String(logIdRef.current++), at: Date.now()}]);
      });
      addSong(song);
      setQuery('');
      onPlay();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }, [query, busy, settings, addSong, onPlay]);

  const confirmRemove = useCallback(
    (song: Song) => {
      Alert.alert('Remove song', `Remove "${song.title}" from your library?`, [
        {text: 'Cancel', style: 'cancel'},
        {text: 'Remove', style: 'destructive', onPress: () => removeSong(song.id)},
      ]);
    },
    [removeSong],
  );

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Row style={styles.headerRow}>
        <Text style={type.title}>Song practice</Text>
        <Pressable onPress={onOpenSettings} hitSlop={10} style={styles.gear}>
          <Text style={styles.gearText}>Settings</Text>
        </Pressable>
      </Row>

      <Card>
        <SectionLabel right={<Text style={styles.provider}>{providerLabel(settings)}</Text>}>Find a song</SectionLabel>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="e.g. Hallelujah Jeff Buckley"
          placeholderTextColor={colors.textFaint}
          style={styles.input}
          autoCapitalize="words"
          returnKeyType="search"
          onSubmitEditing={search}
          editable={!busy}
        />
        <Button
          label={busy ? 'Searching the web…' : 'Find chords and melody'}
          onPress={search}
          variant="primary"
          busy={busy}
          disabled={!query.trim()}
        />
        {keyWarning ? <Text style={styles.warn}>{keyWarning}</Text> : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </Card>

      {log.length > 0 ? (
        <Card>
          <SectionLabel right={busy ? <ActivityIndicator size="small" color={colors.accent} /> : null}>
            Agent steps
          </SectionLabel>
          {log.map((entry) => (
            <LogRow key={entry.id} entry={entry} />
          ))}
        </Card>
      ) : null}

      <SectionLabel>Library</SectionLabel>
      {songs.length === 0 ? <Empty title="Nothing saved yet" /> : null}
      {songs.map((song) => (
        <SongRow
          key={song.id}
          song={song}
          selected={song.id === currentSong?.id}
          onPress={() => {
            selectSong(song.id);
            onPlay();
          }}
          onLongPress={song.builtIn ? undefined : () => confirmRemove(song)}
        />
      ))}
      <Text style={styles.hint}>Long-press a saved song to remove it. Bundled songs cannot be removed.</Text>
    </ScrollView>
  );
}

function LogRow({entry}: {entry: AgentLog}) {
  const tone =
    entry.kind === 'warn'
      ? colors.accent
      : entry.kind === 'done'
        ? colors.good
        : entry.kind === 'search'
          ? colors.melody
          : colors.textDim;
  const prefix =
    entry.kind === 'search'
      ? 'search'
      : entry.kind === 'fetch'
        ? 'read'
        : entry.kind === 'results'
          ? 'found'
          : entry.kind === 'warn'
            ? 'note'
            : entry.kind === 'done'
              ? 'done'
              : '·';
  return (
    <View style={styles.logRow}>
      <Text style={[styles.logPrefix, {color: tone}]}>{prefix}</Text>
      <View style={styles.logBody}>
        <Text style={styles.logText} numberOfLines={2}>
          {entry.text}
        </Text>
        {entry.kind === 'results'
          ? entry.items.slice(0, 4).map((item, i) => (
              <Pressable key={i} onPress={() => Linking.openURL(item.url).catch(() => {})}>
                <Text style={styles.logLink} numberOfLines={1}>
                  {item.title || item.url}
                </Text>
              </Pressable>
            ))
          : null}
      </View>
    </View>
  );
}

function SongRow({
  song,
  selected,
  onPress,
  onLongPress,
}: {
  song: Song;
  selected: boolean;
  onPress: () => void;
  onLongPress?: () => void;
}) {
  const summary = useMemo(() => {
    const timeline = buildTimeline(song);
    const chords = timeline.chords.length;
    const notes = timeline.melody.filter((m) => m.midi != null).length;
    return {
      key: keyLabel(timeline.key),
      detail: `${chords} chord${chords === 1 ? '' : 's'} · ${notes} melody note${notes === 1 ? '' : 's'}`,
    };
  }, [song]);

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      style={({pressed}) => [styles.songRow, selected && styles.songRowSelected, pressed && {opacity: 0.7}]}>
      <View style={styles.songInfo}>
        <Text style={styles.songTitle} numberOfLines={1}>
          {song.title}
        </Text>
        <Text style={styles.songArtist} numberOfLines={1}>
          {song.artist}
        </Text>
        <Text style={styles.songDetail} numberOfLines={1}>
          {summary.key} · {song.tempo} bpm · {song.timeSignature.join('/')} · {summary.detail}
        </Text>
      </View>
      <View style={styles.songTags}>
        {song.builtIn ? <Pill label="bundled" /> : null}
        {song.source?.confidence ? (
          <Pill
            label={song.source.confidence}
            tone={song.source.confidence === 'high' ? 'good' : song.source.confidence === 'low' ? 'bad' : 'warn'}
          />
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: {flex: 1, backgroundColor: colors.bg},
  content: {padding: space.lg, gap: space.md, paddingBottom: space.xl},
  headerRow: {justifyContent: 'space-between'},
  gear: {paddingVertical: 6, paddingHorizontal: 10, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border},
  gearText: {color: colors.textDim, fontSize: 13, fontWeight: '600'},
  provider: {...type.tiny, color: colors.textFaint},
  input: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.text,
    paddingHorizontal: space.md,
    paddingVertical: 12,
    fontSize: 16,
  },
  warn: {...type.dim, color: colors.accent},
  error: {...type.dim, color: colors.bad},
  hint: {...type.dim, color: colors.textFaint, textAlign: 'center', marginTop: space.xs},
  logRow: {flexDirection: 'row', gap: space.sm, alignItems: 'flex-start'},
  logPrefix: {fontSize: 11, fontWeight: '700', width: 46, marginTop: 2},
  logBody: {flex: 1},
  logText: {...type.dim, color: colors.text},
  logLink: {...type.dim, color: colors.melody, marginTop: 2},
  songRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.md,
  },
  songRowSelected: {borderColor: colors.accent, backgroundColor: colors.surfaceAlt},
  songInfo: {flex: 1, gap: 2},
  songTitle: {...type.heading},
  songArtist: {...type.dim},
  songDetail: {...type.dim, color: colors.textFaint, fontSize: 12},
  songTags: {gap: 4, alignItems: 'flex-end'},
});
