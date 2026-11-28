import { setTimeout as delay } from 'node:timers/promises';

const api = 'https://api.replicate.com/v1';
export const LUNA = 'openai/gpt-5.6-luna';
export const WHISPER = 'vaibhavs10/incredibly-fast-whisper';

async function validationReason(response) {
  const problem = await response.json().catch(() => null);
  // Validation errors can echo the submitted input. Only return known descriptions.
  const issues = Array.isArray(problem?.detail) ? problem.detail : [];
  const detail = [problem?.title, problem?.detail, ...issues.map(issue =>
    [Array.isArray(issue?.loc) ? issue.loc.join('.') : '', issue?.msg].join(' ')
  )].filter(value => typeof value === 'string').join(' ');
  if (/invalid version or not permitted|does not exist.*permission/i.test(detail))
    return 'Replicate says the model version is unavailable or this account cannot use it.';
  if (/\bversion\b/i.test(detail)) return 'Replicate rejected the configured model version.';
  if (/\baudio\b/i.test(detail)) {
    if (/required|missing/i.test(detail)) return 'Replicate says the required audio file is missing.';
    if (/uri|url/i.test(detail)) return 'Replicate rejected the file address supplied for the recording.';
    return 'Replicate rejected the recording supplied in the audio field.';
  }
  return 'Replicate rejected the request. The app could not identify the field from its response.';
}

export function replicateClient(token, fetcher = fetch) {
  return async (model, input, timeout, recordId) => {
    const match = /^([\w-]+\/[\w.-]+)(?::([a-f0-9]{64}))?$/.exec(model);
    if (!token || !match) throw new Error('Provider configuration unavailable');
    const [, name, configuredVersion] = match;
    const signal = AbortSignal.timeout(timeout);
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    async function call(path, options) {
      const response = await fetcher(api + path, { headers, signal, redirect: 'error', ...options });
      if (!response.ok) {
        const reasons = {
          401: 'Replicate rejected the service credential.',
          402: 'Replicate requires billing credit before it can process requests.',
          403: 'Replicate denied access to the configured model.',
          404: 'The configured Replicate model or prediction is unavailable.',
          422: 'Replicate rejected the model input or version.',
          429: 'Replicate is rate limiting requests. Try again shortly.',
        };
        if (response.status === 422) reasons[422] = await validationReason(response);
        console.warn('Executive provider request failed', { model, httpStatus: response.status, reason: reasons[response.status] });
        throw Object.assign(new Error(reasons[response.status] || 'Replicate is temporarily unavailable.'), {
          status: response.status === 429 ? 429 : 502,
        });
      }
      return response.json();
    }
    let id;
    try {
      let version = configuredVersion;
      if (!version && name === WHISPER) {
        const metadata = await call(`/models/${name}`, { method: 'GET' });
        version = metadata.latest_version?.id;
        if (typeof version !== 'string' || !/^[a-f0-9]{64}$/.test(version)) {
          throw Object.assign(new Error('Replicate did not list an available Whisper version for this account.'), { status: 502 });
        }
      }
      let prediction = await call(version ? '/predictions' : `/models/${name}/predictions`, {
        method: 'POST',
        headers: { ...headers, 'Cancel-After': `${Math.max(5, Math.ceil(timeout / 1000))}s` },
        body: JSON.stringify({ ...(version ? { version } : {}), input }),
      });
      if (!/^[a-z0-9]+$/.test(prediction.id ?? '')) throw new Error('Invalid prediction ID');
      id = prediction.id;
      await recordId(id);
      while (['starting', 'processing'].includes(prediction.status)) {
        await delay(750, undefined, { signal });
        prediction = await call(`/predictions/${id}`);
      }
      if (prediction.status !== 'succeeded') {
        console.warn('Executive prediction ended', { model, id, status: prediction.status });
        throw Object.assign(new Error('Replicate could not complete the prediction. Please try again.'), { status: 502 });
      }
      return prediction;
    } catch (error) {
      if (id && signal.aborted) {
        await call(`/predictions/${id}/cancel`, { method: 'POST', signal: AbortSignal.timeout(2500) }).catch(() => {});
      }
      if (signal.aborted) throw Object.assign(new Error('Executive timed out. Please try again.'), { status: 504 });
      throw error;
    }
  };
}
