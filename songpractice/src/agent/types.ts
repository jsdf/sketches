import {Song} from '../music/song';

export type LlmProvider = 'deepseek' | 'claude';
export type SearchProvider = 'tavily' | 'brave' | 'duckduckgo';

export type Settings = {
  llmProvider: LlmProvider;
  deepseekKey: string;
  deepseekModel: string;
  deepseekBaseUrl: string;
  claudeKey: string;
  claudeModel: string;
  searchProvider: SearchProvider;
  tavilyKey: string;
  braveKey: string;
  /** Upper bound on agent turns, so a confused run cannot spend forever. */
  maxSteps: number;
};

export const DEFAULT_SETTINGS: Settings = {
  llmProvider: 'deepseek',
  deepseekKey: '',
  deepseekModel: 'deepseek-chat',
  deepseekBaseUrl: 'https://api.deepseek.com',
  claudeKey: '',
  claudeModel: 'claude-opus-5',
  searchProvider: 'duckduckgo',
  tavilyKey: '',
  braveKey: '',
  maxSteps: 12,
};

export type AgentEvent =
  | {kind: 'status'; text: string}
  | {kind: 'search'; text: string}
  | {kind: 'results'; text: string; items: {title: string; url: string}[]}
  | {kind: 'fetch'; text: string}
  | {kind: 'note'; text: string}
  | {kind: 'warn'; text: string}
  | {kind: 'done'; text: string};

export type AgentLog = AgentEvent & {id: string; at: number};

/** Raw shape the model submits, before local validation turns it into a Song. */
export type SubmitPayload = {
  title?: string;
  artist?: string;
  key?: string;
  tempo?: number;
  timeSignature?: string;
  sections?: {
    name?: string;
    chords?: {symbol?: string; beats?: number}[];
    melody?: {note?: string; beats?: number; lyric?: string}[];
  }[];
  sources?: string[];
  confidence?: string;
  notes?: string;
};

export type FindSongResult = {song: Song; warnings: string[]};

export class AgentError extends Error {}
