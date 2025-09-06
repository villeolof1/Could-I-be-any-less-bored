// src/audio/audio-gate.js
let armed = false;                 // becomes true after first user gesture
let toneModPromise = null;         // lazy import of tone.js
let started = false;               // true after Tone.start()

export function isArmed() { return armed; }
export function isStarted() { return started; }

export function armAudio() {
  armed = true;
}

export async function enableTone() {
  if (!armed) throw new Error('Audio must be armed by a user gesture first');
  if (!toneModPromise) {
    toneModPromise = import('tone');   // dynamic import, only after gesture
  }
  const Tone = await toneModPromise;
  if (!started) {
    await Tone.start();
    started = true;
  }
  return Tone;
}
