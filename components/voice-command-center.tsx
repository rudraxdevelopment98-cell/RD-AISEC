"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icons";
import {
  parseVoiceCommand,
  hasWakeWord,
  stripWake,
  WAKE_WORD,
  type NavLink,
  type VoiceIntent,
} from "@/lib/voice-commands";

// Minimal Web Speech API typing (not in the default TS DOM lib).
type SR = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((e: any) => void) | null;
  onerror: ((e: any) => void) | null;
  onend: (() => void) | null;
};

function getRecognition(): SR | null {
  if (typeof window === "undefined") return null;
  const Ctor = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
  return Ctor ? (new Ctor() as SR) : null;
}

const LS_WAKE = "rdaisec.voice.wake";
const LS_MUTE = "rdaisec.voice.mute";

/**
 * Voice Command Center — hands-free control of the portal, fully in-browser.
 *
 * - Voice → commands: "go to findings", "scan example dot com", "search for XSS".
 * - Spoken responses (TTS) via window.speechSynthesis.
 * - Wake word / always-listening: say "Shiva …" and it acts without a click.
 *
 * No cloud speech service and no API key — SpeechRecognition + speechSynthesis
 * are the browser's own. Nothing leaves the machine except the navigation the
 * command triggers.
 */
export function VoiceCommandCenter({ links }: { links: NavLink[] }) {
  const router = useRouter();
  const [supported, setSupported] = useState(true);
  const [open, setOpen] = useState(false);
  const [wake, setWake] = useState(false); // always-listening (wake word)
  const [muted, setMuted] = useState(false);
  const [listening, setListening] = useState(false);
  const [heard, setHeard] = useState(""); // live/interim transcript
  const [last, setLast] = useState<{ said: string; reply: string } | null>(null);

  const recRef = useRef<SR | null>(null);
  const wakeRef = useRef(false); // latest wake value for async callbacks
  const oneShotRef = useRef(false); // push-to-talk single command
  const mutedRef = useRef(false);

  wakeRef.current = wake;
  mutedRef.current = muted;

  // Restore preferences.
  useEffect(() => {
    setSupported(!!getRecognition());
    try {
      setWake(localStorage.getItem(LS_WAKE) === "1");
      setMuted(localStorage.getItem(LS_MUTE) === "1");
    } catch {
      /* ignore */
    }
  }, []);

  const speak = useCallback((text: string) => {
    if (mutedRef.current || typeof window === "undefined" || !("speechSynthesis" in window)) return;
    try {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 1.05;
      u.pitch = 1;
      window.speechSynthesis.speak(u);
    } catch {
      /* ignore */
    }
  }, []);

  const execute = useCallback(
    (intent: VoiceIntent, said: string) => {
      setLast({ said, reply: intent.speak });
      speak(intent.speak);
      switch (intent.type) {
        case "navigate":
        case "scan":
        case "search":
          router.push(intent.href);
          break;
        case "back":
          router.back();
          break;
        case "stop":
          setWake(false);
          try {
            localStorage.setItem(LS_WAKE, "0");
          } catch {
            /* ignore */
          }
          break;
        default:
          break;
      }
    },
    [router, speak],
  );

  // Handle a finalized transcript.
  const onFinal = useCallback(
    (transcript: string) => {
      const said = transcript.trim();
      if (!said) return;
      // In always-listening mode, only act when the wake word is present.
      if (wakeRef.current && !oneShotRef.current) {
        if (!hasWakeWord(said)) return;
        const cmd = stripWake(said);
        execute(parseVoiceCommand(cmd, links), said);
        return;
      }
      // Push-to-talk: wake word optional.
      const cmd = hasWakeWord(said) ? stripWake(said) : said;
      execute(parseVoiceCommand(cmd, links), said);
    },
    [execute, links],
  );

  // Build/tear down a recognition session for the current mode.
  const startSession = useCallback(
    (oneShot: boolean) => {
      const rec = getRecognition();
      if (!rec) {
        setSupported(false);
        return;
      }
      // Abort any prior session.
      try {
        recRef.current?.abort();
      } catch {
        /* ignore */
      }
      oneShotRef.current = oneShot;
      rec.lang = "en-US";
      rec.continuous = !oneShot;
      rec.interimResults = true;
      rec.onresult = (e: any) => {
        let interim = "";
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const r = e.results[i];
          if (r.isFinal) onFinal(r[0].transcript);
          else interim += r[0].transcript;
        }
        setHeard(interim);
      };
      rec.onerror = (e: any) => {
        // "no-speech"/"aborted" are normal; surface only permission problems.
        if (e?.error === "not-allowed" || e?.error === "service-not-allowed") {
          setSupported(false);
          setListening(false);
        }
      };
      rec.onend = () => {
        setHeard("");
        // Keep always-listening alive by restarting; stop after a one-shot.
        if (wakeRef.current && !oneShotRef.current) {
          try {
            rec.start();
          } catch {
            /* ignore */
          }
        } else {
          setListening(false);
        }
      };
      recRef.current = rec;
      try {
        rec.start();
        setListening(true);
      } catch {
        /* start() throws if already started — ignore */
      }
    },
    [onFinal],
  );

  const stopSession = useCallback(() => {
    try {
      recRef.current?.abort();
    } catch {
      /* ignore */
    }
    recRef.current = null;
    setListening(false);
    setHeard("");
  }, []);

  // Drive continuous listening from the wake toggle.
  useEffect(() => {
    if (!supported) return;
    if (wake) startSession(false);
    else if (!oneShotRef.current) stopSession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wake, supported]);

  // Clean up on unmount.
  useEffect(() => () => stopSession(), [stopSession]);

  function toggleWake() {
    const next = !wake;
    setWake(next);
    try {
      localStorage.setItem(LS_WAKE, next ? "1" : "0");
    } catch {
      /* ignore */
    }
    speak(next ? "Always listening. Say Shiva, then a command." : "Wake word off.");
  }

  function toggleMute() {
    const next = !muted;
    setMuted(next);
    try {
      localStorage.setItem(LS_MUTE, next ? "1" : "0");
    } catch {
      /* ignore */
    }
  }

  function pushToTalk() {
    if (listening && oneShotRef.current) {
      stopSession();
      return;
    }
    startSession(true);
  }

  if (!supported && !open) {
    // Still render a disabled affordance so the feature is discoverable.
  }

  return (
    <div className="fixed bottom-5 left-5 z-40 flex flex-col items-start gap-2 print:hidden">
      {open && (
        <div className="glass-panel w-72 rounded-xl border border-surface-border p-3 shadow-2xl">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-sm font-semibold text-gray-200">
              <Icon name="bot" className="h-4 w-4 text-brand" />
              Voice Command
            </span>
            <button onClick={() => setOpen(false)} className="text-xs text-gray-500 hover:text-white">
              close
            </button>
          </div>

          {!supported ? (
            <p className="mt-2 text-xs text-gray-500">
              Voice isn't available in this browser. Try Chrome or Edge, and allow
              microphone access.
            </p>
          ) : (
            <>
              <p className="mt-2 text-[11px] leading-relaxed text-gray-500">
                Say <span className="text-gray-300">"{WAKE_WORD}, go to findings"</span>,{" "}
                <span className="text-gray-300">"scan example dot com"</span>, or{" "}
                <span className="text-gray-300">"search for XSS"</span>. Say{" "}
                <span className="text-gray-300">"help"</span> anytime.
              </p>

              {/* Live transcript */}
              <div className="mt-2 min-h-[2.2rem] rounded-lg border border-surface-border bg-black/30 px-2.5 py-1.5 text-xs text-gray-300">
                {heard ? (
                  <span className="text-brand">{heard}…</span>
                ) : listening ? (
                  <span className="text-gray-500">Listening…</span>
                ) : (
                  <span className="text-gray-600">Idle</span>
                )}
              </div>

              {last && (
                <div className="mt-2 text-[11px]">
                  <p className="truncate text-gray-400">
                    <span className="text-gray-600">You:</span> {last.said}
                  </p>
                  <p className="truncate text-emerald-300/80">
                    <span className="text-gray-600">Shiva:</span> {last.reply}
                  </p>
                </div>
              )}

              {/* Controls */}
              <div className="mt-3 flex items-center gap-2">
                <button
                  onClick={pushToTalk}
                  className={`flex-1 rounded-lg px-2.5 py-1.5 text-xs font-semibold ${
                    listening && oneShotRef.current
                      ? "bg-red-500/20 text-red-300 ring-1 ring-red-500/40"
                      : "btn-primary"
                  }`}
                >
                  {listening && oneShotRef.current ? "Stop" : "🎙 Speak a command"}
                </button>
              </div>

              <label className="mt-3 flex cursor-pointer items-center justify-between text-[11px] text-gray-400">
                <span>Always listening (wake word)</span>
                <input type="checkbox" checked={wake} onChange={toggleWake} className="accent-emerald-500" />
              </label>
              <label className="mt-1.5 flex cursor-pointer items-center justify-between text-[11px] text-gray-400">
                <span>Mute spoken replies</span>
                <input type="checkbox" checked={muted} onChange={toggleMute} className="accent-emerald-500" />
              </label>
            </>
          )}
        </div>
      )}

      {/* Floating mic toggle */}
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label="Voice command center"
        title="Voice Command Center"
        className={`relative flex h-12 w-12 items-center justify-center rounded-full border shadow-lg transition ${
          listening
            ? "border-emerald-400/60 bg-emerald-500/20 text-emerald-200"
            : "border-surface-border bg-surface-card/80 text-gray-300 hover:border-brand hover:text-white"
        }`}
      >
        <Icon name="bot" className="h-5 w-5" />
        {(listening || wake) && (
          <span className="absolute -right-0.5 -top-0.5 flex h-3 w-3">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex h-3 w-3 rounded-full bg-emerald-500" />
          </span>
        )}
      </button>
    </div>
  );
}
