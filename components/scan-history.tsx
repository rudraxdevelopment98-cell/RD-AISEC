"use client";

import { useState } from "react";
import { ReconnaissanceResultsTabs } from "./reconnaissance-results-tabs";

type ScanRun = {
  id: string;
  target: string;
  scanType: string;
  status: string;
  progress: number;
  result: string;
  error?: string;
  durationMs?: number;
  createdAt: string | Date;
  completedAt?: string | Date | null;
};

type ScanHistoryProps = {
  scans: ScanRun[];
  engagementId: string;
};

export function ScanHistory({ scans, engagementId }: ScanHistoryProps) {
  const [selectedScan, setSelectedScan] = useState<ScanRun | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const parseScanResult = (result: string) => {
    try {
      return JSON.parse(result);
    } catch {
      return null;
    }
  };

  const formatDate = (dateString: string | Date) => {
    return new Date(dateString).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "completed":
        return "bg-emerald-900/20 border-emerald-700 text-emerald-400";
      case "running":
        return "bg-blue-900/20 border-blue-700 text-blue-400";
      case "failed":
        return "bg-red-900/20 border-red-700 text-red-400";
      default:
        return "bg-gray-900/20 border-gray-700 text-gray-400";
    }
  };

  if (selectedScan) {
    const parsed = parseScanResult(selectedScan.result);
    return (
      <div className="space-y-4">
        <button
          onClick={() => setSelectedScan(null)}
          className="text-sm text-gray-400 hover:text-white transition-colors flex items-center gap-2"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back to Scan History
        </button>
        {parsed && (
          <ReconnaissanceResultsTabs
            results={{
              target: selectedScan.target,
              durationMs: selectedScan.durationMs,
              ...parsed,
            }}
            onClose={() => setSelectedScan(null)}
          />
        )}
      </div>
    );
  }

  return (
    <div className="card rounded-lg border border-gray-700 p-6 space-y-4">
      <div>
        <h3 className="text-xl font-bold">Scan History</h3>
        <p className="text-sm text-gray-400">
          {scans.length} scan{scans.length !== 1 ? "s" : ""} completed for this engagement
        </p>
      </div>

      {scans.length === 0 ? (
        <div className="rounded bg-gray-800/50 border border-gray-700 p-8 text-center">
          <svg className="w-12 h-12 mx-auto text-gray-600 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <p className="text-gray-400 text-sm">No scans yet. Start a reconnaissance scan to view results.</p>
        </div>
      ) : (
        <div className="space-y-2 max-h-96 overflow-y-auto">
          {scans
            .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
            .map((scan) => (
              <div key={scan.id} className="space-y-0">
                <button
                  onClick={() => setExpandedId(expandedId === scan.id ? null : scan.id)}
                  className="w-full text-left p-3 bg-gray-800/50 hover:bg-gray-800 rounded border border-gray-700 transition-colors"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex-1 flex items-center gap-3">
                      <div
                        className={`px-2 py-1 rounded text-xs font-semibold border ${getStatusColor(scan.status)}`}
                      >
                        {scan.status.charAt(0).toUpperCase() + scan.status.slice(1)}
                      </div>
                      <div>
                        <div className="font-mono text-sm text-emerald-400">{scan.target}</div>
                        <div className="text-xs text-gray-500">
                          {formatDate(scan.createdAt)}
                          {scan.durationMs && ` • ${(scan.durationMs / 1000).toFixed(2)}s`}
                        </div>
                      </div>
                    </div>
                    <svg
                      className={`w-5 h-5 text-gray-400 transition-transform ${
                        expandedId === scan.id ? "rotate-180" : ""
                      }`}
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M19 14l-7 7m0 0l-7-7m7 7V3"
                      />
                    </svg>
                  </div>
                </button>

                {expandedId === scan.id && (
                  <div className="p-4 bg-gray-900/50 border-x border-b border-gray-700 text-sm space-y-3">
                    {scan.status === "completed" && (
                      <button
                        onClick={() => setSelectedScan(scan)}
                        className="w-full px-3 py-2 bg-emerald-700 hover:bg-emerald-600 text-white rounded text-sm font-medium transition-colors"
                      >
                        View Detailed Results
                      </button>
                    )}

                    <div className="space-y-2 text-xs">
                      <div>
                        <span className="text-gray-400">Scan Type:</span>
                        <span className="ml-2 text-gray-300">{scan.scanType}</span>
                      </div>
                      {scan.error && (
                        <div>
                          <span className="text-gray-400">Error:</span>
                          <span className="ml-2 text-red-400">{scan.error}</span>
                        </div>
                      )}
                      {scan.completedAt && (
                        <div>
                          <span className="text-gray-400">Completed:</span>
                          <span className="ml-2 text-gray-300">{formatDate(scan.completedAt)}</span>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
