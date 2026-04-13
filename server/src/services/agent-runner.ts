/**
 * 단순 에이전트 호출 서비스 (세션·RAG 없이 단회 LLM 응답)
 *
 * 포트폴리오 댓글 등 단발성 에이전트 호출에 사용합니다.
 */
import { db, agents, eq, and, isNull } from '@openmento/db';
import { createAdapterWithFallback } from '../adapters/index.js';
import type { AdapterConfig, LlmMessage } from '../adapters/index.js';
import { getInstitutionSetting } from './institution-settings-service.js';

interface AdminSecrets {
  openaiApiKey?: string;
  anthropicApiKey?: string;
  openclawApiKey?: string;
  geminiApiKey?: string;
  [key: string]: string | undefined;
}

const safeKey = (v: string | undefined): string | undefined =>
  typeof v === 'string' && v.length > 0 && !v.includes('\u2022') ? v : undefined;

function resolveKey(provider: string, secrets: AdminSecrets): string | undefined {
  const map: Record<string, string | undefined> = {
    openai: safeKey(secrets.openaiApiKey),
    anthropic: safeKey(secrets.anthropicApiKey),
    openclaw: safeKey(secrets.openclawApiKey),
    google: safeKey(secrets.geminiApiKey),
  };
  return map[provider];
}

export interface CallAgentOptions {
  agentId: string;
  institutionId: string;
  userMessage: string;
  systemOverride?: string;
}

/**
 * agentId의 에이전트 설정으로 단발 LLM 호출을 실행하고 응답 텍스트를 반환합니다.
 * 실패 시 null을 반환합니다.
 */
export async function callAgent({ agentId, institutionId, userMessage, systemOverride }: CallAgentOptions): Promise<string | null> {
  const [agent] = await db
    .select()
    .from(agents)
    .where(and(eq(agents.id, agentId), eq(agents.institutionId, institutionId), isNull(agents.deletedAt)))
    .limit(1);

  if (!agent || agent.status === 'terminated' || agent.status === 'paused') {
    return null;
  }

  const adapterConfig = agent.adapterConfig as AdapterConfig;
  const fallbackConfig = agent.fallbackAdapterConfig as AdapterConfig | null | undefined;

  const secrets = await getInstitutionSetting<AdminSecrets>(institutionId, 'secrets', {});
  const resolvedPrimary: AdapterConfig = (() => {
    const key = resolveKey(adapterConfig.provider, secrets);
    return key ? { ...adapterConfig, apiKey: key } : adapterConfig;
  })();
  const resolvedFallback: AdapterConfig | null | undefined = fallbackConfig
    ? (() => {
        const key = resolveKey(fallbackConfig.provider, secrets);
        return key ? { ...fallbackConfig, apiKey: key } : fallbackConfig;
      })()
    : fallbackConfig;

  const llm = createAdapterWithFallback(resolvedPrimary, resolvedFallback);

  const systemPrompt = systemOverride ?? (agent.systemPrompt as string | null) ?? '당신은 학생 포트폴리오를 리뷰하는 AI 강사입니다.';
  const messages: LlmMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userMessage },
  ];

  try {
    const result = await llm.chat(messages);
    return result.content ?? null;
  } catch {
    return null;
  }
}
