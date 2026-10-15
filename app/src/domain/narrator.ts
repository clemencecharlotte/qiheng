import type { QaAnswer } from './qa'

export interface NarratorConfig {
  status: 'disabled' | 'enabled'
  endpoint: string | null
  reason: string
}

export interface NarratorRuntime {
  endpoint?: string
  serverSecretStored?: boolean
}

declare global {
  interface Window {
    __QIANG_NARRATOR__?: NarratorRuntime
  }
}

export function detectNarratorConfig(runtime?: NarratorRuntime): NarratorConfig {
  const injected =
    runtime ??
    (typeof window !== 'undefined' ? window.__QIANG_NARRATOR__ : undefined)
  if (!injected || !injected.endpoint || !injected.serverSecretStored) {
    return {
      status: 'disabled',
      endpoint: null,
      reason:
        '未检测到经同源服务端代理并通过服务端机密存储的模型通道；本轮使用确定性规则解释，不假装 API 已接通。',
    }
  }
  return {
    status: 'enabled',
    endpoint: injected.endpoint,
    reason: '已检测到同源服务端代理（密钥仅在服务端保管）。',
  }
}

export interface NarratorInput {
  question: string
  ruleConclusion: string
  evidenceSummary: string[]
  allowedEvidenceIds: string[]
}

export interface NarratorTransport {
  complete(input: NarratorInput, signal?: AbortSignal): Promise<string>
}

const EVIDENCE_TOKEN =
  /(?:quality|health|period|role|unit|scenario|manual):[^\s，。；、,;.()\[\]{}"'`]+/g
const APPROVAL_OVERRIDE = ['可以批准', '允许批准', '建议批准', '应当批准', '能够批准']

export interface NarrationValidationResult {
  ok: boolean
  reason?: string
}

export function extractEvidenceTokens(text: string): string[] {
  return text.match(EVIDENCE_TOKEN) ?? []
}

export function validateNarration(
  text: string,
  allowedEvidenceIds: string[],
  safetyAllowsApproval: boolean,
): NarrationValidationResult {
  const trimmed = text.trim()
  if (trimmed.length === 0) return { ok: false, reason: '模型输出为空。' }
  if (trimmed.length > 2000) return { ok: false, reason: '模型输出超长。' }
  const allowed = new Set(allowedEvidenceIds)
  const tokens = extractEvidenceTokens(trimmed)
  const fabricated = tokens.filter((t) => !allowed.has(t))
  if (fabricated.length > 0) {
    return { ok: false, reason: `模型输出包含无效证据引用：${fabricated.join('、')}` }
  }
  if (!safetyAllowsApproval && APPROVAL_OVERRIDE.some((p) => trimmed.includes(p))) {
    return { ok: false, reason: '模型输出试图把被拒绝的建议改写成可批准，已拒绝。' }
  }
  return { ok: true }
}

export interface NarratedAnswer extends QaAnswer {
  narrationMode: 'rule' | 'model'
  fallbackReason?: string
  narrationNote?: string
}

export interface NarrateOptions {
  question: string
  config: NarratorConfig
  transport: NarratorTransport | null
  safetyAllowsApproval: boolean
  timeoutMs?: number
}

export async function narrateAnswer(
  answer: QaAnswer,
  opts: NarrateOptions,
): Promise<NarratedAnswer> {
  const ruleFallback = (reason: string): NarratedAnswer => ({
    ...answer,
    narrationMode: 'rule',
    fallbackReason: reason,
  })

  if (opts.config.status !== 'enabled' || !opts.transport) {
    return ruleFallback(opts.config.reason)
  }

  const allowedEvidenceIds = answer.evidence.map((e) => e.id)
  const input: NarratorInput = {
    question: opts.question,
    ruleConclusion: answer.conclusion,
    evidenceSummary: answer.evidence.map(
      (e) => `${e.id} | ${e.label} | ${e.unit ?? ''} | ${e.quality ?? ''} | ${e.detail}`,
    ),
    allowedEvidenceIds,
  }

  const timeoutMs = opts.timeoutMs ?? 8000
  const controller =
    typeof AbortController !== 'undefined' ? new AbortController() : undefined
  const timer = setTimeout(() => controller?.abort(), timeoutMs)

  try {
    const text = await Promise.race([
      opts.transport.complete(input, controller?.signal),
      new Promise<string>((_, reject) =>
        setTimeout(() => reject(new Error('模型调用超时')), timeoutMs),
      ),
    ])
    const validation = validateNarration(
      text,
      allowedEvidenceIds,
      opts.safetyAllowsApproval,
    )
    if (!validation.ok) {
      return ruleFallback(`已回退规则解释：${validation.reason}`)
    }
    return {
      ...answer,
      narrationMode: 'model',
      narrationNote: text.trim(),
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : '模型调用失败'
    return ruleFallback(`已回退规则解释：${reason}`)
  } finally {
    clearTimeout(timer)
  }
}