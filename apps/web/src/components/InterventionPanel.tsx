/**
 * Panel showing available interventions.
 */

'use client';

import { Intervention } from '@/types';

interface InterventionPanelProps {
  interventions: Intervention[];
  onApply: (interventionId: string) => void;
  disabled?: boolean;
}

export function InterventionPanel({ interventions, onApply, disabled = false }: InterventionPanelProps) {
  return (
    <div className="bg-gray-800 p-4 rounded-lg border border-gray-700">
      <h3 className="text-lg font-semibold mb-4">Interventions</h3>
      <div className="grid grid-cols-1 gap-2">
        {interventions.map((intervention) => (
          <button
            key={intervention.id}
            onClick={() => onApply(intervention.id)}
            disabled={disabled}
            className="px-4 py-3 bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800 disabled:text-gray-500 disabled:cursor-not-allowed rounded text-left transition-colors font-medium"
          >
            {intervention.label}
          </button>
        ))}
      </div>
    </div>
  );
}
