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
  const [text, setText] = useState("");
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
      setText("");
      setError("");
      setListening(true);
      void nativeDictate()
        .then((transcript) => setText(transcript.slice(0, 2000)))
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
    setText("");
    setError("");
    setListening(true);
    r.onresult = (event) => {
      setText(
        Array.from(event.results, (result) => result[0]?.transcript || "")
          .join(" ")
          .slice(0, 2000),
      );
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
      <details
        open={listening || !!text || !!error || undefined}
        style={{
          position: "absolute",
          right: 0,
          bottom: "calc(100% + 10px)",
          width: "min(310px, calc(100vw - 48px))",
          maxHeight: "30dvh",
          overflowY: "auto",
          padding: "10px 14px",
          borderRadius: 16,
          background: "#fff",
          boxShadow: "0 4px 24px #183b3220",
          zIndex: 5,
        }}
      >
        <summary style={{ cursor: "pointer", color: "#536852" }}>
          About dictation
        </summary>
        <p style={{ margin: "4px 0" }} role="status">
          {listening
            ? nativeDictate
              ? "Speak in the speech window. Your transcript will appear here for review."
              : "Listening… Speak in your device’s language. Stop to review."
            : nativeDictate
              ? "Device speech recognition · Your speech provider may process audio online. Review the text before sending."
              : supported === false
                ? "To speak your instruction, use your keyboard’s microphone or a browser that supports dictation."
                : "Browser dictation · Your browser may process speech online. Humeto receives text only when you send it."}
        </p>
        {error && <p role="alert">{error}</p>}
        {text && (
          <div>
            <p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
              {text}
            </p>
            <button
              type="button"
              disabled={listening || disabled}
              onClick={() => {
                onInsert(text);
                setText("");
              }}
            >
              Use dictated text
            </button>{" "}
            <button
              type="button"
              disabled={listening}
              onClick={() => setText("")}
            >
              Discard
            </button>
            <p>Review and edit your instruction before sending.</p>
          </div>
        )}
      </details>
    </div>
  );
}
