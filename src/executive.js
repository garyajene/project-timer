export function createExecutivePanel({ approve, today }) {
  const panel = document.createElement('details');
  panel.className = 'panel executive-panel';
  panel.innerHTML = `
    <summary>Executive</summary>
    <div class="executive-body">
      <div class="executive-history" role="log" aria-label="Conversation" tabindex="0"></div>
      <section class="executive-suggestions" aria-label="Suggested changes" hidden></section>
      <p class="executive-status helper-text" role="status"></p>
      <form class="executive-form">
        <label>Message<textarea class="text-input" maxlength="4000" rows="3" placeholder="What would you like help planning?"></textarea></label>
        <label class="executive-context"><input type="checkbox"> Include project names and planning settings</label>
        <div class="executive-actions">
          <button type="submit" class="primary">Send</button>
          <button type="button" data-record>Record voice</button>
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
  function controls() {
    send.disabled = Boolean(request || capture || approving);
    recordButton.disabled = Boolean(request || approving || (capture && capture.recorder?.state !== 'recording'));
    cancelButton.hidden = !capture;
    clearButton.disabled = approving;
    suggestions.querySelectorAll('button').forEach((button) => { button.disabled = Boolean(request || capture || approving); });
  }

  async function api(path, options = {}) {
    const response = await fetch('/api/executive/' + path, options);
    const payload = await response.json();
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
    const text = input.value.trim();
    if (!text || request || capture || approving) return;
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
  });

  function stopCapture(discard) {
    const item = capture;
    if (!item) return;
    item.discard = discard;
    clearInterval(item.clock);
    clearTimeout(item.timeout);
    if (item.onHide) document.removeEventListener('visibilitychange', item.onHide);
    if (discard || !item.recorder) capture = null;
    if (item.recorder?.state === 'recording') item.recorder.stop();
    if (discard) item.stream?.getTracks().forEach((track) => track.stop());
    recordButton.textContent = 'Record voice';
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
        clearInterval(item.clock);
        clearTimeout(item.timeout);
        if (item.onHide) document.removeEventListener('visibilitychange', item.onHide);
        capture = null;
        recordButton.textContent = 'Record voice';
        const blob = new Blob(chunks, { type: type.split(';')[0] });
        if (!blob.size) {
          status.textContent = 'No audio was recorded. Try again.';
          controls();
          return;
        }
        process('transcribe', blob, blob.type, 'Transcribing recording…', ({ text }) => {
          input.value = [input.value.trimEnd(), text].filter(Boolean).join(' ').slice(0, 4000);
          status.textContent = 'Review your transcript, then send when ready.';
          if (panel.open && panel.isConnected) input.focus();
        });
      });
      if (document.hidden) return stopCapture(true);
      recorder.start();
      item.onHide = () => { if (document.hidden) stopCapture(true); };
      document.addEventListener('visibilitychange', item.onHide);
      const start = performance.now();
      const update = () => { status.textContent = `Recording · ${Math.floor((performance.now() - start) / 1000)}s / ${limits.audioLimit}s`; };
      item.clock = setInterval(update, 250);
      item.timeout = setTimeout(() => stopCapture(false), limits.audioLimit * 1000 - 250);
      recordButton.textContent = 'Stop recording';
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
  panel.addEventListener('toggle', () => { if (!panel.open) stopCapture(true); });
  return { panel, suspend: () => stopCapture(true), clear };
}
