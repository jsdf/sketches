import React, {useCallback, useState} from 'react';
import {ActivityIndicator, StyleSheet, View} from 'react-native';
import {StatusBar} from 'expo-status-bar';
import {SafeAreaProvider, SafeAreaView} from 'react-native-safe-area-context';

import {InstrumentProvider} from './src/audio/InstrumentProvider';
import {StoreProvider, useStore} from './src/state/store';
import {TabBar, TabKey} from './src/components/TabBar';
import {DrillScreen} from './src/screens/DrillScreen';
import {PaletteScreen} from './src/screens/PaletteScreen';
import {PlayScreen} from './src/screens/PlayScreen';
import {ScaleScreen} from './src/screens/ScaleScreen';
import {SettingsScreen} from './src/screens/SettingsScreen';
import {ShapesScreen} from './src/screens/ShapesScreen';
import {SongScreen} from './src/screens/SongScreen';
import {colors} from './src/theme';

export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <StoreProvider>
        <Root />
      </StoreProvider>
    </SafeAreaProvider>
  );
}

function Root() {
  const {hydrated} = useStore();
  const [tab, setTab] = useState<TabKey>('song');
  const [settingsOpen, setSettingsOpen] = useState(false);

  const renderFooter = useCallback(
    () => (settingsOpen ? null : <TabBar active={tab} onChange={setTab} />),
    [settingsOpen, tab],
  );

  if (!hydrated) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  return (
    // The instrument panel lives between the screen and the tab bar, mounted
    // once for the whole app so its audio context survives navigation.
    <InstrumentProvider renderFooter={renderFooter}>
      <SafeAreaView style={styles.safe} edges={['top']}>
        {settingsOpen ? (
          <SettingsScreen onBack={() => setSettingsOpen(false)} />
        ) : (
          <Screen tab={tab} onOpenSettings={() => setSettingsOpen(true)} onPlay={() => setTab('play')} />
        )}
      </SafeAreaView>
    </InstrumentProvider>
  );
}

function Screen({tab, onOpenSettings, onPlay}: {tab: TabKey; onOpenSettings: () => void; onPlay: () => void}) {
  switch (tab) {
    case 'play':
      return <PlayScreen />;
    case 'palette':
      return <PaletteScreen />;
    case 'scale':
      return <ScaleScreen />;
    case 'shapes':
      return <ShapesScreen />;
    case 'drill':
      return <DrillScreen />;
    default:
      return <SongScreen onOpenSettings={onOpenSettings} onPlay={onPlay} />;
  }
}

const styles = StyleSheet.create({
  safe: {flex: 1, backgroundColor: colors.bg},
  loading: {flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg},
});
