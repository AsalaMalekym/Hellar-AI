import OpenAI from 'openai';
import type { Config } from './config.js';
import { HttpError } from './security.js';
export type TextMessage = { role: 'system' | 'user' | 'assistant'; content: string };
export interface AIProvider {
  ready: boolean;
  stream(model: string, messages: TextMessage[], signal: AbortSignal): AsyncIterable<string>;
  image(prompt: string, size: string, signal: AbortSignal): Promise<Buffer>;
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
    async *stream(model, messages, signal) {
      if (!client)
        throw new HttpError(
          503,
          'ИИ ещё не подключён. Владелец должен настроить API-ключ.',
          'AI_NOT_CONFIGURED',
        );
      const response = await client.chat.completions.create(
        { model, messages, stream: true, max_completion_tokens: c.maxOutput, store: false },
        { signal },
      );
      for await (const chunk of response) {
        const choice = chunk.choices[0];
        if (choice?.finish_reason === 'content_filter')
          throw new HttpError(422, 'Модель отклонила запрос. Попробуй изменить формулировку.');
        if (choice?.delta.refusal)
          throw new HttpError(422, 'Модель не может выполнить этот запрос.');
        if (choice?.delta.content) yield choice.delta.content;
      }
    },
    async image(prompt, size, signal) {
      if (!client)
        throw new HttpError(503, 'Генерация изображений ещё не настроена.', 'AI_NOT_CONFIGURED');
      const r = await client.images.generate(
        {
          model: c.imageModel,
          prompt,
          size: size as '1024x1024',
          n: 1,
          quality: 'low',
          output_format: 'png',
        },
        { signal },
      );
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
