/**
 * Google Gemini LLM 어댑터
 * @google/generative-ai v0.14+ (generateContent API)를 래핑합니다.
 *
 * plan.md 3-3: EWS 모니터 fallback 모델 — gemini-2.0-flash
 */

import { GoogleGenerativeAI, HarmBlockThreshold, HarmCategory } from '@google/generative-ai';
import type { ILlmAdapter, LlmMessage, LlmResponse, LlmStreamChunk, AdapterConfig } from './llm.interface.js';

export class GoogleAdapter implements ILlmAdapter {
  readonly provider = 'google';
  readonly model: string;
  private readonly client: GoogleGenerativeAI;
  private readonly temperature: number;
  private readonly maxTokens: number;
  private readonly timeoutMs: number;

  constructor(config: AdapterConfig) {
    const apiKey = config.apiKey ?? process.env.GOOGLE_AI_API_KEY ?? process.env.GOOGLE_API_KEY ?? process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error(
        'GOOGLE_AI_API_KEY, GOOGLE_API_KEY 또는 GEMINI_API_KEY 환경변수가 설정되지 않았습니다.',
      );
    }
    this.client = new GoogleGenerativeAI(apiKey);
    this.model = config.model;
    this.temperature = config.temperature ?? 0.7;
    this.maxTokens = config.maxTokens ?? 2048;
    this.timeoutMs = config.timeoutMs ?? 30_000;
  }

  async chat(messages: LlmMessage[]): Promise<LlmResponse> {
    const generativeModel = this.client.getGenerativeModel({
      model: this.model,
      generationConfig: {
        temperature: this.temperature,
        maxOutputTokens: this.maxTokens,
      },
      // 교육 도메인: 안전 필터를 BLOCK_ONLY_HIGH 로 조정 (코드 예제 등 오탐 방지)
      safetySettings: [
        { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
        { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
        { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
        { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
      ],
    });

    // Google Generative AI에서 system 메시지는 systemInstruction으로 분리
    const systemMsg = messages.find((m) => m.role === 'system');
    const nonSystemMessages = messages.filter((m) => m.role !== 'system');

    // system instruction은 별도 모델 파라미터로 전달
    const modelWithSystem = systemMsg
      ? this.client.getGenerativeModel({
          model: this.model,
          systemInstruction: systemMsg.content,
          generationConfig: {
            temperature: this.temperature,
            maxOutputTokens: this.maxTokens,
          },
          safetySettings: generativeModel.safetySettings,
        })
      : generativeModel;

    // Google API: user/model 교대 패턴 (assistant → model 역할 이름 변환)
    const geminiContents = nonSystemMessages.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const result = await modelWithSystem.generateContent({
        contents: geminiContents,
      });
      const response = result.response;
      const text = response.text();

      const usage = response.usageMetadata;
      return {
        content: text,
        model: this.model,
        inputTokens: usage?.promptTokenCount ?? 0,
        outputTokens: usage?.candidatesTokenCount ?? 0,
      };
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        throw new Error(
          `Google Gemini 요청 타임아웃 (${this.timeoutMs / 1000}초 초과)`,
        );
      }
      throw err;
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

    const modelWithSystem = this.client.getGenerativeModel({
      model: this.model,
      ...(systemMsg ? { systemInstruction: systemMsg.content } : {}),
      generationConfig: {
        temperature: this.temperature,
        maxOutputTokens: this.maxTokens,
      },
    });

    const geminiContents = nonSystemMessages.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));

    const result = await modelWithSystem.generateContentStream({
      contents: geminiContents,
    });

    let fullContent = '';
    for await (const chunk of result.stream) {
      const delta = chunk.text();
      fullContent += delta;
      onChunk({ delta, done: false });
    }
    onChunk({ delta: '', done: true });

    const finalResponse = await result.response;
    const usage = finalResponse.usageMetadata;
    return {
      content: fullContent,
      model: this.model,
      inputTokens: usage?.promptTokenCount ?? 0,
      outputTokens: usage?.candidatesTokenCount ?? 0,
    };
  }
}
