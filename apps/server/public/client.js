// Plain browser harness for the WebRTC media-path milestone. No build step.
// Later replaced by the real @voice/web-sdk VoiceSession.

const $ = (id) => document.getElementById(id);
const log = (msg) => {
  $('log').textContent += msg + '\n';
  $('log').scrollTop = $('log').scrollHeight;
};

let pc;
let control;
let sessionId;
let localStream;

const sendEvent = (payload) => control.send(JSON.stringify({ kind: 'event', payload }));

function setConnectedUi(on) {
  $('connect').textContent = on ? 'Disconnect' : 'Connect';
  $('connect').disabled = false;
  $('interrupt').disabled = !on;
}

async function connect() {
  $('conn').textContent = 'connecting…';
  $('connect').disabled = true;

  localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  pc = new RTCPeerConnection();
  for (const track of localStream.getAudioTracks()) pc.addTrack(track, localStream);

  pc.ontrack = (e) => {
    $('remote').srcObject = e.streams[0];
    log('▶ remote audio attached (you should hear yourself echoed)');
  };
  pc.onconnectionstatechange = () => {
    $('conn').textContent = pc.connectionState;
    log('connection: ' + pc.connectionState);
    if (pc.connectionState === 'failed' || pc.connectionState === 'closed') disconnect();
  };

  control = pc.createDataChannel('control');
  control.onopen = () => {
    log('control channel open');
    // Begin the voice-session lifecycle on top of the transport (what the old
    // "Start session" button did) — one step now.
    sendEvent({ type: 'session.start', sessionId });
    log('➡ session.start');
    setConnectedUi(true);
  };
  control.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.kind === 'event') log('⬅ ' + JSON.stringify(msg.payload));
  };

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
  log('answer applied; session ' + sessionId);
}

function disconnect() {
  if (control) control.close();
  if (pc) pc.close();
  if (localStream) for (const t of localStream.getTracks()) t.stop();
  pc = undefined;
  control = undefined;
  localStream = undefined;
  $('remote').srcObject = null;
  $('conn').textContent = 'idle';
  log('disconnected');
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
