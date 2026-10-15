import { useRef, useState, type FormEvent, type RefObject } from 'react'
import OriginDialog from './OriginDialog'

/**
 * D06 · AuthPreview —— 代表性登录/注册入口（统一模态原语的首个使用者）。
 * 登录/注册同一窗内容交接保输入（受控 values，切 tab 不重置）；
 * 最终关闭回初始来源触发器；未接入鉴权：提交 preventDefault 只闪声明，
 * 不造登录/账号/在线成功；评审游客不挡路（说明行明示）。
 * AuthForm = 面板内容本体（可独立 SSR 窄验）；AuthPreview = 触发器 + OriginDialog。
 */

type Tab = 'login' | 'register'

export function AuthForm({
  initialTab = 'login',
  emailRef,
}: {
  initialTab?: Tab
  emailRef?: RefObject<HTMLInputElement | null>
} = {}) {
  const [tab, setTab] = useState<Tab>(initialTab)
  const [flash, setFlash] = useState(false)
  const flashTimer = useRef(0)
  const internalEmailRef = useRef<HTMLInputElement>(null)
  const emailFocusRef = emailRef ?? internalEmailRef
  const [values, setValues] = useState({ email: '', password: '', confirm: '' })
  const set = (k: keyof typeof values) => (v: string) => setValues((s) => ({ ...s, [k]: v }))

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault() // 未接入鉴权：不发送、不造成功
    setFlash(true)
    window.clearTimeout(flashTimer.current)
    flashTimer.current = window.setTimeout(() => setFlash(false), 1600)
  }

  return (
    <div className="u-auth">
      <div className="u-auth__tabs" role="tablist" aria-label="登录或注册">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'login'}
          className={tab === 'login' ? 'on' : ''}
          onClick={() => {
            setTab('login')
            emailFocusRef.current?.focus({ preventScroll: true })
          }}
        >
          登录
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'register'}
          className={tab === 'register' ? 'on' : ''}
          onClick={() => {
            setTab('register')
            emailFocusRef.current?.focus({ preventScroll: true })
          }}
        >
          注册
        </button>
      </div>
      <form onSubmit={onSubmit}>
        <label className="u-auth__field">
          <span>邮箱</span>
          <input
            type="email"
            name="email"
            required
            autoComplete="email"
            placeholder="you@example.com"
            value={values.email}
            onChange={(e) => set('email')(e.target.value)}
            ref={emailFocusRef}
          />
        </label>
        <label className="u-auth__field">
          <span>密码</span>
          <input
            type="password"
            name="password"
            required
            minLength={8}
            autoComplete={tab === 'login' ? 'current-password' : 'new-password'}
            placeholder="至少 8 位"
            value={values.password}
            onChange={(e) => set('password')(e.target.value)}
          />
        </label>
        {tab === 'register' ? (
          <label className="u-auth__field">
            <span>确认密码</span>
            <input
              type="password"
              name="confirm"
              required
              minLength={8}
              autoComplete="new-password"
              placeholder="再次输入密码"
              value={values.confirm}
              onChange={(e) => set('confirm')(e.target.value)}
            />
          </label>
        ) : null}
        <button type="submit" className="u-auth__submit">
          {tab === 'login' ? '登录' : '注册'}
        </button>
        <p className="u-auth__note" data-flash={flash ? '1' : '0'}>
          未接入鉴权 · 提交不发送
        </p>
      </form>
    </div>
  )
}

export default function AuthPreview() {
  return (
    <OriginDialog
      triggerLabel="登录 / 注册"
      title="登录或注册（设计原型）"
      note="评审游客可直接进入演示，不被此入口挡路（提交口径见表单说明）"
    >
      <AuthForm />
    </OriginDialog>
  )
}
