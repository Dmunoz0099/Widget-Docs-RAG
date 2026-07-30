import { config } from '../config.js';
import { GeminiProvider } from './gemini.js';
import { ClaudeProvider } from './claude.js';
import { OpenAIProvider } from './openai.js';

/** Instancia un proveedor por su nombre. */
function makeProvider(name) {
  switch (name) {
    case 'gemini':
      return new GeminiProvider();
    case 'claude':
      return new ClaudeProvider();
    case 'openai':
      return new OpenAIProvider();
    default:
      throw new Error(`Proveedor de IA desconocido: "${name}" (usa gemini|claude|openai)`);
  }
}

// El proveedor de chat y el de embeddings pueden diferir (p.ej. claude + gemini).
let _chat;
let _embed;

export function getChatProvider() {
  if (!_chat) _chat = makeProvider(config.aiProvider);
  return _chat;
}

export function getEmbeddingProvider() {
  if (!_embed) _embed = makeProvider(config.embeddingProvider);
  return _embed;
}
