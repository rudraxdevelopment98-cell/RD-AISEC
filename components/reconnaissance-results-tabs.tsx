"use client";

import { useState } from "react";

type DNSData = {
  subdomains: { subdomain: string; ip?: string }[];
  mxRecords: string[];
};

type PortData = {
  openPorts: number[];
  commonPorts: number[];
};

type WebData = {
  statusCode: number;
  title: string;
  headers: Record<string, string>;
  technologies: string[];
};

type OSINTData = {
  sslData?: {
    subject?: string;
    issuer?: string;
    dates?: { start: string; end: string };
  };
  txtRecords: string[];
};

type ScanResults = {
  target: string;
  dnsEnumeration?: DNSData;
  portDiscovery?: PortData;
  webTechDetection?: WebData;
  osintGathering?: OSINTData;
  durationMs?: number;
};

type ReconnaissanceResultsTabsProps = {
  results: ScanResults;
  onClose: () => void;
};

export function ReconnaissanceResultsTabs({
  results,
  onClose,
}: ReconnaissanceResultsTabsProps) {
  const [activeTab, setActiveTab] = useState<"dns" | "ports" | "web" | "osint">(
    "dns"
  );

  const tabs = [
    { id: "dns", label: "DNS & Subdomains", count: results.dnsEnumeration?.subdomains.length || 0 },
    { id: "ports", label: "Open Ports", count: results.portDiscovery?.openPorts.length || 0 },
    { id: "web", label: "Web Technologies", count: results.webTechDetection?.technologies.length || 0 },
    { id: "osint", label: "OSINT & SSL", count: results.osintGathering?.txtRecords.length || 0 },
  ];

  return (
    <div className="card rounded-lg border border-gray-700 p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-xl font-bold">Scan Results</h3>
          <p className="text-sm text-gray-400">
            Target: <span className="font-mono text-emerald-400">{results.target}</span>
          </p>
        </div>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-white transition-colors p-2"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Tab Navigation */}
      <div className="flex gap-2 border-b border-gray-700 overflow-x-auto">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as any)}
            className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 whitespace-nowrap ${
              activeTab === tab.id
                ? "border-emerald-500 text-emerald-400"
                : "border-transparent text-gray-400 hover:text-white"
            }`}
          >
            {tab.label} <span className="ml-1 text-xs bg-gray-800 px-2 py-0.5 rounded">{tab.count}</span>
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="min-h-64">
        {/* DNS Enumeration */}
        {activeTab === "dns" && results.dnsEnumeration && (
          <div className="space-y-4">
            <div>
              <h4 className="font-semibold text-sm text-gray-300 mb-3">Discovered Subdomains</h4>
              {results.dnsEnumeration.subdomains.length > 0 ? (
                <div className="space-y-2">
                  {results.dnsEnumeration.subdomains.map((sub, idx) => (
                    <div
                      key={idx}
                      className="flex items-center justify-between p-3 bg-gray-800/50 rounded border border-gray-700 hover:border-emerald-700 transition-colors"
                    >
                      <div className="flex-1 font-mono text-sm text-emerald-400">{sub.subdomain}</div>
                      {sub.ip && (
                        <div className="text-sm text-gray-400">
                          <span className="bg-gray-700 px-2 py-1 rounded">{sub.ip}</span>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-gray-400 text-sm">No subdomains found</p>
              )}
            </div>

            {results.dnsEnumeration.mxRecords.length > 0 && (
              <div>
                <h4 className="font-semibold text-sm text-gray-300 mb-3">Mail Servers (MX Records)</h4>
                <div className="space-y-2">
                  {results.dnsEnumeration.mxRecords.map((mx, idx) => (
                    <div key={idx} className="p-3 bg-gray-800/50 rounded border border-gray-700">
                      <div className="font-mono text-sm text-blue-400">{mx}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Port Discovery */}
        {activeTab === "ports" && results.portDiscovery && (
          <div className="space-y-4">
            <div>
              <h4 className="font-semibold text-sm text-gray-300 mb-3">Open Ports</h4>
              {results.portDiscovery.openPorts.length > 0 ? (
                <div className="grid grid-cols-2 gap-2">
                  {results.portDiscovery.openPorts.map((port) => {
                    const commonPortNames: Record<number, string> = {
                      21: "FTP",
                      22: "SSH",
                      25: "SMTP",
                      53: "DNS",
                      80: "HTTP",
                      110: "POP3",
                      143: "IMAP",
                      443: "HTTPS",
                      445: "SMB",
                      3306: "MySQL",
                      5432: "PostgreSQL",
                      6379: "Redis",
                      8080: "HTTP-Proxy",
                      8443: "HTTPS-Alt",
                    };
                    return (
                      <div
                        key={port}
                        className="p-3 bg-gradient-to-br from-red-900/30 to-red-900/10 rounded border border-red-700/50 hover:border-red-600 transition-colors"
                      >
                        <div className="font-mono font-bold text-red-400">{port}</div>
                        <div className="text-xs text-gray-400">{commonPortNames[port] || "Unknown"}</div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-gray-400 text-sm">No open ports discovered</p>
              )}
            </div>
          </div>
        )}

        {/* Web Technologies */}
        {activeTab === "web" && results.webTechDetection && (
          <div className="space-y-4">
            <div className="p-4 bg-blue-900/20 border border-blue-700/50 rounded">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-gray-400">Status Code:</span>
                  <div className="text-lg font-bold text-blue-400 mt-1">
                    {results.webTechDetection.statusCode}
                  </div>
                </div>
                <div>
                  <span className="text-gray-400">Page Title:</span>
                  <div className="text-sm font-mono text-blue-400 mt-1 truncate">
                    {results.webTechDetection.title || "N/A"}
                  </div>
                </div>
              </div>
            </div>

            {results.webTechDetection.technologies.length > 0 && (
              <div>
                <h4 className="font-semibold text-sm text-gray-300 mb-3">Detected Technologies</h4>
                <div className="flex flex-wrap gap-2">
                  {results.webTechDetection.technologies.map((tech, idx) => (
                    <div
                      key={idx}
                      className="px-3 py-1 bg-sky-900/30 border border-sky-700 rounded-full text-sm text-sky-300 hover:bg-sky-900/50 transition-colors"
                    >
                      {tech}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {Object.keys(results.webTechDetection.headers).length > 0 && (
              <div>
                <h4 className="font-semibold text-sm text-gray-300 mb-3">HTTP Headers</h4>
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {Object.entries(results.webTechDetection.headers).map(([key, value]) => (
                    <div key={key} className="p-2 bg-gray-800/50 rounded text-xs font-mono">
                      <div className="text-gray-400">{key}:</div>
                      <div className="text-gray-300 break-all">{String(value)}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* OSINT & SSL */}
        {activeTab === "osint" && results.osintGathering && (
          <div className="space-y-4">
            {results.osintGathering.sslData && (
              <div className="p-4 bg-amber-900/20 border border-amber-700/50 rounded space-y-3">
                <h4 className="font-semibold text-sm text-amber-300">SSL Certificate</h4>
                {results.osintGathering.sslData.subject && (
                  <div className="text-sm">
                    <span className="text-gray-400">Subject:</span>
                    <div className="font-mono text-amber-400 text-xs mt-1">
                      {results.osintGathering.sslData.subject}
                    </div>
                  </div>
                )}
                {results.osintGathering.sslData.issuer && (
                  <div className="text-sm">
                    <span className="text-gray-400">Issuer:</span>
                    <div className="font-mono text-amber-400 text-xs mt-1">
                      {results.osintGathering.sslData.issuer}
                    </div>
                  </div>
                )}
                {results.osintGathering.sslData.dates && (
                  <div className="text-sm">
                    <span className="text-gray-400">Valid:</span>
                    <div className="font-mono text-amber-400 text-xs mt-1">
                      {results.osintGathering.sslData.dates.start} → {results.osintGathering.sslData.dates.end}
                    </div>
                  </div>
                )}
              </div>
            )}

            {results.osintGathering.txtRecords.length > 0 && (
              <div>
                <h4 className="font-semibold text-sm text-gray-300 mb-3">TXT Records</h4>
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {results.osintGathering.txtRecords.map((txt, idx) => (
                    <div key={idx} className="p-3 bg-gray-800/50 rounded border border-gray-700">
                      <div className="font-mono text-xs text-gray-300 break-all">{txt}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Footer */}
      {results.durationMs && (
        <div className="text-xs text-gray-500 border-t border-gray-700 pt-4">
          Scan completed in {(results.durationMs / 1000).toFixed(2)}s
        </div>
      )}
    </div>
  );
}
