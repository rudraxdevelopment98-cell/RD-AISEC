// AirSight event adapters — the consolidation layer. Everything the sensing
// section captures (the monitor-mode SURVEY: APs + stations, and the LIVE MONITOR:
// per-device motion) is mapped here into AirSight's ONE canonical event model
// (network_discovered / client_seen / presence_event). So the survey, the live
// monitor, the auto-map and a future CSI source all publish the same events
// instead of being separate tools. Pure (no DB/IO), unit tested.

import type { Survey } from "@/lib/survey-core";
import { vendorForMac } from "@/lib/survey-core";
import type { MotionState } from "@/lib/live-monitor-core";
import type { NetworkEvent, ClientEvent, PresenceEvent, PresenceState, AirsightEvent } from "@/lib/airsight-core";

const nowIso = () => new Date().toISOString();

/** Map each discovered AP in a survey to a canonical network_discovered event. */
export function surveyToNetworkEvents(survey: Survey, timestamp = nowIso()): NetworkEvent[] {
  return (survey.aps ?? [])
    .filter((ap) => ap.bssid)
    .map((ap) => ({
      type: "network_discovered",
      timestamp,
      bssid: ap.bssid.toLowerCase(),
      ssid: ap.essid || "(hidden)",
      channel: ap.channel || 0,
      encryption: ap.privacy || "unknown",
      vendor: vendorForMac(ap.bssid) || "Unknown",
      signalDbm: ap.power || 0,
    }));
}

/** Map each station (client) in a survey to a canonical client_seen event. */
export function surveyToClientEvents(survey: Survey, timestamp = nowIso()): ClientEvent[] {
  return (survey.stations ?? [])
    .filter((st) => st.mac)
    .map((st) => ({
      type: "client_seen",
      timestamp,
      clientMac: st.mac.toLowerCase(),
      associatedBssid: st.bssid ? st.bssid.toLowerCase() : null,
      vendor: vendorForMac(st.mac) || "Unknown",
      signalDbm: st.power || 0,
    }));
}

/** Map a live-monitor motion state to a canonical presence state. */
export function motionToPresenceState(m: MotionState): PresenceState {
  switch (m) {
    case "moving":
    case "approaching":
    case "receding":
      return "motion";
    case "still":
      return "present";
    case "gone":
    default:
      return "idle";
  }
}

/** Build a presence_event from a tracked device's motion (source = rssi). */
export function motionToPresenceEvent(input: {
  bssid: string;
  zoneLabel?: string;
  motion: MotionState;
  confidence?: number;
  timestamp?: string;
}): PresenceEvent {
  return {
    type: "presence_event",
    timestamp: input.timestamp ?? nowIso(),
    bssid: input.bssid.toLowerCase(),
    zoneLabel: input.zoneLabel ?? "",
    state: motionToPresenceState(input.motion),
    confidence: Math.round((input.confidence ?? (input.motion === "gone" ? 0.9 : 0.7)) * 100) / 100,
    source: "rssi",
  };
}

/** Flatten a survey into the unified network + client event stream. */
export function surveyToEvents(survey: Survey, timestamp = nowIso()): AirsightEvent[] {
  return [...surveyToNetworkEvents(survey, timestamp), ...surveyToClientEvents(survey, timestamp)];
}

/** Roll a survey's events up for the AirSight dashboard header tiles. */
export function eventSummary(survey: Survey): {
  networks: number;
  clients: number;
  associated: number;
  encryptions: { name: string; count: number }[];
  strongest: { bssid: string; ssid: string; signalDbm: number } | null;
} {
  const nets = surveyToNetworkEvents(survey);
  const clients = surveyToClientEvents(survey);
  const encMap = new Map<string, number>();
  for (const n of nets) {
    const e = (n.encryption || "unknown").toUpperCase();
    encMap.set(e, (encMap.get(e) ?? 0) + 1);
  }
  const strongest = nets.reduce<NetworkEvent | null>((best, n) => (!best || n.signalDbm > best.signalDbm ? n : best), null);
  return {
    networks: nets.length,
    clients: clients.length,
    associated: clients.filter((c) => c.associatedBssid).length,
    encryptions: Array.from(encMap.entries()).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
    strongest: strongest ? { bssid: strongest.bssid, ssid: strongest.ssid, signalDbm: strongest.signalDbm } : null,
  };
}
