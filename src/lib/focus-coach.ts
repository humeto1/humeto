// Deliberately local, bounded intent matching. No model or external service is used.
export type FocusAction =
  "progress" | "extend" | "pause" | "resume" | "blocked" | "complete" | "break";
export type FocusProposal = {
  action: FocusAction;
  note: string;
  minutes?: number;
  progress?: number;
  nextStep?: string;
  blocker?: string;
};
export function focusGuidance(blocker: string, nextStep = "") {
  if (blocker === "waiting")
    return "Waiting on someone? Save who or what you need, then switch to a task you can move forward. Your original task stays open.";
  if (blocker === "unclear")
    return "Make the next step smaller: identify the one question you need answered, or write the first sentence. Try a short five-minute session.";
  if (blocker === "overwhelmed")
    return "Let’s reduce the pressure. Take a pause, choose one small next step, or switch to something lighter. Your time is saved.";
  return nextStep
    ? `Your next step is “${nextStep}”. Want a short session to work on just that?`
    : "What is one small action you can do next? Save it below, or switch tasks if this one needs to wait.";
}
export function interpretFocus(
  message: string,
  state: string | null,
): { reply: string; proposal: FocusProposal | null } {
  const text = message.trim(),
    lower = text.toLowerCase();
  if (!state)
    return {
      reply:
        "Choose a task and your expected time first. Once you begin, you can tell me how it is going here.",
      proposal: null,
    };
  if (
    /\b(not blocked|not stuck|not waiting|not done|not finished|haven.t finished|haven.t completed|don.t (finish|complete|pause|stop)|do not)\b/.test(
      lower,
    )
  )
    return {
      reply:
        "I won’t mark this finished. Use Save progress to record an update, or choose one of the task controls.",
      proposal: null,
    };
  if (
    /\b(what.*(next|do)|help me|suggest|how.*start)\b/.test(lower) &&
    !/\b(blocked|stuck)\b/.test(lower)
  )
    return {
      reply:
        "Choose the smallest useful next step. If you are waiting on a person, switch to something you can act on; if the task is unclear, spend five minutes defining it. You stay in control of the timer.",
      proposal: null,
    };
  // Questions never silently become timer or completion actions.
  if (text.includes("?"))
    return {
      reply:
        "I can save progress, pause, resume, record a blocker or set your next check-in. Try “50% done, need 15 more minutes”. Review any proposed change before applying.",
      proposal: null,
    };
  if (
    /^(i.?m |i am |it.?s |task is |this is )?(done|finished|complete|completed)[.!\s]*$/.test(
      lower,
    )
  )
    return {
      reply:
        "Ready to mark this task done and save your time? Review and apply below.",
      proposal: { action: "complete", note: text },
    };
  const timedBreak = lower.match(
    /^(?:take |i need |start )?(?:a )?(\d{1,3})[- ]?min(?:ute)?s? (?:break|rest)[.!]*$/,
  );
  if (timedBreak && Number(timedBreak[1]) >= 1 && Number(timedBreak[1]) <= 120)
    return {
      reply: `Pause your work clock for a ${Number(timedBreak[1])}-minute break? The task stays open.`,
      proposal: { action: "break", note: text, minutes: Number(timedBreak[1]) },
    };
  if (
    /^(pause|take a break|i need a break|pause (the )?timer)[.!\s]*$/.test(
      lower,
    )
  )
    return {
      reply: "Pause the timer and keep your progress saved.",
      proposal: { action: "pause", note: text },
    };
  if (/^(resume|continue|back to work|resume (the )?timer)[.!\s]*$/.test(lower))
    return {
      reply:
        state === "running"
          ? "The timer is already running."
          : "Ready to pick this up again? I’ll check in after the selected time.",
      proposal: state === "running" ? null : { action: "resume", note: text },
    };
  if (
    /\b(blocked|stuck|waiting (on|for)|overwhelmed|don.t know|not sure how)\b/.test(
      lower,
    )
  ) {
    const blocker = /\b(waiting|reply|response|approval)\b/.test(lower)
      ? "waiting"
      : /\b(overwhelmed|too much|stress)\b/.test(lower)
        ? "overwhelmed"
        : /\b(unclear|don.t know|not sure)\b/.test(lower)
          ? "unclear"
          : "other";
    return {
      reply: focusGuidance(blocker),
      proposal: { action: "blocked", note: text, blocker },
    };
  }
  if (
    /(?:-\d+(?:\.\d+)?|\d+\.\d+)\s*(?:%|(?:more\s+)?(?:minutes?|mins?))/i.test(
      text,
    )
  )
    return {
      reply:
        "Use a whole-number percentage from 0–100 and a check-in time from 1–720 minutes.",
      proposal: null,
    };
  const percentage = text.match(/\b(\d{1,3})\s*%/),
    duration = lower.match(/\b(\d{1,3})\s*(?:more\s+)?(minutes?|mins?)\b/);
  if (
    (percentage && Number(percentage[1]) > 100) ||
    (duration && (Number(duration[1]) < 1 || Number(duration[1]) > 720))
  )
    return {
      reply: "Use progress from 0–100% and a check-in time from 1–720 minutes.",
      proposal: null,
    };
  const next = text.match(/(?:my )?next step\s*(?:is\s*:?|:)\s*(.{1,500})/i);
  const proposal: FocusProposal = {
    action: duration ? (state === "running" ? "extend" : "resume") : "progress",
    note: text,
  };
  if (percentage) proposal.progress = Number(percentage[1]);
  if (duration) proposal.minutes = Number(duration[1]);
  if (next) proposal.nextStep = next[1].trim();
  return {
    reply: duration
      ? `Set a new check-in in ${proposal.minutes} minutes${percentage ? ` and save ${proposal.progress}% progress` : ""}. This keeps the task open.`
      : percentage
        ? `Save ${proposal.progress}% progress. Only Mark task complete marks the task complete.`
        : "Save this as a progress note. Your timer and task status will stay as they are.",
    proposal,
  };
}
export function focusReply(
  action: string,
  minutes: number,
  progress?: number,
  blocker = "",
  nextStep = "",
) {
  if (action === "start")
    return `Let’s work on one thing. I’ll check in after ${minutes} minutes. What would a useful first step look like?`;
  if (action === "complete")
    return "Task completed. Your time and progress are saved. Take a breath, then choose what you want to move forward next.";
  if (action === "switch")
    return `Your previous task is still open and its time is saved. Let’s give this task ${minutes} minutes.`;
  if (action === "blocked") return focusGuidance(blocker, nextStep);
  if (action === "break")
    return "Break started. Your work timer is paused; your task stays open. Resume when you are ready.";
  if (action === "pause")
    return "Timer paused. Take your time; your progress and next step are saved.";
  if (action === "stop")
    return "Session saved. The task stays open, ready for you to return when it makes sense.";
  if (action === "extend" || action === "resume")
    return `Your ${progress === undefined ? "progress" : `${progress}% progress`} is saved. I’ll check in again in ${minutes} minutes.`;
  return `${progress === undefined ? "Update" : `${progress}% progress`} saved.${nextStep ? ` Next step: ${nextStep}` : " What is the smallest useful next step?"}`;
}
