import { useEffect } from 'react';
import { AudioEngine } from '@aero/music-engine';
import { useSettings } from '@/store/settings';

/** App-wide audio engine. Volume/mute follow settings; unlocked on the first user gesture. */
export const audioEngine = new AudioEngine({ volume: useSettings.getState().volume });
audioEngine.setMuted(useSettings.getState().muted);
useSettings.subscribe((s) => {
  audioEngine.setVolume(s.volume);
  audioEngine.setMuted(s.muted);
});

/** Unlock/resume audio on any pointer/keyboard gesture while mounted. */
export function useAudioUnlock(): void {
  useEffect(() => {
    const h = () => void audioEngine.unlock();
    window.addEventListener('pointerdown', h);
    window.addEventListener('keydown', h);
    return () => {
      window.removeEventListener('pointerdown', h);
      window.removeEventListener('keydown', h);
    };
  }, []);
}
