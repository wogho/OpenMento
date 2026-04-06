/**
 * Anthropic Claude LLM 어댑터
 * @anthropic-ai/sdk v0.24+ (messages API)를 래핑합니다.
 */

import Anthropic from '@anthropic-ai/sdk';
import type { ILlmAdapter, LlmMessage, LlmResponse, LlmStreamChunk, AdapterConfig } from './llm.interface.js';

export class AnthropicAdapter implements ILlmAdapter {
  readonly provider = 'anthropic';
  readonly model: string;
  private readonly client: Anthropic;
  private readonly temperature: number;
  private readonly maxTokens: number;
  private readonly timeoutMs: number;

  constructor(config: AdapterConfig) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error('ANTHROPIC_API_KEY 환경변수가 설정되지 않았습니다.');
    }
    this.client = new Anthropic({ apiKey });
    this.model = config.model;
    this.temperature = config.temperature ?? 0.7;
    this.maxTokens = config.maxTokens ?? 2048;
    this.timeoutMs = config.timeoutMs ?? 30_000;
  }

  async chat(messages: LlmMessage[]): Promise<LlmResponse> {
    // Anthropic API: system 메시지는 별도 필드로 분리
    const systemMsg = messages.find((m) => m.role === 'system');
    const nonSystemMessages = messages.filter((m) => m.role !== 'system');

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
    const response = await this.client.messages.create(
      {
        model: this.model,
        max_tokens: this.maxTokens,
        temperature: this.temperature,
        ...(systemMsg ? { system: systemMsg.content } : {}),
        messages: nonSystemMessages.map((m) => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
        })),
      },
      { signal: controller.signal },
    );

    const block = response.content[0];
    if (!block || block.type !== 'text') {
      throw new Error('Anthropic 응답이 비어있습니다.');
    }

    return {
      content: block.text,
      model: response.model,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    };
    } finally {
      clearTimeout(timer);
    }
  }

  async chatStream(
    messages: LlmMessage[],
    onChunk: (chunk: LlmStreamChunk) => void,
  ): Promise<LlmResponse> {
    const systemMsg = messages.find((m) => m.role === 'system');
    const nonSystemMessages = messages.filter((m) => m.role !== 'system');

    const stream = await this.client.messages.stream({
      model: this.model,
      max_tokens: this.maxTokens,
      temperature: this.temperature,
      ...(systemMsg ? { system: systemMsg.content } : {}),
      messages: nonSystemMessages.map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      })),
    });

    let fullContent = '';

    for await (const event of stream) {
      if (
        event.type === 'content_block_delta' &&
        event.delta.type === 'text_delta'
      ) {
        fullContent += event.delta.text;
        onChunk({ delta: event.delta.text, done: false });
      }
    }

    onChunk({ delta: '', done: true });

    const finalMessage = await stream.finalMessage();
    return {
      content: fullContent,
      model: finalMessage.model,
      inputTokens: finalMessage.usage.input_tokens,
      outputTokens: finalMessage.usage.output_tokens,
    };
  }
}
