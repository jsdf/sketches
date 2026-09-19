import {AgentEvent, Settings, SubmitPayload} from './types';

/** Returns ok, or a correction the model should act on and try again. */
export type SubmitHandler = (payload: SubmitPayload) => {ok: true} | {ok: false; message: string};

export type RunOptions = {
  query: string;
  settings: Settings;
  onEvent: (event: AgentEvent) => void;
  onSubmit: SubmitHandler;
};

/** Parses model JSON that may be wrapped in prose or a code fence. */
export function looseJsonParse(text: string): any {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    /* fall through to recovery */
  }
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(trimmed);
  if (fenced) {
    try {
      return JSON.parse(fenced[1]);
    } catch {
      /* fall through */
    }
  }
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start !== -1 && end > start) {
    try {
      return JSON.parse(trimmed.slice(start, end + 1));
    } catch {
      /* give up below */
    }
  }
  throw new Error('The model returned arguments that were not valid JSON.');
}

export function truncate(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max) + `\n[truncated]`;
}
