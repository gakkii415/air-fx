import { AudioEngine } from './audio-engine.js';

const $ = (id) => document.getElementById(id);
const engine = new AudioEngine();
const effectNames = { crush: 'しゃりしゃり', air: 'エアー', filter: 'こもる', gate: 'ぶつ切り', repeat: 'リピート', echo: 'やまびこ' };
const keys = { a: 'crush', s: 'air', d: 'filter', j: 'gate', k: 'repeat', l: 'echo' };
const state = { tracks: [], current: null, loaded: false, loading: false, peaks: null, mode: 'tap', effects: new Set(), loop: true, loadRequest: 0, x: .65, intensity: .6 };
let toastTimer, frameTime = 0, heldPointers = new Map(), heldKeys = new Set(), audioStateBound = false;
const escapeHTML = (value) => String(value).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const formatTime = (seconds) => { const n = Math.max(0, Math.floor(Number(seconds) || 0)); return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`; };
function toast(message) { $('toast').textContent = message; $('toast').classList.add('visible'); clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').classList.remove('visible'), 3700); }
function status(text) { $('system-status').textContent = text; }
function rangeFill(input) { input.style.setProperty('--fill', `${(input.value - input.min) / (input.max - input.min) * 100}%`); }
document.querySelectorAll('input[type=range]').forEach(rangeFill);

function renderTracks() {
  $('track-count').textContent = `${state.tracks.length} TRACKS`;
  $('track-list').innerHTML = state.tracks.map((track, i) => `<button class="track-card ${state.current?.id === track.id ? 'selected' : ''}" data-track="${i}" aria-label="${escapeHTML(track.title)} — ${escapeHTML(track.artist)} を再生" aria-pressed="${state.current?.id === track.id}"><span class="track-art art-${i + 1}" aria-hidden="true"><span class="art-orbit"></span><span class="art-letter">0${i + 1}</span></span><span class="track-details"><strong>${escapeHTML(track.title)}</strong><span class="artist">${escapeHTML(track.artist)}</span><span class="track-meta"><b>${i === 0 ? 'GLITCH HOP' : 'ELECTRONIC'}</b><span>${track.bpm} BPM</span></span></span><span class="track-indicator" aria-hidden="true">▶</span></button>`).join('');
  $('track-list').querySelectorAll('[data-track]').forEach(button => button.addEventListener('click', () => selectTrack(state.tracks[Number(button.dataset.track)])));
}

function showTrack(track) {
  const i = Math.max(0, state.tracks.findIndex(t => t.id === track.id));
  $('now-art').className = `now-art art-${i + 1}`;
  $('now-art').querySelector('.art-letter').textContent = track.local ? 'MY' : `0${i + 1}`;
  $('now-title').textContent = track.title;
  $('now-title').title = track.title;
  $('now-artist').textContent = track.artist;
  $('bpm-number').textContent = track.bpm;
  $('bpm-input').value = track.bpm;
  $('duration').textContent = formatTime(track.duration);
  $('elapsed').textContent = '0:00';
  $('now-label').textContent = track.local ? 'YOUR LOCAL SOUND' : 'READY TO PLAY';
  renderTracks();
}

async function selectTrack(track, input = track.url) {
  // Resume immediately within the gesture, before fetch/decode awaits.
  const ready = engine.init();
  if (engine.context?.state !== 'running') engine.context?.resume().catch(() => {});
  const request = ++state.loadRequest;
  state.loading = true;
  state.loaded = false;
  engine.pause();
  state.current = track;
  state.peaks = null;
  $('play-button').disabled = true;
  showTrack(track);
  $('waveform-empty').textContent = 'LOADING YOUR SOUND…';
  $('waveform-empty').hidden = false;
  $('waveform-empty').style.display = 'flex';
  status('LOADING AUDIO');
  updateTransport();
  drawWaveform();
  try {
    await ready;
    if (!audioStateBound) { engine.context.addEventListener('statechange', updateTransport); audioStateBound = true; }
    const result = await engine.load(input);
    if (request !== state.loadRequest || result.stale) return;
    state.peaks = result.peaks;
    state.loaded = true;
    state.loading = false;
    engine.setBpm(Number($('bpm-input').value));
    engine.setVolume(Number($('volume').value) / 100);
    engine.setMix(Number($('mix').value) / 100);
    engine.setIntensity(state.intensity);
    engine.setXY(state.x, state.intensity);
    $('duration').textContent = formatTime(result.duration);
    $('waveform-empty').style.display = 'none';
    $('play-button').disabled = false;
    await engine.play();
    if (request !== state.loadRequest) return;
    updateTransport();
  } catch (error) {
    if (request !== state.loadRequest) return;
    state.loading = false;
    state.loaded = false;
    $('play-button').disabled = false;
    $('waveform-empty').textContent = 'TAP PLAY TO RETRY';
    status('AUDIO LOAD ERROR');
    toast(error.message || '音源を読み込めませんでした。もう一度お試しください。');
  }
}

function updateTransport() {
  const playing = engine.isPlaying && engine.context?.state === 'running';
  $('play-button').querySelector('use').setAttribute('href', playing ? '#i-pause' : '#i-play');
  $('play-button').setAttribute('aria-label', playing ? '一時停止' : '再生');
  document.body.classList.toggle('is-playing', playing);
  $('now-label').textContent = state.loading ? 'LOADING SOUND…' : playing ? 'NOW PLAYING' : state.loaded ? 'PAUSED / READY' : 'READY TO PLAY';
  if (!state.loading) status(playing ? 'AUDIO RUNNING' : 'SYSTEM READY');
}

async function togglePlay() {
  if (state.loading || !state.current) return;
  if (!state.loaded) return selectTrack(state.current, state.current.file || state.current.url);
  try { if (engine.isPlaying && engine.context?.state !== 'running') await engine.context.resume(); else if (engine.isPlaying) engine.pause(); else await engine.play(); updateTransport(); }
  catch (error) { toast(error.message); }
}
$('play-button').addEventListener('click', togglePlay);
$('loop-button').addEventListener('click', () => { state.loop = !state.loop; $('loop-button').classList.toggle('active', state.loop); $('loop-button').setAttribute('aria-pressed', String(state.loop)); toast(state.loop ? '曲のループ再生 ON' : '曲のループ再生 OFF'); });
engine.onEnded = async () => { if (state.loop) { engine.seek(0); await engine.play(); } updateTransport(); };
$('seek').addEventListener('input', () => { if (state.loaded) { engine.seek(Number($('seek').value) / 1000 * engine.duration); updateTransport(); drawWaveform(); } });
$('volume').addEventListener('input', e => { engine.setVolume(e.target.value / 100); rangeFill(e.target); });
$('mix').addEventListener('input', e => { engine.setMix(e.target.value / 100); $('mix-output').innerHTML = `${e.target.value}<span>%</span>`; rangeFill(e.target); });
$('intensity').addEventListener('input', e => setIntensity(e.target.value / 100));
$('bpm-input').addEventListener('change', e => { const bpm = Math.max(60, Math.min(220, Number(e.target.value) || 128)); e.target.value = bpm; $('bpm-number').textContent = bpm; engine.setBpm(bpm); });

function setIntensity(value) { state.intensity = Math.max(0, Math.min(1, value)); engine.setIntensity(state.intensity); engine.setXY(state.x, state.intensity); $('intensity').value = Math.round(state.intensity * 100); $('intensity-output').innerHTML = `${Math.round(state.intensity * 100)}<span>%</span>`; rangeFill($('intensity')); updateXY(); }
function updateXY() { const left = `${state.x * 100}%`, top = `${(1 - state.intensity) * 100}%`; $('xy-cursor').style.left = left; $('xy-cursor').style.top = top; $('x-line').style.left = left; $('y-line').style.top = top; $('xy-pad').setAttribute('aria-valuenow', Math.round(state.intensity * 100)); $('xy-pad').setAttribute('aria-valuetext', `音色 ${Math.round(state.x * 100)}%、強さ ${Math.round(state.intensity * 100)}%`); }
function moveXY(e) { const rect = $('xy-pad').getBoundingClientRect(); state.x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)); setIntensity(1 - (e.clientY - rect.top) / rect.height); }
let xyPointer = null;
$('xy-pad').addEventListener('pointerdown', e => { xyPointer = e.pointerId; $('xy-pad').setPointerCapture(e.pointerId); moveXY(e); });
$('xy-pad').addEventListener('pointermove', e => { if (xyPointer === e.pointerId) moveXY(e); });
for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) $('xy-pad').addEventListener(event, () => { xyPointer = null; });
$('xy-pad').addEventListener('keydown', e => { if (!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)) return; e.preventDefault(); if (e.key === 'ArrowLeft') state.x = Math.max(0, state.x - .05); if (e.key === 'ArrowRight') state.x = Math.min(1, state.x + .05); setIntensity(state.intensity + (e.key === 'ArrowUp' ? .05 : e.key === 'ArrowDown' ? -.05 : 0)); });

function setEffect(id, on) {
  if (on) state.effects.add(id); else state.effects.delete(id);
  engine.setEffect(id, on);
  const pad = document.querySelector(`[data-effect="${id}"]`);
  pad.classList.toggle('is-active', on);
  pad.setAttribute('aria-pressed', String(on));
  $('active-fx').classList.toggle('has-fx', state.effects.size > 0);
  $('active-fx').innerHTML = `<i></i>${state.effects.size ? `${state.effects.size} EFFECT${state.effects.size > 1 ? 'S' : ''} ACTIVE` : 'エフェクトを選んでみよう'}`;
  if (on && !state.loaded && !state.loading && state.current) selectTrack(state.current, state.current.file || state.current.url);
}
function clearEffects() { heldPointers.clear(); heldKeys.clear(); for (const id of Object.keys(effectNames)) setEffect(id, false); }
$('reset-fx').addEventListener('click', () => { clearEffects(); toast('エフェクトをリセットしました'); });
document.querySelectorAll('[data-mode]').forEach(button => button.addEventListener('click', () => { state.mode = button.dataset.mode; clearEffects(); document.querySelectorAll('[data-mode]').forEach(b => { b.classList.toggle('selected', b === button); b.setAttribute('aria-pressed', String(b === button)); }); toast(state.mode === 'hold' ? '押している間だけエフェクトがかかります' : 'タップでエフェクトの ON / OFF を切り替えます'); }));
document.querySelectorAll('[data-effect]').forEach(pad => {
  pad.addEventListener('click', e => { if (state.mode === 'tap' || e.detail === 0) setEffect(pad.dataset.effect, !state.effects.has(pad.dataset.effect)); });
  pad.addEventListener('keydown', e => { if (state.mode !== 'hold' || !['Space', 'Enter'].includes(e.code)) return; e.preventDefault(); if (!e.repeat) { heldKeys.add(pad.dataset.effect); setEffect(pad.dataset.effect, true); } });
  pad.addEventListener('keyup', e => { if (state.mode !== 'hold' || !['Space', 'Enter'].includes(e.code)) return; e.preventDefault(); heldKeys.delete(pad.dataset.effect); if (![...heldPointers.values()].includes(pad.dataset.effect)) setEffect(pad.dataset.effect, false); });
  pad.addEventListener('blur', () => { if (state.mode === 'hold' && heldKeys.has(pad.dataset.effect)) { heldKeys.delete(pad.dataset.effect); if (![...heldPointers.values()].includes(pad.dataset.effect)) setEffect(pad.dataset.effect, false); } });
  pad.addEventListener('pointerdown', e => { if (state.mode !== 'hold') return; e.preventDefault(); heldPointers.set(e.pointerId, pad.dataset.effect); pad.setPointerCapture(e.pointerId); setEffect(pad.dataset.effect, true); });
  for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) pad.addEventListener(event, e => { const id = heldPointers.get(e.pointerId); if (id) { heldPointers.delete(e.pointerId); if (![...heldPointers.values()].includes(id) && !heldKeys.has(id)) setEffect(id, false); } });
  pad.addEventListener('contextmenu', e => e.preventDefault());
});
function inputFocused(e) { return /INPUT|TEXTAREA|SELECT/.test(e.target.tagName) || e.target.isContentEditable || document.querySelector('dialog[open]'); }
window.addEventListener('keydown', e => { if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || inputFocused(e)) return; const id = keys[e.key.toLowerCase()]; if (id) { e.preventDefault(); if (state.mode === 'hold') { heldKeys.add(id); setEffect(id, true); } else setEffect(id, !state.effects.has(id)); } else if (e.code === 'Space' && e.target.tagName !== 'BUTTON' && e.target.id !== 'xy-pad') { e.preventDefault(); togglePlay(); } });
window.addEventListener('keyup', e => { const id = keys[e.key.toLowerCase()]; if (id && heldKeys.has(id)) { heldKeys.delete(id); if (![...heldPointers.values()].includes(id)) setEffect(id, false); } });
window.addEventListener('blur', () => { if (state.mode === 'hold') clearEffects(); });
document.addEventListener('visibilitychange', () => { if (document.hidden && state.mode === 'hold') clearEffects(); });

$('upload-button').addEventListener('click', () => $('audio-upload').click());
$('audio-upload').addEventListener('change', async e => {
  const file = e.target.files[0]; if (!file) return;
  if (file.size > 100 * 1024 * 1024) { toast('100MB以下の音声ファイルを選んでください。'); e.target.value = ''; return; }
  const track = { id: 'local', title: file.name.replace(/\.[^/.]+$/, ''), artist: 'YOUR LOCAL TRACK', local: true, bpm: 128, duration: 0, file };
  await selectTrack(track, file);
  e.target.value = '';
});

function renderCredits() {
  $('credits-content').innerHTML = state.tracks.map(track => `<article class="credit-item"><h3>${escapeHTML(track.title)} <span>— ${escapeHTML(track.artist)}</span></h3><p>${escapeHTML(track.credit)}</p><a href="${escapeHTML(track.sourceUrl)}" target="_blank" rel="noopener noreferrer">作者・配布元 ↗</a><a href="${escapeHTML(track.licenseUrl)}" target="_blank" rel="noopener noreferrer">${escapeHTML(track.license)} ↗</a></article>`).join('');
}
for (const [button, dialog] of [['help-open','help-dialog'], ['credits-open','credits-dialog'], ['credits-footer','credits-dialog']]) $(button).addEventListener('click', () => $(dialog).showModal());
document.querySelectorAll('dialog').forEach(dialog => { dialog.querySelectorAll('.dialog-close').forEach(button => button.addEventListener('click', () => dialog.close())); dialog.addEventListener('click', e => { if (e.target === dialog) { const rect = dialog.getBoundingClientRect(); if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) dialog.close(); } }); });

const canvas = $('waveform'), ctx = canvas.getContext('2d');
function drawWaveform() {
  const rect = canvas.getBoundingClientRect(), dpr = Math.min(window.devicePixelRatio || 1, 2);
  if (canvas.width !== Math.round(rect.width * dpr) || canvas.height !== Math.round(rect.height * dpr)) { canvas.width = Math.round(rect.width * dpr); canvas.height = Math.round(rect.height * dpr); }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, rect.width, rect.height);
  const ratio = engine.duration ? engine.currentTime / engine.duration : 0;
  const peaks = state.peaks;
  if (peaks) {
    const count = Math.min(peaks.length, Math.floor(rect.width / 3));
    const step = rect.width / count;
    for (let i = 0; i < count; i++) { const peak = peaks[Math.floor(i / count * peaks.length)]; const height = Math.max(2, Math.pow(peak, 1.3) * (rect.height - 20)); ctx.fillStyle = i / count <= ratio ? '#d4fa73' : '#657944'; ctx.fillRect(i * step, (rect.height - height) / 2, Math.max(1, step - 1.4), height); }
  } else { ctx.strokeStyle = '#333e2b'; ctx.beginPath(); ctx.moveTo(10, rect.height / 2); ctx.lineTo(rect.width - 10, rect.height / 2); ctx.stroke(); }
  $('playhead').style.opacity = peaks ? '1' : '0'; $('playhead').style.left = `${ratio * 100}%`;
}
new ResizeObserver(drawWaveform).observe(canvas);
function frame(time) { if (time - frameTime > 45 && !document.hidden) { frameTime = time; if (state.loaded) { $('elapsed').textContent = formatTime(engine.currentTime); $('seek').value = engine.duration ? engine.currentTime / engine.duration * 1000 : 0; if (engine.isPlaying) drawWaveform(); } } requestAnimationFrame(frame); }
requestAnimationFrame(frame);

try {
  const response = await fetch('./tracks.json'); if (!response.ok) throw new Error('ライブラリを読み込めませんでした。');
  state.tracks = await response.json(); state.current = state.tracks[0]; showTrack(state.current); renderCredits(); $('play-button').disabled = false;
  $('waveform-empty').textContent = 'TAP PLAY TO START';
} catch (error) { $('track-list').textContent = '音源一覧を読み込めませんでした。ページを再読み込みしてください。自分の曲は読み込めます。'; toast(error.message); }
engine.setMix(.75); engine.setIntensity(.6); engine.setXY(.65, .6);
// Local diagnostics for playback/DSP verification. Audio files are never uploaded.
window.__airfx = { engine, state };
