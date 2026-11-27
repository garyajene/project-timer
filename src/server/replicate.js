import { setTimeout as delay } from 'node:timers/promises';

const api = 'https://api.replicate.com/v1';
export const LUNA = 'openai/gpt-5.6-luna';
export const WHISPER = 'vaibhavs10/incredibly-fast-whisper:3ab86df6c8f54c11309d4d1f930ac292bad43ace52d10c80d87eb258b3c9f79c';

export function replicateClient(token, fetcher = fetch) {
  return async (model, input, timeout, recordId) => {
    const match = /^([\w-]+\/[\w.-]+)(?::([a-f0-9]{64}))?$/.exec(model);
    if (!token || !match) throw new Error('Provider configuration unavailable');
    const [, name, version] = match;
    const signal = AbortSignal.timeout(timeout);
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    async function call(path, options) {
      const response = await fetcher(api + path, { headers, signal, redirect: 'error', ...options });
      if (!response.ok) throw new Error('Provider request failed');
      return response.json();
    }
    let id;
    try {
      let prediction = await call(version ? '/predictions' : `/models/${name}/predictions`, {
        method: 'POST',
        headers: { ...headers, 'Cancel-After': `${Math.ceil(timeout / 1000)}s` },
        body: JSON.stringify({ ...(version ? { version } : {}), input }),
      });
      if (!/^[a-z0-9]+$/.test(prediction.id ?? '')) throw new Error('Invalid prediction ID');
      id = prediction.id;
      await recordId(id);
      while (['starting', 'processing'].includes(prediction.status)) {
        await delay(750, undefined, { signal });
        prediction = await call(`/predictions/${id}`);
      }
      if (prediction.status !== 'succeeded') throw new Error('Prediction failed');
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
