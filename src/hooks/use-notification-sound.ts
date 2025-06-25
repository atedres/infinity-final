"use client";

import { useCallback, useRef } from 'react';

/**
 * A hook to play a notification sound.
 * @param soundPath The path to the sound file in the /public directory.
 * @returns A function to call to play the sound.
 */
export function useNotificationSound(soundPath: string) {
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Lazily create the Audio element only on the client
  if (typeof window !== 'undefined' && !audioRef.current) {
    audioRef.current = new Audio(soundPath);
    audioRef.current.volume = 0.4; // Set a reasonable volume
  }

  const playSound = useCallback(() => {
    // Play sound only if the document is visible to the user
    if (audioRef.current && document.visibilityState === 'visible') {
      // Rewind to the start in case it's played again quickly
      audioRef.current.currentTime = 0;
      audioRef.current.play().catch(error => {
        // Autoplay can be blocked by the browser, log error but don't crash.
        // This is common if the user hasn't interacted with the page yet.
        console.error(`Could not play sound: ${error.message}`);
      });
    }
  }, []);

  return playSound;
}
