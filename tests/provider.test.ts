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
          '\n\ndata: [DONE]\n\n',
        { status: 200, headers: { 'content-type': 'text/event-stream' } },
      );
    return new Response(
      JSON.stringify({ data: [{ b64_json: Buffer.from('image-test').toString('base64') }] }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  };
  const c = { ...config(), key: 'test-only-key' },
    ai = provider(c, transport);
  let text = '';
  for await (const chunk of ai.stream(
    c.chatModels[0],
    [{ role: 'user', content: 'hello' }],
    new AbortController().signal,
  ))
    text += chunk;
  assert.equal(text, 'Тест');
  assert.equal(calls[0].body.stream, true);
  assert.equal(calls[0].body.max_completion_tokens, c.maxOutput);
  assert.equal(calls[0].body.store, false);
  assert.equal(calls[0].headers.get('authorization'), 'Bearer test-only-key');
  assert.equal(
    (await ai.image('cosmos', '1024x1024', new AbortController().signal)).toString(),
    'image-test',
  );
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
