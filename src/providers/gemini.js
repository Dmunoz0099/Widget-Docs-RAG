import { AIProvider, httpJson } from './AIProvider.js';
import { config } from '../config.js';

const BASE = 'https://generativelanguage.googleapis.com/v1beta';

/**
 * Proveedor Gemini (Google AI Studio). Usa la REST API directamente
 * (sin SDK) para minimizar dependencias.
 */
export class GeminiProvider extends AIProvider {
  constructor({ apiKey, chatModel, embedModel } = config.gemini) {
    super();
    this.apiKey = apiKey;
    this.chatModel = chatModel;
    this.embedModel = embedModel;
    // gemini-embedding-001 devuelve 3072 dims por defecto, pero soporta
    // reducirlas (Matryoshka) via outputDimensionality para cuadrar con la tabla.
    this.outputDim = config.embeddingDim;
  }

  async embed(texts) {
    if (!texts.length) return [];
    // batchEmbedContents: un request para varios textos.
    const model = `models/${this.embedModel}`;
    const url = `${BASE}/${model}:batchEmbedContents?key=${this.apiKey}`;
    const body = {
      requests: texts.map((t) => ({
        model,
        content: { parts: [{ text: t }] },
        outputDimensionality: this.outputDim,
      })),
    };
    const res = await httpJson(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const embeddings = (res.embeddings || []).map((e) => e.values);
    if (embeddings.length !== texts.length) {
      throw new Error(
        `Gemini devolvio ${embeddings.length} embeddings para ${texts.length} textos`,
      );
    }
    return embeddings;
  }

  async generate({ system, user }) {
    const url = `${BASE}/models/${this.chatModel}:generateContent?key=${this.apiKey}`;
    const body = {
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: user }] }],
      generationConfig: { temperature: 0.2 },
    };
    const res = await httpJson(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const parts = res?.candidates?.[0]?.content?.parts || [];
    const text = parts.map((p) => p.text || '').join('').trim();
    if (!text) {
      const reason = res?.candidates?.[0]?.finishReason || 'desconocido';
      throw new Error(`Gemini no devolvio texto (finishReason: ${reason})`);
    }
    return text;
  }
}
