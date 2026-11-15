/**
 * Trend chart showing vital signs over the last 5 minutes.
 */

'use client';

import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { VitalSigns } from '@/types';

interface VitalsTrendChartProps {
  history: VitalSigns[];
}

export function VitalsTrendChart({ history }: VitalsTrendChartProps) {
  // Format data for recharts
  const data = history.map(v => ({
    time: Math.floor(v.simulation_time),
    HR: Math.round(v.heart_rate),
    SpO2: Math.round(v.spo2 * 100),
    MAP: Math.round(v.mean_arterial_pressure),
  }));

  return (
    <div className="bg-gray-800 p-4 rounded-lg border border-gray-700">
      <h3 className="text-lg font-semibold mb-4">Trends (Last 5 Minutes)</h3>
      <ResponsiveContainer width="100%" height={250}>
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
          <XAxis 
            dataKey="time" 
            stroke="#9CA3AF"
            label={{ value: 'Time (s)', position: 'insideBottom', offset: -5, fill: '#9CA3AF' }}
          />
          <YAxis stroke="#9CA3AF" />
          <Tooltip 
            contentStyle={{ backgroundColor: '#1F2937', border: '1px solid #374151' }}
            labelStyle={{ color: '#9CA3AF' }}
          />
          <Legend />
          <Line type="monotone" dataKey="HR" stroke="#3B82F6" name="HR (bpm)" dot={false} strokeWidth={2} />
          <Line type="monotone" dataKey="SpO2" stroke="#10B981" name="SpO2 (%)" dot={false} strokeWidth={2} />
          <Line type="monotone" dataKey="MAP" stroke="#F59E0B" name="MAP (mmHg)" dot={false} strokeWidth={2} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
