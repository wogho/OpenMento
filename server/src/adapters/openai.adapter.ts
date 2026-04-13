/**
 * OpenAI LLM 어댑터
 * openai SDK v4+ (chat completions API)를 래핑합니다.
 */

import OpenAI from 'openai';
import type { ILlmAdapter, LlmMessage, LlmResponse, LlmStreamChunk, AdapterConfig } from './llm.interface.js';

export class OpenAiAdapter implements ILlmAdapter {
  readonly provider = 'openai';
  readonly model: string;
  private readonly client: OpenAI;
  private readonly temperature: number;
  private readonly maxTokens: number;
  private readonly timeoutMs: number;

  constructor(config: AdapterConfig) {
    const apiKey = config.apiKey ?? process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY 환경변수가 설정되지 않았습니다.');
    }
    this.client = new OpenAI({ apiKey });
    this.model = config.model;
    this.temperature = config.temperature ?? 0.7;
    this.maxTokens = config.maxTokens ?? 2048;
    this.timeoutMs = config.timeoutMs ?? 30_000;
  }

  async chat(messages: LlmMessage[]): Promise<LlmResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
    const response = await this.client.chat.completions.create(
      {
        model: this.model,
        messages,
        temperature: this.temperature,
        max_tokens: this.maxTokens,
      },
      { signal: controller.signal },
    );

    const choice = response.choices[0];
    if (!choice?.message?.content) {
      throw new Error('OpenAI 응답이 비어있습니다.');
    }

    return {
      content: choice.message.content,
      model: response.model,
      inputTokens: response.usage?.prompt_tokens ?? 0,
      outputTokens: response.usage?.completion_tokens ?? 0,
    };
    } finally {
      clearTimeout(timer);
    }
  }

  async chatStream(
    messages: LlmMessage[],
    onChunk: (chunk: LlmStreamChunk) => void,
  ): Promise<LlmResponse> {
    const stream = await this.client.chat.completions.create({
      model: this.model,
      messages,
      temperature: this.temperature,
      max_tokens: this.maxTokens,
      stream: true,
      stream_options: { include_usage: true },
    });

    let fullContent = '';
    let inputTokens = 0;
    let outputTokens = 0;
    let finalModel = this.model;

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content ?? '';
      if (delta) {
        fullContent += delta;
        onChunk({ delta, done: false });
      }
      // stream_options.include_usage: 마지막 청크에만 포함
      if (chunk.usage) {
        inputTokens = chunk.usage.prompt_tokens;
        outputTokens = chunk.usage.completion_tokens;
      }
      if (chunk.model) finalModel = chunk.model;
    }

    onChunk({ delta: '', done: true });

    return {
      content: fullContent,
      model: finalModel,
      inputTokens,
      outputTokens,
    };
  }
}
