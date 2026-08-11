"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icons";
import {
  parseVoiceCommand,
  resolveFollowup,
  hasWakeWord,
  stripWake,
  WAKE_WORD,
  type NavLink,
  type VoiceIntent,
  type Pending,
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

  const [pending, setPending] = useState<Pending | null>(null); // awaiting an answer

  const recRef = useRef<SR | null>(null);
  const wakeRef = useRef(false); // latest wake value for async callbacks
  const oneShotRef = useRef(false); // push-to-talk single command
  const mutedRef = useRef(false);
  const pendingRef = useRef<Pending | null>(null); // latest pending for async callbacks
  const pendingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const voiceRef = useRef<SpeechSynthesisVoice | null>(null); // preferred TTS voice

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

  // Pick the warmest natural-sounding English voice available (loads async).
  useEffect(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    const pickVoice = () => {
      const vs = window.speechSynthesis.getVoices();
      if (!vs.length) return;
      const prefer = [
        "Samantha",
        "Google UK English Female",
        "Google US English",
        "Microsoft Aria Online (Natural) - English (United States)",
        "Microsoft Jenny Online (Natural) - English (United States)",
        "Karen",
        "Serena",
        "Moira",
        "Tessa",
        "Fiona",
        "Victoria",
      ];
      let v = vs.find((x) => prefer.includes(x.name));
      if (!v) v = vs.find((x) => /^en/i.test(x.lang) && /female|aria|jenny|samantha|karen|serena|natural/i.test(x.name));
      if (!v) v = vs.find((x) => /^en/i.test(x.lang));
      voiceRef.current = v ?? vs[0] ?? null;
    };
    pickVoice();
    window.speechSynthesis.onvoiceschanged = pickVoice;
    return () => {
      try {
        window.speechSynthesis.onvoiceschanged = null;
      } catch {
        /* ignore */
      }
    };
  }, []);

  const speak = useCallback((text: string) => {
    if (mutedRef.current || typeof window === "undefined" || !("speechSynthesis" in window)) return;
    try {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      if (voiceRef.current) u.voice = voiceRef.current;
      // Slightly slower + a touch higher = calmer, friendlier delivery.
      u.rate = 0.98;
      u.pitch = 1.08;
      u.volume = 1;
      window.speechSynthesis.speak(u);
    } catch {
      /* ignore */
    }
  }, []);

  // A status question — look up live state and speak the real answer. The filler
  // ("let me check") was already spoken by applyIntent; speechSynthesis queues, so
  // the answer follows it naturally.
  const runQuery = useCallback(
    async (topic: string, said: string) => {
      try {
        const res = await fetch(`/api/voice/brief?topic=${encodeURIComponent(topic)}`, {
          headers: { accept: "application/json" },
        });
        const data = (await res.json()) as { speak?: string };
        const reply =
          data?.speak || "Sorry, I couldn't get that right now. Please try again.";
        setLast({ said, reply });
        speak(reply);
      } catch {
        const reply = "Sorry, I couldn't reach the portal just now.";
        setLast({ said, reply });
        speak(reply);
      }
    },
    [speak],
  );

  const applyIntent = useCallback(
    (intent: VoiceIntent, said: string) => {
      setLast({ said, reply: intent.speak });
      speak(intent.speak);
      if (pendingTimer.current) clearTimeout(pendingTimer.current);

      // The assistant asked a question — remember what we're waiting for so the
      // next utterance is treated as the answer (no wake word needed).
      if (intent.type === "ask") {
        pendingRef.current = intent.pending;
        setPending(intent.pending);
        pendingTimer.current = setTimeout(() => {
          pendingRef.current = null;
          setPending(null);
        }, 20000);
        return;
      }

      pendingRef.current = null;
      setPending(null);
      switch (intent.type) {
        case "navigate":
        case "scan":
        case "search":
          router.push(intent.href);
          break;
        case "query":
          void runQuery(intent.topic, said);
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
    [router, speak, runQuery],
  );

  // Handle a finalized transcript.
  const onFinal = useCallback(
    (transcript: string) => {
      const said = transcript.trim();
      if (!said) return;
      // Answering a question we just asked — no wake word required.
      if (pendingRef.current) {
        applyIntent(resolveFollowup(pendingRef.current, said, links), said);
        return;
      }
      // In always-listening mode, only act when the wake word is present.
      if (wakeRef.current && !oneShotRef.current) {
        if (!hasWakeWord(said)) return;
        applyIntent(parseVoiceCommand(stripWake(said), links), said);
        return;
      }
      // Push-to-talk: wake word optional.
      const cmd = hasWakeWord(said) ? stripWake(said) : said;
      applyIntent(parseVoiceCommand(cmd, links), said);
    },
    [applyIntent, links],
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
  useEffect(
    () => () => {
      stopSession();
      if (pendingTimer.current) clearTimeout(pendingTimer.current);
    },
    [stopSession],
  );

  function toggleWake() {
    const next = !wake;
    setWake(next);
    try {
      localStorage.setItem(LS_WAKE, next ? "1" : "0");
    } catch {
      /* ignore */
    }
    speak(next ? "I'm listening now. Just say Shiva, then tell me what you need." : "Okay, I've stopped listening.");
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
    <div className="fixed bottom-10 left-5 z-40 flex flex-col items-start gap-2 print:hidden">
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
                Talk to me naturally — <span className="text-gray-300">"{WAKE_WORD}, take me to findings"</span>,{" "}
                <span className="text-gray-300">"scan example dot com"</span>,{" "}
                <span className="text-gray-300">"what's running?"</span>,{" "}
                <span className="text-gray-300">"how many critical findings?"</span>, or{" "}
                <span className="text-gray-300">"brief me"</span> and I'll read you the status.
                I'll ask if I'm unsure, and you can answer back.
              </p>

              {/* Waiting-for-answer hint */}
              {pending && (
                <p className="mt-2 rounded-lg border border-brand/30 bg-brand/5 px-2.5 py-1.5 text-[11px] text-brand-glow">
                  {pending.kind === "confirmScan"
                    ? "Waiting for yes or no…"
                    : pending.kind === "scanTarget"
                    ? "Waiting for a target…"
                    : "Waiting — tell me where to go…"}
                </p>
              )}

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
                  <p className="truncate text-brand/80">
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
                      ? "bg-sev-crit/20 text-sev-crit ring-1 ring-red-500/40"
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
            ? "border-emerald-400/60 bg-brand/20 text-brand"
            : "border-surface-border bg-surface-card/80 text-gray-300 hover:border-brand hover:text-white"
        }`}
      >
        <Icon name="bot" className="h-5 w-5" />
        {(listening || wake) && (
          <span className="absolute -right-0.5 -top-0.5 flex h-3 w-3">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex h-3 w-3 rounded-full bg-brand" />
          </span>
        )}
      </button>
    </div>
  );
}
