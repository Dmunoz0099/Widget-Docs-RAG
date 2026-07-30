import { AIProvider, httpJson } from './AIProvider.js';
import { config } from '../config.js';

const BASE = 'https://api.anthropic.com/v1';

/**
 * Proveedor Claude (Anthropic) para GENERACION.
 * NOTA: Anthropic no ofrece embeddings; usa Gemini u OpenAI para embed()
 * mediante EMBEDDING_PROVIDER.
 */
export class ClaudeProvider extends AIProvider {
  constructor({ apiKey, chatModel } = config.claude) {
    super();
    this.apiKey = apiKey;
    this.chatModel = chatModel;
  }

  async embed() {
    throw new Error(
      'Claude no soporta embeddings. Configura EMBEDDING_PROVIDER=gemini (u openai).',
    );
  }

  async generate({ system, user }) {
    const url = `${BASE}/messages`;
    const body = {
      model: this.chatModel,
      max_tokens: 1024,
      temperature: 0.2,
      system,
      messages: [{ role: 'user', content: user }],
    };
    const res = await httpJson(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });
    const text = (res.content || [])
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim();
    if (!text) throw new Error('Claude no devolvio texto');
    return text;
  }
}
