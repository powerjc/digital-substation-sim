import { useState } from 'react'
import { FEATURES, isActive } from '../lib/features'
import { PROFILES, TRIP_CLASS } from '../lib/schema'

export default function SettingsPanel({ config, onFeature, onReset, onNetwork }) {
  const [open, setOpen] = useState(false)
  const prof = PROFILES[config.goose.profile]
  return (
    <div className="relative">
      <button onClick={() => setOpen(o => !o)} title="Settings"
        className={`px-3 py-1.5 text-sm font-semibold rounded-lg border transition ${open ? 'bg-gray-800 text-white border-gray-800' : 'bg-white text-gray-700 border-gray-300 hover:border-gray-500'}`}>
        ⚙
      </button>
      {open && (
        <div className="absolute right-0 top-11 z-20 w-80 max-w-[calc(100vw-2rem)] max-h-[80vh] overflow-y-auto bg-white border border-gray-200 rounded-xl shadow-lg p-4 flex flex-col gap-4 text-sm">
          <div>
            <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Features</div>
            {FEATURES.map(f => (
              <div key={f.id} className="mb-2">
                <label className="flex items-start gap-2 cursor-pointer">
                  <input type="checkbox" className="mt-1" checked={isActive(config, f.id)} onChange={e => onFeature(f.id, e.target.checked)} />
                  <span><span className="font-semibold text-gray-800">{f.label}</span><br /><span className="text-xs text-gray-500">{f.help}</span></span>
                </label>
                {f.id === 'redundancy' && isActive(config, 'redundancy') && onNetwork && (
                  <div className="flex gap-3 mt-1 ml-6" role="radiogroup" aria-label="Redundancy scheme">
                    {[['prp', 'PRP (two networks)'], ['rstp', 'RSTP (ring)']].map(([v, l]) => (
                      <label key={v} className="flex items-center gap-1 text-xs text-gray-700">
                        <input type="radio" name="redundancy" checked={(config.network.redundancy ?? 'prp') === v} onChange={() => onNetwork({ redundancy: v })} />{l}
                      </label>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
          <div>
            <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Fixed values (illustrative)</div>
            <ul className="text-xs text-gray-600 space-y-0.5">
              <li>Power system: {config.freqHz} Hz</li>
              <li>Relay trips {config.timing.relayTripCycles} cycle after the fault (scripted)</li>
              <li>Breaker opens {config.timing.breakerOpenCycles} cycles after the trip coil</li>
              <li>Retransmission: {prof.intervalsMs.slice(0, 4).join(', ')}… ms, doubling to a {prof.heartbeatMs / 1000} s heartbeat; TAL = {prof.talFactor} × the next gap</li>
              <li>IED stack: {config.stack.publishMs} ms to publish, {config.stack.subscribeMs} ms to act on a frame</li>
              <li>Network: {config.network.linkMbps} Mbit/s links, {config.network.switchLatencyUs} µs per switch</li>
              <li>Trip-message class: {TRIP_CLASS.ms} ms ({TRIP_CLASS.name}, IEC 61850-5)</li>
              {isActive(config, 'secondBay') && <li>Breaker failure: BF trip {config.timing.bfCycles} cycles after the trip if current still flows</li>}
            </ul>
          </div>
          <p className="text-xs text-gray-400">The fault and the relay’s decision are scripted: this simulator is about how signals travel, not why the relay tripped.</p>
          <button onClick={() => { onReset(); setOpen(false) }} className="self-start px-3 py-1 rounded-lg border border-gray-300 text-gray-700 hover:border-gray-500">Reset settings</button>
        </div>
      )}
    </div>
  )
}
