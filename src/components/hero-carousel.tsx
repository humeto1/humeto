"use client";

import { useEffect, useRef, useState } from "react";
import {
  ArrowUpRight,
  Check,
  ChevronLeft,
  ChevronRight,
  LayoutGrid,
  Pause,
  Play,
  Sparkles,
} from "lucide-react";
import styles from "./hero-carousel.module.css";

const labels = [
  "Education & immigration CRM",
  "Simplified task management",
  "Application assistant",
];
const duration = 8000;

export default function HeroCarousel({
  originalHero,
}: {
  originalHero: string;
}) {
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [reduced, setReduced] = useState(true);
  const [visible, setVisible] = useState(true);
  const [elapsed, setElapsed] = useState(0);
  const elapsedRef = useRef(0);
  const running = !paused && !hovered && !focused && !reduced && visible;

  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updateMotion = () => setReduced(preference.matches);
    const updateVisibility = () => setVisible(!document.hidden);
    updateMotion();
    updateVisibility();
    preference.addEventListener("change", updateMotion);
    document.addEventListener("visibilitychange", updateVisibility);
    return () => {
      preference.removeEventListener("change", updateMotion);
      document.removeEventListener("visibilitychange", updateVisibility);
    };
  }, []);

  useEffect(() => {
    if (!running) return;
    let previous = performance.now();
    const timer = window.setInterval(() => {
      const now = performance.now();
      elapsedRef.current += now - previous;
      previous = now;
      if (elapsedRef.current >= duration) {
        elapsedRef.current = 0;
        setActive((slide) => (slide + 1) % labels.length);
      }
      setElapsed(elapsedRef.current);
    }, 100);
    return () => window.clearInterval(timer);
  }, [running]);

  function select(index: number) {
    setActive((index + labels.length) % labels.length);
    elapsedRef.current = 0;
    setElapsed(0);
  }

  return (
    <section
      className={styles.carousel}
      aria-label="Discover Humeto"
      aria-roledescription="carousel"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocusCapture={() => setFocused(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget))
          setFocused(false);
      }}
    >
      <div
        className={styles.slide}
        hidden={active !== 0}
        role="group"
        aria-roledescription="slide"
        aria-label="1 of 3: Education and immigration CRM"
        dangerouslySetInnerHTML={{ __html: originalHero }}
      />
      <div
        className={styles.slide}
        hidden={active !== 1}
        role="group"
        aria-roledescription="slide"
        aria-label="2 of 3: Simplified task management"
      >
        <div className="hero wrap">
          <div className="hero-copy">
            <div className="eyebrow">
              <span className="status-dot" /> Make space. <em>For what matters.</em>
            </div>
            <h1>
              Task Management
              <br />
              <em>AI Goal Chasing</em>
            </h1>
            <p className="hero-description">
              Turn ideas into tasks, connect them to your goals, and stay focused
              with timers, progress tracking and AI follow-ups.
            </p>
            <div className="hero-buttons">
              <a href="/workspace/tasks" className="button">
                Find your focus <ArrowUpRight size={16} />
              </a>
              <a href="#tasks" className="button button-outline">
                Explore task management
              </a>
            </div>
            <div className="hero-note">
              <span className="mini-check">✓</span> Four priorities. One clear
              view.
            </div>
            <div className="hero-people">
              <div className="avatar-stack">
                <span className="avatar peach">AL</span>
                <span className="avatar sage">RK</span>
                <span className="avatar lavender">MJ</span>
              </div>
              <div>
                <strong>Your work, at your own pace.</strong>
                <small>For individuals, teams & everything in between.</small>
              </div>
            </div>
          </div>
          <div className="hero-visual">
            <div className="hero-photo">
              <img
                src="/assets/hero-tasks.webp"
                alt="Creative professional planning a focused day in a sunlit studio"
              />
              <div className="photo-caption">
                <span className="location-pin">
                  <LayoutGrid size={16} />
                </span>
                <span>
                  A clearer day starts here.
                  <small>Less juggling. More doing.</small>
                </span>
                <span className="caption-arrow">↗</span>
              </div>
            </div>
            <div className="floating-card offer-card">
              <span className="success-icon">
                <Check size={20} />
              </span>
              <div>
                <span className="floating-label">
                  A LITTLE WIN FOR YOUR DAY.
                </span>
                <strong>Room for your best work.</strong>
                <p>Three priorities. One peaceful morning.</p>
              </div>
              <span className="float-check">✓</span>
            </div>
            <div className={`${styles.taskCard} floating-card`}>
              <div className={styles.cardHeading}>
                <LayoutGrid size={16} />
                <strong>Today, with intention.</strong>
                <span>Sample board</span>
              </div>
              <div className={styles.matrix}>
                <div>
                  <small>IMPORTANT · URGENT</small>
                  <strong>Send final application</strong>
                  <span>Today · 10:30</span>
                </div>
                <div>
                  <small>IMPORTANT · NOT URGENT</small>
                  <strong>Plan the next chapter</strong>
                  <span>Scheduled for Friday</span>
                </div>
                <div>
                  <small>URGENT · NOT IMPORTANT</small>
                  <strong>Confirm team meeting</strong>
                  <span>Delegate to Alex</span>
                </div>
                <div>
                  <small>NOT URGENT · NOT IMPORTANT</small>
                  <strong>Explore new ideas</strong>
                  <span>Whenever inspiration hits</span>
                </div>
              </div>
              <div className={styles.cardFoot}>
                Matrix for clarity. Kanban for momentum.
              </div>
            </div>
            <div className="round-sticker">
              LESS RUSH
              <br />
              <span>✳</span>
              <br />
              MORE FOCUS
            </div>
          </div>
        </div>
      </div>
      <div
        className={styles.slide}
        hidden={active !== 2}
        role="group"
        aria-roledescription="slide"
        aria-label="3 of 3: Application assistant"
      >
        <div className="hero wrap">
          <div className="hero-copy">
            <div className="eyebrow">
              <span className="status-dot" /> Big ambitions. <em>Less busywork.</em>
            </div>
            <h1>
              AI Form Filling
              <br />
              <em>Chrome Extension</em>
            </h1>
            <p className="hero-description">
              Upload your documents. AI reads and organizes your information, then
              helps fill long forms for jobs, study, visas and more—with you in
              control.
            </p>
            <div className="hero-buttons">
              <a href="/workspace/settings" className="button">
                Explore the extension <ArrowUpRight size={16} />
              </a>
              <a href="#application-assist" className="button button-outline">
                Meet your form helper
              </a>
            </div>
            <div className="hero-note">
              <span className="mini-check">✓</span> Your review. Your answers.
              Your next opportunity.
            </div>
            <div className={styles.futureNote}>
              <Sparkles size={14} />
              <span>
                Coming next: document reading & AI chat.
                <br />
                <small>Ask a question. Find a detail. Keep moving.</small>
              </span>
            </div>
          </div>
          <div className="hero-visual">
            <div className="hero-photo">
              <img
                src="/assets/hero-assistant.webp"
                alt="International applicant reviewing documents beside a laptop in a warm library"
              />
              <div className="photo-caption">
                <span className="location-pin">
                  <Sparkles size={16} />
                </span>
                <span>
                  Your next opportunity is calling.
                  <small>Bring your information along.</small>
                </span>
                <span className="caption-arrow">↗</span>
              </div>
            </div>
            <div className="floating-card offer-card">
              <span className="success-icon">
                <Sparkles size={20} />
              </span>
              <div>
                <span className="floating-label">
                  ONE PROFILE. SO MANY POSSIBILITIES.
                </span>
                <strong>A helpful hand for every form.</strong>
                <p>Student · Job · Visa applications</p>
              </div>
              <span className="float-check">✓</span>
            </div>
            <div className={`${styles.assistantCard} floating-card`}>
              <div className={styles.cardHeading}>
                <Sparkles size={16} />
                <strong>Humeto, help me find…</strong>
              </div>
              <span className={styles.concept}>AI CHAT · PLANNED CONCEPT</span>
              <p className={styles.question}>
                When does Amira’s passport expire?
              </p>
              <div className={styles.answer}>
                <span>From the sample passport</span>
                <strong>30 September 2031</strong>
                <small>Source: Passport · page 1</small>
              </div>
              <div className={styles.suggestion}>
                <Check size={13} /> Suggested answer · review before filling
              </div>
            </div>
            <div className="round-sticker">
              LESS TYPING
              <br />
              <span>✳</span>
              <br />
              MORE LIVING
            </div>
          </div>
        </div>
      </div>
      <div className={`${styles.controls} wrap`}>
        <div
          className={styles.tabs}
          role="group"
          aria-label="Choose a homepage cover"
        >
          {labels.map((label, index) => (
            <button
              key={label}
              className={active === index ? styles.selected : ""}
              aria-label={`Show ${label}`}
              aria-pressed={active === index}
              onClick={() => select(index)}
            >
              <span className={styles.tabNumber}>0{index + 1}</span>
              <span>{label}</span>
              <span className={styles.track}>
                <span
                  style={{
                    width:
                      active === index
                        ? `${(elapsed / duration) * 100}%`
                        : "0%",
                  }}
                />
              </span>
            </button>
          ))}
        </div>
        <div className={styles.actions}>
          <span className={styles.counter}>0{active + 1} / 03</span>
          <button
            aria-label="Previous cover"
            onClick={() => select(active - 1)}
          >
            <ChevronLeft size={17} />
          </button>
          <button
            aria-label={
              paused || reduced
                ? "Play cover slideshow"
                : "Pause cover slideshow"
            }
            onClick={() => {
              if (reduced) setReduced(false);
              setPaused(!(paused || reduced));
            }}
          >
            {paused || reduced ? <Play size={14} /> : <Pause size={14} />}
          </button>
          <button aria-label="Next cover" onClick={() => select(active + 1)}>
            <ChevronRight size={17} />
          </button>
        </div>
      </div>
      <p className={styles.timing}>
        A new perspective every 8 seconds. Pause and explore at your own pace.
      </p>
    </section>
  );
}
