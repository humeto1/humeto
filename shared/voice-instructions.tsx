"use client";
import { useEffect, useRef, useState } from "react";
import { Mic, Square } from "lucide-react";

type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult:
    | ((event: {
        results: ArrayLike<ArrayLike<{ transcript: string }>>;
      }) => void)
    | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
};
type SpeechWindow = Window & {
  SpeechRecognition?: new () => Recognition;
  webkitSpeechRecognition?: new () => Recognition;
};

/** Browser-managed dictation only: never records/uploads audio to Humeto. */
export function VoiceInstructions({
  onInsert,
  disabled = false,
  nativeDictate,
}: {
  onInsert: (text: string) => void;
  disabled?: boolean;
  nativeDictate?: () => Promise<string>;
}) {
  const [supported, setSupported] = useState<boolean | null>(null);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState("");
  const recognition = useRef<Recognition | null>(null);
  useEffect(() => {
    const w = window as SpeechWindow;
    setSupported(
      !!(w.SpeechRecognition || w.webkitSpeechRecognition) &&
        window.isSecureContext,
    );
    const stop = () => {
      if (document.hidden) recognition.current?.stop();
    };
    document.addEventListener("visibilitychange", stop);
    return () => {
      document.removeEventListener("visibilitychange", stop);
      const r = recognition.current;
      if (r) {
        r.onresult = null;
        r.onerror = null;
        r.onend = null;
        r.abort();
      }
    };
  }, []);
  useEffect(() => {
    if (disabled) recognition.current?.stop();
  }, [disabled]);
  function start() {
    if (nativeDictate) {
      if (listening) return;
      setError("");
      setListening(true);
      void nativeDictate()
        .then((transcript) => {
          if (transcript.trim()) onInsert(transcript.slice(0, 2000));
        })
        .catch((cause: unknown) =>
          setError(
            cause instanceof Error
              ? cause.message
              : "Unable to start speech recognition.",
          ),
        )
        .finally(() => setListening(false));
      return;
    }
    const w = window as SpeechWindow;
    const Constructor = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!Constructor || recognition.current) return;
    const r = new Constructor();
    recognition.current = r;
    r.lang = navigator.language || "en-US";
    r.continuous = false;
    r.interimResults = true;
    let transcript = "";
    setError("");
    setListening(true);
    r.onresult = (event) => {
      transcript = Array.from(
        event.results,
        (result) => result[0]?.transcript || "",
      )
        .join(" ")
        .slice(0, 2000);
    };
    r.onerror = ({ error: code }) =>
      setError(
        code === "not-allowed" || code === "service-not-allowed"
          ? "Microphone access or speech recognition was denied. Check browser permissions, or use your keyboard microphone."
          : code === "no-speech"
            ? "No speech heard. Try again."
            : "Speech recognition is unavailable. Try again, type, or use your keyboard microphone.",
      );
    r.onend = () => {
      if (transcript.trim()) onInsert(transcript);
      transcript = "";
      recognition.current = null;
      setListening(false);
    };
    try {
      r.start();
    } catch {
      recognition.current = null;
      setListening(false);
      setError(
        "Unable to start dictation. Type or use your keyboard microphone.",
      );
    }
  }
  return (
    <div
      className="voice-instructions"
      style={{
        position: "relative",
        alignSelf: "center",
        flexShrink: 0,
        fontSize: 12,
        lineHeight: 1.5,
      }}
    >
      {(nativeDictate || supported) && (
        <button
          type="button"
          disabled={disabled || (!!nativeDictate && listening)}
          aria-label={
            listening
              ? nativeDictate
                ? "Listening…"
                : "Stop dictation"
              : "Dictate instruction"
          }
          title="Dictate instruction"
          aria-pressed={listening}
          onClick={() => (listening ? recognition.current?.stop() : start())}
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 0,
            width: 48,
            height: 48,
            minWidth: 48,
            minHeight: 48,
            border: 0,
            borderRadius: "50%",
            background: listening ? "#a93c36" : "#204e3e",
            color: "white",
          }}
        >
          {listening ? <Square size={22} /> : <Mic size={24} />}
        </button>
      )}
      {error && (
        <p
          role="alert"
          style={{
            position: "absolute",
            right: 0,
            bottom: "100%",
            width: "min(310px, calc(100vw - 48px))",
            padding: 12,
            borderRadius: 12,
            background: "#fff",
            boxShadow: "0 4px 24px #183b3220",
            zIndex: 5,
          }}
        >
          {error}
        </p>
      )}
    </div>
  );
}
