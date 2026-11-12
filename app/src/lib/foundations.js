// Foundations content (data). Text markup: {{term}} or {{term|shown text}}
// links a glossary term; **bold**. Every number quoted is checked in
// foundations.test.js.
//
// `code` shows a name or value in monospace.
//
// Chapter: { id, part, title, copper, body[], figure, key, sim: { label, panel, action }, built }

export const PARTS = [
  { id: 'A', title: 'The network', sub: 'Ethernet for substation people' },
  { id: 'B', title: 'IEC 61850 messaging', sub: 'Messages, names, datasets, publishing and subscribing' },
  { id: 'C', title: 'Virtual wiring', sub: 'Schematics, aux relays and contacts in a digital substation (ANSI / IEEE)' },
  { id: 'D', title: 'Configuration and engineering', sub: 'The SCL files, where each setting lives, commissioning' },
  { id: 'E', title: 'Time', sub: 'Latency, phase angle, clocks, sync status' },
]

export const SKIP_CHECK = {
  intro: 'Comfortable with basic networking? If these three are easy, skip ahead to A5, which maps the network layers onto IEC 61850.',
  questions: [
    { q: 'What does a switch do with a multicast frame when no multicast filtering is configured?', a: 'Sends it out of every port in the frame’s VLAN (except the one it came in on).' },
    { q: 'What does an 802.1Q tag carry?', a: 'A VLAN ID and a priority.' },
    { q: 'Can a router forward a frame that carries no IP packet?', a: 'No. A router forwards IP packets between networks; a plain Ethernet frame stays in its own network.' },
  ],
  skipTo: 'A5',
}

export const CHAPTERS = [
  {
    id: 'A1', part: 'A', built: true,
    title: 'From wires to messages',
    copper: 'You know this: the relay’s trip contact closes, DC flows through the panel wiring and terminal blocks to the breaker’s trip coil, and the breaker opens. One wire, one signal, there all the time.',
    body: [
      'In a digital substation the relay doesn’t close a contact for the breaker. It **sends a message**: a short packet of data that says “trip = true”. The message goes over an Ethernet cable (usually fibre) to a {{switch}}, which passes it on to a {{breaker IED}} at the breaker. The breaker IED reads the message and closes its own output contact to the trip coil.',
      'Three things change. **The wire becomes a shared network:** one fibre carries many signals, each identified by name and address instead of by its terminal number. **The signal becomes a message:** it exists only for an instant, so it is repeated to be sure it arrives. **Continuity checking becomes a software check:** the receiver expects messages at a steady rate and raises an alarm when they stop.',
      'Each chapter in this module explains one piece of those three changes. The messages are called {{GOOSE}}; Part B explains them properly.',
    ],
    figure: 'wires',
    key: 'A digital trip is a message, not a voltage. It needs an address, it has to be repeated, and its absence has to be noticed.',
    sim: { label: 'See the bay in the simulator', panel: 'bay' },
  },
  {
    id: 'A2', part: 'A', built: true,
    title: 'Frames and MAC addresses',
    copper: 'You know this: every wire has a number and lands on a numbered terminal, so you can trace where a signal goes and what it is.',
    body: [
      'On Ethernet, data travels in {{frames}}. A frame is an envelope: the address it is going to, the address it came from, a label saying what is inside, the contents, and a check value so the receiver can tell whether it was damaged on the way.',
      'The addresses are {{MAC addresses}}: six bytes, written like 02-00-00-AB-00-21. Every network port has its own. An address whose first byte is odd (01-…) is a {{group address}}: it names a group of receivers instead of one device. GOOSE uses group addresses; chapter A3 shows why.',
      'After the addresses comes the {{EtherType}}, two bytes that say what kind of data follows: 0x88B8 means GOOSE, 0x0800 means an IP packet. At the end, the {{FCS}} is a checksum; a frame that fails it is thrown away without notice.',
      'Each cable connects exactly two ports and carries traffic both ways at once ({{full duplex}}). There are no collisions on a switched network: a frame can only be delayed, waiting its turn at a busy port (chapter A4).',
      'In networking terms, frames and MAC addresses are **Layer 2**; the cable, connectors and transceivers are **Layer 1**. Chapter A5 puts the layers together.',
      'Size and speed: the simulator’s GOOSE trip frame is 140 bytes. At 100 Mbit/s it takes 12.8 µs to send, counting the 8-byte preamble and the 12-byte gap that separate frames on the wire.',
    ],
    figure: 'frame',
    key: 'A frame is addressed by MAC address and labelled by EtherType. A receiver decides whether to keep a frame from those fields before it looks inside.',
    sim: { label: 'Decode a real trip frame in the simulator', panel: 'decoded', action: 'selectTripFrame' },
  },
  {
    id: 'A3', part: 'A', built: true,
    title: 'Switches: one, all, or a group',
    copper: 'You know this: one relay’s trip often has to reach several places (two trip coils, a breaker-failure initiate, a recorder). With copper you wire each destination, or parallel them through an auxiliary relay.',
    body: [
      'A {{switch}} has several ports and passes frames between them. It learns which MAC address sits behind which port by reading the source address of every frame it receives. It is a **Layer 2** device: it decides by MAC address alone and never looks inside the contents (A5). After that:',
      'A {{unicast}} frame, to one device’s own address, leaves through one port only: the port that device is behind. A {{broadcast}} frame (FF-FF-FF-FF-FF-FF) leaves through every port. A {{multicast}} frame, to a group address, also leaves through every port, unless the switch has been configured with {{multicast filtering}} to send it only where it is wanted.',
      'Every device that receives a frame checks the destination: its own address, broadcast, or a group it subscribes to. Anything else it discards.',
      'GOOSE is multicast because one sender usually has several receivers. The relay sends one frame; the switch delivers a copy to every port; each IED keeps it or not, according to its own configuration. The relay doesn’t know who is listening, and doesn’t need to. That is {{publish/subscribe}}.',
    ],
    figure: 'switch',
    key: 'One GOOSE frame reaches every port of its network. Which IEDs act on it is decided by each receiver’s configuration, not by the sender.',
    sim: { label: 'See the trip frames and who accepted them', panel: 'frames' },
  },
  {
    id: 'A4', part: 'A', built: true,
    title: 'VLANs and priority',
    copper: 'You know this: trip circuits, CT circuits and alarm wiring run in separate cables and terminal groups, so one can’t interfere with another.',
    body: [
      'On one physical network, {{VLANs}} do that separation. A frame carries a 4-byte {{802.1Q tag}} with a VLAN ID (1–4094) and a {{priority}} (0–7). Each switch port is configured with the VLANs it carries, and a frame only leaves through ports that carry its VLAN. A multicast flood stays inside its VLAN. Like the frames they label, VLANs are a **Layer 2** feature, set up in the switches.',
      'That makes the **switch configuration part of the protection circuit**. If the port to the breaker IED doesn’t carry the trip message’s VLAN, the trip never arrives, and nothing in the relay or the breaker IED says why.',
      'Priority matters when frames queue. A port sends one frame at a time. If ten full-size frames (1518 bytes, a file transfer for instance) are waiting at a 100 Mbit/s port when the trip arrives, the trip waits 1.23 ms behind them. A switch that honours priority sends the trip next, after only the frame already on the wire: at most 123 µs. GOOSE uses priority 4 by default.',
    ],
    figure: 'vlan',
    key: 'VLAN membership on switch ports decides who can receive a message at all. Priority decides who goes first when a port is busy.',
    sim: { label: 'Break the VLAN on the bay switch', panel: 'bay' },
  },
  {
    id: 'A5', part: 'A', built: true,
    title: 'Layers, and why GOOSE has no IP address',
    copper: 'You know this: SCADA reaches the station over a communications circuit through an RTU or gateway, while trip wiring never leaves the relay panels and the yard.',
    body: [
      'Networking people describe communication in **layers**, numbered from the cable up (the {{OSI model}}). Four matter here. **Layer 1** is the physical link: fibre or copper, connectors, transceivers, link lights. **Layer 2** is Ethernet: frames, MAC addresses, VLANs and switches, everything in A2–A4. **Layer 3** is {{IP}}: addresses that let {{routers}} pass packets from one network to another. **Layer 4** is {{TCP}} (or UDP), which keeps a conversation complete and in order. On top sits the **application**: the actual content, a SCADA poll or a trip.',
      'That is the working vocabulary. A “Layer 2 network” is switches only, with no routing; a “Layer 3 switch” can also route; a “Layer 1 problem” is a cable, a connector or a transceiver.',
      '{{MMS}}, the IEC 61850 client/server protocol that SCADA gateways and HMIs use, travels down the whole stack: TCP/IP, plus the session and presentation layers (5 and 6) that the full OSI model adds above TCP. Because it has an IP address, routers can carry it out to a control centre.',
      'GOOSE and {{Sampled Values}} skip the middle: the message goes straight into an Ethernet frame, labelled by its EtherType (0x88B8 GOOSE, 0x88BA SV). Every IED saves the processing time, but a router has nothing to route, so GOOSE stays inside its own Layer 2 network, its {{broadcast domain}}. (A routable variant exists for wide-area schemes; it is out of scope here.)',
      'Inside the fence there are usually two networks. The {{station bus}} links the IEDs with each other and with the HMI, gateway and station computer: MMS, and GOOSE between bays. The {{process bus}} links the protection IEDs with the {{merging units}} and breaker IEDs in the yard: Sampled Values, trips and positions. Some stations run both on one network, separated by VLANs.',
    ],
    figure: ['layers', 'station'],
    key: 'GOOSE and Sampled Values are Layer 2: fast, not routable, local to their network. MMS uses the whole stack and can be routed. “Layer 1, 2, 3” is how networking people say where a device or a problem sits.',
    sim: null,
  },
  {
    id: 'A6', part: 'A', built: true,
    title: 'Preview: when the network fails',
    copper: 'You know this: critical trip paths are duplicated (two trip coils, two DC supplies, main 1 and main 2), so one failure doesn’t stop the breaker opening.',
    body: [
      'A trip that depends on a network needs a network that survives one broken cable or switch. There are two approaches. **Find another path:** switches running {{RSTP}} detect the failure and reconfigure, but frames are lost until they have. **Send everything twice:** with {{PRP}} each device sends every frame on two independent networks at once; with {{HSR}} every frame travels both ways round a ring. One failure then loses nothing.',
      '**Time:** a merging unit stamps every sample, and a relay comparing samples from several merging units needs all their clocks to agree to about a microsecond. {{PTP}} distributes that time over the same Ethernet.',
      'Both come in later parts of the simulator. For now, the bay simulator has one switch and no redundancy, which is exactly why a single dead link loses the trip.',
    ],
    figure: null,
    key: 'A network carrying trips needs redundancy that loses nothing during a failure, and Sampled Values need a common clock.',
    sim: null,
  },
  // Parts A–E built (SPEC § 11.2)
  {
    id: 'B1', part: 'B', built: true,
    title: 'Three kinds of message',
    copper: 'You know this: a substation already has three kinds of signalling. SCADA polls values and sends controls through the RTU. Trip, block and status wiring runs between relays, lockouts and breakers. CT and VT secondary circuits carry the measurements.',
    body: [
      'IEC 61850 has a message type for each. {{MMS}} takes over the RTU’s job. It is {{client/server}}: a client (the gateway or HMI) asks a server (an IED) for values, sets up {{reports}} that the IED sends when values change, and operates breakers with {{select-before-operate}} controls. It runs over TCP/IP (A5), and an answer within a second or so is fine.',
      '{{GOOSE}} takes over the trip, block and status wiring between IEDs. It is publish/subscribe (A3): the publisher multicasts a message whenever a value changes and keeps repeating it, and every IED configured to listen acts on it, within a few milliseconds.',
      '{{Sampled Values}} take over the CT and VT secondary wiring. A {{merging unit}} in the yard measures currents and voltages and publishes a continuous stream of samples, typically 80 per cycle: 4800 messages a second at 60 Hz, from every merging unit, all the time. The relays subscribe to the streams they need.',
      'This module and the bay simulator concentrate on GOOSE. Sampled Values get their own simulator slice later; MMS appears where SCADA meets the station.',
    ],
    figure: 'kinds',
    key: 'MMS is the SCADA conversation, GOOSE is the trip wiring, Sampled Values are the CT and VT wiring. Each has its own pattern, speed and place in the network.',
    sim: null,
  },
  {
    id: 'B2', part: 'B', built: true,
    title: 'Names for everything: the data model',
    copper: 'You know this: device function numbers. 21 is distance, 50/51 overcurrent, 87 differential, 50BF breaker failure, 52 the breaker. A label like 21-AB on a schematic tells you what the device does and where it is.',
    body: [
      'IEC 61850 names every function and every value in a fixed hierarchy, the same in every vendor’s IED. The trip in the simulator is `LineProtABPROT/PTRC1.Tr.general`. Read it from the left:',
      'The **IED name** (`LineProtAB`) is the physical device. The {{logical device}} (`PROT`) is a group of functions inside it, such as protection or control. The {{logical node}} (`PTRC1`) is one function: a four-letter class and an instance number. The {{data object}} (`Tr`) is one piece of information the function has, here its trip. The {{data attribute}} (`general`) is one value of it, here “tripped, any phase”.',
      'Logical-node classes play the part of device numbers. The first letter is the family: P protection, R protection-related, X switchgear, C control, T instrument transformers, M measurement, L the IED itself. Distance protection (21) is `PDIS`; the breaker (52) is `XCBR`. `PTRC`, trip conditioning, gathers the function’s trips into one trip output: the data model’s 94.',
      'Every value travels with its {{quality}} (is it valid, is it a test value) and usually a timestamp, so a receiver always knows how far to trust it.',
    ],
    figure: ['name', 'lnTable'],
    key: 'Every value has a full name: IED, logical device, logical node, data object, attribute. Logical nodes are the data model’s device numbers.',
    sim: { label: 'See the names in a decoded frame', panel: 'decoded', action: 'selectTripFrame' },
  },
  {
    id: 'B3', part: 'B', built: true,
    title: 'Datasets and control blocks',
    copper: 'You know this: a relay’s output contacts are assigned in its settings (output 3 = trip), and the wiring diagram says which terminal each output lands on.',
    body: [
      'An IED doesn’t publish single values. It publishes a {{dataset}}: an ordered list of values chosen in configuration. The simulator’s trip dataset `DS_Trip` holds two: `PTRC1.Tr.general` and its quality.',
      'A GOOSE {{control block}} says how the dataset is published: its name (`gocbRef`), a text ID (`goID`), the dataset, the configuration revision ({{confRev}}), the fastest repeat and the heartbeat interval, and its network address: destination multicast MAC, {{APPID}}, VLAN ID and priority. Whenever any value in the dataset changes, the whole dataset is sent again as a new state.',
      'One detail explains a classic commissioning failure: **the frame carries the values, not their names.** `allData` is just “true, good”, in dataset order. The subscriber knows the first value is the trip only because its own configuration says so. If someone edits the dataset, its confRev goes up, and a subscriber still configured for the old list must reject the new frames rather than read value 1 as something else. That is the confRev check in the simulator.',
    ],
    figure: 'gocb',
    key: 'The dataset is what is sent; the control block is how. Values arrive by position, so publisher and subscriber must agree on the dataset, and confRev proves they do.',
    sim: { label: 'Break confRev at 52-AB in the bay', panel: 'bay' },
  },
  {
    id: 'B4', part: 'B', built: true,
    title: 'Publishing: state, sequence, heartbeat',
    copper: 'You know this: a contact is open or closed all the time, and whatever it is wired to sees that state continuously. If the wire breaks, it sees “open”.',
    body: [
      'A GOOSE message exists only while it is on the wire, so the publisher keeps sending the current state. When nothing changes it repeats it at a slow, steady {{heartbeat}}: 1 s in the simulator.',
      'When a value changes, the publisher sends the new state at once, with {{stNum}} one higher and {{sqNum}} back to 0. Then it repeats it quickly, 2, 4, 8, 16 ms… apart in the simulator, doubling until it is back at the heartbeat. Each repeat has sqNum one higher. Fast repeats straight after a change mean one lost frame costs only a couple of milliseconds.',
      'Every frame carries its {{TAL}}: how long the subscriber should wait for the next one. Here it is twice the gap to the next scheduled frame: 4 ms on the first frame after a change, 2000 ms on a heartbeat.',
      'There is no acknowledgement: the publisher never learns who received what. The repeat pattern is set per project and per vendor (IEC 61850-8-1 leaves it open); the values here are illustrative.',
    ],
    figure: 'publish',
    key: 'stNum counts changes; sqNum counts repeats of the same state. Fast repeats after a change give reliability; the heartbeat proves the publisher is still there.',
    sim: { label: 'Watch the burst in the timing chart', panel: 'timing' },
  },
  {
    id: 'B5', part: 'B', built: true,
    title: 'Subscribing and supervision',
    copper: 'You know this: trip-circuit supervision passes a small current through the trip circuit and alarms when it opens, so a broken wire is found before it is needed.',
    body: [
      'A {{subscription}} is the receiving IED’s configuration for one message: the address and APPID to listen for, the gocbRef, dataset and confRev to expect, and where each value goes in its logic. Every arriving frame goes through the same checks, in order.',
      '**1. Is it for me?** Destination address and APPID; if not, the frame is dropped quietly. **2. Is it the message I was configured for?** gocbRef, dataset and confRev; a mismatch is a configuration error and is reported as one. **3. Is it new?** A higher stNum is a new state: act on it. The same stNum with a higher sqNum is a repeat: nothing to do. **4. Can I use it?** Quality and the test flag (B6).',
      '**5. Supervision.** Every accepted frame, new or repeat, restarts a timer of length TAL. If it runs out before the next frame, the subscription is declared lost: its values are marked invalid and an alarm is raised. This is trip-circuit supervision for the network. Edition 2 IEDs show the status as a logical node, {{LGOS}}, so SCADA can alarm on it.',
      'What an IED does with a lost input is a design decision, input by input. For a trip input: usually don’t trip, and alarm. For a blocking signal, the safe choice may be the opposite.',
    ],
    figure: 'subscribe',
    key: 'A subscriber filters, checks identity, checks sequence and quality, then supervises. The TAL timer turns silence into an alarm.',
    sim: { label: 'Break a subscription in the bay', panel: 'bay' },
  },
  {
    id: 'B6', part: 'B', built: true,
    title: 'Quality, test and simulation',
    copper: 'You know this: before testing a relay you open its test switches, so its trip can’t reach the breaker, and inject from a test set.',
    body: [
      'There are no test switches on a network, so IEC 61850 does the same job with modes and flags. Every function has a {{mode}}: on, blocked, test, test/blocked or off. An IED in test mode sets the **test** flag in the quality of everything it publishes.',
      'A subscriber in normal mode (on) treats test-flagged data as invalid: a relay under test can publish trips all day and the in-service breaker IED ignores them. A subscriber that is itself in test mode accepts them, so IEDs under test together can be tested end to end. In test/blocked, a function runs but its physical outputs stay blocked: the relay works, its contacts don’t move.',
      'A test set can also publish GOOSE and Sampled Values that imitate a real IED, with the {{simulation}} flag set. An IED accepts simulated messages only when it is put into simulation mode (`LPHD.Sim`), and then uses them in place of the real ones.',
      'Mode is the new isolating link: after a test, the most important step is putting every IED back to “on”. The bay simulator gets test mode next (slice 1.1).',
    ],
    figure: 'testMatrix',
    key: 'Modes and test flags replace test switches. A normal-mode subscriber ignores test data, and an IED left in test is the new forgotten test switch.',
    sim: null,
  },
  {
    id: 'C1', part: 'C', built: true,
    title: 'Where did my contact go?',
    copper: 'You know this: on the DC schematic the relay’s trip output is a contact in the trip rung, wired through terminal blocks and cable cores to the breaker’s 52a and trip coil. Wire numbers and terminal designations tell you where it goes.',
    body: [
      'In a digital substation there is no contact between the relay and the breaker. The relay has a **value** instead: `PTRC1.Tr.general`, true while the trip is asserted. The value is an entry in a dataset, published by a control block (B3). At the other end, the breaker IED has an input configured to take that entry from that message, and it drives a real output contact in the breaker’s trip rung.',
      'So each piece of the copper circuit has a counterpart. The **relay output contact** becomes the dataset entry. The **wire number and terminal** become the message’s identity (gocbRef, APPID, multicast address) plus the entry’s position in the dataset. The **cable** becomes the network path through switches and VLANs. The **trip-coil input** becomes the breaker IED’s subscription and its own output contact.',
      'On the drawings the contact symbol is replaced by a row in a {{signal list}}: signal name, publishing IED and dataset, position, and every subscriber. Chapter C5 shows the list for a whole station.',
      'One thing doesn’t move: the last metres of copper at the breaker. The breaker IED’s output contact still sits in series with 52a and the trip coil (A1, C3).',
    ],
    figure: 'contactMap',
    key: 'The relay’s trip contact becomes a value in a dataset; the wire number becomes the message’s identity and the entry’s position; the breaker IED drives the only copper left.',
    sim: { label: 'See the trip value in a decoded frame', panel: 'decoded', action: 'selectTripFrame' },
  },
  {
    id: 'C2', part: 'C', built: true,
    title: 'Where did my aux relay go?',
    copper: 'You know this: one protection trip often has to go to several places: both trip coils, breaker-failure initiate, the fault recorder, a SCADA alarm. A {{94|94 auxiliary tripping relay}} multiplies one contact into many, and every new destination needs a spare contact and new wiring.',
    body: [
      'With GOOSE the relay publishes the trip once (A3). Every device that needs it has its own {{subscription}} to that same message. There is no auxiliary relay and no contact count: the publisher neither knows nor cares how many subscribers there are.',
      'Adding a destination changes only the new subscriber’s configuration. The publisher’s dataset already has the value, and the switch already delivers it to every port in the VLAN. In copper the same change means a spare contact, or another aux relay, and new wiring through the panels.',
      'Failures change shape too. In copper, a failed aux relay coil stops every destination at once, and nothing alarms unless that coil is supervised; a broken wire stops one destination, and only a supervised circuit (a trip coil, through trip-circuit supervision) alarms. In the digital version a dead publisher, or a shared switch, also stops every destination at once, but **every subscriber supervises its own feed** (B5), so every loss raises its own alarm.',
      'Fan-in is the mirror image. Several relays tripping one breaker used to be parallel contacts on the trip bus; now the breaker IED subscribes to several messages and ORs them in its logic.',
    ],
    figure: 'fanout',
    key: 'One message, many subscriptions: the aux relay disappears, a new destination touches only the new subscriber, and every destination supervises its own feed.',
    sim: null,
  },
  {
    id: 'C3', part: 'C', built: true,
    title: 'Dry contacts at the edges',
    copper: 'You know this: 52a is closed when the breaker is closed, 52b the opposite. A relay or RTU reads them as {{dry contacts}}: contacts with no voltage of their own, wetted by station DC through the input.',
    body: [
      'Copper doesn’t disappear; it moves to the edge. A {{breaker IED}} (or a merging unit with binary I/O) mounted at the breaker does the wiring-heavy work locally. Its {{binary inputs}} read 52a and 52b. Its {{binary outputs}} are real contacts: the trip output in series with 52a and the trip coil, the close output with 52b and the close coil.',
      'The two auxiliary contacts become one {{double point}} value, `XCBR1.Pos.stVal`, published as GOOSE (B2). 52a closed and 52b open is **on** (10). 52a open and 52b closed is **off** (01). Both open is **intermediate** (00): the breaker is moving. Both closed is **bad** (11): a contact or wiring fault. Reading both contacts is what lets the IED tell “open” from “a broken wire”: a lasting intermediate or bad state is an alarm.',
      'Supervision moves too. The breaker IED can supervise its own trip and close circuits and publish the result, so trip-circuit supervision reaches the relay and SCADA as a message instead of an alarm contact.',
      'What is left of the copper is short, local and testable with a meter. Everything between the bay and the control house is network.',
    ],
    figure: 'dryContacts',
    key: 'Dry contacts stay at the breaker. The breaker IED reads 52a and 52b into one double-point position and drives the trip and close coils through real contacts.',
    sim: { label: 'See the Position GOOSE in the simulator', panel: 'timing' },
  },
  {
    id: 'C4', part: 'C', built: true,
    title: 'Lockouts and seal-ins in logic',
    copper: 'You know this: an {{86 lockout}} relay trips the breakers and blocks closing until someone resets it by hand, and it stays tripped through a DC interruption because it is mechanically latched. A {{seal-in}} around the trip output holds the trip coil energized until 52a breaks the current, so the relay’s own contact never has to.',
    body: [
      'In a digital substation the lockout is **logic**: a latch in an IED, often the protection IED or the breaker IED. A trip sets it. It publishes a lockout state that the breaker IEDs subscribe to, to trip and to block closing. It resets only on a deliberate command: a pushbutton on the IED, the HMI, or SCADA.',
      'There is no standard logical node called lockout (B2): each vendor builds it in logic and publishes its state like any other value. That puts two questions on the design and test checklist that the hand-reset relay answered by construction. **Does the latch survive a restart of the IED?** And **what does each breaker IED do if the lockout message is lost:** block closing, or not?',
      'Seal-in moves to the breaker IED. The trip message is a state, repeated until the relay resets (B4), and the breaker IED typically holds its trip output until the position shows open, so 52a, not the output contact, still breaks the coil current.',
      'On the drawings, the 86 and its contact development become a logic diagram and a few rows in the signal list. Nothing on the panel shows the lockout is set, except the IED’s display and the HMI.',
    ],
    figure: 'lockout',
    key: 'Lockouts and seal-ins become logic. Check what the hand-reset relay guaranteed by construction: the latch survives a restart, and a lost lockout message is handled safely.',
    sim: null,
  },
  {
    id: 'C5', part: 'C', built: true,
    title: 'The new wiring diagram',
    copper: 'You know this: to trace a trip you follow the schematic and the wiring diagram: relay terminal, cable core, terminal block, trip coil. Every connection is on paper and can be checked with a meter.',
    body: [
      'The digital equivalent is a set of documents rather than one drawing. The {{signal matrix}}: every published signal as a row, every IED as a column, a mark where an IED subscribes. Each IED’s {{virtual inputs}}: which message and dataset entry feeds which logic input. The **logic diagrams** in each IED. The **network drawings**: switch ports, VLANs, priorities. And the SCD file that ties them together (Part D).',
      'Tracing a trip that didn’t arrive follows the path the simulator shows. Was it published (the relay’s logic and its GOOSE)? Did it reach the port (switch and VLAN)? Was it accepted (the subscriber’s checks and status)? Did the logic use it (the virtual-input mapping)?',
      'The matrix below is for the station this simulator is heading to: lines A–X and A–B on bus A, and the transformer tap A–T behind 52-AT. Tap a cell, or an IED to see its virtual inputs.',
    ],
    figure: 'matrix',
    key: 'The signal matrix replaces the wiring diagram and virtual inputs replace the terminal blocks. Tracing a trip means following it through publish, network, subscribe and logic.',
    sim: null,
  },
  {
    id: 'D1', part: 'D', built: true,
    title: 'The SCL files',
    copper: 'You know this: a project goes from the one-line and the protection philosophy to schematics, wiring diagrams and relay settings files, each made by different people with different tools, and all of them have to agree.',
    body: [
      'IEC 61850 puts the whole configuration into files in one XML format, {{SCL}} (Substation Configuration Language, IEC 61850-6). Each file type has one job in the project, and they pass from tool to tool in a fixed order.',
      'The {{SSD}} describes the single line and the functions it needs, before any IED is chosen. Each vendor supplies an {{ICD}} per IED type: what that IED can do. A vendor-independent {{system configurator}} combines them into the {{SCD}}: every IED, every network address, every dataset and control block, and every subscription. That one file is the master copy of the digital wiring.',
      'Each vendor’s {{IED configurator}} then takes its IED’s share of the SCD, adds the IED’s own logic and settings, and produces a {{CID}} to load into the IED. Changes made in the IED tool go back to the system tool as an IID, and a project that needs part of another substation’s configuration (the far end of a line) receives a SED.',
      'Two things usually live outside SCL: protection settings (reaches, time delays), which stay in the vendor’s settings files, and the switch configuration (D2).',
    ],
    figure: 'scl',
    key: 'SSD and ICDs go into the system configurator, which makes the SCD, the master copy of the digital wiring. Each IED gets its CID cut from that SCD.',
    sim: null,
  },
  {
    id: 'D2', part: 'D', built: true,
    title: 'Where each value lives',
    copper: 'You know this: when the wiring diagram and the relay’s output assignment disagree, the trip goes nowhere, and you find it by tracing both.',
    body: [
      'Every value on the simulator screen has exactly one source, and is copied from there into every IED that needs it. The addresses (MAC, APPID, VLAN, priority) sit in the SCD’s communication section. The names, dataset and confRev sit in the publisher’s part of the SCD. What a subscriber expects, and which virtual input it feeds, is an {{ExtRef}} in the subscriber’s part.',
      'The classic misses are all **two copies that drifted apart**: a publisher reloaded from a newer SCD than its subscriber (confRev, dataset); a value typed by hand in one IED tool instead of taken from the SCD (APPID, gocbRef); a switch configured from an old VLAN plan. The SCD can’t help with the last one: switch VLANs are usually set in the switch’s own tool.',
      'The table below lists each value, where it is set, and lets you open the simulator with that copy broken.',
    ],
    figure: 'whereLives',
    key: 'One SCD, many copies. Every value has one source, and every classic miss is two copies that drifted apart.',
    sim: null,
  },
  {
    id: 'D3', part: 'D', built: true,
    title: 'Commissioning: proving the digital wiring',
    copper: 'You know this: point-to-point checks with a meter against the wiring diagram, trip tests through the test switches, then an end-to-end trip of the breaker.',
    body: [
      'The meter is replaced by checks at each layer of the path. **Configuration:** every IED holds the CID made from the current SCD. **Network:** switch ports and VLANs match the VLAN plan, and a {{network analyzer}} on a mirror port shows each message on the ports it should reach. **Subscription status:** every subscription in every IED is healthy before any functional test; a standing alarm is a miss already found.',
      '**Signal tests:** each signal is exercised from the publisher to the subscriber’s logic, in test mode (B6) so that in-service IEDs ignore it, or from a test set publishing simulated messages. **End-to-end:** the breaker trips from the relay, as before.',
      'And one step copper never needed in this form: **restore**. Every IED back to on, simulation off, alarm list clear. An IED left in test mode passes every other check and ignores the real trip.',
    ],
    figure: 'commissioning',
    key: 'Prove the digital wiring layer by layer (configuration, network, subscription status, signals, end to end), then restore every IED to normal. Only the last step catches an IED left in test.',
    sim: null,
  },
  {
    id: 'E1', part: 'E', built: true,
    title: 'Two kinds of time: latency and timestamps',
    copper: 'You know this: a sequence-of-events recorder stamps every contact change, and fault records from different relays only line up if their clocks agree, which is why a GPS clock sends IRIG-B to all of them.',
    body: [
      '{{latency|Latency}} is how long something takes. The transfer time of a trip (logic to logic, the 3 ms class) is a latency. It decides how fast protection acts, and it exists whether or not any clock is synchronized.',
      'A {{timestamp}} says when something happened, by the clock of the device that saw it. Every GOOSE carries `t`, the time of its last state change; event records and fault records are stamped; Sampled Values are numbered against the start of each second.',
      'Timestamps from several IEDs only tell a true story if their clocks agree. In the figure, the breaker IED’s clock is set a few milliseconds behind the relay’s: the record shows the trip coil energizing before the relay tripped. Nothing was wrong with the protection, only with the time.',
    ],
    figure: 'clockOffset',
    key: 'Latency is how long; a timestamp is when. Events from several IEDs line up only if their clocks agree.',
    sim: null,
  },
  {
    id: 'E2', part: 'E', built: true,
    title: 'Time is phase angle',
    copper: 'You know this: a differential relay compares the currents from CTs on every side of its zone, all wired into one relay, so every current is measured at the same instant.',
    body: [
      'With Sampled Values, each merging unit samples its own CTs, and the relay lines up samples from different merging units by their sample number. That means “the same instant” only if the merging units’ clocks agree.',
      'At 60 Hz a cycle is 16.67 ms, or 360°. So **1 ms of time error is 21.6° of phase error**, and 1 µs is 0.0216°.',
      'For a current I flowing straight through a differential zone, a time error Δt between the two sides makes the relay see a false differential of 2·sin(θ/2)·I, where θ = 360°·f·Δt. At 1 ms that is 0.37·I, above an illustrative 30 % slope: the relay would trip for a fault outside its zone. At 10 µs it is under 0.4 % of I. This is why Sampled Values aim for about a microsecond. (The Line Protection Simulator shows the same arithmetic for line differential over a channel with unequal delays.)',
    ],
    figure: 'phase',
    key: 'Time error is phase error: 21.6° per millisecond at 60 Hz. Differential protection on Sampled Values needs merging units that agree to about a microsecond.',
    sim: null,
  },
  {
    id: 'E3', part: 'E', built: true,
    title: 'Where time comes from',
    copper: 'You know this: a GPS clock in the control house, with {{IRIG-B}} on coax to every relay and recorder, and a 1PPS pulse for the devices that need it.',
    body: [
      'In a digital substation the time travels on the same Ethernet, using {{PTP}}, the Precision Time Protocol (IEEE 1588). The power-utility profile (IEC 61850-9-3, also IEEE C37.238) fixes its options for substations and aims for about 1 µs at every device.',
      'The chain: a GNSS (GPS) antenna feeds a {{grandmaster}} clock, the station’s reference. Its time messages pass through the switches to every IED. A switch on the path must not add unknown delay, so each is a {{transparent clock}} (it measures how long each time message spent inside it and corrects for it) or a {{boundary clock}} (it synchronizes itself and serves time onward). The IEDs follow as ordinary clocks.',
      'A station usually has two grandmaster-capable clocks. Every clock announces its priority and quality ({{clock class}}: locked to GPS, in holdover, or free-running), and the {{best master clock algorithm}} makes every device agree on the best one. If it fails or loses GPS, the next best takes over without anyone doing anything. Older texts say master and slave; IEEE 1588-2019 adds “time transmitter” and “time receiver”.',
      'PTP is Layer 2 multicast here, like GOOSE, so the VLAN and priority planning of A4 applies to it too.',
    ],
    figure: 'clocks',
    key: 'GPS → grandmaster → PTP through transparent or boundary clocks → every IED. The best master clock algorithm picks the grandmaster and fails over automatically.',
    sim: null,
  },
  {
    id: 'E4', part: 'E', built: true,
    title: 'Is my time good?',
    copper: 'You know this: a GPS clock has a “locked” lamp and an alarm contact, and a relay reports when it loses its IRIG-B signal.',
    body: [
      'Every device that uses time also says how good its time is. The grandmaster announces its clock class. IEDs report “synchronized” or “sync lost” as a status value and an alarm. Timestamps carry a time quality (clock not synchronized, clock failure, accuracy).',
      'Sampled Values carry {{smpSynch}} in every message: **0** not synchronized, **1** synchronized to a local clock, **2** synchronized to a global, GPS-traceable clock.',
      'What protection does with it depends on whether it compares merging units. A function that compares several streams (87B, 87T) can only line up samples that share a clock, so it blocks if any stream is not synchronized, or if the streams claim different references. A function that uses one merging unit (21 or 51 from one CT set) needs no common clock and carries on. This is the typical behaviour; vendors differ in detail.',
    ],
    figure: 'sync',
    key: 'Every stream says whether its time is good. Functions that compare merging units block on bad or mixed sync; functions that use one merging unit carry on.',
    sim: null,
  },
  {
    id: 'E5', part: 'E', built: true,
    title: 'Holdover and failure',
    copper: 'You know this: when the GPS antenna cable is cut, the station clock keeps running on its internal oscillator and raises an alarm, and an old recorder drifts a few seconds a month until nobody’s records line up.',
    body: [
      'A grandmaster that loses GPS keeps time on its own oscillator: {{holdover}}. Its time drifts away from true time at the oscillator’s frequency error. In the simplest picture the error grows steadily: 1 ppm is 1 µs every second, so a basic crystal passes 1 µs after 1 s, an oven-controlled crystal after 100 s, and rubidium after about 2.8 hours. (Real oscillators also age and move with temperature; these figures are illustrative.)',
      'Inside one station, what matters most is that all devices follow the **same** clock. If they all follow a grandmaster in holdover, they drift together and their samples still line up; the station loses its link to true time (global becomes local) before it loses protection. Comparisons with other stations, and event records against the outside world, suffer first.',
      'The dangerous moments are changes: a failover to a backup grandmaster whose time has drifted, or devices resynchronizing at different moments. Merging units can disagree for a while, and differential protection blocks until they agree again. Hence two grandmasters with independent antennas, oscillators chosen for the holdover time the station needs, and alarms on every loss of lock.',
    ],
    figure: 'holdover',
    key: 'Without GPS, clocks drift at their oscillator’s rate. Devices that drift together still protect; the risks are failovers and devices that disagree.',
    sim: null,
  },
]

export const builtChapters = () => CHAPTERS.filter(c => c.built)
export const chapterById = id => CHAPTERS.find(c => c.id === id)

// Split text into plain / bold / term pieces
export function parseRich(text) {
  const out = []
  const re = /\{\{([^}|]+)(?:\|([^}]+))?\}\}|\*\*([^*]+)\*\*|`([^`]+)`/g
  let last = 0, m
  while ((m = re.exec(text))) {
    if (m.index > last) out.push({ kind: 'text', text: text.slice(last, m.index) })
    if (m[1]) out.push({ kind: 'term', term: m[1], text: m[2] ?? m[1] })
    else if (m[3]) out.push({ kind: 'bold', text: m[3] })
    else out.push({ kind: 'code', text: m[4] })
    last = re.lastIndex
  }
  if (last < text.length) out.push({ kind: 'text', text: text.slice(last) })
  return out
}
