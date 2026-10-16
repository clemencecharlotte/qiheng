/**
 * M12 · 静态声明脚注注册表（宿主统一 qh-note-*）。
 * 反复出现的静态声明（合成演示/设备边界/只读导航/离线非实时/数据口径/批准边界/本地记录）
 * 只在该表声明一次，正文以 <NoteRef> 真实 sup/a 角标交叉引用到每页末右下紧凑脚注；
 * 动态拒绝/未知/来源/观察时间/批准条件不在此表，保持对象或动作旁。
 */
export interface NoteDef {
  id: string
  n: number
  /** 读屏用简称（aria-label） */
  short: string
  text: string
}

export const NOTES: Record<string, NoteDef> = {
  synthetic: {
    id: 'qh-note-synthetic',
    n: 1,
    short: '合成演示与设备边界',
    text: '合成演示 · 不下发设备，不连接真实 PLC/SCADA。',
  },
  readonly: {
    id: 'qh-note-readonly',
    n: 2,
    short: '只读导航范围',
    text: '只读导航：不自动生成方案、不自动批准、不执行、不清记录。',
  },
  offline: {
    id: 'qh-note-offline',
    n: 3,
    short: '离线数据非实时',
    text: '离线 CSV / JSON 批次与只读治理事件；服务时间由接收端生成，非实时连接。',
  },
  data: {
    id: 'qh-note-data',
    n: 3,
    short: '数据与 KPI 口径',
    text: '合成固定种子数据，非现场实测；收益与耗电为模型推算，未验证 KPI。',
  },
  approval: {
    id: 'qh-note-approval',
    n: 4,
    short: '批准与执行边界',
    text: '批准与执行只记录合成演示状态，不改变任何设备或控制回路。',
  },
  local: {
    id: 'qh-note-local',
    n: 5,
    short: '本地记录属性',
    text: '本地演示记录，非生产审计存证。',
  },
  flow: {
    id: 'qh-note-flow',
    n: 6,
    short: '流程与视觉示意',
    text: '流程与视觉为抽象示意，非运行状态、不映射实时测点；结果不作为现场操作指令。',
  },
  passport: {
    id: 'qh-note-passport',
    n: 7,
    short: '护照只读摘要',
    text: '护照为本地已封存记录的真实只读摘要，不代表当前授权，不含预测 / 节能估计。',
  },
  relations: {
    id: 'qh-note-relations',
    n: 8,
    short: '关联证据只读',
    text: '关联证据只读：来源/批次/事件来自真实只读存储；设备/候选/复验/批准边界为域内合成证据（非只读 API），二者分源标明，均只读、不写入、不触发执行。',
  },
  governance: {
    id: 'qh-note-governance',
    n: 9,
    short: '治理事件口径',
    text: '仅显示真实存储的治理事件（导入完成 / 隔离 / 拒绝 / 服务错误）；离线批次非实时，不触发调度、批准或执行。',
  },
  prerecord: {
    id: 'qh-note-prerecord',
    n: 10,
    short: '预录产品演示',
    text: '预录产品演示（真实候选实际交互录制），不代表当前系统状态；全程只读，无生产写入，未演示也不声称模型/工具调用成功。',
  },
  executionIntake: {
    id: 'qh-note-execution-intake',
    n: 11,
    short: '执行准入技术口径',
    text: '执行准入（原 B03b · 候选 4174）：只接受 passport.status=complete 且合法 attempt（有限完整 plan）；admit 走 validateStoredPassport 结构门 + 受支持 source/generator/canonicalVersion/版本 + 按快照独立复验。Start 不加桶；advance 人工逐桶、写成功才发布。',
  },
  replanBarrier: {
    id: 'qh-note-replan-barrier',
    n: 12,
    short: 'suffix 父保存屏障口径',
    text: 'suffix 重规划（原 B04d）：模块级 replanController + executionController 父保存屏障；Panel 仅视图。确认弹层捕获 suffixId/epoch/verification/revision/完整 snapshot，提交再核。',
  },
  bounds: {
    id: 'qh-note-bounds',
    n: 13,
    short: '能力边界',
    text: '能力边界：不写 PLC 程序、不替代现场操作规程；喘振/启停边界未核实的机组不进入自动调度；合成结果不称现场 KPI。',
  },
}

export type NoteKey = keyof typeof NOTES
