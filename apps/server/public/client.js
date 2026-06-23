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

const turnBars = []; // each: { ttft, gen, tts }
let turns = 0;
let partialEl = null;
let agentEl = null;

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

  const maxMs = 2000; // y-axis to 2s
  const yFor = (ms) => H - (ms / maxMs) * H;
  const axisX = 30;

  // gridlines + labels every 0.5s
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

  // budget line at 1.1s
  const by = yFor(1100);
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
      // Sentences stream in; append them to one agent line for the turn.
      if (!agentEl) {
        agentEl = document.createElement('div');
        agentEl.className = 'final';
        agentEl.innerHTML = '<b style="color:#3ad29f">agent:</b> ';
        $('transcript').appendChild(agentEl);
      }
      agentEl.appendChild(document.createTextNode(e.text + ' '));
      $('transcript').scrollTop = $('transcript').scrollHeight;
      break;
    case 'agent.response.started':
      setSession('speaking');
      break;
    case 'agent.response.completed':
      agentEl = null; // next turn starts a fresh agent line
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
