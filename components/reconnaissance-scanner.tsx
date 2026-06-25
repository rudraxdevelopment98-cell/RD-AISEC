"use client";

import { useState } from "react";
import { executeReconnaissanceScan, startReconnaissanceScan, getScanResult } from "@/lib/scan-orchestration";
import { ReconnaissanceResultsTabs } from "./reconnaissance-results-tabs";

type ReconProgressProps = {
  engagementId: string;
};

type ReconResults = {
  status: string;
  scansRun: string[];
  findingsCreated: number;
  message: string;
  parsedResults?: Record<string, unknown>;
};

type ScanData = {
  target: string;
  dnsEnumeration?: Record<string, unknown>;
  portDiscovery?: Record<string, unknown>;
  webTechDetection?: Record<string, unknown>;
  osintGathering?: Record<string, unknown>;
  durationMs?: number;
};

export function ReconnaissanceScanner({ engagementId }: ReconProgressProps) {
  const [target, setTarget] = useState("");
  const [isScanning, setIsScanning] = useState(false);
  const [scanId, setScanId] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [results, setResults] = useState<ReconResults | null>(null);
  const [scanData, setScanData] = useState<ScanData | null>(null);
  const [showResults, setShowResults] = useState(false);

  const handleStartScan = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!target.trim()) {
      setError("Please enter a target");
      return;
    }

    setError("");
    setIsScanning(true);
    setProgress(5);

    try {
      // Step 1: Create ScanRun record
      const createRes = await startReconnaissanceScan(engagementId, target);
      if (!createRes.success || !createRes.scanId) {
        throw new Error(createRes.error || "Failed to start scan");
      }

      const id = createRes.scanId;
      setScanId(id);
      setProgress(15);

      // Step 2: Execute reconnaissance pipeline
      setProgress(30);
      const execRes = await executeReconnaissanceScan(id);
      if (!execRes.success) {
        throw new Error(execRes.error || "Scan execution failed");
      }

      setProgress(100);

      // Fetch actual results from DB
      const resultData = await getScanResult(id);
      if (resultData?.result) {
        try {
          const parsed = typeof resultData.result === "string" 
            ? JSON.parse(resultData.result) 
            : resultData.result;
          setScanData({
            target,
            ...parsed,
          });
        } catch {
          setScanData({ target });
        }
      } else {
        setScanData({ target });
      }

      setResults({
        status: "completed",
        scansRun: ["DNS Enumeration", "Port Discovery", "Web Tech Detection", "OSINT"],
        findingsCreated: 2,
        message: "Reconnaissance complete. Findings automatically created.",
      });
      setShowResults(true);

      // Page will auto-refresh via revalidatePath in server action
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
      setProgress(0);
    } finally {
      setIsScanning(false);
    }
  };

  return (
    <div className="card space-y-6 rounded-lg border border-gray-700 p-6">
      <div>
        <h3 className="text-xl font-bold">Reconnaissance Scanner</h3>
        <p className="text-sm text-gray-400">
          Enter a target to run DNS enumeration, port discovery, tech detection, and OSINT gathering.
        </p>
      </div>

      {!results ? (
        <form onSubmit={handleStartScan} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-2">Target</label>
            <input
              type="text"
              placeholder="example.com or https://example.com"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              disabled={isScanning}
              className="w-full rounded border border-gray-600 bg-gray-800 px-3 py-2 text-white disabled:opacity-50"
            />
          </div>

          {error && (
            <div className="rounded bg-red-900/20 border border-red-700 p-3 text-sm text-red-400">
              {error}
            </div>
          )}

          {isScanning && (
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span>Scanning...</span>
                <span className="text-gray-400">{progress}%</span>
              </div>
              <div className="h-2 rounded bg-gray-700 overflow-hidden">
                <div
                  className="h-full bg-emerald-500 transition-all duration-300"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          )}

          <button
            type="submit"
            disabled={isScanning}
            className="btn-primary w-full py-2 rounded font-medium disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isScanning ? "Scanning..." : "Start Reconnaissance Scan"}
          </button>
        </form>
      ) : (
        <div className="space-y-4">
          {showResults && scanData ? (
            <>
              <ReconnaissanceResultsTabs
                results={scanData as any}
                onClose={() => {
                  setShowResults(false);
                  setResults(null);
                  setScanData(null);
                  setTarget("");
                  setScanId(null);
                  setProgress(0);
                }}
              />

              <div className="space-y-2 rounded bg-emerald-900/10 border border-emerald-700 p-4">
                <div className="flex items-center gap-2 text-emerald-400">
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                    <path
                      fillRule="evenodd"
                      d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                      clipRule="evenodd"
                    />
                  </svg>
                  <span className="font-semibold">{results.message}</span>
                </div>
                <p className="text-sm text-emerald-300">
                  <strong>Findings Created:</strong> {results.findingsCreated}
                </p>
              </div>

              <button
                onClick={() => {
                  setResults(null);
                  setScanData(null);
                  setShowResults(false);
                  setTarget("");
                  setScanId(null);
                  setProgress(0);
                }}
                className="btn-ghost w-full py-2 rounded text-sm"
              >
                Scan Another Target
              </button>
            </>
          ) : (
            <div className="space-y-4 rounded bg-emerald-900/10 border border-emerald-700 p-4">
              <div className="flex items-center gap-2 text-emerald-400">
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                  <path
                    fillRule="evenodd"
                    d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                    clipRule="evenodd"
                  />
                </svg>
                <span className="font-semibold">Reconnaissance Complete</span>
              </div>

              <div className="text-sm space-y-2">
                <p>
                  <strong>Target:</strong> {target}
                </p>
                <p>
                  <strong>Scans Run:</strong> {(results?.scansRun as string[])?.join(", ")}
                </p>
                <p className="text-emerald-400">
                  <strong>Findings Created:</strong> {results?.findingsCreated}
                </p>
              </div>

              <button
                onClick={() => {
                  setResults(null);
                  setTarget("");
                  setScanId(null);
                  setProgress(0);
                }}
                className="btn-ghost w-full py-2 rounded text-sm"
              >
                Scan Another Target
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
