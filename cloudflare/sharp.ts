// Only metadata() is used by shared imageRoutes; image cleaning uses storage.ts.
import { pngMetadata } from './storage.js';
export default function metadataOnly(data: Buffer) { return { metadata: async () => pngMetadata(data) }; }
