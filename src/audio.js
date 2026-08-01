const soundUrls = {
  start: new URL('./assets/sounds/here we go.mp3', import.meta.url),
  zenBreak: new URL('./assets/sounds/Mudita Bell - Melodic Mirth (alarm sound)mp3.mp3', import.meta.url),
  complete: new URL('./assets/sounds/buzzer_alarm.mp3', import.meta.url),
};

const audioPlayers = new Map();

function getPlayer(sound) {
  if (typeof Audio === 'undefined' || !soundUrls[sound]) return null;
  if (!audioPlayers.has(sound)) {
    const player = new Audio(soundUrls[sound]);
    player.preload = 'auto';
    audioPlayers.set(sound, player);
  }
  return audioPlayers.get(sound);
}

export function playSound(sound) {
  try {
    const player = getPlayer(sound);
    if (!player) return;
    player.currentTime = 0;
    const playback = player.play();
    if (playback?.catch) playback.catch(() => {});
  } catch {
    // Sound is progressive enhancement; timer transitions must never depend on it.
  }
}

export const sounds = Object.freeze({
  start: () => playSound('start'),
  zenBreak: () => playSound('zenBreak'),
  complete: () => playSound('complete'),
});
