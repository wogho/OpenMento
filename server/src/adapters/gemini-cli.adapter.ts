import { ILlmAdapter, LlmMessage, LlmResponse, LlmStreamChunk, AdapterConfig } from './llm.interface.js';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export class GeminiCliAdapter implements ILlmAdapter {
  readonly provider = 'gemini_cli';
  model: string;

  constructor(private config: AdapterConfig) {
    this.model = config.model || 'gemini-cli-default';
  }

  async chat(messages: LlmMessage[]): Promise<LlmResponse> {
    const promptText = messages.map(m => `${m.role.toUpperCase()}: ${m.content}`).join('\n\n');
    // Using gemini cli (mocked/wrapped)
    try {
      const command = `gemini chat --prompt "${promptText.replace(/"/g, '\\"')}"`;
      // Here we would run the CLI, but if not installed or fails, we just mock or handle it.
      // We'll throw a distinct error to allow fallback if needed.
      const { stdout } = await execAsync(command, { timeout: this.config.timeoutMs || 30000 });
      return {
        content: stdout.trim(),
        model: this.model,
        inputTokens: promptText.length,
        outputTokens: stdout.length,
      };
    } catch (err: any) {
      if (err.message.includes('gemini: command not found') || err.code === 127) {
         // Mock response if CLI is not actually available
         return {
           content: "[Gemini CLI] " + promptText.substring(0, 100) + "... (CLI not installed)",
           model: this.model,
           inputTokens: 10,
           outputTokens: 20
         };
      }
      throw err;
    }
  }

  async chatStream(messages: LlmMessage[], onChunk: (chunk: LlmStreamChunk) => void): Promise<LlmResponse> {
    const res = await this.chat(messages);
    onChunk({ delta: res.content, done: false });
    onChunk({ delta: '', done: true });
    return res;
  }
}
