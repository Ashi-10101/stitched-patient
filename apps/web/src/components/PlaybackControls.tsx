/**
 * Playback controls: play/pause and speed selection.
 *
 * `variant="play"` uses the Play palette. In both variants the selected speed
 * button has `aria-pressed="true"` and a check mark, so the state does not
 * rely on colour (play-mode 11.9).
 */

'use client';

import { PlaybackSpeed } from '@/types';

interface PlaybackControlsProps {
  playing: boolean;
  speed: PlaybackSpeed;
  simulationTime: number;
  onPlayPause: () => void;
  onSpeedChange: (speed: PlaybackSpeed) => void;
  /** Colour palette; defaults to the clinician style. */
  variant?: 'clinician' | 'play';
}

const STYLES = {
  clinician: {
    container: 'flex items-center gap-4 bg-gray-800 p-4 rounded-lg border border-gray-700',
    playButton: 'px-6 py-2 bg-blue-600 hover:bg-blue-700 rounded font-semibold transition-colors',
    group: 'border-l border-gray-600 pl-4 flex items-center gap-2',
    label: 'text-sm text-gray-400',
    speedSelected: 'bg-blue-600 text-white',
    speedOther: 'bg-gray-700 text-gray-300 hover:bg-gray-600',
    time: 'text-xl font-mono font-bold',
  },
  play: {
    container:
      'flex items-center gap-4 bg-[#2E1A47] text-[#FFF7EC] p-4 rounded-lg border border-[#FF7A1A]',
    playButton:
      'px-6 py-2 bg-[#FF7A1A] text-[#2E1A47] hover:bg-[#FF8F3D] rounded font-semibold text-base transition-colors',
    group: 'border-l border-[#FF7A1A]/50 pl-4 flex items-center gap-2',
    label: 'text-base text-[#FFF7EC]',
    speedSelected: 'bg-[#FF7A1A] text-[#2E1A47] font-semibold',
    speedOther: 'bg-[#3D2560] text-[#FFF7EC] hover:bg-[#4A2E73]',
    time: 'text-xl font-mono font-bold text-[#FFF7EC]',
  },
} as const;

export function PlaybackControls({
  playing,
  speed,
  simulationTime,
  onPlayPause,
  onSpeedChange,
  variant = 'clinician',
}: PlaybackControlsProps) {
  const styles = STYLES[variant];

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className={styles.container}>
      <div className="flex items-center gap-2">
        <button
          onClick={onPlayPause}
          className={styles.playButton}
          aria-label={playing ? 'Pause' : 'Play'}
        >
          {playing ? '⏸ Pause' : '▶ Play'}
        </button>
      </div>

      <div className={styles.group}>
        <span className={styles.label}>Speed:</span>
        {(['1x', '2x', '4x'] as PlaybackSpeed[]).map((s) => (
          <button
            key={s}
            onClick={() => onSpeedChange(s)}
            className={`px-3 py-1 rounded transition-colors ${
              speed === s ? styles.speedSelected : styles.speedOther
            }`}
            aria-pressed={speed === s}
          >
            {speed === s && (
              <span aria-hidden="true" className="mr-1">
                ✓
              </span>
            )}
            {s}
          </button>
        ))}
      </div>

      <div className={styles.group}>
        <span className={styles.label}>Sim Time:</span>
        <span className={styles.time}>{formatTime(simulationTime)}</span>
      </div>
    </div>
  );
}
