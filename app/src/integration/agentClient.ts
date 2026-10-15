/**
 * M29 r14 · 前端 Agent 同源合同客户端（对齐正规 MCP gateway 实际 HTTP 合同）。
 * 只访问同源受控 gateway：/agent-api/status、/agent-api/tools、/agent-api/query、/agent-api/resources、/agent-api/resource。
 * 不在浏览器写 token；服务端未接时诚实 unavailable/cancelled/failed。query 由 RequestCoordinator 执行（冻结快照+迟到保护）。
 */
export interface AgentStatus {
  status: string
  protocol?: string
  mcp?: { state: string; verifiedByThisRequest?: boolean }
  provider?: { state: string; model?: string; onlineVerified?: boolean; modelSwitchAllowed?: boolean }
}

export interface AgentToolMeta { name: string; description?: string }
export interface AgentResourceMeta { uri: string; name?: string; title?: string }

const UNAVAILABLE: AgentStatus = { status: 'unavailable' }

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T | null> {
  try {
    const res = await fetch(path, { signal, headers: { accept: 'application/json' } })
    if (!res.ok) return null
    return (await res.json()) as T
  } catch {
    return null
  }
}

export async function fetchAgentStatus(signal?: AbortSignal): Promise<AgentStatus> {
  return (await getJson<AgentStatus>('/agent-api/status', signal)) ?? UNAVAILABLE
}

export async function fetchAgentTools(signal?: AbortSignal): Promise<AgentToolMeta[]> {
  const j = await getJson<{ tools?: AgentToolMeta[] }>('/agent-api/tools', signal)
  return Array.isArray(j?.tools) ? j.tools : []
}

export async function fetchAgentResources(signal?: AbortSignal): Promise<AgentResourceMeta[]> {
  const j = await getJson<{ resources?: AgentResourceMeta[] }>('/agent-api/resources', signal)
  return Array.isArray(j?.resources) ? j.resources : []
}

export async function fetchAgentResource(uri: string, signal?: AbortSignal): Promise<string | null> {
  const j = await getJson<{ contents?: Array<{ text?: string }> }>(`/agent-api/resource?uri=${encodeURIComponent(uri)}`, signal)
  const text = j?.contents?.[0]?.text
  return typeof text === 'string' ? text : null
}
