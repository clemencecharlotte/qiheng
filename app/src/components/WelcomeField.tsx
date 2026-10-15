import { useEffect, useRef } from 'react'
import WelcomeCore from './welcome/WelcomeCore'
import { mountFieldEngine } from './welcome/fieldEngineMount'

/**
 * 背景层挂载器 —— 把原版 `field-engine.js` 挂到欢迎页背景。
 *
 * 生命周期（M2 补丁）统一由 `fieldEngineMount.ts` 负责：脚本单例加载、
 * 每挂载一个引擎实例、卸载真正 destroy（撤监听/observer/RAF/计时器），
 * 迟到回调不复活已销毁实例。此处只保留 React 接线。
 *
 * 原版引擎的**绘制公式、几何参数、颜色、节奏、鼠标幅度/半径一律未动**，
 * 只在 `public/field-engine.js` 补了工厂与生命周期管理（见 docs/MIGRATION-M2.md）。
 * 背景全程保留：Hero 离场只写 `.qh-backdrop[data-hero]`，气流 canvas 不参与淡出。
 */
export default function WelcomeField() {
  const backdropRef = useRef<HTMLDivElement>(null)
  const fieldRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const backdrop = backdropRef.current
    if (!backdrop || !fieldRef.current) return
    return mountFieldEngine(backdrop)
  }, [])

  return (
    <div className="qh-backdrop" id="backdrop" aria-hidden="true" ref={backdropRef}>
      <div className="qh-ambient" />
      <canvas className="qh-bd-layer qh-topology" id="bg-topology" />
      <canvas className="qh-bd-layer" id="bg-airflow" ref={fieldRef} />
      <WelcomeCore tilt />
      {/* 引擎会在 #bg-topology 上画拓扑骨架，并把节点标签 .node-label 注入这里 */}
      <div className="qh-visual-labels" id="visual-labels" />
    </div>
  )
}
