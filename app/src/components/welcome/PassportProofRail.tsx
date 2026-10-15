import type { PassportStoreSnapshot } from '../../domain/passport'

/**
 * M28 r01 B · 序幕「已封存成果」代表（真实加载 loadPassportStore 结果，替代 qh-flow-rail 四流程缩略）。
 * 有记录：显示真实身份/来源/时间/候选复验摘要，并提供进入实际 records/audit 证据的入口。
 * 无记录：显示准备步骤与实际比较入口；不预造护照/审批记录，不拿当前 run 冒历史。
 */
interface Props {
  store: PassportStoreSnapshot
}

function shortId(id: string): string {
  return id.length > 18 ? `${id.slice(0, 18)}…` : id
}

export default function PassportProofRail({ store }: Props) {
  const rows = store.passports.slice(-3).reverse()

  if (store.corrupted) {
    return (
      <div className="qh-proof-rail" aria-label="已封存成果（只读）">
        <p className="hint neg">护照本地存储损坏或不可用：已保留原文、不回退伪历史、不覆盖。可在记录页只读查看有效条目。</p>
        <a className="btn ghost" href="#/records/audit">在记录中只读查看</a>
      </div>
    )
  }

  if (rows.length === 0) {
    return (
      <div className="qh-proof-rail" aria-label="已封存成果（只读）">
        <h3>尚无已封存成果</h3>
        <ol className="qh-proof-rail-steps">
          <li>先在场景中选择常态，查看同条件基线与建议。</li>
          <li>由人独立复验并确认后，将当次方案封存为决策护照。</li>
          <li>回到这里即可查看真实身份、来源与候选 / 复验摘要。</li>
        </ol>
        <div className="qh-proof-rail-actions">
          <a className="btn ghost" href="#/schedule/compare?mode=legacy&scenario=normal">进入方案比较</a>
        </div>
      </div>
    )
  }

  return (
    <div className="qh-proof-rail" aria-label="已封存成果（只读）">
      <h3>已封存成果（真实只读）</h3>
      <ul className="qh-proof-rail-list">
        {rows.map((p) => (
          <li key={p.passportId} className="qh-proof-rail-item">
            <div className="qh-proof-rail-head">
              <b className="mono">{shortId(p.passportId)}</b>
              <span className="qh-proof-rail-status">{p.status}（{p.authorization}）</span>
            </div>
            <p className="qh-proof-rail-meta">
              来源 {p.inputSource} · 生成 {p.generatedAt}
            </p>
            <p className="qh-proof-rail-meta">
              候选 / 复验摘要：合法 {p.summary.legal} · 拒绝 {p.summary.rejected} · 无解 / 未运行 {p.summary.notRun}
            </p>
            <a className="qh-proof-rail-link" href={`#/records/audit?passportId=${encodeURIComponent(p.passportId)}`}>进入记录 · 查看该护照证据 →</a>
          </li>
        ))}
      </ul>
      <p className="qh-proof-rail-note">本地已封存只读摘要，不代表当前授权<sup aria-hidden="true">*</sup></p>
    </div>
  )
}
