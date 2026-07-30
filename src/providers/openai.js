import { AIProvider, httpJson } from './AIProvider.js';
import { config } from '../config.js';

const BASE = 'https://api.openai.com/v1';

/** Proveedor OpenAI (embeddings + generacion). */
export class OpenAIProvider extends AIProvider {
  constructor({ apiKey, chatModel, embedModel } = config.openai) {
    super();
    this.apiKey = apiKey;
    this.chatModel = chatModel;
    this.embedModel = embedModel;
  }

  get headers() {
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.apiKey}`,
    };
  }

  async embed(texts) {
    if (!texts.length) return [];
    const res = await httpJson(`${BASE}/embeddings`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({ model: this.embedModel, input: texts }),
    });
    // La API preserva el orden de entrada, pero ordenamos por "index" por seguridad.
    return (res.data || [])
      .slice()
      .sort((a, b) => a.index - b.index)
      .map((d) => d.embedding);
  }

  async generate({ system, user }) {
    const res = await httpJson(`${BASE}/chat/completions`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({
        model: this.chatModel,
        temperature: 0.2,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
    });
    const text = res?.choices?.[0]?.message?.content?.trim();
    if (!text) throw new Error('OpenAI no devolvio texto');
    return text;
  }
}
