import React, {createContext, useCallback, useContext, useEffect, useMemo, useState} from 'react';

import {Settings} from '../agent/types';
import {DEMO_SONGS} from '../music/demoSongs';
import {buildTimeline, Song, Timeline} from '../music/song';
import {
  DEFAULT_PREFS,
  loadLibrary,
  loadPrefs,
  loadSettings,
  Prefs,
  saveLibrary,
  savePrefs,
  saveSettings,
} from './storage';
import {DEFAULT_SETTINGS} from '../agent/types';

type Store = {
  hydrated: boolean;
  settings: Settings;
  updateSettings: (patch: Partial<Settings>) => void;
  prefs: Prefs;
  updatePrefs: (patch: Partial<Prefs>) => void;
  /** Saved songs followed by the bundled ones. */
  songs: Song[];
  addSong: (song: Song) => void;
  removeSong: (id: string) => void;
  currentSong: Song | null;
  timeline: Timeline | null;
  selectSong: (id: string) => void;
};

const StoreContext = createContext<Store | null>(null);

export function StoreProvider({children}: {children: React.ReactNode}) {
  const [hydrated, setHydrated] = useState(false);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);
  const [library, setLibrary] = useState<Song[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const [s, p, lib] = await Promise.all([loadSettings(), loadPrefs(), loadLibrary()]);
      if (!alive) return;
      setSettings(s);
      setPrefs(p);
      setLibrary(lib);
      const all = [...lib, ...DEMO_SONGS];
      const wanted = p.lastSongId && all.find((song) => song.id === p.lastSongId);
      setCurrentId(wanted ? wanted.id : (all[0]?.id ?? null));
      setHydrated(true);
    })();
    return () => {
      alive = false;
    };
  }, []);

  const updateSettings = useCallback((patch: Partial<Settings>) => {
    setSettings((prev) => {
      const next = {...prev, ...patch};
      saveSettings(next).catch(() => {});
      return next;
    });
  }, []);

  const updatePrefs = useCallback((patch: Partial<Prefs>) => {
    setPrefs((prev) => {
      const next = {...prev, ...patch};
      savePrefs(next).catch(() => {});
      return next;
    });
  }, []);

  const songs = useMemo(() => [...library, ...DEMO_SONGS], [library]);

  const addSong = useCallback((song: Song) => {
    setLibrary((prev) => {
      const next = [song, ...prev.filter((s) => s.id !== song.id)].slice(0, 100);
      saveLibrary(next).catch(() => {});
      return next;
    });
    setCurrentId(song.id);
    savePrefs({...DEFAULT_PREFS, lastSongId: song.id}).catch(() => {});
  }, []);

  const removeSong = useCallback(
    (id: string) => {
      setLibrary((prev) => {
        const next = prev.filter((s) => s.id !== id);
        saveLibrary(next).catch(() => {});
        return next;
      });
      setCurrentId((prev) => (prev === id ? (DEMO_SONGS[0]?.id ?? null) : prev));
    },
    [],
  );

  const selectSong = useCallback(
    (id: string) => {
      setCurrentId(id);
      updatePrefs({lastSongId: id});
    },
    [updatePrefs],
  );

  const currentSong = useMemo(() => songs.find((s) => s.id === currentId) ?? songs[0] ?? null, [songs, currentId]);
  // Expanding a song into a timeline is pure and not free, so memoise it once
  // here rather than in each practice screen.
  const timeline = useMemo(() => (currentSong ? buildTimeline(currentSong) : null), [currentSong]);

  const value = useMemo<Store>(
    () => ({
      hydrated,
      settings,
      updateSettings,
      prefs,
      updatePrefs,
      songs,
      addSong,
      removeSong,
      currentSong,
      timeline,
      selectSong,
    }),
    [hydrated, settings, updateSettings, prefs, updatePrefs, songs, addSong, removeSong, currentSong, timeline, selectSong],
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): Store {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore must be used inside a StoreProvider');
  return ctx;
}
