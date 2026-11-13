import { useSyncExternalStore } from 'react';

// Whether a movie is playing from the camera: the live view pauses meanwhile, so the movie gets
// all of the camera's Wi-Fi

let playing = false;
const listeners = new Set<() => void>();

export function setMoviePlaying(on: boolean) {
  if (on === playing) return;
  playing = on;
  listeners.forEach((l) => l());
}

export function useMoviePlaying() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => playing,
  );
}
