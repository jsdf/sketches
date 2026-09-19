import React, {createContext, useCallback, useContext, useEffect, useMemo, useRef, useState} from 'react';
import {Platform, StyleSheet, View} from 'react-native';
import {WebView} from 'react-native-webview';
import {setAudioModeAsync} from 'expo-audio';

import {INSTRUMENT_HTML} from './instrumentHtml';

export type Channel = 'chords' | 'melody' | 'user' | 'click';

export type SeqEvent = {
  /** Start position in beats. */
  b: number;
  /** Length in beats. */
  d: number;
  /** MIDI note. */
  m: number;
  c: Channel;
  v?: number;
};

export type PlayOptions = {
  events: SeqEvent[];
  tempo: number;
  loop: boolean;
  loopStart: number;
  loopEnd: number;
  startBeat?: number;
  beatsPerBar?: number;
  /** Beat of the first downbeat, for sections that do not start on a bar line. */
  barOffset?: number;
  countIn?: number;
};

export type PadItem = {
  label: string;
  sub?: string;
  notes: number[];
  root?: boolean;
  /** Seconds between successive notes, to strum rather than block a chord. */
  strum?: number;
  dur?: number;
  /** Sustain for as long as the pad is held, instead of a fixed one-shot. */
  hold?: boolean;
};

export type PianoConfig = {
  mode: 'piano';
  low: number;
  high: number;
  keyWidth?: number;
  labels?: 'all' | 'white' | 'c' | 'none';
  octaveLabels?: boolean;
  flats?: boolean;
  /** midi -> 'on' | 'root' */
  highlight?: Record<number, string>;
  /** midi -> small label above the key (scale degree, chord tone). */
  degrees?: Record<number, string>;
  /** Notes the view should centre on; the keybed slides to show them. */
  focus?: number[];
};

export type PadsConfig = {mode: 'pads'; items: PadItem[]; cols?: number; cue?: number};
export type InstrumentConfig = PianoConfig | PadsConfig | {mode: 'none'};

type NoteListener = (midi: number, on: boolean) => void;
type PadListener = (index: number, notes: number[]) => void;
type BeatListener = (beat: number) => void;
type StateListener = (playing: boolean, finished: boolean) => void;

export type Instrument = {
  /** Replaces the playing surface. Rebuilds the keybed or pad grid. */
  setConfig: (config: InstrumentConfig, height: number) => void;
  /** Cheap partial update: highlights, degrees, focus or pad cue. */
  update: (patch: Partial<PianoConfig> & {items?: PadItem[]; cue?: number}) => void;
  /** Lights up keys without sounding them, to follow playback. */
  flash: (notes: number[] | null) => void;
  noteOn: (midi: number, channel?: Channel, velocity?: number) => void;
  noteOff: (midi: number, channel?: Channel) => void;
  allOff: () => void;
  hit: (notes: number[], opts?: {channel?: Channel; dur?: number; strum?: number; velocity?: number}) => void;
  play: (opts: PlayOptions) => void;
  stop: () => void;
  setTempo: (tempo: number) => void;
  setGain: (channel: Channel, value: number) => void;
  setMaster: (value: number) => void;
  onNote: (fn: NoteListener) => () => void;
  onPad: (fn: PadListener) => () => void;
  onBeat: (fn: BeatListener) => () => void;
  onState: (fn: StateListener) => () => void;
  resume: () => void;
};

const InstrumentContext = createContext<{instrument: Instrument; ready: boolean} | null>(null);

export function InstrumentProvider({
  children,
  renderFooter,
}: {
  children: React.ReactNode;
  /** Rendered below the instrument panel, e.g. the tab bar. */
  renderFooter?: () => React.ReactNode;
}) {
  const webRef = useRef<WebView>(null);
  const loadedRef = useRef(false);
  const queueRef = useRef<object[]>([]);
  const noteListeners = useRef(new Set<NoteListener>());
  const padListeners = useRef(new Set<PadListener>());
  const beatListeners = useRef(new Set<BeatListener>());
  const stateListeners = useRef(new Set<StateListener>());
  const [ready, setReady] = useState(false);
  const [height, setHeight] = useState(0);

  useEffect(() => {
    // Without this the iOS ring/silent switch mutes the WebView's audio too.
    setAudioModeAsync({playsInSilentMode: true, interruptionMode: 'mixWithOthers'}).catch(() => {});
  }, []);

  const post = useCallback((msg: object) => {
    if (!loadedRef.current || !webRef.current) {
      queueRef.current.push(msg);
      return;
    }
    webRef.current.injectJavaScript(`window.SP&&window.SP.cmd(${JSON.stringify(msg)});true;`);
  }, []);

  const handleMessage = useCallback(
    (event: {nativeEvent: {data: string}}) => {
      let msg: any;
      try {
        msg = JSON.parse(event.nativeEvent.data);
      } catch {
        return;
      }
      switch (msg.t) {
        case 'loaded': {
          loadedRef.current = true;
          const queued = queueRef.current;
          queueRef.current = [];
          post({t: 'init'});
          for (const m of queued) post(m);
          break;
        }
        case 'ready':
          setReady(true);
          break;
        case 'note':
          noteListeners.current.forEach((fn) => fn(msg.m, !!msg.on));
          break;
        case 'pad':
          padListeners.current.forEach((fn) => fn(msg.index, msg.notes ?? []));
          break;
        case 'pos':
          beatListeners.current.forEach((fn) => fn(msg.beat));
          break;
        case 'state':
          stateListeners.current.forEach((fn) => fn(!!msg.playing, !!msg.finished));
          break;
      }
    },
    [post],
  );

  const instrument = useMemo<Instrument>(() => {
    const sub = <T,>(set: React.RefObject<Set<T>>) => (fn: T) => {
      set.current!.add(fn);
      return () => {
        set.current!.delete(fn);
      };
    };
    return {
      setConfig: (config, h) => {
        setHeight(h);
        post({t: 'inst', cfg: config});
      },
      update: (patch) => post({t: 'update', cfg: patch}),
      flash: (notes) => post({t: 'flash', notes}),
      noteOn: (midi, channel = 'user', velocity = 1) => post({t: 'on', m: midi, c: channel, v: velocity}),
      noteOff: (midi, channel = 'user') => post({t: 'off', m: midi, c: channel}),
      allOff: () => post({t: 'allOff'}),
      hit: (notes, opts = {}) =>
        post({
          t: 'hit',
          notes,
          c: opts.channel ?? 'user',
          dur: opts.dur ?? 0.7,
          strum: opts.strum ?? 0,
          v: opts.velocity ?? 1,
        }),
      play: (opts) => post({t: 'play', ...opts}),
      stop: () => post({t: 'stop'}),
      setTempo: (tempo) => post({t: 'tempo', tempo}),
      setGain: (channel, value) => post({t: 'gain', c: channel, v: value}),
      setMaster: (value) => post({t: 'master', v: value}),
      resume: () => post({t: 'resume'}),
      onNote: sub(noteListeners),
      onPad: sub(padListeners),
      onBeat: sub(beatListeners),
      onState: sub(stateListeners),
    };
  }, [post]);

  const value = useMemo(() => ({instrument, ready}), [instrument, ready]);

  return (
    <InstrumentContext.Provider value={value}>
      <View style={styles.root}>
        <View style={styles.content}>{children}</View>
        {/*
          The WebView stays mounted for the life of the app. Unmounting it would
          tear down the AudioContext, so screens without an instrument collapse
          the panel to zero height instead.
        */}
        <View style={[styles.panel, {height}]}>
          <WebView
            ref={webRef}
            source={{html: INSTRUMENT_HTML, baseUrl: 'https://songpractice.local/'}}
            originWhitelist={['*']}
            onMessage={handleMessage}
            javaScriptEnabled
            // Lets the AudioContext start without a touch inside the WebView.
            mediaPlaybackRequiresUserAction={false}
            allowsInlineMediaPlayback
            androidLayerType={Platform.OS === 'android' ? 'hardware' : undefined}
            scrollEnabled={false}
            overScrollMode="never"
            bounces={false}
            setSupportMultipleWindows={false}
            style={styles.web}
          />
        </View>
        {renderFooter?.()}
      </View>
    </InstrumentContext.Provider>
  );
}

function useInstrumentContext() {
  const ctx = useContext(InstrumentContext);
  if (!ctx) throw new Error('useInstrument must be used inside an InstrumentProvider');
  return ctx;
}

export function useInstrument(): Instrument {
  return useInstrumentContext().instrument;
}

export function useInstrumentReady(): boolean {
  return useInstrumentContext().ready;
}

/** Applies a surface while the calling screen is mounted. */
export function useInstrumentSurface(config: InstrumentConfig, height: number) {
  const instrument = useInstrument();
  // Rebuilding the keybed is not free, so only resend when the shape changes.
  const shape = JSON.stringify(config);
  useEffect(() => {
    instrument.setConfig(JSON.parse(shape), height);
  }, [instrument, shape, height]);
  useEffect(
    () => () => {
      instrument.allOff();
    },
    [instrument],
  );
}

/** Playhead in beats. Local state, so only the subscriber re-renders. */
export function usePlayhead(): number {
  const instrument = useInstrument();
  const [beat, setBeat] = useState(0);
  useEffect(() => instrument.onBeat(setBeat), [instrument]);
  return beat;
}

export function useTransportState(onFinished?: () => void): boolean {
  const instrument = useInstrument();
  const [playing, setPlaying] = useState(false);
  const finishedRef = useRef(onFinished);
  finishedRef.current = onFinished;
  useEffect(
    () =>
      instrument.onState((isPlaying, finished) => {
        setPlaying(isPlaying);
        if (finished) finishedRef.current?.();
      }),
    [instrument],
  );
  return playing;
}

/** Notes the user plays on the instrument, for grading and readouts. */
export function usePlayedNotes(onNote?: (midi: number, on: boolean) => void): number[] {
  const instrument = useInstrument();
  const [held, setHeld] = useState<number[]>([]);
  const cb = useRef(onNote);
  cb.current = onNote;
  useEffect(
    () =>
      instrument.onNote((midi, on) => {
        setHeld((prev) => (on ? (prev.includes(midi) ? prev : [...prev, midi].sort((a, b) => a - b)) : prev.filter((m) => m !== midi)));
        cb.current?.(midi, on);
      }),
    [instrument],
  );
  return held;
}

const styles = StyleSheet.create({
  root: {flex: 1},
  content: {flex: 1},
  panel: {overflow: 'hidden', backgroundColor: '#101117'},
  web: {flex: 1, backgroundColor: '#101117'},
});
