/**
 * Claude backend.
 *
 * The Anthropic API runs web search and web fetch server side, so this backend
 * only has to handle one client tool: the final submission. That removes the
 * search-provider key and the HTML scraping the DeepSeek path needs.
 */
import {RunOptions, truncate} from './runner';
import {SUBMIT_SCHEMA, SUBMIT_TOOL_NAME, SYSTEM_PROMPT, userPrompt} from './prompts';
import {AgentError, Settings, SubmitPayload} from './types';

const API_URL = 'https://api.anthropic.com/v1/messages';
const API_VERSION = '2023-06-01';

type ContentBlock = any;
type Message = {role: 'user' | 'assistant'; content: string | ContentBlock[]};

const TOOLS = [
  {type: 'web_search_20260209', name: 'web_search', max_uses: 8},
  {type: 'web_fetch_20260209', name: 'web_fetch', max_uses: 6},
  {
    name: SUBMIT_TOOL_NAME,
    description: 'Submit the finished transcription. Call this exactly once, when you are done researching.',
    input_schema: SUBMIT_SCHEMA,
  },
];

export async function runClaude({query, settings, onEvent, onSubmit}: RunOptions): Promise<SubmitPayload> {
  if (!settings.claudeKey) throw new AgentError('No Anthropic API key set. Add one in Settings.');

  const messages: Message[] = [{role: 'user', content: userPrompt(query)}];

  for (let step = 0; step < settings.maxSteps; step++) {
    onEvent({kind: 'status', text: step === 0 ? 'Asking Claude to research the song…' : 'Thinking…'});
    const reply = await callClaude(messages, settings);

    if (reply.stop_reason === 'refusal') {
      throw new AgentError('Claude declined this request.');
    }

    const blocks: ContentBlock[] = reply.content ?? [];
    // Thinking blocks must be echoed back unchanged, so append the whole array.
    messages.push({role: 'assistant', content: blocks});
    reportServerTools(blocks, onEvent);

    if (reply.stop_reason === 'pause_turn') {
      // The server paused a long-running tool turn; send it straight back.
      continue;
    }

    const submissions = blocks.filter((b) => b?.type === 'tool_use' && b.name === SUBMIT_TOOL_NAME);
    if (submissions.length > 0) {
      const call = submissions[0];
      const verdict = onSubmit(call.input as SubmitPayload);
      if (verdict.ok) return call.input as SubmitPayload;
      onEvent({kind: 'warn', text: 'Submission had problems; asking Claude to fix it.'});
      messages.push({
        role: 'user',
        content: [{type: 'tool_result', tool_use_id: call.id, content: verdict.message, is_error: true}],
      });
      continue;
    }

    if (reply.stop_reason === 'tool_use') {
      // A client tool we do not implement; tell it so rather than stalling.
      const unknown = blocks.filter((b) => b?.type === 'tool_use');
      messages.push({
        role: 'user',
        content: unknown.map((b) => ({
          type: 'tool_result',
          tool_use_id: b.id,
          content: `Unknown tool "${b.name}". Use ${SUBMIT_TOOL_NAME} when you are ready.`,
          is_error: true,
        })),
      });
      continue;
    }

    const text = blocks
      .filter((b) => b?.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();
    onEvent({kind: 'warn', text: 'Claude answered in prose; asking it to submit properly.'});
    messages.push({
      role: 'user',
      content: `Do not answer in prose. Call ${SUBMIT_TOOL_NAME} with your best transcription now.${
        text ? '' : ' You returned no content.'
      }`,
    });
  }

  throw new AgentError(`Gave up after ${settings.maxSteps} steps without a usable transcription.`);
}

/** Surfaces the server-run searches and fetches in the UI's step log. */
function reportServerTools(blocks: ContentBlock[], onEvent: RunOptions['onEvent']) {
  for (const block of blocks) {
    if (block?.type === 'server_tool_use' && block.name === 'web_search') {
      onEvent({kind: 'search', text: String(block.input?.query ?? '')});
    } else if (block?.type === 'server_tool_use' && block.name === 'web_fetch') {
      onEvent({kind: 'fetch', text: String(block.input?.url ?? '')});
    } else if (block?.type === 'web_search_tool_result') {
      // A successful result is a list; an error is a single object.
      if (Array.isArray(block.content)) {
        onEvent({
          kind: 'results',
          text: `${block.content.length} result${block.content.length === 1 ? '' : 's'}`,
          items: block.content.map((r: any) => ({title: String(r.title ?? ''), url: String(r.url ?? '')})),
        });
      } else {
        onEvent({kind: 'warn', text: `Search error: ${block.content?.error_code ?? 'unknown'}`});
      }
    } else if (block?.type === 'web_fetch_tool_result' && block.content?.error_code) {
      onEvent({kind: 'warn', text: `Fetch error: ${block.content.error_code}`});
    }
  }
}

async function callClaude(messages: Message[], settings: Settings): Promise<any> {
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': settings.claudeKey,
      'anthropic-version': API_VERSION,
    },
    body: JSON.stringify({
      model: settings.claudeModel,
      max_tokens: 16000,
      system: SYSTEM_PROMPT,
      messages,
      tools: TOOLS,
      thinking: {type: 'adaptive'},
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    if (res.status === 401) throw new AgentError('Anthropic rejected the API key.');
    if (res.status === 429) throw new AgentError('Anthropic is rate limiting this key. Try again shortly.');
    throw new AgentError(`Anthropic error ${res.status}: ${truncate(body, 300)}`);
  }
  return res.json();
}
