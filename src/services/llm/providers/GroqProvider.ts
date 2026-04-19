/**
 * Groq LLM provider implementation
 */

import { ILLMProvider } from '../../../types';
import FormData from 'form-data';

export class GroqProvider implements ILLMProvider {
  private apiKey: string = process.env.GROQ_API_KEY || '';
  private model: string = 'llama-3.3-70b-versatile';
  private apiEndpoint: string = 'https://api.groq.com/openai/v1/chat/completions';

  async initialize(apiKey: string): Promise<void> {
    if (apiKey && apiKey.trim().length > 0) {
      this.apiKey = apiKey.trim();
    }
  }

  async generateText(prompt: string, options?: Record<string, unknown>): Promise<string> {
    if (!this.apiKey) {
      throw new Error('Groq API key not set');
    }

    const PRIMARY_MODEL = 'llama-3.3-70b-versatile';
    const FALLBACK_MODEL = 'meta-llama/llama-4-scout-17b-16e-instruct';
    const RETRY_WAIT_MS = 60_000;

    const buildBody = (model: string) => JSON.stringify({
      messages: [{ role: 'user', content: prompt }],
      model,
      temperature: (options?.temperature as number) || 0.7,
      max_tokens: (options?.maxTokens as number) || 2000,
      top_p: 0.95
    });

    const callApi = async (model: string): Promise<{ ok: boolean; status: number; data: any }> => {
      const response = await fetch(this.apiEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`
        },
        body: buildBody(model)
      });
      const data: any = await response.json();
      return { ok: response.ok, status: response.status, data };
    };

    const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

    // ── Attempt loop (runs at most twice: initial + one retry after 60-s wait) ──
    for (let attempt = 1; attempt <= 2; attempt++) {

      // Step 1: Primary model
      const primary = await callApi(PRIMARY_MODEL);

      if (primary.ok) {
        return primary.data.choices?.[0]?.message?.content || '';
      }

      if (primary.status === 429) {
        const primaryMsg = primary.data?.error?.message || 'TPM rate limit';
        console.warn(`[GroqProvider] 429 on primary model (${PRIMARY_MODEL}): ${primaryMsg}`);
        console.log(`[GroqProvider] Falling back immediately to ${FALLBACK_MODEL}...`);

        // Step 2: Fallback model (no wait)
        const fallback = await callApi(FALLBACK_MODEL);

        if (fallback.ok) {
          console.log(`[GroqProvider] Fallback model (${FALLBACK_MODEL}) succeeded.`);
          return fallback.data.choices?.[0]?.message?.content || '';
        }

        if (fallback.status === 429) {
          const fallbackMsg = fallback.data?.error?.message || 'TPM rate limit';
          console.warn(`[GroqProvider] 429 on fallback model (${FALLBACK_MODEL}): ${fallbackMsg}`);

          if (attempt < 2) {
            // Step 3: Both models rate-limited — wait 60 s then retry from Step 1
            console.log(`[GroqProvider] Both models rate-limited. Waiting ${RETRY_WAIT_MS / 1000}s before retrying...`);
            await sleep(RETRY_WAIT_MS);
            console.log(`[GroqProvider] Resuming after ${RETRY_WAIT_MS / 1000}s wait — retrying primary model...`);
            continue; // go to attempt 2
          }

          // Exhausted all retries
          throw new Error(`Groq API error: ${fallbackMsg}`);
        }

        // Fallback returned a non-429 error
        throw new Error(`Groq API error (fallback): ${fallback.data?.error?.message || fallback.status}`);
      }

      // Primary returned a non-429 error
      throw new Error(`Groq API error: ${primary.data?.error?.message || primary.status}`);
    }

    // Should never reach here
    throw new Error('Groq API error: exhausted retry attempts');
  }

  getModelInfo(): Record<string, unknown> {
    return {
      provider: 'Groq',
      model: this.model,
      endpoint: this.apiEndpoint
    };
  }

  async transcribeAudio(base64Audio: string): Promise<string> {
    if (!this.apiKey) {
      throw new Error('Groq API key not set');
    }

    try {
      // 1. Convert base64 to Buffer
      const buffer = Buffer.from(base64Audio, 'base64');

      const boundary = '----GroqFormBoundary' + Math.random().toString(36).substring(2);

      // Construct the multipart body manually
      const parts = [
        `--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\nwhisper-large-v3\r\n`,
        `--${boundary}\r\nContent-Disposition: form-data; name="temperature"\r\n\r\n0\r\n`,
        `--${boundary}\r\nContent-Disposition: form-data; name="response_format"\r\n\r\njson\r\n`,
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="recording.wav"\r\nContent-Type: audio/wav\r\n\r\n`
      ];

      // Combine parts and file buffer
      const paramBuffer = Buffer.concat([
        Buffer.from(parts.join('')),
        buffer,
        Buffer.from(`\r\n--${boundary}--`)
      ]);

      console.log(`[GroqProvider] Sending audio to Groq API... (Size: ${paramBuffer.length} bytes)`);

      const headers = {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': paramBuffer.length.toString()
      };

      const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
        method: 'POST',
        headers: headers,
        body: paramBuffer
      });

      if (!response.ok) {
        const errorText = await response.text();
        let errorMsg = `Groq Audio API error: ${response.status} ${response.statusText}`;
        try {
          const errorJson = JSON.parse(errorText);
          if (errorJson.error?.message) errorMsg += ` - ${errorJson.error.message}`;
        } catch (e) {
          errorMsg += ` - ${errorText}`;
        }
        console.error('[GroqProvider]', errorMsg);
        throw new Error(errorMsg);
      }

      const data: any = await response.json();
      console.log(`[GroqProvider] Transcription received: "${data.text?.substring(0, 50)}..."`);
      return data.text || '';

    } catch (error) {
      console.error('[GroqProvider] Transcribe error:', error);
      throw error;
    }
  }
}
