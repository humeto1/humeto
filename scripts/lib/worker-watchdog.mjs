// PM2 cannot detect a live process stuck awaiting I/O. Exit so it can restart it.
export function workerWatchdog({
  timeoutMs = 120000,
  checkMs = 10000,
  onStall = () => {
    console.error(
      "Document reader made no progress for two minutes; restarting to recover stalled I/O.",
    );
    process.exit(1);
  },
} = {}) {
  let progressAt = Date.now();
  const timer = setInterval(() => {
    if (Date.now() - progressAt >= timeoutMs) onStall();
  }, checkMs);
  timer.unref();
  return {
    touch() {
      progressAt = Date.now();
    },
    stop() {
      clearInterval(timer);
    },
  };
}
