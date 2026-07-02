// Demo harness for the AI Voice SDK. Plain browser JS, served static (no build).
// Mobile-first: chat-bubble transcript, tabbed transcript/latency, sticky controls.

const $ = (id) => document.getElementById(id);
const log = (msg) => {
  const el = $('log');
  if (!el) return;
  el.textContent += msg + '\n';
  el.scrollTop = el.scrollHeight;
};

let pc;
let control;
let sessionId;
let localStream;

const turnBars = []; // each: { ttft, gen, tts }
let turns = 0;
let partialEl = null;
let agentEl = null;
let muted = false;
let connState = 'idle';
let sessState = '—';
let tConnectStart = 0;

const sendEvent = (payload) => control && control.send(JSON.stringify({ kind: 'event', payload }));

// --- status chip (combines connection + session state) ---
function renderStatus() {
  const chip = $('status');
  let text = connState;
  let cls = '';
  if (connState === 'connected') {
    if (sessState === 'speaking') { text = 'speaking'; cls = 'warn'; }
    else if (sessState === 'listening') { text = 'listening'; cls = 'on'; }
    else { text = 'connected'; cls = 'on'; }
  } else if (connState === 'connecting…' || connState === 'connecting') {
    cls = 'connecting';
  }
  chip.textContent = text;
  chip.className = 'chip' + (cls ? ' ' + cls : '');
}
function setConn(state) { connState = state; $('d-conn').textContent = state; renderStatus(); }
function setSession(state) { sessState = state; $('d-sess').textContent = state; renderStatus(); }

function setConnectedUi(on) {
  $('connect').textContent = on ? 'Disconnect' : 'Connect';
  $('connect').disabled = false;
  $('interrupt').disabled = !on;
  $('mute').disabled = !on;
  if (!on) { muted = false; $('mute').textContent = '🎙'; }
}

// --- transcript (chat bubbles) ---
function clearTranscript() {
  $('transcript').innerHTML = '';
  partialEl = null;
  agentEl = null;
}
function bubble(cls, text) {
  const el = document.createElement('div');
  el.className = 'msg ' + cls;
  el.textContent = text;
  $('transcript').appendChild(el);
  $('transcript').scrollTop = $('transcript').scrollHeight;
  return el;
}
function showPartial(text) {
  if (!partialEl) partialEl = bubble('partial', '');
  partialEl.textContent = text;
  $('transcript').scrollTop = $('transcript').scrollHeight;
}
function commitYou(text) {
  if (partialEl) { partialEl.remove(); partialEl = null; }
  bubble('you', text);
}
function appendAgent(text) {
  if (!agentEl) agentEl = bubble('agent', '');
  agentEl.textContent += (agentEl.textContent ? ' ' : '') + text;
  $('transcript').scrollTop = $('transcript').scrollHeight;
}

// --- latency chart ---
function drawChart() {
  const c = $('chart');
  const ctx = c.getContext('2d');
  const W = c.width;
  const H = c.height;
  ctx.clearRect(0, 0, W, H);

  const maxMs = 2000; // y-axis to 2s
  const yFor = (ms) => H - (ms / maxMs) * H;
  const axisX = 30;

  ctx.font = '10px system-ui';
  for (let g = 500; g <= maxMs; g += 500) {
    const y = yFor(g);
    ctx.strokeStyle = '#2a2f3a';
    ctx.beginPath();
    ctx.moveTo(axisX, y);
    ctx.lineTo(W, y);
    ctx.stroke();
    ctx.fillStyle = '#8b93a3';
    ctx.fillText(g / 1000 + 's', 3, y + 3);
  }

  const by = yFor(1100); // budget line at 1.1s
  ctx.strokeStyle = '#f5a623';
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(axisX, by);
  ctx.lineTo(W, by);
  ctx.stroke();
  ctx.setLineDash([]);

  // stacked bars: LLM ttft (bottom) → LLM gen → TTS (top)
  const segs = [
    ['ttft', '#4f8cff'],
    ['gen', '#a06bff'],
    ['tts', '#3ad29f'],
  ];
  const bw = 34;
  const gap = 10;
  const x0 = axisX + 8;
  const visible = turnBars.slice(-Math.floor((W - x0) / (bw + gap)));
  visible.forEach((t, i) => {
    const x = x0 + i * (bw + gap);
    let y = H;
    for (const [seg, color] of segs) {
      const h = ((t[seg] || 0) / maxMs) * H;
      y -= h;
      ctx.fillStyle = color;
      ctx.fillRect(x, y, bw, h);
    }
    const total = (t.ttft || 0) + (t.gen || 0) + (t.tts || 0);
    ctx.fillStyle = '#e6e9ef';
    ctx.font = '10px system-ui';
    ctx.fillText(Math.round(total), x, y - 4);
  });
}
// Size the canvas backing store to its rendered width (it's hidden on the
// inactive mobile tab, so guard against a zero width).
function resizeChart() {
  const c = $('chart');
  const w = c.clientWidth;
  if (!w) return;
  c.width = w;
  c.height = 220;
  drawChart();
}

// --- server events ---
function onServerEvent(e) {
  log('⬅ ' + JSON.stringify(e));
  switch (e.type) {
    case 'session.started':
      setSession('listening');
      break;
    case 'transcript.partial':
      showPartial(e.text);
      break;
    case 'transcript.final':
      commitYou(e.text);
      break;
    case 'agent.response.text':
      appendAgent(e.text);
      break;
    case 'agent.response.started':
      setSession('speaking');
      break;
    case 'agent.response.completed':
      agentEl = null; // next turn starts a fresh agent bubble
      setSession('listening');
      break;
    case 'agent.interrupted':
      setSession('listening');
      break;
    case 'metrics.latency':
      turnBars.push({
        ttft: e.metrics.llmTtftMs || 0,
        gen: e.metrics.llmGenMs || 0,
        tts: e.metrics.ttsMs || 0,
      });
      turns += 1;
      $('d-turns').textContent = turns;
      drawChart();
      break;
  }
}

// --- connection ---
async function connect() {
  clearTranscript();
  turnBars.length = 0;
  turns = 0;
  $('d-turns').textContent = '0';
  setConn('connecting…');
  $('connect').disabled = true;
  tConnectStart = performance.now();

  localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  // STUN lets the client discover its public (srflx) address so the server can
  // route media back — without it, mobile/cellular NAT makes ICE crawl for
  // seconds before finding a path.
  pc = new RTCPeerConnection({
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
    ],
  });
  for (const track of localStream.getAudioTracks()) pc.addTrack(track, localStream);

  pc.ontrack = (e) => {
    $('remote').srcObject = e.streams[0];
  };
  pc.onconnectionstatechange = () => {
    setConn(pc.connectionState);
    if (pc.connectionState === 'connected') log(`✔ connected in ${Math.round(performance.now() - tConnectStart)}ms`);
    if (pc.connectionState === 'failed' || pc.connectionState === 'closed') disconnect();
  };

  control = pc.createDataChannel('control');
  control.onopen = () => {
    sendEvent({ type: 'session.start', sessionId });
    setConnectedUi(true);
    log('control channel open · session.start sent');
  };
  control.onmessage = (e) => onServerEvent(JSON.parse(e.data).payload);

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  const tOffer = performance.now();
  await waitIceComplete(pc);
  log(`ice gathering: ${Math.round(performance.now() - tOffer)}ms`);

  const providers = { asr: $('asr').value, llm: $('llm').value, tts: $('tts').value };
  const tFetch = performance.now();
  const resp = await fetch('/session', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ offer: pc.localDescription.sdp, providers }),
  });
  const { answer, sessionId: sid } = await resp.json();
  sessionId = sid;
  await pc.setRemoteDescription({ type: 'answer', sdp: answer });
  log(`/session + answer: ${Math.round(performance.now() - tFetch)}ms`);
}

function disconnect() {
  if (control) control.close();
  if (pc) pc.close();
  if (localStream) for (const t of localStream.getTracks()) t.stop();
  pc = undefined;
  control = undefined;
  localStream = undefined;
  $('remote').srcObject = null;
  setConn('idle');
  setSession('—');
  setConnectedUi(false);
}

// Resolve once gathering is complete OR after a short cap. The server has a
// directly reachable public candidate, so we don't need every last client
// candidate — waiting for full "complete" can hang ~20s on mobile networks
// that are slow to reach a STUN server. The host/srflx candidates gathered
// within the cap are enough; connectivity finds the rest peer-reflexively.
function waitIceComplete(peer, timeoutMs = 2500) {
  return new Promise((resolve) => {
    if (peer.iceGatheringState === 'complete') return resolve();
    const onChange = () => {
      if (peer.iceGatheringState === 'complete') finish();
    };
    const finish = () => {
      clearTimeout(timer);
      peer.removeEventListener('icegatheringstatechange', onChange);
      resolve();
    };
    const timer = setTimeout(finish, timeoutMs);
    peer.addEventListener('icegatheringstatechange', onChange);
  });
}

// --- wiring ---
$('connect').onclick = () => {
  if (pc) {
    disconnect();
    return;
  }
  connect().catch((e) => {
    log('error: ' + e.message);
    disconnect();
  });
};

$('interrupt').onclick = () => {
  sendEvent({ type: 'agent.interrupt', sessionId, reason: 'manual' });
  log('➡ agent.interrupt');
};

$('mute').onclick = () => {
  if (!localStream) return;
  muted = !muted;
  for (const t of localStream.getAudioTracks()) t.enabled = !muted; // muted track sends silence
  $('mute').textContent = muted ? '🔇' : '🎙';
  $('mute').title = muted ? 'Unmute' : 'Mute';
  log(muted ? 'muted' : 'unmuted');
};

// Changing a provider mid-call reconnects with the new choice (debounced, so
// changing several at once coalesces into a single reconnect). While
// disconnected, the choice is just staged for the next Connect.
let switchTimer;
for (const id of ['asr', 'llm', 'tts']) {
  $(id).onchange = () => {
    $('d-prov').textContent = `${$('asr').value} · ${$('llm').value} · ${$('tts').value}`;
    if (!pc) return;
    log('provider changed — reconnecting…');
    clearTimeout(switchTimer);
    switchTimer = setTimeout(() => {
      disconnect();
      connect().catch((e) => {
        log('error: ' + e.message);
        disconnect();
      });
    }, 400);
  };
}

// tabs (mobile only — on desktop both panels show and the tab bar is hidden)
document.querySelectorAll('.tabs button').forEach((b) => {
  b.onclick = () => {
    document.querySelectorAll('.tabs button').forEach((x) => x.classList.remove('active'));
    document.querySelectorAll('.panel').forEach((p) => p.classList.remove('active'));
    b.classList.add('active');
    $('panel-' + b.dataset.tab).classList.add('active');
    if (b.dataset.tab === 'latency') resizeChart();
  };
});

window.addEventListener('resize', resizeChart);
resizeChart();
