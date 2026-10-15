import { useEffect, useState } from 'react'
import { Tooltip } from '../ui/Disclosure'

/**
 * S1 顶栏本地时钟：HH:mm:ss，时区经统一 Tooltip 可见（非原生 title）。
 * 只是本地钟——不冒充观测时间/最后接收时间（三信号分离，见 CONSOLE-DIRECTION §4）。
 */
export default function Clock() {
  const [now, setNow] = useState<Date>(() => new Date())
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(t)
  }, [])
  const pad = (n: number) => String(n).padStart(2, '0')
  let tz = '本地时区'
  try {
    tz = Intl.DateTimeFormat().resolvedOptions().timeZone || tz
  } catch {
    /* 保持默认 */
  }
  const hms = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`
  const iso = now.toISOString()
  return (
    <Tooltip text={`本地时间 · 时区 ${tz}`} ariaLabel={`本地时间 ${hms}（时区 ${tz}）`} className="topbar-clock-tip">
      <time className="topbar-clock mono" dateTime={iso} data-testid="topbar-clock">
        {hms}
      </time>
    </Tooltip>
  )
}
