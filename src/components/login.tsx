"use client";
import { useState } from "react";
import {
  ArrowUpRight,
  ArrowLeft,
  Check,
  ShieldCheck,
  GraduationCap,
  Building2,
  User,
  LoaderCircle,
} from "lucide-react";
export default function Login({ demoEnabled }: { demoEnabled: boolean }) {
  const [mode, setMode] = useState("login"),
    [busy, setBusy] = useState(""),
    [error, setError] = useState("");
  async function submit(action: string, body: unknown, key = action) {
    setBusy(key);
    setError("");
    try {
      const r = await fetch("/api/auth/" + action, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      location.href = "/workspace";
    } catch (e) {
      setError((e as Error).message);
      setBusy("");
    }
  }
  return (
    <main className="auth-page">
      <section className="auth-story">
        <a href="/" className="app-logo">
          <span>h</span>humeto.
        </a>
        <div>
          <span className="eyebrow">ROOM FOR WHAT COMES NEXT</span>
          <h1>
            Big plans.
            <br />
            <em>
              A calmer place
              <br />
              to start.
            </em>
          </h1>
          <p>
            Your information, your documents and your next important step. All
            together.
          </p>
          <div className="auth-assurance">
            <Check size={15} /> Small steps. Saved progress. Your own pace.
          </div>
        </div>
        <img
          src="/assets/library.webp"
          alt="Students working together in a bright library"
        />
        <span className="auth-image-note">
          AI-generated illustration · fictional local demo
        </span>
      </section>
      <section className="auth-form-area">
        <a href="/" className="subtle-link">
          <ArrowLeft size={15} /> Back to Humeto
        </a>
        <div className="auth-form-content">
          <span className="eyebrow">A LITTLE MORE ORGANIZED</span>
          <h2>{mode === "login" ? "Welcome back." : "Your next chapter."}</h2>
          <p>
            {mode === "login"
              ? "Sign in to pick up where you left off."
              : "Create a local individual workspace."}
          </p>
          {error && (
            <div className="notice error" role="alert">
              {error}
            </div>
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              submit(mode, {
                name: f.get("name"),
                email: f.get("email"),
                password: f.get("password"),
              });
            }}
          >
            {mode === "register" && (
              <label>
                Your name
                <input
                  required
                  name="name"
                  autoComplete="name"
                  placeholder="Alex Morgan"
                />
              </label>
            )}
            <label>
              Email address
              <input
                name="email"
                type="email"
                required
                autoComplete="email"
                placeholder="you@example.com"
              />
            </label>
            <label>
              Password
              <input
                name="password"
                type="password"
                required
                minLength={mode === "register" ? 12 : 1}
                autoComplete={
                  mode === "login" ? "current-password" : "new-password"
                }
                placeholder={
                  mode === "register"
                    ? "At least 12 characters"
                    : "Your password"
                }
              />
            </label>
            <button className="btn primary full" disabled={!!busy}>
              {busy === mode ? (
                <LoaderCircle className="spin" size={16} />
              ) : (
                <>
                  {mode === "login" ? "Sign in" : "Create workspace"}
                  <ArrowUpRight size={16} />
                </>
              )}
            </button>
          </form>
          {demoEnabled && (
            <button
              className="auth-mode"
              onClick={() => {
                setMode(mode === "login" ? "register" : "login");
                setError("");
              }}
            >
              {mode === "login"
                ? "New here? Create an individual workspace"
                : "Already have a workspace? Sign in"}
            </button>
          )}
          {demoEnabled && (
            <div className="demo-entry">
              <div className="divider-label">OR EXPLORE A LOCAL DEMO</div>
              <div className="demo-login-grid">
                {[
                  {
                    id: "ayesha",
                    title: "Institute",
                    desc: "Manage students & applications",
                    icon: Building2,
                  },
                  {
                    id: "amira",
                    title: "Student",
                    desc: "A calm, personal intake journey",
                    icon: GraduationCap,
                  },
                  {
                    id: "admin",
                    title: "Super admin",
                    desc: "Institutes & subscriptions",
                    icon: ShieldCheck,
                  },
                  {
                    id: "solo",
                    title: "Individual",
                    desc: "Your own application workspace",
                    icon: User,
                  },
                ].map((d) => (
                  <button
                    key={d.id}
                    disabled={!!busy}
                    onClick={() => submit("demo", { userId: d.id }, d.id)}
                  >
                    <d.icon size={20} />
                    <strong>{d.title}</strong>
                    <small>{d.desc}</small>
                    {busy === d.id && (
                      <LoaderCircle size={13} className="spin" />
                    )}
                  </button>
                ))}
              </div>
              <p className="tiny">
                Local demo accounts use fictional data. Real credentials are
                required outside the loopback development preview.
              </p>
            </div>
          )}
        </div>
        <div className="auth-footer">
          <ShieldCheck size={14} /> HTTP-only sessions · tenant-scoped server
          access
        </div>
      </section>
    </main>
  );
}
