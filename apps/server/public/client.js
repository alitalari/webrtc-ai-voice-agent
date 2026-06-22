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

async function connect() {
  $('conn').textContent = 'connecting…';
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

  pc = new RTCPeerConnection();
  for (const track of stream.getAudioTracks()) pc.addTrack(track, stream);

  pc.ontrack = (e) => {
    $('remote').srcObject = e.streams[0];
    log('▶ remote audio track attached (you should hear yourself echoed)');
  };
  pc.onconnectionstatechange = () => {
    $('conn').textContent = pc.connectionState;
    log('connection: ' + pc.connectionState);
  };

  control = pc.createDataChannel('control');
  control.onopen = () => {
    log('control channel open');
    $('start').disabled = false;
    $('turn').disabled = false;
    $('interrupt').disabled = false;
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

function waitIceComplete(pc) {
  return new Promise((resolve) => {
    if (pc.iceGatheringState === 'complete') return resolve();
    pc.addEventListener('icegatheringstatechange', () => {
      if (pc.iceGatheringState === 'complete') resolve();
    });
  });
}

const sendEvent = (payload) => control.send(JSON.stringify({ kind: 'event', payload }));
const sendVad = (speech, timestampMs) =>
  control.send(JSON.stringify({ kind: 'vad', payload: { speech, timestampMs } }));

$('connect').onclick = () => connect().catch((e) => log('error: ' + e.message));
$('start').onclick = () => {
  sendEvent({ type: 'session.start', sessionId });
  log('➡ session.start');
};
$('interrupt').onclick = () => {
  sendEvent({ type: 'agent.interrupt', sessionId, reason: 'manual' });
  log('➡ agent.interrupt');
};

// Simulate a turn: ~300ms of "speech" then >600ms of "silence" to trigger an endpoint.
$('turn').onclick = () => {
  log('➡ simulating a turn (VAD)');
  let t = 0;
  for (; t <= 300; t += 20) sendVad(true, t);
  for (; t <= 1100; t += 20) sendVad(false, t);
};
