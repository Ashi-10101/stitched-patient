/**
 * Home page - case selection.
 */

'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '@/lib/api';

export default function Home() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startCase = async (caseId: string) => {
    setLoading(true);
    setError(null);

    try {
      const session = await api.createSession(caseId);
      router.push(`/session/${session.session_id}`);
    } catch (err: any) {
      setError(err.message || 'Failed to start session');
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-8">
      <div className="max-w-2xl w-full">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold mb-4">Stitched Patient</h1>
          <p className="text-gray-400 mb-2">Virtual patient for medical training</p>
          <p className="text-sm text-yellow-500 bg-yellow-500/10 inline-block px-4 py-2 rounded">
            ⚠️ Educational simulation, not for clinical use
          </p>
        </div>

        <div className="bg-gray-800 p-6 rounded-lg border border-gray-700">
          <h2 className="text-xl font-semibold mb-4">Select a Case</h2>
          
          <div className="space-y-3">
            <button
              onClick={() => startCase('adult-tension-pneumothorax')}
              disabled={loading}
              className="w-full text-left p-4 bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800 disabled:cursor-not-allowed rounded transition-colors"
            >
              <div className="font-semibold text-lg">Adult Tension Pneumothorax</div>
              <div className="text-sm text-gray-400 mt-1">
                32-year-old male with sudden onset chest pain and shortness of breath following motor vehicle collision
              </div>
            </button>
          </div>

          {error && (
            <div className="mt-4 p-3 bg-red-500/10 border border-red-500 rounded text-red-400 text-sm">
              {error}
            </div>
          )}

          {loading && (
            <div className="mt-4 text-center text-gray-400">
              Starting session...
            </div>
          )}
        </div>

        <div className="mt-8 text-center text-xs text-gray-500">
          Built for Kiroween 2026 • Frankenstein category
        </div>
      </div>
    </main>
  );
}
