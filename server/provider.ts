import type { TokenUsage } from './billing.js';
import OpenAI from 'openai';
import type { Config } from './config.js';
import { HttpError } from './security.js';
export type TextMessage = { role: 'system' | 'user' | 'assistant'; content: string };
export interface AIProvider {
  ready: boolean;
  stream(
    model: string,
    messages: TextMessage[],
    signal: AbortSignal,
    onUsage?: (usage: TokenUsage) => void,
    onRequest?: (requestId: string | null) => void,
  ): AsyncIterable<string>;
  image(
    prompt: string,
    size: string,
    signal: AbortSignal,
    onUsage?: (usage: TokenUsage) => void,
    onRequest?: (requestId: string | null) => void,
  ): Promise<Buffer>;
}
export function provider(c: Config, transport?: typeof fetch): AIProvider {
  const client = c.key
    ? new OpenAI({
        apiKey: c.key,
        fetch: transport,
        maxRetries: 0,
        timeout: Math.max(c.aiTimeout, c.imageTimeout),
      })
    : null;
  return {
    ready: !!client,
    async *stream(model, messages, signal, onUsage, onRequest) {
      if (!client)
        throw new HttpError(
          503,
          'ИИ ещё не подключён. Владелец должен настроить API-ключ.',
          'AI_NOT_CONFIGURED',
        );
      const { data: response, request_id } = await client.chat.completions
        .create(
          {
            model,
            messages,
            stream: true,
            stream_options: { include_usage: true },
            max_completion_tokens: c.maxOutput,
            store: false,
          },
          { signal },
        )
        .withResponse();
      onRequest?.(request_id);
      for await (const chunk of response) {
        if (chunk.usage)
          onUsage?.({
            input: chunk.usage.prompt_tokens,
            cached: chunk.usage.prompt_tokens_details?.cached_tokens || 0,
            output: chunk.usage.completion_tokens,
          });
        const choice = chunk.choices[0];
        if (choice?.finish_reason === 'content_filter')
          throw new HttpError(422, 'Модель отклонила запрос. Попробуй изменить формулировку.');
        if (choice?.delta.refusal)
          throw new HttpError(422, 'Модель не может выполнить этот запрос.');
        if (choice?.delta.content) yield choice.delta.content;
      }
    },
    async image(prompt, size, signal, onUsage, onRequest) {
      if (!client)
        throw new HttpError(503, 'Генерация изображений ещё не настроена.', 'AI_NOT_CONFIGURED');
      const { data: r, request_id } = await client.images
        .generate(
          {
            model: c.imageModel,
            prompt,
            size: size as '1024x1024',
            n: 1,
            quality: 'low',
            output_format: 'png',
          },
          { signal },
        )
        .withResponse();
      onRequest?.(request_id);
      if (r.usage)
        onUsage?.({ input: r.usage.input_tokens, cached: 0, output: r.usage.output_tokens });
      const data = r.data?.[0]?.b64_json;
      if (!data || data.length > 34 * 1024 * 1024)
        throw new HttpError(502, 'Сервис изображений вернул неподдерживаемый результат.');
      return Buffer.from(data, 'base64');
    },
  };
}
export function providerError(e: unknown, signal?: AbortSignal) {
  if (signal?.aborted)
    return signal.reason?.name === 'TimeoutError'
      ? 'Время ожидания истекло. Попробуй ещё раз.'
      : 'Генерация остановлена.';
  if (e instanceof HttpError) return e.message;
  const status = (e as { status?: number })?.status;
  if (status === 429)
    return 'Провайдер временно ограничил запросы или исчерпан его лимит. Попробуй позже.';
  if (status === 401 || status === 403) return 'Сервис ИИ требует проверки доступа владельцем.';
  if (status === 400 || status === 422)
    return 'Провайдер отклонил запрос. Проверь промпт, модель и параметры.';
  return 'Сервис ИИ временно недоступен. Попробуй позже.';
}
