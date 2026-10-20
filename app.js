import { AudioEngine } from './audio-engine.js?v=4';

const $ = id => document.getElementById(id);
const engine = new AudioEngine();
const effectNames = { crush: 'しゃりしゃり', air: 'エアー', filter: 'こもる', gate: 'ぶつ切り', repeat: 'リピート', echo: 'やまびこ' };
const parameters = {
  crush: { name: '音の粗さ', low: '細かい', high: '粗い' },
  air: { name: 'うねり', low: 'ゆっくり', high: '速い' },
  filter: { name: '音の明るさ', low: 'こもる', high: 'ひらく' },
  gate: { name: '刻みの速さ', low: 'ゆったり', high: '細かく' },
  repeat: { name: 'リピート幅', low: '長い', high: '短い' },
  echo: { name: '音の間隔', low: '長い', high: '短い' },
};
const keys = { a: 'crush', s: 'air', d: 'filter', j: 'gate', k: 'repeat', l: 'echo' };
const state = { tracks: [], current: null, loaded: false, loading: false, peaks: null, mode: 'hold', effects: new Set(), loop: true, loadRequest: 0, intensity: 1, selectedEffect: 'air', params: Object.fromEntries(Object.keys(effectNames).map(id => [id, .5])) };
const heldPointers = new Map(), heldKeys = new Map();
let toastTimer, frameTime = 0, boundAudioContext = null;
const clamp = n => Math.max(0, Math.min(1, Number(n) || 0));
const escapeHTML = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const formatTime = s => { const n = Math.max(0, Math.floor(Number(s) || 0)); return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`; };
function toast(message) { $('toast').textContent = message; $('toast').classList.add('visible'); clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').classList.remove('visible'), 3000); }
function status(text) { $('system-status').textContent = text; }
function rangeFill(input) { input.style.setProperty('--fill', `${(input.value - input.min) / (input.max - input.min) * 100}%`); }
function showPlaybackNotice(message, retry = false) { $('playback-notice-text').textContent = message; $('retry-play').hidden = !retry; $('playback-notice').hidden = false; }
function clearPlaybackNotice() { if (engine.getDiagnostics().fallbackReason) showPlaybackNotice('簡易モード：エアー・こもる・やまびこが使えます。'); else $('playback-notice').hidden = true; }
function syncAudioCapabilities() {
  const available = new Set(engine.availableEffects);
  document.querySelectorAll('[data-effect]').forEach(pad => { const supported = available.has(pad.dataset.effect); pad.disabled = !supported; pad.title = supported ? '' : 'このブラウザでは、このエフェクトを使えません。'; if (!supported && state.effects.has(pad.dataset.effect)) setEffect(pad.dataset.effect, false); });
  if (!available.has(state.selectedEffect)) selectParameter('air');
  clearPlaybackNotice();
}
engine.onCapabilitiesChanged = syncAudioCapabilities;

function renderTracks() {
  $('track-count').textContent = state.tracks.length;
  $('track-list').innerHTML = state.tracks.map((track, i) => `<button class="track-card ${state.current?.id === track.id ? 'selected' : ''}" data-track="${i}" aria-pressed="${state.current?.id === track.id}" aria-label="${escapeHTML(track.title)}、${escapeHTML(track.artist)} を再生"><strong>${escapeHTML(track.title)}</strong><span class="artist">${escapeHTML(track.artist)}</span><span class="track-meta">${track.bpm} BPM · ${formatTime(track.duration)}</span><span class="track-indicator" aria-hidden="true"></span></button>`).join('');
  $('track-list').querySelectorAll('[data-track]').forEach(button => button.addEventListener('click', () => { selectTrack(state.tracks[Number(button.dataset.track)]); $('tracks-dialog').close(); }));
}
function showTrack(track) {
  const i = Math.max(0, state.tracks.findIndex(t => t.id === track.id));
  $('now-art').className = `now-art art-${i % 3 + 1}`;
  $('now-art').querySelector('.art-letter').textContent = track.local ? 'MY' : String(i + 1).padStart(2, '0');
  $('now-title').textContent = track.title; $('now-title').title = track.title;
  $('now-artist').textContent = track.artist;
  $('bpm-number').textContent = track.bpm; $('bpm-input').value = track.bpm;
  $('duration').textContent = formatTime(track.duration); $('elapsed').textContent = '0:00';
  renderTracks();
}
async function selectTrack(track, input = track.file || track.url) {
  const ready = engine.init(); // Resume within the actual user gesture.
  const request = ++state.loadRequest;
  state.loading = true; state.loaded = false; state.peaks = null; state.current = track;
  engine.pause(); $('play-button').disabled = true; showTrack(track);
  $('waveform-empty').textContent = '音源を読み込み中…'; $('waveform-empty').style.display = 'flex';
  clearPlaybackNotice(); updateTransport(); drawWaveform();
  try {
    await ready;
    if (boundAudioContext !== engine.context) { boundAudioContext = engine.context; engine.context.addEventListener('statechange', updateTransport); }
    syncAudioCapabilities();
    const result = await engine.load(input);
    if (request !== state.loadRequest || result.stale) return;
    state.loaded = true; state.loading = false; state.peaks = result.peaks;
    engine.setBpm(Number($('bpm-input').value)); engine.setVolume(Number($('volume').value) / 100); engine.setMix(Number($('mix').value) / 100); engine.setIntensity(1);
    $('duration').textContent = formatTime(result.duration); $('waveform-empty').style.display = 'none'; $('play-button').disabled = false;
    updateTransport(); await engine.play();
    if (request !== state.loadRequest) return;
    clearPlaybackNotice(); updateTransport();
  } catch (error) {
    if (request !== state.loadRequest) return;
    state.loading = false; $('play-button').disabled = false;
    if (!state.loaded) $('waveform-empty').textContent = '再生ボタンでもう一度試せます';
    updateTransport(); status('TAP PLAY TO RETRY'); showPlaybackNotice(error.message || '再生を開始できませんでした。', true);
  }
}
function updateTransport() {
  const playing = engine.isPlaying && engine.context?.state === 'running';
  $('play-button').querySelector('use').setAttribute('href', playing ? '#i-pause' : '#i-play');
  $('play-button').setAttribute('aria-label', playing ? '一時停止' : '再生');
  document.body.classList.toggle('is-playing', playing);
  $('now-label').textContent = state.loading ? 'LOADING SOUND…' : playing ? 'NOW PLAYING' : state.loaded ? 'PAUSED / READY' : 'READY TO PLAY';
  status(state.loading ? 'LOADING AUDIO' : playing ? 'AUDIO RUNNING' : 'SYSTEM READY');
}
async function togglePlay() {
  if (state.loading || !state.current) return;
  if (!state.loaded) return selectTrack(state.current);
  try { if (engine.isPlaying && engine.context?.state === 'running') engine.pause(); else await engine.play(); clearPlaybackNotice(); updateTransport(); }
  catch (error) { updateTransport(); showPlaybackNotice(error.message || '再生ボタンをもう一度タップしてください。', true); }
}
$('play-button').addEventListener('click', togglePlay); $('retry-play').addEventListener('click', togglePlay);
$('loop-button').addEventListener('click', () => { state.loop = !state.loop; $('loop-button').classList.toggle('active', state.loop); $('loop-button').setAttribute('aria-pressed', String(state.loop)); toast(state.loop ? '曲のループ ON' : '曲のループ OFF'); });
engine.onEnded = async () => { try { if (state.loop) { engine.seek(0); await engine.play(); } updateTransport(); } catch (error) { updateTransport(); showPlaybackNotice(error.message, true); } };
$('seek').addEventListener('input', () => { if (state.loaded) { engine.seek(Number($('seek').value) / 1000 * engine.duration); updateTransport(); drawWaveform(); } });
$('volume').addEventListener('input', e => { engine.setVolume(e.target.value / 100); rangeFill(e.target); });
$('mix').addEventListener('input', e => { engine.setMix(e.target.value / 100); $('mix-output').textContent = `${e.target.value}%`; rangeFill(e.target); });
$('bpm-input').addEventListener('change', e => { const bpm = Math.max(60, Math.min(220, Number(e.target.value) || 128)); e.target.value = bpm; $('bpm-number').textContent = bpm; engine.setBpm(bpm); });

function selectParameter(id) { state.selectedEffect = id; updateParameterUI(); }
function updateParameterUI() {
  const id = state.selectedEffect, meta = parameters[id], value = Math.round(state.params[id] * 100), pad = document.querySelector(`[data-effect="${id}"]`);
  $('parameter-label').innerHTML = `${effectNames[id]} <span>/ ${meta.name}</span>`;
  $('parameter-output').textContent = value; $('parameter').value = value;
  $('parameter').setAttribute('aria-label', `${effectNames[id]}の${meta.name}`);
  $('parameter-low').textContent = meta.low; $('parameter-high').textContent = meta.high;
  document.querySelector('.parameter-strip').style.setProperty('--fx', pad.style.getPropertyValue('--fx'));
  document.querySelectorAll('[data-effect]').forEach(p => p.classList.toggle('parameter-selected', p === pad)); rangeFill($('parameter'));
}
function setParameter(id, value) {
  state.params[id] = clamp(value); engine.setEffectParameter(id, state.params[id]);
  const pad = document.querySelector(`[data-effect="${id}"]`), number = Math.round(state.params[id] * 100);
  pad.style.setProperty('--param', `${number}%`); pad.querySelector('.pad-parameter output').textContent = number;
  if (state.selectedEffect === id) updateParameterUI();
}
$('parameter').addEventListener('input', e => setParameter(state.selectedEffect, e.target.value / 100));
function setEffect(id, on) {
  if (on && !engine.availableEffects.includes(id)) return;
  if (on) state.effects.add(id); else state.effects.delete(id);
  engine.setEffect(id, on);
  const pad = document.querySelector(`[data-effect="${id}"]`); pad.classList.toggle('is-active', on); pad.setAttribute('aria-pressed', String(on));
  $('active-fx').classList.toggle('has-fx', state.effects.size > 0);
  $('active-fx').innerHTML = `<i></i>${state.effects.size ? `${state.effects.size} EFFECT${state.effects.size > 1 ? 'S' : ''} ACTIVE` : state.mode === 'hold' ? '押している間だけ ON' : 'タップで ON / OFF'}`;
  if (on && !state.loaded && !state.loading && state.current) selectTrack(state.current);
}
function isHeld(id) { return [...heldPointers.values()].some(p => p.effect === id) || [...heldKeys.values()].includes(id); }
function clearEffects(resetParameters = false) { heldPointers.clear(); heldKeys.clear(); for (const id of Object.keys(effectNames)) { setEffect(id, false); if (resetParameters) setParameter(id, .5); } }
function releaseHeld() { if (state.mode === 'hold') clearEffects(); else { heldPointers.clear(); heldKeys.clear(); } }
$('reset-fx').addEventListener('click', () => { clearEffects(true); toast('エフェクトと横パラメータをリセットしました'); });
document.querySelectorAll('[data-mode]').forEach(button => button.addEventListener('click', () => { clearEffects(); state.mode = button.dataset.mode; document.querySelectorAll('[data-mode]').forEach(b => { b.classList.toggle('selected', b === button); b.setAttribute('aria-pressed', String(b === button)); }); setEffect('crush', false); toast(state.mode === 'hold' ? '押している間だけ ON。左右へ動かして音を変えられます。' : 'タップで ON / OFF。押したまま左右に動かすと音が変わります。'); }));

function releasePointer(pad, e, cancelled = false) {
  const info = heldPointers.get(e.pointerId); if (!info) return;
  heldPointers.delete(e.pointerId);
  if (info.mode === 'hold') { if (!isHeld(info.effect)) setEffect(info.effect, false); }
  else if (!cancelled && !info.dragged) setEffect(info.effect, !state.effects.has(info.effect));
  else if (cancelled && info.dragged && !info.wasActive) setEffect(info.effect, false);
  try { if (pad.hasPointerCapture(e.pointerId)) pad.releasePointerCapture(e.pointerId); } catch { /* already released */ }
}
for (const pad of document.querySelectorAll('[data-effect]')) {
  const id = pad.dataset.effect;
  pad.setAttribute('aria-label', `${effectNames[id]}。長押しでオン、左右に動かして${parameters[id].name}を調整`);
  pad.addEventListener('pointerdown', e => {
    if (pad.disabled || (e.pointerType === 'mouse' && e.button !== 0)) return;
    e.preventDefault(); selectParameter(id);
    heldPointers.set(e.pointerId, { effect: id, startX: e.clientX, startValue: state.params[id], width: Math.max(70, pad.getBoundingClientRect().width), mode: state.mode, dragged: false, wasActive: state.effects.has(id) });
    try { pad.setPointerCapture(e.pointerId); } catch { /* synthetic or cancelled pointer */ }
    if (state.mode === 'hold') setEffect(id, true);
  });
  pad.addEventListener('pointermove', e => {
    const info = heldPointers.get(e.pointerId); if (!info || info.effect !== id) return;
    if (e.cancelable) e.preventDefault();
    const dx = e.clientX - info.startX;
    if (Math.abs(dx) > 3) info.dragged = true;
    if (info.dragged) { if (info.mode === 'tap' && !state.effects.has(id)) setEffect(id, true); selectParameter(id); setParameter(id, info.startValue + dx / info.width); }
  });
  pad.addEventListener('pointerup', e => { if (e.cancelable) e.preventDefault(); releasePointer(pad, e); });
  for (const event of ['pointercancel', 'lostpointercapture']) pad.addEventListener(event, e => releasePointer(pad, e, true));
  pad.addEventListener('click', e => { if (e.detail === 0 && !e.pointerType && !pad.disabled) { selectParameter(id); setEffect(id, !state.effects.has(id)); } });
  pad.addEventListener('contextmenu', e => e.preventDefault());
  pad.addEventListener('keydown', e => {
    if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') { e.preventDefault(); selectParameter(id); setParameter(id, state.params[id] + (e.code === 'ArrowLeft' ? -.05 : .05)); return; }
    if (!['Space', 'Enter'].includes(e.code)) return;
    e.preventDefault(); if (e.repeat) return; selectParameter(id);
    if (state.mode === 'hold') { heldKeys.set(`pad:${e.code}:${id}`, id); setEffect(id, true); } else setEffect(id, !state.effects.has(id));
  });
  pad.addEventListener('keyup', e => { const token = `pad:${e.code}:${id}`; if (heldKeys.has(token)) { e.preventDefault(); heldKeys.delete(token); if (!isHeld(id)) setEffect(id, false); } });
  pad.addEventListener('blur', () => { for (const token of [...heldKeys.keys()]) if (token.startsWith('pad:') && heldKeys.get(token) === id) heldKeys.delete(token); if (state.mode === 'hold' && !isHeld(id)) setEffect(id, false); });
}
// Keep two independent fingers as two pad controls, including Safari's gesture path.
function onPerformanceTouch(e) {
  if (e.touches.length < 2) return;
  const performanceTouch = heldPointers.size > 0 || [...e.touches].some(t => t.target instanceof Element && t.target.closest('.deck'));
  if (performanceTouch && e.cancelable) e.preventDefault();
}
for (const event of ['touchstart', 'touchmove']) document.addEventListener(event, onPerformanceTouch, { passive: false, capture: true });
for (const event of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(event, e => { if (heldPointers.size || (e.target instanceof Element && e.target.closest('.deck'))) { if (e.cancelable) e.preventDefault(); } }, { passive: false, capture: true });
function inputFocused(e) { return /INPUT|TEXTAREA|SELECT/.test(e.target.tagName) || e.target.isContentEditable || document.querySelector('dialog[open]'); }
window.addEventListener('keydown', e => { if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || inputFocused(e)) return; const id = keys[e.key.toLowerCase()]; if (id) { e.preventDefault(); selectParameter(id); if (state.mode === 'hold') { heldKeys.set(`key:${e.key.toLowerCase()}`, id); setEffect(id, true); } else setEffect(id, !state.effects.has(id)); } else if (e.code === 'Space' && e.target.tagName !== 'BUTTON') { e.preventDefault(); togglePlay(); } });
window.addEventListener('keyup', e => { const token = `key:${e.key.toLowerCase()}`, id = heldKeys.get(token); if (id) { heldKeys.delete(token); if (!isHeld(id)) setEffect(id, false); } });
window.addEventListener('blur', releaseHeld); document.addEventListener('visibilitychange', () => { if (document.hidden) releaseHeld(); });

function openDialog(id) { releaseHeld(); $(id).showModal(); }
for (const [button, dialog] of [['tracks-open', 'tracks-dialog'], ['settings-open', 'settings-dialog'], ['help-open', 'help-dialog'], ['credits-footer', 'credits-dialog']]) $(button).addEventListener('click', () => openDialog(dialog));
for (const dialog of document.querySelectorAll('dialog')) { dialog.querySelectorAll('.dialog-close').forEach(b => b.addEventListener('click', () => dialog.close())); dialog.addEventListener('click', e => { if (e.target !== dialog) return; const r = dialog.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) dialog.close(); }); }
$('upload-button').addEventListener('click', () => $('audio-upload').click());
$('upload-dialog-button').addEventListener('click', () => { $('tracks-dialog').close(); $('audio-upload').click(); });
$('audio-upload').addEventListener('change', async e => { const file = e.target.files[0]; if (!file) return; if (file.size > 100 * 1024 * 1024) { toast('100MB以下の音声ファイルを選んでください。'); e.target.value = ''; return; } await selectTrack({ id: 'local', title: file.name.replace(/\.[^/.]+$/, ''), artist: 'YOUR LOCAL TRACK', local: true, bpm: 128, duration: 0, file }); e.target.value = ''; });
function renderCredits() { $('credits-content').innerHTML = state.tracks.map(t => `<article class="credit-item" title="${escapeHTML(t.credit)}"><h3>${escapeHTML(t.title)}</h3><p>${escapeHTML(t.artist)}</p><a class="credit-license" href="${escapeHTML(t.licenseUrl)}" target="_blank" rel="noopener noreferrer">${escapeHTML(t.license)}</a><a href="${escapeHTML(t.sourceUrl)}" target="_blank" rel="noopener noreferrer">配布元 ↗</a></article>`).join(''); }

const canvas = $('waveform'), ctx = canvas.getContext('2d');
function drawWaveform() {
  const rect = canvas.getBoundingClientRect(), dpr = Math.min(devicePixelRatio || 1, 2);
  if (canvas.width !== Math.round(rect.width * dpr) || canvas.height !== Math.round(rect.height * dpr)) { canvas.width = Math.round(rect.width * dpr); canvas.height = Math.round(rect.height * dpr); }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, rect.width, rect.height);
  const ratio = engine.duration ? engine.currentTime / engine.duration : 0;
  if (state.peaks) { const count = Math.min(state.peaks.length, Math.floor(rect.width / 3)), step = rect.width / count; for (let i = 0; i < count; i++) { const height = Math.max(2, Math.pow(state.peaks[Math.floor(i / count * state.peaks.length)], 1.3) * (rect.height - 10)); ctx.fillStyle = i / count <= ratio ? '#d4fa73' : '#688447'; ctx.fillRect(i * step, (rect.height - height) / 2, Math.max(1, step - 1.4), height); } }
  else { ctx.strokeStyle = '#35432a'; ctx.beginPath(); ctx.moveTo(10, rect.height / 2); ctx.lineTo(rect.width - 10, rect.height / 2); ctx.stroke(); }
  $('playhead').style.opacity = state.peaks ? '1' : '0'; $('playhead').style.left = `${ratio * 100}%`;
}
new ResizeObserver(drawWaveform).observe(canvas);
function frame(time) { if (time - frameTime > 45 && !document.hidden) { frameTime = time; if (state.loaded) { $('elapsed').textContent = formatTime(engine.currentTime); $('seek').value = engine.duration ? engine.currentTime / engine.duration * 1000 : 0; if (engine.isPlaying) drawWaveform(); } } requestAnimationFrame(frame); }
requestAnimationFrame(frame);
for (const input of document.querySelectorAll('input[type=range]')) rangeFill(input);
engine.setIntensity(1); engine.setMix(.75);
for (const id of Object.keys(effectNames)) setParameter(id, .5);
updateParameterUI();
try { const r = await fetch('./tracks.json?v=4'); if (!r.ok) throw new Error('音源一覧を読み込めませんでした。'); state.tracks = await r.json(); state.current = state.tracks[0]; showTrack(state.current); renderCredits(); $('play-button').disabled = false; }
catch (error) { $('track-list').textContent = '音源一覧を読み込めませんでした。自分の曲は読み込めます。'; showPlaybackNotice(error.message); }
window.__airfx = { engine, state, heldPointers };
