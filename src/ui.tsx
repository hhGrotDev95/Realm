import { AnimatePresence, m as motion, useDragControls, type PanInfo } from 'framer-motion'
import { Heart } from 'lucide-react'
import { Component, useEffect, useRef, type ReactNode } from 'react'
import { stageById, type StageId, type UpdateSource } from './data'
import { useApp } from './store'
import { t } from './i18n'

export const spring = { type: 'spring', stiffness: 420, damping: 36 } as const

export function Avatar({ id, size }: { id: string; size?: 'lg' | 'xl' }) {
  const { guest, crew } = useApp()
  const f = id === 'me' ? { name: guest.nickname ?? t('Du'), color: guest.color } : (crew.byId[id] ?? { name: '?', color: '#55545f' })
  return (
    <span className={`avatar ${size ?? ''}`} style={{ background: f.color }} title={f.name}>
      {f.name[0]}
    </span>
  )
}

export function AvatarStack({ ids, max = 3 }: { ids: string[]; max?: number }) {
  if (!ids.length) return null
  const shown = ids.slice(0, max)
  return (
    <span className="avatars" aria-label={t('{n} aus deiner Crew', { n: ids.length })}>
      {shown.map((id) => (
        <Avatar key={id} id={id} />
      ))}
      {ids.length > max && <span className="avatar more">+{ids.length - max}</span>}
    </span>
  )
}

export function StageDot({ id }: { id: StageId }) {
  return <span className="stage-dot" style={{ background: stageById[id].color }} />
}

export function Segmented<T extends string>({ value, options, onChange, id }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; id: string }) {
  return (
    <div className="seg" role="tablist">
      {options.map((o) => (
        <button key={o.value} role="tab" aria-selected={value === o.value} className={value === o.value ? 'on' : ''} onClick={() => onChange(o.value)}>
          {value === o.value && <motion.span layoutId={`seg-${id}`} className="pill" transition={spring} />}
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function FavButton({ id }: { id: string }) {
  const { plan, toggleFav } = useApp()
  const on = plan.includes(id)
  return (
    <button
      className={`fav ${on ? 'on' : ''}`}
      aria-pressed={on}
      aria-label={on ? t('Aus Plan entfernen') : t('Zum Plan hinzufügen')}
      onClick={(e) => {
        e.stopPropagation()
        toggleFav(id)
      }}
    >
      <motion.span key={String(on)} initial={{ scale: on ? 0.4 : 1 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 600, damping: 14 }}>
        <Heart size={21} fill={on ? 'currentColor' : 'none'} strokeWidth={2} />
      </motion.span>
    </button>
  )
}

const SOURCE: Record<UpdateSource, string> = {
  official: t('Offiziell'),
  confirmed: t('Community bestätigt'),
  unconfirmed: t('Unbestätigt'),
  app: t('App-Hinweis'),
}
export function SourceTag({ source }: { source: UpdateSource }) {
  return <span className={`tag ${source}`}>{SOURCE[source]}</span>
}

export function ago(min: number) {
  if (min < 1) return t('gerade eben')
  if (min < 60) return t('vor {n} Min.', { n: min })
  if (min < 60 * 24) return t('vor {n} Std.', { n: Math.round(min / 60) })
  return t('vor {n} T.', { n: Math.round(min / 1440) })
}

export function Sheet({ open, onClose, children, full, label }: { open: boolean; onClose: () => void; children: ReactNode; full?: boolean; label: string }) {
  const controls = useDragControls()
  const ref = useRef<HTMLDivElement>(null)
  // move focus into the sheet and restore it on close
  useEffect(() => {
    if (!open) return
    const prev = document.activeElement as HTMLElement | null
    const timer = window.setTimeout(() => {
      if (!ref.current?.contains(document.activeElement)) ref.current?.focus({ preventScroll: true })
    }, 50)
    return () => {
      window.clearTimeout(timer)
      prev?.focus?.({ preventScroll: true })
    }
  }, [open])
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div className="scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
          <motion.div
            className={`sheet ${full ? 'full' : ''}`}
            ref={ref}
            tabIndex={-1}
            role="dialog"
            aria-modal
            aria-label={label}
            style={{ outline: 'none' }}
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', stiffness: 380, damping: 38 }}
            drag="y"
            dragListener={false}
            dragControls={controls}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0.05, bottom: 0.8 }}
            onDragEnd={(_: unknown, i: PanInfo) => {
              if (i.offset.y > 110 || i.velocity.y > 600) onClose()
            }}
          >
            <div className="sheet-grip" onPointerDown={(e) => controls.start(e)}>
              <i />
            </div>
            <div className="sheet-body">{children}</div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}

export function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return <button type="button" role="switch" aria-checked={on} aria-label={label} className={`switch ${on ? 'on' : ''}`} onClick={() => onChange(!on)} />
}

export const fadeUp = {
  initial: { opacity: 0, y: 14 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
}

export function stagger(i: number) {
  return { ...fadeUp, transition: { delay: 0.04 * i, duration: 0.45, ease: [0.22, 1, 0.36, 1] as const } }
}

/**
 * Catches a lazily loaded part that fails to load (e.g. offline before it was ever cached)
 * so the rest of the app keeps working, and offers a retry.
 */
export class LazyBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    if (!this.state.failed) return this.props.children
    return (
      <div className="empty" role="alert">
        <b>{t('Gerade nicht verfügbar')}</b>
        {t('Dieser Bereich konnte ohne Netz nicht geladen werden.')}
        <div style={{ marginTop: 14 }}>
          <button className="btn secondary sm" onClick={() => this.setState({ failed: false })}>
            {t('Erneut versuchen')}
          </button>
        </div>
      </div>
    )
  }
}
