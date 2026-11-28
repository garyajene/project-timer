import { spawn } from 'node:child_process';

const formats = new Map([['audio/webm', 'matroska'], ['audio/mp4', 'mov'], ['audio/ogg', 'ogg']]);

export async function readExecutiveBody(request, maxBytes) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    size += chunk.length;
    if (size > maxBytes) {
      request.resume();
      throw Object.assign(new Error('The request is too large.'), { status: 413 });
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, size);
}

function transcode(input, args, maxBytes) {
  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', ['-nostdin', '-v', 'error', '-xerror', '-protocol_whitelist', 'pipe', ...args], {
      stdio: ['pipe', 'pipe', 'ignore'], timeout: 30000, killSignal: 'SIGKILL', env: { PATH: process.env.PATH },
    });
    const chunks = [];
    let size = 0;
    child.on('error', reject);
    child.stdin.on('error', () => {});
    child.stdout.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) child.kill('SIGKILL');
      else chunks.push(chunk);
    });
    child.on('close', (code) => {
      if (code !== 0 || !size || size > maxBytes) reject(new Error('Invalid audio'));
      else resolve(Buffer.concat(chunks, size));
    });
    child.stdin.end(input);
  });
}

export async function normalizeRecording(request, secondsLimit) {
  const format = formats.get(request.headers['content-type']?.split(';')[0].trim());
  if (!format) throw Object.assign(new Error('This recording format is unsupported.'), { status: 415 });
  const audio = await readExecutiveBody(request, 16 * 1024 * 1024);
  const rate = 16000;
  const maxSamples = rate * secondsLimit;
  try {
    const pcm = await transcode(audio, ['-f', format, '-i', 'pipe:0', '-map', '0:a:0', '-t', String(secondsLimit + 1),
      '-ac', '1', '-ar', String(rate), '-f', 's16le', 'pipe:1'], (maxSamples + rate) * 2);
    if (pcm.length / 2 > maxSamples) throw new Error('Duration limit');
    const mp3 = await transcode(pcm, ['-f', 's16le', '-ac', '1', '-ar', String(rate), '-i', 'pipe:0',
      '-map_metadata', '-1', '-b:a', '16k', '-f', 'mp3', 'pipe:1'], 740000);
    return { uri: `data:audio/mpeg;base64,${mp3.toString('base64')}`, seconds: pcm.length / (rate * 2) };
  } catch {
    throw Object.assign(new Error(`Record valid audio up to ${secondsLimit} seconds and try again.`), { status: 422 });
  }
}
