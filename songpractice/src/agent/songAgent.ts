/**
 * Front door for song lookup: picks a backend, runs it, and validates whatever
 * comes back before it becomes a Song.
 */
import {normalizeSubmission, retryMessage, ValidationError} from './normalize';
import {runClaude} from './claude';
import {runDeepSeek} from './deepseek';
import {SubmitHandler} from './runner';
import {AgentError, AgentEvent, FindSongResult, Settings, SubmitPayload} from './types';

export async function findSong(
  query: string,
  settings: Settings,
  onEvent: (event: AgentEvent) => void,
): Promise<FindSongResult> {
  const trimmed = query.trim();
  if (!trimmed) throw new AgentError('Type a song name first.');

  let accepted: FindSongResult | null = null;

  const onSubmit: SubmitHandler = (payload: SubmitPayload) => {
    try {
      accepted = normalizeSubmission(payload, trimmed);
      return {ok: true};
    } catch (err) {
      if (err instanceof ValidationError) return {ok: false, message: retryMessage(err)};
      return {ok: false, message: `Submission failed: ${(err as Error).message}`};
    }
  };

  const run = settings.llmProvider === 'claude' ? runClaude : runDeepSeek;
  await run({query: trimmed, settings, onEvent, onSubmit});

  if (!accepted) throw new AgentError('The agent finished without a usable transcription.');
  const result = accepted as FindSongResult;
  for (const warning of result.warnings) onEvent({kind: 'warn', text: warning});
  onEvent({kind: 'done', text: `Ready: ${result.song.title}`});
  return result;
}

export function providerLabel(settings: Settings): string {
  return settings.llmProvider === 'claude' ? `Claude (${settings.claudeModel})` : `DeepSeek (${settings.deepseekModel})`;
}

export function missingKeyMessage(settings: Settings): string | null {
  if (settings.llmProvider === 'claude' && !settings.claudeKey) {
    return 'Add an Anthropic API key in Settings to search for songs.';
  }
  if (settings.llmProvider === 'deepseek' && !settings.deepseekKey) {
    return 'Add a DeepSeek API key in Settings to search for songs.';
  }
  return null;
}
