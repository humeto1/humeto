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
}: {
  onInsert: (text: string) => void;
  disabled?: boolean;
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
      style={{
        width: "100%",
        flexShrink: 0,
        maxHeight: "30dvh",
        overflowY: "auto",
        fontSize: 12,
        lineHeight: 1.5,
      }}
    >
      {supported && (
        <button
          type="button"
          disabled={disabled}
          aria-pressed={listening}
          onClick={() => (listening ? recognition.current?.stop() : start())}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "8px 12px",
            minHeight: 44,
          }}
        >
          {listening ? <Square size={16} /> : <Mic size={16} />}
          {listening ? "Stop dictation" : "Dictate instruction"}
        </button>
      )}
      <p style={{ margin: "4px 0" }} role="status">
        {listening
          ? "Listening… Speak in your device’s language. Stop to review."
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
    </div>
  );
}
