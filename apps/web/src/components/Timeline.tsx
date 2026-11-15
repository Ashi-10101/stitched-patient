/**
 * Timeline showing branches and checkpoints.
 */

'use client';

import { BranchMetadata, CheckpointMetadata } from '@/types';

interface TimelineProps {
  branches: BranchMetadata[];
  currentBranchId: string;
  checkpoints: CheckpointMetadata[];
  onFork: (checkpointId: string) => void;
}

export function Timeline({ branches, currentBranchId, checkpoints, onFork }: TimelineProps) {
  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="bg-gray-800 p-4 rounded-lg border border-gray-700">
      <h3 className="text-lg font-semibold mb-4">Timeline & Branches</h3>
      
      <div className="mb-4">
        <div className="text-sm text-gray-400 mb-2">Active Branches:</div>
        <div className="space-y-2">
          {branches.map((branch) => (
            <div
              key={branch.branch_id}
              className={`p-2 rounded ${
                branch.branch_id === currentBranchId
                  ? 'bg-blue-600/30 border border-blue-500'
                  : 'bg-gray-700'
              }`}
            >
              <div className="flex items-center justify-between">
                <div>
                  <span className="font-mono text-xs">{branch.branch_id.slice(0, 8)}</span>
                  {branch.parent_branch_id && (
                    <span className="text-xs text-gray-400 ml-2">
                      ← forked from {branch.parent_branch_id.slice(0, 8)}
                    </span>
                  )}
                </div>
                <span className="text-xs text-gray-400">{branch.event_count} events</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div>
        <div className="text-sm text-gray-400 mb-2">Checkpoints (click to fork):</div>
        <div className="space-y-1 max-h-48 overflow-y-auto">
          {checkpoints.length === 0 ? (
            <div className="text-sm text-gray-500 italic">No checkpoints yet</div>
          ) : (
            checkpoints.map((checkpoint) => (
              <button
                key={checkpoint.checkpoint_id}
                onClick={() => onFork(checkpoint.checkpoint_id)}
                className="w-full text-left p-2 bg-gray-700 hover:bg-gray-600 rounded text-sm transition-colors"
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono">{formatTime(checkpoint.simulation_time)}</span>
                  <span className="text-xs text-gray-400">
                    {checkpoint.is_automatic ? 'auto' : 'manual'}
                  </span>
                </div>
                {checkpoint.description && (
                  <div className="text-xs text-gray-400 mt-1">{checkpoint.description}</div>
                )}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
