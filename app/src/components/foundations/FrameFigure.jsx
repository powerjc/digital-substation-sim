import { useMemo, useState } from 'react'
import { sampleTripFrame } from '../../lib/figures'
import { fmtAppid } from '../../lib/goose'

// Anatomy of the simulator's real trip frame. Tap a field.
export default function FrameFigure() {
  const f = useMemo(sampleTripFrame, [])
  const payload = f.length - (6 + 6 + 4 + 2 + 4)
  const FIELDS = [
    { id: 'pre', label: 'Preamble', bytes: 8, w: 30, grey: true, value: '8 bytes of 1-0-1-0… then a start marker',
      text: 'Wakes the receiver up and marks where the frame starts. Not counted in the frame length.' },
    { id: 'dst', label: 'To', bytes: 6, w: 58, value: `${f.dst}: first byte 01 is odd, so a group address`,
      text: 'Destination MAC address. The receiver checks this first: its own address, broadcast, or a group it subscribes to.' },
    { id: 'src', label: 'From', bytes: 6, w: 58, value: `${f.src}: the relay's own port`,
      text: 'Source MAC address: the sender. Switches learn where devices are from this field.' },
    { id: 'tag', label: 'Tag', bytes: 4, w: 36, value: `VLAN ${f.vlan.id}, priority ${f.vlan.priority}`,
      text: 'The 802.1Q tag: which VLAN the frame belongs to and how urgent it is. Optional on Ethernet; GOOSE normally carries it. Chapter A4.' },
    { id: 'type', label: 'Type', bytes: 2, w: 32, value: '0x88B8: GOOSE',
      text: 'EtherType: what follows. 0x88B8 GOOSE, 0x88BA Sampled Values, 0x0800 an IP packet.' },
    { id: 'pay', label: 'Contents', bytes: payload, w: 120, value: `APPID ${fmtAppid(f.appid)}, then the GOOSE message (${payload} bytes)`,
      text: 'The contents. For GOOSE: an application ID, then the message itself: who sent it, the state and sequence numbers, and the data values. Part B takes it apart.' },
    { id: 'fcs', label: 'Check', bytes: 4, w: 34, value: 'checksum of everything before it',
      text: 'Frame check sequence. If a bit was damaged on the way, the checksum fails and the frame is discarded without notice.' },
  ]
  const [sel, setSel] = useState('dst')
  const s = FIELDS.find(x => x.id === sel)
  let x = 6
  const blocks = FIELDS.map(fl => { const b = { ...fl, x }; x += fl.w + 2; return b })
  return (
    <div className="flex flex-col gap-2">
      <svg viewBox="0 0 400 74" className="w-full h-auto max-w-xl select-none" role="img" aria-label="Ethernet frame fields">
        {blocks.map(b => (
          <g key={b.id} onClick={() => setSel(b.id)} style={{ cursor: 'pointer' }}>
            <rect x={b.x} y={10} width={b.w} height={34} rx={3}
              fill={b.id === sel ? '#e0e7ff' : b.grey ? '#f3f4f6' : '#fff'} stroke={b.id === sel ? '#4f46e5' : '#9ca3af'} strokeWidth={b.id === sel ? 2 : 1} strokeDasharray={b.grey ? '3 2' : undefined} />
            <text x={b.x + b.w / 2} y={31} textAnchor="middle" fontSize={10} fontWeight="600" fill={b.grey ? '#9ca3af' : '#374151'}>{b.label}</text>
            <text x={b.x + b.w / 2} y={58} textAnchor="middle" fontSize={8.5} fill="#9ca3af">{b.bytes} B</text>
          </g>
        ))}
        <text x={398} y={72} textAnchor="end" fontSize={8.5} fill="#9ca3af">frame: {f.length} bytes (preamble not counted)</text>
      </svg>
      <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm">
        <div className="font-semibold text-gray-800">{s.label} <span className="font-normal text-gray-500">· {s.bytes} bytes</span></div>
        <div className="font-mono text-xs text-indigo-800 my-1 break-all">{s.value}</div>
        <div className="text-gray-700">{s.text}</div>
      </div>
      <p className="text-xs text-gray-400">This is the simulator’s real trip frame. Tap a field.</p>
    </div>
  )
}
