/**
 * 环境读取（避免依赖 vite/client 类型声明）。
 * 只读取到只读数据服务的**固定** base 与开关，不承载令牌。
 *
 * 独立 dev 配置（app/vite.data.config.ts）用 define 注入 __QH_DATA_BASE__ /
 * __QH_DATA_ENABLED__；基础构建/测试未注入时回退到 import.meta.env，最终为 undefined
 * （面板显示“未配置”空态）。
 */
declare const __QH_DATA_BASE__: string | undefined
declare const __QH_DATA_ENABLED__: string | undefined

export interface DataEnv {
  /** 只读数据服务的同源前缀；未设置则面板显示“未配置”空态。 */
  VITE_QH_DATA_BASE?: string
  /** '0' 时显式关闭接入。 */
  VITE_QH_DATA_ENABLED?: string
}

export function readEnv(): DataEnv {
  const meta = import.meta as unknown as { env?: DataEnv }
  const env = meta.env ?? {}
  const injectedBase = typeof __QH_DATA_BASE__ !== 'undefined' ? __QH_DATA_BASE__ : undefined
  const injectedEnabled = typeof __QH_DATA_ENABLED__ !== 'undefined' ? __QH_DATA_ENABLED__ : undefined
  return {
    VITE_QH_DATA_BASE: injectedBase ?? env.VITE_QH_DATA_BASE,
    VITE_QH_DATA_ENABLED: injectedEnabled ?? env.VITE_QH_DATA_ENABLED,
  }
}
