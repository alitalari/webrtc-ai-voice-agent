// Demo harness for the AI Voice SDK. Plain browser JS, served static (no build).
// Later replaced by the real @voice/web-sdk VoiceSession.

const $ = (id) => document.getElementById(id);
const log = (msg) => {
  const el = $('log');
  el.textContent += msg + '\n';
  el.scrollTop = el.scrollHeight;
};

let pc;
let control;
let sessionId;
let localStream;

const latencies = [];
let turns = 0;
let partialEl = null;

const sendEvent = (payload) => control.send(JSON.stringify({ kind: 'event', payload }));
const sendConfig = (payload) => control && control.send(JSON.stringify({ kind: 'config', payload }));

function setConn(state) {
  $('conn').textContent = state;
  $('d-conn').textContent = state;
  $('conn').className = 'pill' + (state === 'connected' ? ' on' : '');
}

function setSession(state) {
  $('sess').textContent = state;
  $('d-sess').textContent = state;
  $('sess').className = 'pill' + (state === 'speaking' ? ' warn' : state === 'listening' ? ' on' : '');
}

function setConnectedUi(on) {
  $('connect').textContent = on ? 'Disconnect' : 'Connect';
  $('connect').disabled = false;
  $('interrupt').disabled = !on;
}

// --- transcript ---
function showPartial(text) {
  if (!partialEl) {
    partialEl = document.createElement('div');
    partialEl.className = 'partial';
    $('transcript').appendChild(partialEl);
  }
  partialEl.textContent = '… ' + text;
  $('transcript').scrollTop = $('transcript').scrollHeight;
}
function commitLine(who, text, color) {
  if (who === 'you' && partialEl) {
    partialEl.remove();
    partialEl = null;
  }
  const el = document.createElement('div');
  el.className = 'final';
  el.innerHTML = `<b style="color:${color}">${who}:</b> `;
  el.appendChild(document.createTextNode(text));
  $('transcript').appendChild(el);
  $('transcript').scrollTop = $('transcript').scrollHeight;
}

// --- latency chart ---
function drawChart() {
  const c = $('chart');
  const ctx = c.getContext('2d');
  const W = c.width;
  const H = c.height;
  ctx.clearRect(0, 0, W, H);

  const budget = 1100;
  const max = Math.max(1200, ...latencies);
  const by = H - (budget / max) * H;
  ctx.strokeStyle = '#f5a623';
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(0, by);
  ctx.lineTo(W, by);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = '#f5a623';
  ctx.font = '11px system-ui';
  ctx.fillText('budget ' + budget + 'ms', 6, by - 4);

  const bw = 34;
  const visible = latencies.slice(-Math.floor(W / (bw + 8)));
  visible.forEach((v, i) => {
    const x = i * (bw + 8) + 8;
    const h = (v / max) * H;
    const y = H - h;
    ctx.fillStyle = v <= budget ? '#3ad29f' : '#ff6b6b';
    ctx.fillRect(x, y, bw, h);
    ctx.fillStyle = '#e6e9ef';
    ctx.font = '10px system-ui';
    ctx.fillText(Math.round(v), x, y - 4);
  });
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
      commitLine('you', e.text, '#4f8cff');
      break;
    case 'agent.response.text':
      commitLine('agent', e.text, '#3ad29f');
      break;
    case 'agent.response.started':
      setSession('speaking');
      break;
    case 'agent.response.completed':
      setSession('listening');
      break;
    case 'agent.interrupted':
      setSession('listening');
      break;
    case 'metrics.latency':
      if (typeof e.metrics.endToEndTurnMs === 'number') {
        latencies.push(e.metrics.endToEndTurnMs);
        turns += 1;
        $('d-turns').textContent = turns;
        drawChart();
      }
      break;
  }
}

// --- connection ---
async function connect() {
  setConn('connecting…');
  $('connect').disabled = true;

  localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  pc = new RTCPeerConnection();
  for (const track of localStream.getAudioTracks()) pc.addTrack(track, localStream);

  pc.ontrack = (e) => {
    $('remote').srcObject = e.streams[0];
  };
  pc.onconnectionstatechange = () => {
    setConn(pc.connectionState);
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
  await waitIceComplete(pc);

  const resp = await fetch('/session', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ offer: pc.localDescription.sdp }),
  });
  const { answer, sessionId: sid } = await resp.json();
  sessionId = sid;
  await pc.setRemoteDescription({ type: 'answer', sdp: answer });
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

function waitIceComplete(peer) {
  return new Promise((resolve) => {
    if (peer.iceGatheringState === 'complete') return resolve();
    peer.addEventListener('icegatheringstatechange', () => {
      if (peer.iceGatheringState === 'complete') resolve();
    });
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

for (const id of ['asr', 'llm', 'tts']) {
  $(id).onchange = () => {
    $('d-prov').textContent = `${$('asr').value} · ${$('llm').value} · ${$('tts').value}`;
    sendConfig({ asr: $('asr').value, llm: $('llm').value, tts: $('tts').value });
  };
}

drawChart();
