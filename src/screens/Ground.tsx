// The built-in illustrated festival ground, shown when a festival has no site plan of its own.
// Shared by the map screen and the console's map editor.
import { MAP, STAGES } from '../data'

export function Ground({ satellite }: { satellite: boolean }) {
  const W = MAP.w
  const H = MAP.h
  const grass = satellite ? '#1b2a1a' : '#14171c'
  const field = satellite ? '#243620' : '#191d23'
  const path = satellite ? '#4a4535' : '#262b33'
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ position: 'absolute', inset: 0 }} aria-hidden>
      <defs>
        <pattern id="trees" width="26" height="26" patternUnits="userSpaceOnUse">
          <circle cx="8" cy="8" r="6" fill={satellite ? '#1f3d1f' : '#1a2420'} />
          <circle cx="20" cy="19" r="5" fill={satellite ? '#1a361b' : '#18211d'} />
        </pattern>
        <pattern id="noise" width="6" height="6" patternUnits="userSpaceOnUse">
          <rect width="6" height="6" fill={grass} />
          <circle cx="1" cy="2" r=".6" fill={satellite ? '#2d4a26' : '#1a1e24'} />
          <circle cx="4" cy="5" r=".5" fill={satellite ? '#29401f' : '#181b21'} />
        </pattern>
        {STAGES.map((s) => (
          <radialGradient key={s.id} id={'g-' + s.id}>
            <stop offset="0" stopColor={s.color} stopOpacity=".28" />
            <stop offset="1" stopColor={s.color} stopOpacity="0" />
          </radialGradient>
        ))}
      </defs>
      <rect width={W} height={H} fill="url(#noise)" />
      <path d="M60 120 Q 80 40 300 50 L 900 60 Q 960 70 950 200 L 960 820 Q 950 910 820 900 L 140 905 Q 40 900 50 780 Z" fill={field} stroke={satellite ? '#3a4a2a' : '#232830'} strokeWidth="3" strokeDasharray="10 8" />
      <path d="M80 480 Q 60 720 160 800 Q 300 860 360 720 Q 380 600 300 520 Q 180 440 80 480 Z" fill="url(#trees)" opacity=".9" />
      <path d="M640 600 Q 600 520 700 480 Q 820 450 880 540 Q 920 640 820 690 Q 700 720 640 600 Z" fill={satellite ? '#1d3b4f' : '#13202b'} />
      <g fill="none" stroke={path} strokeLinecap="round" strokeWidth="22">
        <path d="M470 70 L 470 200 Q 470 300 440 420 Q 420 520 470 600 L 470 760 L 300 860" />
        <path d="M250 330 Q 350 380 440 420 Q 560 470 690 520 L 860 860" />
        <path d="M520 250 Q 650 200 820 140" />
        <path d="M220 620 Q 300 560 440 420" />
      </g>
      {STAGES.map((s) => (
        <g key={s.id}>
          <circle cx={s.x} cy={s.y} r="120" fill={`url(#g-${s.id})`} />
          <path d={`M${s.x - 44} ${s.y - 34} Q ${s.x} ${s.y - 70} ${s.x + 44} ${s.y - 34} Z`} fill={s.color} opacity={0.22} />
        </g>
      ))}
      <text x="720" y="610" fill={satellite ? '#5c8aa8' : '#2c3e4d'} fontSize="16" fontFamily="Inter" fontWeight="600" letterSpacing="3">
        SEE
      </text>
      <text x="140" y="700" fill={satellite ? '#4c6e44' : '#26332b'} fontSize="16" fontFamily="Inter" fontWeight="600" letterSpacing="3">
        WALD
      </text>
    </svg>
  )
}
