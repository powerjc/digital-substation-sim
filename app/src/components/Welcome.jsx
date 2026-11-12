// First-run card: how to read the screen and where to start
const KEY = 'dss.welcomed'
export function loadWelcomed() { try { return localStorage.getItem(KEY) === '1' } catch { return false } }
export function saveWelcomed() { try { localStorage.setItem(KEY, '1') } catch { /* storage unavailable */ } }

export function WelcomeCard({ onStartLesson, onFoundations, onClose }) {
  return (
    <section className="mx-4 mt-4 rounded-xl border border-indigo-200 bg-indigo-50/60 px-4 py-3">
      <div className="flex items-start justify-between gap-2">
        <h2 className="text-sm font-bold text-indigo-900">Welcome: a trip is a network message</h2>
        <button onClick={onClose} className="text-indigo-400 hover:text-indigo-700 text-lg leading-none px-1" title="Close">×</button>
      </div>
      <p className="text-sm text-gray-700 mt-1">In a digital substation the relay’s trip reaches the breaker as a GOOSE message over Ethernet, not over a wire. This bay has a line relay, a switch and a breaker IED.</p>
      <div className="mt-2 rounded-lg bg-white border border-indigo-100 px-3 py-2 text-sm text-gray-700">
        <b>New to digital substations?</b> Terms like APPID, VLAN or stNum on this screen are explained from the ground up in <b>Foundations</b>: the network, the messages and the configuration, starting from the copper wiring you know.
        <div className="mt-2"><button onClick={onFoundations} className="text-sm px-3 py-1 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700">Start with Foundations</button></div>
      </div>
      <p className="text-sm text-gray-700 mt-2">Or dive into the simulator:</p>
      <ol className="text-sm text-gray-700 mt-1 space-y-1 list-decimal pl-5">
        <li><b>Play or step</b> through the fault and trip. The timing chart shows each signal and every frame on the wire.</li>
        <li><b>Tap a frame</b> (in the list or on the chart) to decode it field by field.</li>
        <li><b>Break something:</b> tap a link, the switch or an IED in the bay view, then run it again.</li>
      </ol>
      <div className="flex flex-wrap gap-2 mt-3">
        <button onClick={onStartLesson} className="text-sm px-3 py-1 rounded-lg border border-indigo-300 text-indigo-700 bg-white hover:border-indigo-500">Start lesson 1: A trip is a message</button>
        <button onClick={onClose} className="text-sm px-3 py-1 rounded-lg border border-indigo-300 text-indigo-700 bg-white hover:border-indigo-500">Explore on my own</button>
      </div>
    </section>
  )
}
