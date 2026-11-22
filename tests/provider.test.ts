import test from 'node:test';
import assert from 'node:assert/strict';
import { provider } from '../server/provider.js';
import { config } from '../server/config.js';
test('OpenAI SDK HTTP contract: real SDK parses mock SSE and image response, key server-only', async () => {
  const calls: any[] = [];
  const transport: typeof fetch = async (input, init) => {
    const url = String(input);
    const body = JSON.parse(String(init?.body));
    calls.push({ url, body, headers: new Headers(init?.headers) });
    if (url.endsWith('/chat/completions'))
      return new Response(
        'data: ' +
          JSON.stringify({
            id: 'test',
            choices: [{ index: 0, delta: { content: 'Тест' }, finish_reason: null }],
          }) +
          '\n\ndata: ' + JSON.stringify({ choices: [], usage: { prompt_tokens: 120, completion_tokens: 30, prompt_tokens_details: { cached_tokens: 20 } } }) + '\n\ndata: [DONE]\n\n',
        { status: 200, headers: { 'content-type': 'text/event-stream' } },
      );
    return new Response(
      JSON.stringify({ data: [{ b64_json: Buffer.from('image-test').toString('base64') }], usage: { input_tokens: 40, output_tokens: 200 } }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  };
  const c = { ...config(), key: 'test-only-key' },
    ai = provider(c, transport);
  let text = '';
  const usages: any[] = [];
  for await (const chunk of ai.stream(
    c.chatModels[0],
    [{ role: 'user', content: 'hello' }],
    new AbortController().signal,
    usage => usages.push(usage),
  ))
    text += chunk;
  assert.equal(text, 'Тест');
  assert.equal(calls[0].body.stream, true);
  assert.equal(calls[0].body.stream_options.include_usage, true);
  assert.deepEqual(usages[0], { input:120,cached:20,output:30 });
  assert.equal(calls[0].body.max_completion_tokens, c.maxOutput);
  assert.equal(calls[0].body.store, false);
  assert.equal(calls[0].headers.get('authorization'), 'Bearer test-only-key');
  assert.equal(
    (await ai.image('cosmos', '1024x1024', new AbortController().signal, usage => usages.push(usage))).toString(),
    'image-test',
  );
  assert.deepEqual(usages[1], { input:40,cached:0,output:200 });
  assert.equal(calls[1].body.n, 1);
  assert.equal(calls[1].body.output_format, 'png');
});
test('SDK does not retry billable requests automatically', async () => {
  let count = 0;
  const ai = provider({ ...config(), key: 'test-only' }, async () => {
    count++;
    return new Response(JSON.stringify({ error: { message: 'test error' } }), {
      status: 429,
      headers: { 'content-type': 'application/json' },
    });
  });
  await assert.rejects(ai.image('cosmos', '1024x1024', new AbortController().signal));
  assert.equal(count, 1);
});
