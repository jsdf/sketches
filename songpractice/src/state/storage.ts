/**
 * Persistence. API keys go to the secure store; everything else to
 * AsyncStorage, which is plenty for a song library.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import {Platform} from 'react-native';

import {Song} from '../music/song';
import {DEFAULT_SETTINGS, Settings} from '../agent/types';

const SETTINGS_KEY = 'sp.settings.v1';
const LIBRARY_KEY = 'sp.library.v1';
const PREFS_KEY = 'sp.prefs.v1';

const SECRET_FIELDS = ['deepseekKey', 'claudeKey', 'tavilyKey', 'braveKey'] as const;
type SecretField = (typeof SECRET_FIELDS)[number];

const secureAvailable = Platform.OS === 'ios' || Platform.OS === 'android';

async function readSecret(field: SecretField): Promise<string> {
  if (!secureAvailable) return (await AsyncStorage.getItem('sp.secret.' + field)) ?? '';
  try {
    return (await SecureStore.getItemAsync('sp_' + field)) ?? '';
  } catch {
    return '';
  }
}

async function writeSecret(field: SecretField, value: string): Promise<void> {
  if (!secureAvailable) {
    await AsyncStorage.setItem('sp.secret.' + field, value);
    return;
  }
  try {
    if (value) await SecureStore.setItemAsync('sp_' + field, value);
    else await SecureStore.deleteItemAsync('sp_' + field);
  } catch {
    /* a device without a keystore just loses the key between launches */
  }
}

export async function loadSettings(): Promise<Settings> {
  const [rawJson, ...secrets] = await Promise.all([
    AsyncStorage.getItem(SETTINGS_KEY),
    ...SECRET_FIELDS.map(readSecret),
  ]);
  let stored: Partial<Settings> = {};
  if (rawJson) {
    try {
      stored = JSON.parse(rawJson);
    } catch {
      /* corrupt settings fall back to defaults */
    }
  }
  const settings: Settings = {...DEFAULT_SETTINGS, ...stored};
  SECRET_FIELDS.forEach((field, i) => {
    settings[field] = secrets[i] as string;
  });
  return settings;
}

export async function saveSettings(settings: Settings): Promise<void> {
  const plain: Record<string, unknown> = {...settings};
  for (const field of SECRET_FIELDS) delete plain[field];
  await Promise.all([
    AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(plain)),
    ...SECRET_FIELDS.map((field) => writeSecret(field, settings[field])),
  ]);
}

export async function loadLibrary(): Promise<Song[]> {
  const raw = await AsyncStorage.getItem(LIBRARY_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function saveLibrary(songs: Song[]): Promise<void> {
  await AsyncStorage.setItem(LIBRARY_KEY, JSON.stringify(songs.filter((s) => !s.builtIn)));
}

export type Prefs = {
  /** Playback tempo as a fraction of the song's own tempo. */
  tempoScale: number;
  chordsOn: boolean;
  melodyOn: boolean;
  clickOn: boolean;
  countIn: boolean;
  loop: boolean;
  keyWidth: number;
  showNoteNames: boolean;
  lastSongId: string | null;
};

export const DEFAULT_PREFS: Prefs = {
  tempoScale: 1,
  chordsOn: true,
  melodyOn: true,
  clickOn: false,
  countIn: true,
  loop: true,
  keyWidth: 44,
  showNoteNames: true,
  lastSongId: null,
};

export async function loadPrefs(): Promise<Prefs> {
  const raw = await AsyncStorage.getItem(PREFS_KEY);
  if (!raw) return DEFAULT_PREFS;
  try {
    return {...DEFAULT_PREFS, ...JSON.parse(raw)};
  } catch {
    return DEFAULT_PREFS;
  }
}

export async function savePrefs(prefs: Prefs): Promise<void> {
  await AsyncStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
}
