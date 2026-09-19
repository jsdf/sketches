/**
 * DeepSeek backend.
 *
 * DeepSeek's API is OpenAI-compatible and has no server-side web search, so the
 * agent loop and the search/fetch tools both run here on the device.
 */
import {fetchPage, webSearch} from './search';
import {looseJsonParse, RunOptions, truncate} from './runner';
import {OPEN_SCHEMA, SEARCH_SCHEMA, SUBMIT_SCHEMA, SUBMIT_TOOL_NAME, SYSTEM_PROMPT, userPrompt} from './prompts';
import {AgentError, Settings, SubmitPayload} from './types';

type ToolCall = {id: string; type: 'function'; function: {name: string; arguments: string}};
type Message = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
};

const TOOLS = [
  {
    type: 'function' as const,
    function: {
      name: 'web_search',
      description: 'Search the web. Returns titles, URLs and snippets.',
      parameters: SEARCH_SCHEMA,
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'open_page',
      description: 'Fetch a web page and return its readable text. Use it on promising search results.',
      parameters: OPEN_SCHEMA,
    },
  },
  {
    type: 'function' as const,
    function: {
      name: SUBMIT_TOOL_NAME,
      description: 'Submit the finished transcription. Call this exactly once, when you are done researching.',
      parameters: SUBMIT_SCHEMA,
    },
  },
];

export async function runDeepSeek({query, settings, onEvent, onSubmit}: RunOptions): Promise<SubmitPayload> {
  if (!settings.deepseekKey) throw new AgentError('No DeepSeek API key set. Add one in Settings.');

  const messages: Message[] = [
    {role: 'system', content: SYSTEM_PROMPT},
    {role: 'user', content: userPrompt(query)},
  ];
  let nudges = 0;

  for (let step = 0; step < settings.maxSteps; step++) {
    onEvent({kind: 'status', text: step === 0 ? 'Asking DeepSeek where to look…' : 'Thinking…'});
    const reply = await callDeepSeek(messages, settings);
    messages.push(reply);

    const calls = reply.tool_calls ?? [];
    if (calls.length === 0) {
      if (nudges++ >= 2) {
        throw new AgentError(
          reply.content
            ? `The model stopped without submitting a song. It said: ${truncate(reply.content, 400)}`
            : 'The model stopped without submitting a song.',
        );
      }
      onEvent({kind: 'warn', text: 'Model replied in prose; asking it to submit properly.'});
      messages.push({
        role: 'user',
        content: `Do not answer in prose. Call ${SUBMIT_TOOL_NAME} with your best transcription now.`,
      });
      continue;
    }

    for (const call of calls) {
      const name = call.function?.name;
      let args: any = {};
      try {
        args = call.function?.arguments ? looseJsonParse(call.function.arguments) : {};
      } catch (err) {
        messages.push({role: 'tool', tool_call_id: call.id, content: `Error: ${(err as Error).message}`});
        continue;
      }

      if (name === SUBMIT_TOOL_NAME) {
        const verdict = onSubmit(args as SubmitPayload);
        if (verdict.ok) return args as SubmitPayload;
        onEvent({kind: 'warn', text: 'Submission had problems; asking the model to fix it.'});
        messages.push({role: 'tool', tool_call_id: call.id, content: verdict.message});
        continue;
      }

      if (name === 'web_search') {
        const q = String(args.query ?? '');
        onEvent({kind: 'search', text: q});
        try {
          const results = await webSearch(q, settings);
          onEvent({
            kind: 'results',
            text: `${results.length} result${results.length === 1 ? '' : 's'}`,
            items: results.map((r) => ({title: r.title, url: r.url})),
          });
          messages.push({
            role: 'tool',
            tool_call_id: call.id,
            content: results.length
              ? results
                  .map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${truncate(r.snippet, 400)}`)
                  .join('\n')
              : 'No results. Try a different query.',
          });
        } catch (err) {
          onEvent({kind: 'warn', text: `Search failed: ${(err as Error).message}`});
          messages.push({role: 'tool', tool_call_id: call.id, content: `Search failed: ${(err as Error).message}`});
        }
        continue;
      }

      if (name === 'open_page') {
        const url = String(args.url ?? '');
        onEvent({kind: 'fetch', text: url});
        try {
          const text = await fetchPage(url);
          messages.push({role: 'tool', tool_call_id: call.id, content: text});
        } catch (err) {
          onEvent({kind: 'warn', text: `Could not open ${url}`});
          messages.push({
            role: 'tool',
            tool_call_id: call.id,
            content: `Could not open that page: ${(err as Error).message}. Try another result.`,
          });
        }
        continue;
      }

      messages.push({role: 'tool', tool_call_id: call.id, content: `Unknown tool "${name}".`});
    }
  }

  throw new AgentError(`Gave up after ${settings.maxSteps} steps without a usable transcription.`);
}

async function callDeepSeek(messages: Message[], settings: Settings): Promise<Message> {
  const base = settings.deepseekBaseUrl.replace(/\/+$/, '');
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${settings.deepseekKey}`,
    },
    body: JSON.stringify({
      model: settings.deepseekModel,
      messages,
      tools: TOOLS,
      tool_choice: 'auto',
      temperature: 0.2,
      max_tokens: 8000,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    if (res.status === 401) throw new AgentError('DeepSeek rejected the API key.');
    if (res.status === 402) throw new AgentError('DeepSeek reports insufficient balance on this key.');
    if (res.status === 429) throw new AgentError('DeepSeek is rate limiting this key. Try again shortly.');
    throw new AgentError(`DeepSeek error ${res.status}: ${truncate(body, 300)}`);
  }

  const json = await res.json();
  const choice = json?.choices?.[0];
  if (!choice?.message) throw new AgentError('DeepSeek returned an empty response.');
  return choice.message as Message;
}
