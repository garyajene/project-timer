export function createExecutivePanel({ approve, today }) {
  const panel = document.createElement('section');
  panel.setAttribute('aria-labelledby', 'executive-heading');
  panel.className = 'panel executive-panel';
  panel.innerHTML = `
    <h2 id="executive-heading">Executive</h2>
    <div class="executive-body">
      <div class="executive-history" role="log" aria-label="Conversation" tabindex="0"></div>
      <section class="executive-suggestions" aria-label="Suggested changes" hidden></section>
      <p class="executive-status helper-text" role="status"></p>
      <form class="executive-form">
        <div class="executive-composer">
          <canvas class="executive-waveform" role="img" aria-label="Live microphone waveform" hidden></canvas>
          <textarea aria-label="Message" maxlength="24000" rows="2" placeholder="What would you like help planning?"></textarea>
          <button type="button" data-record aria-label="Record voice" title="Record voice">
            <svg aria-hidden="true" viewBox="0 0 24 24"><g class="mic-symbol" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="2" width="6" height="13" rx="3"/><path d="M5 11a7 7 0 0 0 14 0m-7 7v4m-4 0h8"/></g><rect class="stop-symbol" x="5" y="5" width="14" height="14" rx="3"/></svg>
          </button>
          <button type="submit" aria-label="Send" title="Send"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 20V4m-7 7 7-7 7 7" fill="none" stroke="currentColor" stroke-width="2"/></svg></button>
        </div>
        <label class="executive-context"><input type="checkbox"> Include project names and planning settings</label>
        <div class="executive-actions">
          <button type="button" data-cancel hidden>Cancel recording</button>
          <button type="button" data-clear>Clear conversation</button>
        </div>
      </form>
    </div>`;
  const find = (selector) => panel.querySelector(selector);
  const input = find('textarea');
  const history = find('.executive-history');
  const suggestions = find('.executive-suggestions');
  const recordButton = find('[data-record]');
  const cancelButton = find('[data-cancel]');
  const clearButton = find('[data-clear]');
  const status = find('.executive-status');
  const send = find('[type=submit]');
  const messages = [];
  let request;
  let capture;
  let approving = false;
  let limits;
  function setRecording(active) {
    const label = active ? 'Stop recording' : 'Record voice';
    recordButton.setAttribute('aria-label', label);
    recordButton.title = label;
    recordButton.classList.toggle('recording', active);
  }
  function controls() {
    const recording = capture?.recorder?.state === 'recording';
    send.disabled = Boolean(request || approving || (capture && !recording));
    send.title = recording ? 'Stop recording and send' : 'Send';
    send.setAttribute('aria-label', send.title);
    recordButton.disabled = Boolean(request || approving || (capture && capture.recorder?.state !== 'recording'));
    cancelButton.hidden = !capture;
    clearButton.hidden = !history.childElementCount && !input.value && !request;
    clearButton.disabled = approving;
    suggestions.querySelectorAll('button').forEach((button) => { button.disabled = Boolean(request || capture || approving); });
  }

  async function api(path, options = {}) {
    const response = await fetch('/api/executive/' + path, options);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || 'Executive is unavailable.');
    return payload;
  }

  function addMessage(role, text) {
    const item = document.createElement('article');
    item.className = 'executive-message executive-' + role;
    const name = document.createElement('strong');
    name.textContent = role === 'user' ? 'You' : 'Executive';
    const message = document.createElement('p');
    message.textContent = text;
    item.append(name, message);
    history.append(item);
    if (history.children.length > 100) history.firstElementChild.remove();
    history.scrollTop = history.scrollHeight;
  }

  function showProposal(items, id) {
    suggestions.replaceChildren();
    suggestions.hidden = !id;
    if (!id) return;
    const heading = document.createElement('h3');
    heading.textContent = 'Review suggested changes';
    const list = document.createElement('ul');
    for (const item of items) {
      const row = document.createElement('li');
      row.textContent = [`${item.action === 'add' ? 'Add' : 'Update'} ${item.name}`,
        item.parent && `Subtask of ${item.parent}`, item.priority && `Priority ${item.priority}`,
        item.minutes && `${item.minutes} min`, item.deadline && `Due ${item.deadline}`].filter(Boolean).join(' · ');
      list.append(row);
    }
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'Approve all';
    const dismiss = document.createElement('button');
    dismiss.type = 'button';
    dismiss.textContent = 'Dismiss';
    const note = document.createElement('p');
    note.className = 'helper-text';
    note.textContent = 'Approval saves these changes to Projects. Use Generate Schedule to place work. Deadlines are planning notes.';
    dismiss.addEventListener('click', () => showProposal([], null));
    button.addEventListener('click', async () => {
      approving = true;
      controls();
      status.textContent = 'Saving approved changes…';
      try {
        await approve(id);
        showProposal([], null);
        status.textContent = 'Changes saved to Projects.';
      } catch (error) {
        status.textContent = error.message;
      } finally {
        approving = false;
        controls();
      }
    });
    const actions = document.createElement('div');
    actions.className = 'executive-actions';
    actions.append(button, dismiss);
    suggestions.append(heading, list, note, actions);
  }

  async function process(path, body, contentType, progress, done, failed) {
    const controller = new AbortController();
    request = controller;
    controls();
    status.textContent = progress;
    try {
      const data = await api(path, { method: 'POST', signal: controller.signal, body,
        headers: { 'Content-Type': contentType, 'X-Executive-Request': crypto.randomUUID() } });
      if (request === controller) {
        status.textContent = '';
        done(data);
      }
    } catch (error) {
      if (request === controller) {
        status.textContent = error.message;
        failed?.();
      }
    } finally {
      if (request === controller) request = null;
      controls();
    }
  }

  find('form').addEventListener('submit', (event) => {
    event.preventDefault();
    if (capture?.recorder?.state === 'recording') {
      capture.sendAfterTranscription = true;
      stopCapture(false);
      return;
    }
    if (!request) sendDraft();
  });

  function sendDraft() {
    const text = input.value.trim();
    if (!text || capture || approving) return;
    if (text.length > 24000) {
      status.textContent = 'Shorten your message to 24,000 characters before sending.';
      return;
    }
    const message = { role: 'user', text };
    input.value = '';
    process('chat', JSON.stringify({ messages: [...messages, message].slice(-(limits?.contextTurns ?? 24)),
      includeProjects: find('[type=checkbox]').checked, today: today() }), 'application/json', 'Executive is thinking…', (data) => {
      const reply = { role: 'assistant', text: data.reply };
      messages.push(message, reply);
      if (messages.length > 24) messages.splice(0, messages.length - 24);
      addMessage(message.role, message.text);
      addMessage(reply.role, reply.text);
      showProposal(data.suggestions, data.proposalId);
    }, () => { if (!input.value) input.value = text; });
  }

  const waveform = find('.executive-waveform');
  function monitorInput(item) {
    const Context = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!Context) return;
    try {
      const pen = waveform.getContext('2d');
      if (!pen) return;
      item.context = new Context();
      const source = item.context.createMediaStreamSource(item.stream);
      const analyser = item.context.createAnalyser();
      source.connect(analyser);
      const samples = new Uint8Array(analyser.fftSize);
      const peaks = [];
      const draw = () => {
        if (item.context.state !== 'running') return;
        input.hidden = true;
        waveform.hidden = false;
        const width = waveform.clientWidth;
        const height = waveform.clientHeight;
        const scale = window.devicePixelRatio || 1;
        if (waveform.width !== Math.round(width * scale)) waveform.width = Math.round(width * scale);
        if (waveform.height !== Math.round(height * scale)) waveform.height = Math.round(height * scale);
        pen.setTransform(scale, 0, 0, scale, 0, 0);
        pen.clearRect(0, 0, width, height);
        analyser.getByteTimeDomainData(samples);
        let peak = 0;
        for (const sample of samples) peak = Math.max(peak, Math.abs(sample - 128) / 128);
        const count = Math.floor(width / 6);
        peaks.push(Math.min(1, peak * 3));
        if (peaks.length > count) peaks.splice(0, peaks.length - count);
        pen.strokeStyle = '#637595';
        pen.lineWidth = 3;
        pen.lineCap = 'round';
        pen.beginPath();
        for (let i = 0; i < count; i++) {
          const amplitude = peaks[i - (count - peaks.length)] || 0;
          const halfHeight = Math.max(.1, amplitude * (height / 2 - 3));
          pen.moveTo(i * 6 + 3, height / 2 - halfHeight);
          pen.lineTo(i * 6 + 3, height / 2 + halfHeight);
        }
        pen.stroke();
      };
      item.waveTimer = setInterval(draw, 60);
      item.context.resume().catch(() => {});
    } catch { /* Recording can continue without an input meter. */ }
  }
  function stopWaveform(item) {
    clearInterval(item.waveTimer);
    item.context?.close().catch(() => {});
    item.context = undefined;
    waveform.hidden = true;
    input.hidden = false;
  }

  function stopCapture(discard) {
    const item = capture;
    if (!item) return;
    item.discard = discard;
    stopWaveform(item);
    clearInterval(item.clock);
    clearTimeout(item.timeout);
    if (item.onHide) document.removeEventListener('visibilitychange', item.onHide);
    if (discard || !item.recorder) capture = null;
    if (item.recorder?.state === 'recording') item.recorder.stop();
    if (discard) item.stream?.getTracks().forEach((track) => track.stop());
    setRecording(false);
    if (!discard) status.textContent = 'Preparing recording…';
    if (discard) status.textContent = '';
    controls();
  }

  recordButton.addEventListener('click', async () => {
    if (capture) return stopCapture(false);
    if (!navigator.mediaDevices?.getUserMedia || !globalThis.MediaRecorder) {
      status.textContent = 'Microphone recording is unavailable in this browser. You can type a message.';
      return;
    }
    const item = {};
    capture = item;
    controls();
    status.textContent = 'Waiting for microphone permission…';
    try {
      limits ??= await api('config');
      if (capture !== item) return;
      item.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (capture !== item) {
        item.stream.getTracks().forEach((track) => track.stop());
        return;
      }
      const type = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus'].find((value) => MediaRecorder.isTypeSupported(value));
      if (!type) throw new Error('This browser has no supported recording format.');
      const recorder = new MediaRecorder(item.stream, { mimeType: type, audioBitsPerSecond: 48000 });
      item.recorder = recorder;
      const chunks = [];
      recorder.addEventListener('dataavailable', ({ data }) => { if (data.size && !item.discard) chunks.push(data); });
      recorder.addEventListener('error', () => {
        if (capture !== item) return;
        stopCapture(true);
        status.textContent = 'Recording failed. Try again or type your message.';
      });
      recorder.addEventListener('stop', () => {
        item.stream.getTracks().forEach((track) => track.stop());
        if (capture !== item || item.discard) return;
        stopWaveform(item);
        clearInterval(item.clock);
        clearTimeout(item.timeout);
        if (item.onHide) document.removeEventListener('visibilitychange', item.onHide);
        capture = null;
        setRecording(false);
        const blob = new Blob(chunks, { type: type.split(';')[0] });
        if (!blob.size) {
          status.textContent = 'No audio was recorded. Try again.';
          controls();
          return;
        }
        process('transcribe', blob, blob.type, 'Transcribing recording…', ({ text }) => {
          input.value = [input.value.trimEnd(), text].filter(Boolean).join(' ');
          if (item.sendAfterTranscription) {
            sendDraft();
            return;
          }
          status.textContent = 'Review your transcript, then send when ready.';
          if (panel.isConnected && !document.hidden) input.focus();
        });
      });
      if (document.hidden) return stopCapture(true);
      recorder.start(1000);
      monitorInput(item);
      item.onHide = () => { if (document.hidden) stopCapture(false); };
      document.addEventListener('visibilitychange', item.onHide);
      const start = performance.now();
      const clock = (seconds) => Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0');
      const update = () => { status.textContent = `Recording · Stop to review or tap Send · ${clock(Math.floor((performance.now() - start) / 1000))} / ${clock(limits.audioLimit)}`; };
      item.clock = setInterval(update, 1000);
      item.timeout = setTimeout(() => stopCapture(false), limits.audioLimit * 1000);
      setRecording(true);
      update();
      controls();
    } catch (error) {
      if (capture !== item) return;
      stopCapture(true);
      status.textContent = error.name === 'NotAllowedError'
        ? 'Microphone permission was denied. Allow access in your browser or type your message.'
        : 'Couldn’t start the microphone. Check your device or type your message.';
    }
  });

  function clear() {
    stopCapture(true);
    request?.abort();
    request = null;
    messages.length = 0;
    input.value = '';
    history.replaceChildren();
    find('[type=checkbox]').checked = false;
    showProposal([], null);
    status.textContent = '';
    controls();
  }
  clearButton.addEventListener('click', clear);
  cancelButton.addEventListener('click', () => stopCapture(true));
  controls();
  return { panel, suspend: () => stopCapture(true), clear };
}
