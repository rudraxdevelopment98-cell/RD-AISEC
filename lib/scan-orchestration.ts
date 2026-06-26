"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { runReconnaissancePipeline } from "@/lib/reconnaissance";
import { classifyFinding } from "@/lib/finding-map";
import { revalidatePath } from "next/cache";

/**
 * Start a reconnaissance scan on a target within an engagement.
 * Returns the ScanRun record (with id to track progress later).
 */
export async function startReconnaissanceScan(
  engagementId: string,
  target: string,
): Promise<{
  success: boolean;
  scanId?: string;
  error?: string;
}> {
  const session = await auth();
  if (!session?.user?.email) {
    return { success: false, error: "Unauthorized" };
  }

  try {
    // Verify engagement exists and user owns it
    const engagement = await prisma.engagement.findUnique({
      where: { id: engagementId },
    });

    if (!engagement) {
      return { success: false, error: "Engagement not found" };
    }

    if (engagement.ownerEmail !== session.user.email) {
      return {
        success: false,
        error: "You do not own this engagement",
      };
    }

    // Create ScanRun record
    const scanRun = await prisma.scanRun.create({
      data: {
        engagementId,
        target,
        scanType: "posture", // Initial type; will be updated
        status: "pending",
        progress: 0,
      },
    });

    return { success: true, scanId: scanRun.id };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Execute reconnaissance pipeline and store results.
 * Called after startReconnaissanceScan to actually run the scans.
 */
export async function executeReconnaissanceScan(
  scanId: string,
): Promise<{
  success: boolean;
  error?: string;
}> {
  const session = await auth();
  if (!session?.user?.email) {
    return { success: false, error: "Unauthorized" };
  }

  try {
    // Get ScanRun record
    const scanRun = await prisma.scanRun.findUnique({
      where: { id: scanId },
      include: { engagement: true },
    });

    if (!scanRun) {
      return { success: false, error: "Scan not found" };
    }

    // Verify ownership
    if (scanRun.engagement.ownerEmail !== session.user.email) {
      return {
        success: false,
        error: "Unauthorized",
      };
    }

    // Update status to running
    await prisma.scanRun.update({
      where: { id: scanId },
      data: { status: "running", progress: 10 },
    });

    const startTime = Date.now();

    // Run reconnaissance pipeline
    const results = await runReconnaissancePipeline(scanRun.target);

    // Convert results to findings
    const findings = [];
    for (const result of results) {
      if (result.status === "success" && result.data) {
        // Create findings from scan results
        if (result.scanType === "dns" && result.data.discoveredSubdomains) {
          const subdomains = result.data.discoveredSubdomains as Array<{
            subdomain: string;
            ip?: string;
          }>;
          if (subdomains.length > 0) {
            findings.push({
              title: `DNS Enumeration: ${subdomains.length} subdomains discovered`,
              severity: "info",
              description: `Found subdomains: ${subdomains.map((s) => s.subdomain).join(", ")}`,
              recommendation:
                "Review discovered subdomains for unauthorized services.",
            });
          }
        }

        if (result.scanType === "port" && result.data.openPorts) {
          const ports = result.data.openPorts as number[];
          if (ports.length > 0) {
            findings.push({
              title: `Open Ports: ${ports.length} ports discovered`,
              severity: ports.some((p) => p < 1024) ? "medium" : "low",
              description: `Open ports: ${ports.join(", ")}`,
              recommendation:
                "Review open ports and ensure only necessary services are exposed.",
            });
          }
        }

        if (result.scanType === "web" && result.data.detectedTechs) {
          const techs = result.data.detectedTechs as string[];
          if (techs.length > 0) {
            findings.push({
              title: `Technologies Detected: ${techs.join(", ")}`,
              severity: "info",
              description: `Stack: ${techs.join(", ")}`,
              recommendation: "Review detected technologies for known vulnerabilities.",
            });
          }
        }
      }
    }

    // Batch create findings
    for (const finding of findings) {
      await prisma.finding.create({
        data: {
          engagementId: scanRun.engagementId,
          title: finding.title,
          severity: finding.severity,
          status: "open",
          description: finding.description,
          recommendation: finding.recommendation,
          ...classifyFinding({
            title: finding.title,
            description: finding.description,
            severity: finding.severity,
          }),
        },
      });
    }

    // Update ScanRun with results
    const durationMs = Date.now() - startTime;
    await prisma.scanRun.update({
      where: { id: scanId },
      data: {
        status: "completed",
        progress: 100,
        result: JSON.stringify(results),
        durationMs,
        completedAt: new Date(),
      },
    });

    // Revalidate engagement page to show new findings
    revalidatePath(`/dashboard/engagements/${scanRun.engagementId}`);

    return { success: true };
  } catch (error) {
    // Update scan as failed
    await prisma.scanRun.update({
      where: { id: scanId },
      data: {
        status: "failed",
        error: error instanceof Error ? error.message : "Unknown error",
        completedAt: new Date(),
      },
    });

    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Get scan results by ID.
 */
export async function getScanResult(scanId: string) {
  const session = await auth();
  if (!session?.user?.email) {
    return null;
  }

  const scan = await prisma.scanRun.findUnique({
    where: { id: scanId },
    include: { engagement: true },
  });

  if (!scan || scan.engagement.ownerEmail !== session.user.email) {
    return null;
  }

  return {
    ...scan,
    result: JSON.parse(scan.result),
  };
}

/**
 * List all scans for an engagement.
 */
export async function listEngagementScans(engagementId: string) {
  const session = await auth();
  if (!session?.user?.email) {
    return [];
  }

  const engagement = await prisma.engagement.findUnique({
    where: { id: engagementId },
  });

  if (!engagement || engagement.ownerEmail !== session.user.email) {
    return [];
  }

  return await prisma.scanRun.findMany({
    where: { engagementId },
    orderBy: { createdAt: "desc" },
  });
}
