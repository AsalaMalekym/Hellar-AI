export type StreamEvent = { event: string; data: any };
export async function readEvents(
  stream: ReadableStream<Uint8Array>,
  handle: (event: StreamEvent) => void,
) {
  const reader = stream.getReader(),
    decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      let index;
      while ((index = buffer.indexOf('\n\n')) !== -1) {
        const block = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        let event = 'message';
        const data: string[] = [];
        for (const line of block.split('\n')) {
          if (line.startsWith('event:')) event = line.slice(6).trim();
          if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
        }
        if (data.length) handle({ event, data: JSON.parse(data.join('\n')) });
      }
      if (done) break;
    }
    if (buffer.trim() && !buffer.startsWith(':'))
      throw Error('Поток прервался до завершения события.');
  } finally {
    reader.releaseLock();
  }
}
