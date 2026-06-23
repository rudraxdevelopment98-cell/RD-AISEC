/**
 * Quick test of reconnaissance scanning functions.
 * Run with: npx ts-node lib/reconnaissance.test.ts
 *
 * Note: This is a standalone test file, not part of the build.
 */

import { dnsEnumeration, portDiscovery, webTechDetection, osintGathering } from "./reconnaissance.ts";

async function runTests() {
  console.log("🔍 Starting reconnaissance scanning tests...\n");

  const testTarget = "example.com";

  console.log(`📌 Target: ${testTarget}\n`);

  // Test DNS Enumeration
  console.log("1️⃣  DNS Enumeration:");
  try {
    const dnsResult = await dnsEnumeration(testTarget);
    console.log(`   Status: ${dnsResult.status}`);
    console.log(`   Found subdomains: ${(dnsResult.data.discoveredSubdomains as any[])?.length || 0}`);
    console.log(`   Mail servers: ${(dnsResult.data.mailServers as any[])?.length || 0}`);
    console.log(`   Duration: ${dnsResult.durationMs}ms\n`);
  } catch (e) {
    console.error("   Error:", e, "\n");
  }

  // Test Port Discovery
  console.log("2️⃣  Port Discovery:");
  try {
    const portResult = await portDiscovery(testTarget);
    console.log(`   Status: ${portResult.status}`);
    console.log(`   Open ports: ${(portResult.data.openPorts as any[])?.join(", ") || "None"}`);
    console.log(`   Duration: ${portResult.durationMs}ms\n`);
  } catch (e) {
    console.error("   Error:", e, "\n");
  }

  // Test Web Tech Detection
  console.log("3️⃣  Web Tech Detection:");
  try {
    const webResult = await webTechDetection(testTarget);
    console.log(`   Status: ${webResult.status}`);
    console.log(`   Status Code: ${webResult.data.statusCode}`);
    console.log(`   Detected techs: ${(webResult.data.detectedTechs as any[])?.join(", ") || "None"}`);
    console.log(`   Duration: ${webResult.durationMs}ms\n`);
  } catch (e) {
    console.error("   Error:", e, "\n");
  }

  // Test OSINT Gathering
  console.log("4️⃣  OSINT Gathering:");
  try {
    const osintResult = await osintGathering(testTarget);
    console.log(`   Status: ${osintResult.status}`);
    console.log(`   Certificates: ${osintResult.data.certCount}`);
    console.log(`   Duration: ${osintResult.durationMs}ms\n`);
  } catch (e) {
    console.error("   Error:", e, "\n");
  }

  console.log("✅ Tests complete!");
}

runTests().catch(console.error);
