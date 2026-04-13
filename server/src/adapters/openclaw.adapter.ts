import { ILlmAdapter, LlmMessage, LlmResponse, LlmStreamChunk, AdapterConfig } from './llm.interface.js';

export class OpenClawAdapter implements ILlmAdapter {
  readonly provider = 'openclaw';
  model: string;
  private endpoint: string;

  constructor(private config: AdapterConfig) {
    this.model = config.model;
    // openclaw endpoint can be defined in env or config
    this.endpoint = process.env['OPENCLAW_API_BASE'] || 'http://localhost:8080/v1/chat/completions';
  }

  async chat(messages: LlmMessage[]): Promise<LlmResponse> {
    const formattedMessages = messages.map(m => ({ role: m.role, content: m.content }));
    const signal = this.config.timeoutMs ? AbortSignal.timeout(this.config.timeoutMs) : undefined;
    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(process.env['OPENCLAW_API_KEY'] && { 
          'Authorization': `Bearer ${process.env['OPENCLAW_API_KEY']}` 
        }),
      },
      body: JSON.stringify({
        model: this.model,
        messages: formattedMessages,
        temperature: this.config.temperature ?? 0.7,
        max_tokens: this.config.maxTokens ?? 2048,
      }),
      signal,
    });
    
    if (!response.ok) {
      throw new Error(`[OpenClaw] HTTP ${response.status}: ${await response.text()}`);
    }
    const data = await response.json();
    return {
      content: data.choices?.[0]?.message?.content || '',
      model: data.model || this.model,
      inputTokens: data.usage?.prompt_tokens || 0,
      outputTokens: data.usage?.completion_tokens || 0,
    };
  }

  async chatStream(messages: LlmMessage[], onChunk: (chunk: LlmStreamChunk) => void): Promise<LlmResponse> {
    const res = await this.chat(messages);
    onChunk({ delta: res.content, done: false });
    onChunk({ delta: '', done: true });
    return res;
  }
}
