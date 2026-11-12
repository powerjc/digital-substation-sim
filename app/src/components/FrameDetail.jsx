import { useState } from 'react'
import { deviceColor } from '../lib/colors'
import { fmtTime, fmtDur } from '../lib/units'
import { fmtAppid, DBPOS_BITS } from '../lib/goose'
import { FateBadge } from './FrameList'
import { HelpLink } from './Help'

// One line of plain explanation per field
const HELP = {
  dst: 'Multicast address of this GOOSE. Switches flood it; each IED keeps the ones it subscribes to. IEC 61850-8-1 recommends 01-0C-CD-01-xx-xx for GOOSE.',
  src: 'The publishing IED’s own address.',
  vlan: 'Virtual LAN the frame belongs to. A switch port only carries the VLANs it is configured for.',
  pcp: '802.1Q priority (0–7); GOOSE defaults to 4. It matters only when frames queue behind other traffic on a busy port.',
  ethertype: 'Identifies the payload as GOOSE.',
  appid: 'Application ID of the control block. Subscribers usually filter on it first. GOOSE uses 0x0000–0x3FFF.',
  length: 'Bytes from APPID to the end of the PDU.',
  gocbRef: 'The GOOSE control block that sent this: IED and logical device / LLN0 $ GO $ name.',
  timeAllowedtoLive: 'How long (ms) the subscriber should wait for the next frame. If nothing arrives in time, the subscription is declared lost. Here: twice the gap to the next scheduled frame.',
  datSet: 'The dataset whose values this frame carries.',
  goID: 'A text ID for the message, set in configuration.',
  t: 'Time of the last state change (a UTC timestamp in a real frame; run time here).',
  stNum: 'State number: goes up by one each time any value in the dataset changes.',
  sqNum: 'Sequence number: restarts at 0 on a new state and counts the repeats of that state.',
  simulation: 'Set when the frame comes from a test set or an IED in simulation. Always false in this slice (test mode comes next).',
  confRev: 'Configuration revision of the dataset. It changes when the dataset is edited; the subscriber must expect the same value.',
  ndsCom: 'Needs commissioning: set when the control block isn’t fully configured.',
  numDatSetEntries: 'How many values follow.',
  BOOLEAN: 'Trip: true while the relay’s trip is asserted.',
  Dbpos: 'Breaker position, two bits: 10 closed, 01 open, 00 intermediate (moving), 11 bad.',
  Quality: 'Validity and flags of the value before it. An IED in test mode sets the test flag.',
}

function Row({ name, value, help, mono = true, hi }) {
  return (
    <div className={`px-3 py-1 border-b border-gray-50 ${hi ? 'bg-red-50' : ''}`}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-gray-600">{name}</span>
        <span className={`${mono ? 'font-mono' : ''} text-gray-900 text-right break-all`}>{value}</span>
      </div>
      {help && <div className="text-[11px] text-gray-400 leading-snug">{help}</div>}
    </div>
  )
}

function Section({ title, children, open: openInit = true, summary, help }) {
  const [open, setOpen] = useState(openInit)
  return (
    <div>
      <div className="flex items-center bg-gray-50 pr-2">
      <button onClick={() => setOpen(o => !o)} className="flex-1 min-w-0 flex items-baseline gap-2 px-3 py-1.5 text-left text-xs font-semibold text-gray-700">
        <span className="text-gray-400 w-3">{open ? '▾' : '▸'}</span>{title}
        {!open && summary && <span className="font-normal text-gray-500 truncate">{summary}</span>}
      </button>
      {help && <HelpLink chapter={help} />}
      </div>
      {open && children}
    </div>
  )
}

const valText = d => d.type === 'Dbpos' ? `${DBPOS_BITS[d.value]} (${d.value})`
  : d.type === 'Quality' ? `${d.value.validity}${d.value.test ? ', test' : ''}` : String(d.value)

export default function FrameDetail({ config, frame, detail, onClose }) {
  if (!frame) return <p className="px-4 py-6 text-sm text-gray-400">Select a frame in the list or on the timing chart to decode it.</p>
  const g = config.gocbs.find(x => x.id === frame.gocb)
  const p = frame.pdu
  const bad = new Set(Object.values(frame.rx).flatMap(rx => (rx.compare ?? []).map(c => c.field)))
  return (
    <div className="text-xs">
      <div className="flex items-start justify-between gap-2 px-3 py-2 border-b border-gray-100">
        <div>
          <div className="text-sm font-semibold"><span style={{ color: deviceColor(frame.pub) }}>{g.label} GOOSE</span> · frame {frame.no}</div>
          <div className="text-gray-500">sent {fmtTime(frame.sendT)} by {frame.pub} · {frame.length} bytes</div>
        </div>
        {onClose && <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-xl leading-none px-1" title="Close">×</button>}
      </div>

      {Object.entries(frame.rx).map(([subId, rx]) => {
        const sub = config.subscriptions.find(s => s.id === subId)
        return (
          <div key={subId} className="px-3 py-2 border-b border-gray-100">
            <div className="flex items-center gap-2"><span className="text-gray-600">At {sub.ied}:</span><FateBadge rx={rx} />
              {rx.t !== null && rx.t !== undefined && <span className="text-gray-400 font-mono">{fmtTime(rx.t)}</span>}</div>
            {rx.reason && <div className="mt-1 text-gray-700">{rx.reason}</div>}
            {rx.compare?.length > 0 && (
              <table className="mt-1 w-full">
                <thead><tr className="text-gray-500 text-left"><th className="font-semibold pr-2">Field</th><th className="font-semibold pr-2">{sub.ied} expects</th><th className="font-semibold">Frame carries</th></tr></thead>
                <tbody>
                  {rx.compare.map(c => (
                    <tr key={c.field} className="align-top"><td className="pr-2">{c.field}</td><td className="pr-2 font-mono text-green-800 break-all">{String(c.expected)}</td><td className="font-mono text-red-700 break-all">{String(c.received)}</td></tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )
      })}

      {frame.unsubscribed?.length > 0 && (
        <div className="px-3 py-2 border-b border-gray-100 text-gray-500">
          Also reached {frame.unsubscribed.join(', ')}: no subscription there, dropped quietly.
        </div>
      )}

      <Section title="Ethernet + 802.1Q" help="A2" open={detail} summary={`${frame.dst} · VLAN ${frame.vlan.id} · prio ${frame.vlan.priority}`}>
        <Row name="Destination MAC" value={frame.dst} help={HELP.dst} hi={bad.has('Destination MAC')} />
        <Row name="Source MAC" value={frame.src} help={HELP.src} />
        <Row name="VLAN ID" value={frame.vlan.id} help={HELP.vlan} />
        <Row name="Priority (PCP)" value={frame.vlan.priority} help={HELP.pcp} />
        <Row name="EtherType" value={`0x${frame.ethertype.toString(16).toUpperCase()}`} help={HELP.ethertype} />
      </Section>
      <Section title="GOOSE header" help="B3">
        <Row name="APPID" value={fmtAppid(frame.appid)} help={HELP.appid} hi={bad.has('APPID')} />
        {detail && <Row name="Length" value={frame.length - 22} help={HELP.length} />}
      </Section>
      <Section title="goosePdu" help="B4">
        <Row name="gocbRef" value={p.gocbRef} help={HELP.gocbRef} hi={bad.has('gocbRef')} />
        <Row name="timeAllowedtoLive" value={`${p.timeAllowedtoLive} ms`} help={HELP.timeAllowedtoLive} />
        <Row name="datSet" value={p.datSet} help={HELP.datSet} hi={bad.has('datSet')} />
        <Row name="goID" value={p.goID} help={HELP.goID} />
        <Row name="t" value={fmtTime(p.t)} help={HELP.t} />
        <Row name="stNum" value={p.stNum} help={HELP.stNum} />
        <Row name="sqNum" value={p.sqNum} help={HELP.sqNum} />
        <Row name="simulation" value={String(p.simulation)} help={HELP.simulation} />
        <Row name="confRev" value={p.confRev} help={HELP.confRev} hi={bad.has('confRev')} />
        <Row name="ndsCom" value={String(p.ndsCom)} help={HELP.ndsCom} />
        <Row name="numDatSetEntries" value={p.numDatSetEntries} help={HELP.numDatSetEntries} />
      </Section>
      <Section title="allData" help="B3">
        {p.allData.map(d => <Row key={d.ref} name={d.ref.split('/').pop()} value={valText(d)} help={HELP[d.type]} />)}
      </Section>
      {detail && (
        <Section title="Path" help="A3">
          {frame.hops.map((h, i) => (
            <Row key={i} name={`${h.link}: ${h.from} → ${h.to}`} mono={false}
              value={h.fate === 'ok' ? `${fmtTime(h.t0)} + ${fmtDur(h.t1 - h.t0)}` : <span className="text-red-700 font-semibold">{h.fate === 'vlan' ? 'VLAN not carried' : h.fate === 'down' ? 'link down' : 'lost'}</span>} />
          ))}
          <div className="px-3 py-1 text-[11px] text-gray-400">Each hop: serialization at {config.network.linkMbps} Mbit/s; each switch adds {config.network.switchLatencyUs} µs (store-and-forward, illustrative).</div>
        </Section>
      )}
    </div>
  )
}
