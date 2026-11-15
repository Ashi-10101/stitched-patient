/**
 * Playback controls: play/pause and speed selection.
 */

'use client';

import { PlaybackSpeed } from '@/types';

interface PlaybackControlsProps {
  playing: boolean;
  speed: PlaybackSpeed;
  simulationTime: number;
  onPlayPause: () => void;
  onSpeedChange: (speed: PlaybackSpeed) => void;
}

export function PlaybackControls({
  playing,
  speed,
  simulationTime,
  onPlayPause,
  onSpeedChange,
}: PlaybackControlsProps) {
  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="flex items-center gap-4 bg-gray-800 p-4 rounded-lg border border-gray-700">
      <div className="flex items-center gap-2">
        <button
          onClick={onPlayPause}
          className="px-6 py-2 bg-blue-600 hover:bg-blue-700 rounded font-semibold transition-colors"
          aria-label={playing ? 'Pause' : 'Play'}
        >
          {playing ? '⏸ Pause' : '▶ Play'}
        </button>
      </div>

      <div className="border-l border-gray-600 pl-4 flex items-center gap-2">
        <span className="text-sm text-gray-400">Speed:</span>
        {(['1x', '2x', '4x'] as PlaybackSpeed[]).map((s) => (
          <button
            key={s}
            onClick={() => onSpeedChange(s)}
            className={`px-3 py-1 rounded transition-colors ${
              speed === s
                ? 'bg-blue-600 text-white'
                : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      <div className="border-l border-gray-600 pl-4 flex items-center gap-2">
        <span className="text-sm text-gray-400">Sim Time:</span>
        <span className="text-xl font-mono font-bold">{formatTime(simulationTime)}</span>
      </div>
    </div>
  );
}
