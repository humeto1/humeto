import { useEffect, useRef, useState } from "react";
export function ProjectVoiceNote({
  disabled,
  onSend,
}: {
  disabled: boolean;
  onSend: (file: File) => Promise<boolean>;
}) {
  const [recording, setRecording] = useState(false),
    [seconds, setSeconds] = useState(0),
    [error, setError] = useState(""),
    [draft, setDraft] = useState<File | null>(null),
    [starting, setStarting] = useState(false);
  const stop = useRef<((send: boolean) => void) | null>(null),
    alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    const hide = () => {
      if (document.hidden) stop.current?.(false);
    };
    document.addEventListener("visibilitychange", hide);
    return () => {
      alive.current = false;
      stop.current?.(false);
      document.removeEventListener("visibilitychange", hide);
    };
  }, []);
  async function deliver(file: File) {
    setDraft(file);
    if (await onSend(file)) {
      if (alive.current) setDraft(null);
    }
  }
  async function start() {
    setStarting(true);
    setError("");
    let stream: MediaStream | undefined, context: AudioContext | undefined;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true },
        video: false,
      });
      if (!alive.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      context = new AudioContext({ sampleRate: 16000 });
      await context.resume();
      if (!alive.current) {
        stream.getTracks().forEach((t) => t.stop());
        void context.close();
        return;
      }
      if (context.sampleRate !== 16000)
        throw Error("This device cannot record this voice-note format.");
      const source = context.createMediaStreamSource(stream),
        processor = context.createScriptProcessor(4096, 1, 1),
        chunks: Int16Array[] = [];
      let samples = 0,
        finished = false;
      const began = Date.now();
      const timer = setInterval(() => {
        setSeconds(Math.min(60, Math.floor((Date.now() - began) / 1000)));
        if (Date.now() - began >= 60000) finish(true);
      }, 200);
      function finish(send: boolean) {
        if (finished) return;
        finished = true;
        clearInterval(timer);
        processor.disconnect();
        source.disconnect();
        stream!.getTracks().forEach((t) => t.stop());
        void context!.close();
        stop.current = null;
        if (alive.current) {
          setRecording(false);
          setSeconds(0);
        }
        if (!send || !samples) {
          if (send && alive.current)
            setError("No audio was recorded. Please try again.");
          return;
        }
        const buffer = new ArrayBuffer(44 + samples * 2),
          v = new DataView(buffer);
        const text = (at: number, s: string) =>
          [...s].forEach((c, i) => v.setUint8(at + i, c.charCodeAt(0)));
        text(0, "RIFF");
        v.setUint32(4, buffer.byteLength - 8, true);
        text(8, "WAVE");
        text(12, "fmt ");
        v.setUint32(16, 16, true);
        v.setUint16(20, 1, true);
        v.setUint16(22, 1, true);
        v.setUint32(24, 16000, true);
        v.setUint32(28, 32000, true);
        v.setUint16(32, 2, true);
        v.setUint16(34, 16, true);
        text(36, "data");
        v.setUint32(40, samples * 2, true);
        let at = 44;
        for (const chunk of chunks)
          for (const n of chunk) {
            v.setInt16(at, n, true);
            at += 2;
          }
        void deliver(
          new File(
            [buffer],
            `Voice note ${new Date().toISOString().replaceAll(":", "-")}.wav`,
            { type: "audio/wav" },
          ),
        );
      }
      stop.current = finish;
      processor.onaudioprocess = (e) => {
        if (finished) return;
        const input = e.inputBuffer.getChannelData(0),
          size = Math.min(input.length, 960000 - samples),
          chunk = new Int16Array(size);
        for (let i = 0; i < size; i++)
          chunk[i] = Math.round(
            Math.max(-1, Math.min(1, input[i])) *
              (input[i] < 0 ? 32768 : 32767),
          );
        chunks.push(chunk);
        samples += size;
        if (samples >= 960000) finish(true);
      };
      source.connect(processor);
      processor.connect(context.destination);
      setRecording(true);
      setSeconds(0);
    } catch (e) {
      stream?.getTracks().forEach((t) => t.stop());
      void context?.close();
      setError((e as Error).message || "Microphone access is unavailable.");
    } finally {
      if (alive.current) setStarting(false);
    }
  }
  return (
    <div className="project-voice-note">
      {error && <p role="alert">{error}</p>}
      {recording ? (
        <>
          <span role="status">Recording · {seconds}s / 60s</span>
          <button type="button" onClick={() => stop.current?.(true)}>
            Send voice note
          </button>
          <button type="button" onClick={() => stop.current?.(false)}>
            Cancel recording
          </button>
        </>
      ) : (
        <button
          type="button"
          disabled={disabled || starting || !!draft}
          onClick={() => void start()}
        >
          {starting ? "Opening microphone…" : "Record voice note"}
        </button>
      )}
      {draft && (
        <button
          type="button"
          disabled={disabled}
          onClick={() => void deliver(draft)}
        >
          Retry sending voice note
        </button>
      )}
      {draft && (
        <button
          type="button"
          disabled={disabled}
          onClick={() => setDraft(null)}
        >
          Discard voice note
        </button>
      )}
      <small>
        Up to one minute. Automatically sends at 60 seconds. Leaving this screen
        cancels recording.
      </small>
    </div>
  );
}
export function ProjectMediaPreview({
  path,
  mime,
  request,
}: {
  path: string;
  mime: string;
  request: (path: string) => Promise<any>;
}) {
  const [url, setUrl] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const object = useRef(""),
    live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      if (object.current) URL.revokeObjectURL(object.current);
    };
  }, [path]);
  async function load() {
    setBusy(true);
    try {
      const r = await request(path + "&media=1");
      if (!live.current) return;
      const bytes = Uint8Array.from(atob(r.bytes), (c) => c.charCodeAt(0));
      object.current = URL.createObjectURL(new Blob([bytes], { type: r.mime }));
      setUrl(object.current);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      if (live.current) setBusy(false);
    }
  }
  return (
    <span>
      {!url ? (
        <button type="button" disabled={busy} onClick={() => void load()}>
          {mime.startsWith("audio/") ? "Play voice note" : "View image"}
        </button>
      ) : mime.startsWith("audio/") ? (
        <audio src={url} controls preload="metadata" />
      ) : (
        <img
          src={url}
          alt="Shared project attachment"
          style={{ maxWidth: "100%", maxHeight: 360, objectFit: "contain" }}
        />
      )}
      {error && <small role="alert">{error}</small>}
    </span>
  );
}
