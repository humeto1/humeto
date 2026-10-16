"use client";
import { useState, useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  LayoutDashboard,
  Users,
  GraduationCap,
  FolderOpen,
  CheckSquare,
  MessageSquare,
  History,
  Settings,
  Search,
  Bell,
  ArrowUpRight,
  ArrowRight,
  Plus,
  LogOut,
  ChevronRight,
  Globe,
  FileText,
  Calendar,
  Check,
  Clock,
  Grid2X2,
  Columns3,
  List,
  Download,
  Upload,
  ShieldCheck,
  Building2,
  Menu,
  X,
  LoaderCircle,
  AlertCircle,
  CheckCircle2,
  CloudCheck,
  User,
  Briefcase,
  MapPin,
  Languages,
  Wallet,
  Plane,
  Compass,
  AtSign,
  Link2,
  Eye,
  Camera,
  Copy,
  Sparkles,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type {
  Actor,
  Person,
  Application,
  Task,
  DocumentRow,
  Intake,
} from "@/lib/types";
import { sections, destinations } from "@/lib/sections";
import ImportHistory from "./import-history";
import TaskAssistant from "./task-assistant";
import ReminderBell from "./reminder-bell";
import ImportPanel from "./import-panel";
import ApplicationChecklist from "./application-checklist";
import SectionEditor, { type EditorHandle } from "./section-editor";
type RequestRow = {
  id: string;
  person_id: string;
  person_name: string;
  section_key: string;
  title: string;
  message: string;
  status: string;
  created_at: string;
};
type Activity = {
  id: string;
  actor_name?: string;
  summary: string;
  created_at: string;
};
type Subscription = {
  plan: string;
  status: string;
  seats: number;
  case_limit: number;
  storage_mb: number;
  expires_at: string;
};
type Data = {
  people: Person[];
  applications: Application[];
  tasks: Task[];
  documents: DocumentRow[];
  requests: RequestRow[];
  activity: Activity[];
  subscription: Subscription;
};
type Tenant = {
  id: string;
  name: string;
  type: string;
  plan: string;
  status: string;
  seats: number;
  case_limit: number;
  storage_mb: number;
  case_count: number;
  expires_at: string;
};
const iconMap: Record<string, LucideIcon> = {
  user: User,
  map: MapPin,
  identity: ShieldCheck,
  users: Users,
  education: GraduationCap,
  compass: Compass,
  languages: Languages,
  briefcase: Briefcase,
  timeline: History,
  file: FileText,
  globe: Globe,
  plane: Plane,
  wallet: Wallet,
  at: AtSign,
  shield: ShieldCheck,
};
const navItems = [
  ["overview", "Overview", LayoutDashboard],
  ["tasks", "Tasks to-do", CheckSquare],
  ["students", "Applicants", Users],
  ["applications", "Applications", GraduationCap],
  ["documents", "Documents", FolderOpen],
  ["assistant", "Humeto assistant", Sparkles],
  ["requests", "Requests", MessageSquare],
  ["activity", "Activity", History],
] as const;
const states = ["To do", "In progress", "Waiting", "Review", "Done"];
const initials = (name: string) =>
  name
    .split(" ")
    .map((s) => s[0])
    .join("")
    .slice(0, 2);
const quadrant = (t: Task) =>
  t.important
    ? t.urgent
      ? "Do now"
      : "Schedule"
    : t.urgent
      ? "Delegate"
      : "Later";
const dateLabel = (s: string) =>
  s
    ? new Date(s + "T12:00:00").toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
      })
    : "No date";
export function Badge({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone?: string;
}) {
  const value = String(children);
  const color =
    tone ||
    (/ready|active|reviewed|resolved|done|entered/i.test(value)
      ? "green"
      : /needed|draft|trial|waiting|received|collecting|review/i.test(value)
        ? "amber"
        : /cancel|read-only|changes/i.test(value)
          ? "red"
          : "neutral");
  return <span className={`badge ${color}`}>{children}</span>;
}
function Avatar({
  person,
}: {
  person: Pick<Person, "name" | "color" | "initials">;
}) {
  return (
    <span className={`person-avatar ${person.color}`}>
      {person.initials || initials(person.name)}
    </span>
  );
}
function Empty({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="empty-card">
      <FolderOpen size={30} />
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}
export default function Workspace({
  actor,
  initial,
  view,
  initialPerson,
  initialIntake = [],
  initialSection,
}: {
  initialSection?: string;
  actor: Actor;
  initial: Data;
  view: string;
  initialPerson?: Person;
  initialIntake?: Intake[];
}) {
  const router = useRouter(),
    [data, setData] = useState(initial),
    [search, setSearch] = useState(""),
    [modal, setModal] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [toast, setToast] = useState(""),
    [mobileNav, setMobileNav] = useState(false),
    [taskView, setTaskView] = useState("board"),
    [journey, setJourney] = useState<string>(
      sections.find((s) => s.key === initialSection)?.journey || "profile",
    ),
    [sectionKey, setSectionKey] = useState(
      initialSection && sections.some((s) => s.key === initialSection)
        ? initialSection
        : "identity",
    ),
    [intakeRows, setIntakeRows] = useState(initialIntake),
    [selectedDocument, setSelectedDocument] = useState<DocumentRow | null>(
      null,
    ),
    [tenants, setTenants] = useState<Tenant[]>([]),
    [selectedTenant, setSelectedTenant] = useState<Tenant | null>(null),
    [selectedApp, setSelectedApp] = useState<Application | null>(null),
    [visaCountry, setVisaCountry] = useState(
      sections.find((s) => s.key === initialSection)?.countries?.[0] ||
        initialPerson?.destination ||
        "United Kingdom",
    ),
    [visaKind, setVisaKind] = useState("Study");
  const [factHits, setFactHits] = useState<
      {
        personId: string;
        personName: string;
        sectionKey: string;
        sectionTitle: string;
        label: string;
        value: string;
        status: string;
      }[]
    >([]),
    [team, setTeam] = useState<
      { id: string; name: string; email: string; role: string }[]
    >([]),
    [pairingSecret, setPairingSecret] = useState(""),
    [pairings, setPairings] = useState<
      { id: string; person_id: string; expires_at: number; revoked: number }[]
    >([]),
    [versions, setVersions] = useState<
      { version: number; original_name: string; created_at: string }[]
    >([]);
  const [importRefresh, setImportRefresh] = useState(0);
  const editor = useRef<EditorHandle>(null),
    fileInput = useRef<HTMLInputElement>(null),
    toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isPlatform = actor.role === "platform_admin",
    isStudent = actor.role === "student",
    staff = ["owner", "consultant"].includes(actor.role),
    writable =
      ["active", "trial", "grace"].includes(data.subscription?.status) &&
      (!data.subscription?.expires_at ||
        data.subscription.expires_at >= new Date().toISOString().slice(0, 10));
  const notify = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 4500);
  }, []);
  async function api(path: string, method = "GET", body?: unknown) {
    const r = await fetch("/api/workspace/" + path, {
      method,
      headers:
        body instanceof FormData
          ? undefined
          : { "Content-Type": "application/json" },
      body:
        body instanceof FormData
          ? body
          : body === undefined
            ? undefined
            : JSON.stringify(body),
    });
    const result = await r.json();
    if (!r.ok) throw new Error(result.error || "Request failed.");
    return result;
  }
  async function refresh() {
    setData(await api("bootstrap"));
    if (staff)
      api("team")
        .then((r) => setTeam(r.members))
        .catch(() => {});
  }
  useEffect(() => {
    if (search.trim().length < 2 || isPlatform) {
      setFactHits([]);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(
      () =>
        fetch("/api/workspace/search?q=" + encodeURIComponent(search), {
          signal: controller.signal,
        })
          .then((r) => r.json())
          .then((d) => setFactHits(d.results || []))
          .catch(() => {}),
      250,
    );
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [search, isPlatform]);
  useEffect(() => {
    if (modal === "document" && selectedDocument)
      api("documents/" + selectedDocument.id + "/versions")
        .then((r) => setVersions(r.versions))
        .catch(() => {});
  }, [modal, selectedDocument]);
  useEffect(() => {
    if (!modal) return;
    const previous = document.activeElement as HTMLElement | null;
    const root = document.querySelector<HTMLElement>(".app-modal");
    const getFocusable = () => [
      ...(root?.querySelectorAll<HTMLElement>(
        'button:not([disabled]),a[href],input,select,textarea,[tabindex="0"]',
      ) || []),
    ];
    getFocusable()[0]?.focus();
    function handle(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) setModal(null);
      if (e.key === "Tab") {
        const list = getFocusable(),
          first = list[0],
          last = list[list.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    }
    document.addEventListener("keydown", handle);
    return () => {
      document.removeEventListener("keydown", handle);
      previous?.focus();
    };
  }, [modal]);
  async function loadPlatform() {
    try {
      const r = await api("platform");
      setTenants(r.tenants);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    if (isPlatform) void loadPlatform();
    if (staff)
      api("team")
        .then((r) => setTeam(r.members))
        .catch(() => {});
    if (!isPlatform)
      api("assist-tokens")
        .then((r) => setPairings(r.tokens))
        .catch(() => {});
  }, []); // Session actor is fixed for this page.
  useEffect(() => {
    function keys(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        document.querySelector<HTMLInputElement>("#global-search")?.focus();
      }
    }
    window.addEventListener("keydown", keys);
    return () => window.removeEventListener("keydown", keys);
  }, []);
  async function navigate(target: string) {
    if (editor.current && !(await editor.current.flush())) {
      notify("Save failed. Your answers remain here; retry before leaving.");
      return;
    }
    router.push(target);
    setMobileNav(false);
    setModal(null);
    setSearch("");
  }
  async function mutate(
    path: string,
    method: string,
    body: unknown,
    message: string,
  ) {
    setBusy(true);
    setError("");
    try {
      const result = await api(path, method, body);
      await refresh();
      if (isPlatform) await loadPlatform();
      setModal(null);
      notify(message);
      return result;
    } catch (e) {
      setError((e as Error).message);
      return null;
    } finally {
      setBusy(false);
    }
  }
  function showModal(type: string) {
    setError("");
    setModal(type);
  }
  async function logout() {
    if (editor.current && !(await editor.current.flush())) return;
    await fetch("/api/auth/logout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    location.href = "/login";
  }
  const filteredPeople = data.people.filter((p) =>
    (p.name + " " + p.email + " " + p.destination + " " + p.course)
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  const filteredDocs = data.documents.filter((d) =>
    (d.title + " " + d.person_name + " " + d.category)
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  const filteredTasks = data.tasks.filter((t) =>
    (t.title + " " + t.person_name + " " + t.assignee + " " + quadrant(t))
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  const filteredApps = data.applications.filter((a) =>
    (
      a.person_name +
      " " +
      a.country +
      " " +
      a.kind +
      " " +
      a.institution +
      " " +
      a.program
    )
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  const p = initialPerson;
  const availableSections = sections.filter(
    (s) =>
      s.journey === journey &&
      (!s.restricted || ["owner", "student"].includes(actor.role)) &&
      (!s.countries || s.countries.includes(visaCountry)) &&
      (!s.visaKinds || s.visaKinds.includes(visaKind)),
  );
  const currentSection =
    sections.find((s) => s.key === sectionKey) || sections[0];
  const personDocs = p
    ? data.documents.filter((d) => d.person_id === p.id)
    : [];
  const personRequests = p
    ? data.requests.filter((r) => r.person_id === p.id)
    : [];
  async function changeSection(key: string) {
    if (editor.current && !(await editor.current.flush())) return;
    setSectionKey(key);
  }
  async function changeJourney(value: string) {
    if (editor.current && !(await editor.current.flush())) return;
    setJourney(value);
    if (value !== "documents")
      setSectionKey(sections.find((s) => s.journey === value)!.key);
  }
  const button = (label: string, fn: () => void, Icon: LucideIcon = Plus) => (
    <button className="btn primary" onClick={fn}>
      <Icon size={16} />
      {label}
    </button>
  );
  function title(h: string, desc: string, action?: React.ReactNode) {
    return (
      <div className="page-heading">
        <div>
          <span className="eyebrow">YOUR NEXT CHAPTER, TOGETHER</span>
          <h1>{h}</h1>
          <p>{desc}</p>
        </div>
        {action}
      </div>
    );
  }
  function taskCard(t: Task) {
    return (
      <article className="task-card" key={t.id}>
        <div className="task-card-top">
          <Badge
            tone={
              quadrant(t) === "Do now"
                ? "red"
                : quadrant(t) === "Schedule"
                  ? "green"
                  : "neutral"
            }
          >
            {quadrant(t)}
          </Badge>
          <span>•••</span>
        </div>
        <h3>{t.title}</h3>
        <p>{t.person_name || "Team task"}</p>
        <div className="task-meta">
          <span>
            <Calendar size={12} />
            {dateLabel(t.due_date)}
          </span>
          <span className="tiny-avatar">
            {initials(t.assignee || actor.name)}
          </span>
        </div>
        {staff && writable && (
          <div className="task-controls">
            <select
              aria-label={`Stage for ${t.title}`}
              value={t.stage}
              onChange={(e) =>
                void mutate(
                  "tasks/" + t.id,
                  "PATCH",
                  { stage: e.target.value, revision: t.revision },
                  "Task moved. Priority preserved.",
                )
              }
              disabled={busy}
            >
              {states.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
            <button
              title="Change importance / urgency"
              className="icon-btn"
              onClick={() => {
                showModal("task-priority:" + t.id);
              }}
            >
              <Grid2X2 size={14} />
            </button>
          </div>
        )}
      </article>
    );
  }
  function docsTable(list: DocumentRow[]) {
    return list.length ? (
      <div className="data-table-container">
        <table className="data-table">
          <thead>
            <tr>
              <th>DOCUMENT</th>
              <th>APPLICANT</th>
              <th>LINKED SECTION</th>
              <th>REVIEW</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {list.map((d) => (
              <tr key={d.id}>
                <td>
                  <div className="table-document">
                    <span className="file-icon">
                      <FileText size={19} />
                    </span>
                    <div>
                      <strong>{d.title}</strong>
                      <small>
                        {d.original_name} · v{d.current_version} ·{" "}
                        {(d.byte_size / 1024).toFixed(0)} KB
                      </small>
                    </div>
                  </div>
                </td>
                <td>{d.person_name}</td>
                <td>
                  {sections.find((s) => s.key === d.section_key)?.title ||
                    "Not linked"}
                </td>
                <td>
                  <Badge>{d.status}</Badge>
                </td>
                <td>
                  <div className="table-actions">
                    <a
                      className="icon-btn"
                      href={`/api/workspace/documents/${d.id}/download?inline=1`}
                      target="_blank"
                      rel="noreferrer"
                      aria-label={`Preview ${d.title}`}
                    >
                      <Eye size={16} />
                    </a>
                    <a
                      className="icon-btn"
                      href={`/api/workspace/documents/${d.id}/download`}
                      aria-label={`Download ${d.title}`}
                    >
                      <Download size={16} />
                    </a>
                    <button
                      className="icon-btn"
                      onClick={() => {
                        setSelectedDocument(d);
                        showModal("document");
                      }}
                      aria-label={`Manage ${d.title}`}
                    >
                      <Settings size={16} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    ) : (
      <Empty
        title="A place for the important things."
        description="Upload a PDF, PNG or JPEG. Originals stay private and linked to the selected applicant."
        action={
          writable && data.people.length > 0
            ? button("Upload a document", () => showModal("upload"), Upload)
            : undefined
        }
      />
    );
  }
  return (
    <div className="workspace-app">
      <aside className={`app-sidebar ${mobileNav ? "open" : ""}`}>
        <a href="/" className="app-logo">
          <span>h</span>humeto.
        </a>
        <button
          className="workspace-switch"
          onClick={() =>
            notify("Workspace switching is managed through your sign-in.")
          }
        >
          <span className="workspace-symbol">{actor.tenantName[0]}</span>
          <span>
            <strong>{isPlatform ? "Humeto platform" : actor.tenantName}</strong>
            <small>
              {isPlatform
                ? "Super admin"
                : actor.workspaceType === "individual"
                  ? "Individual workspace"
                  : "Institute workspace"}
            </small>
          </span>
          <ChevronRight size={13} />
        </button>
        <div className="sidebar-section-label">YOUR WORKSPACE</div>
        <nav aria-label="Workspace navigation">
          {isPlatform ? (
            <button
              className={view === "platform" ? "active" : ""}
              onClick={() => void navigate("/workspace")}
            >
              <Building2 size={18} />
              Institutes & plans
            </button>
          ) : (
            navItems
              .filter(
                ([key]) =>
                  !(
                    isStudent &&
                    ["activity", "tasks", "assistant"].includes(key)
                  ),
              )
              .map(([key, label, Icon]) => (
                <button
                  key={key}
                  className={
                    view === key || (view === "profile" && key === "students")
                      ? "active"
                      : ""
                  }
                  onClick={() =>
                    void navigate(
                      key === "overview" ? "/workspace" : "/workspace/" + key,
                    )
                  }
                >
                  <Icon size={18} />
                  {isStudent && key === "students" ? "My information" : label}
                  {key === "requests" &&
                    data.requests.filter((r) => r.status === "Open").length >
                      0 && (
                      <span className="nav-count">
                        {
                          data.requests.filter((r) => r.status === "Open")
                            .length
                        }
                      </span>
                    )}
                </button>
              ))
          )}
        </nav>
        <div className="sidebar-bottom">
          <span className="sidebar-spark">✳</span>
          <strong>A little progress, every day.</strong>
          <p>
            {isPlatform
              ? "Make room for another ambitious team."
              : "You’re making big things happen. One small step at a time."}
          </p>
          <span className="local-pill">
            <span /> Local development
          </span>
        </div>
        <button
          className="settings-link"
          onClick={() => void navigate("/workspace/settings")}
        >
          <Settings size={16} /> Workspace settings
        </button>
        <div className="sidebar-person">
          <span className="person-avatar peach">{initials(actor.name)}</span>
          <span>
            <strong>{actor.name}</strong>
            <small>{actor.role.replace("_", " ")}</small>
          </span>
          <button
            onClick={() => void logout()}
            className="icon-btn"
            aria-label="Sign out"
          >
            <LogOut size={16} />
          </button>
        </div>
      </aside>
      {mobileNav && (
        <button
          className="nav-scrim"
          aria-label="Close navigation"
          onClick={() => setMobileNav(false)}
        />
      )}
      <div className="app-main">
        <header className="app-topbar">
          <button
            className="icon-btn mobile-menu"
            aria-label="Open navigation"
            onClick={() => setMobileNav(true)}
          >
            <Menu size={20} />
          </button>
          <div className="breadcrumb">
            Workspace <ChevronRight size={12} />
            <strong>
              {view === "tasks"
                ? "Tasks to-do"
                : view === "profile"
                  ? p?.name
                  : view === "platform"
                    ? "Institutes & subscriptions"
                    : view[0].toUpperCase() + view.slice(1)}
            </strong>
          </div>
          <div className="topbar-right">
            <label className="global-search">
              <Search size={15} />
              <input
                id="global-search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={
                  view === "profile"
                    ? "Find a question in this journey…"
                    : "Search this view…"
                }
              />
              <kbd>⌘ K</kbd>
            </label>
            {staff ? (
              <ReminderBell />
            ) : (
              <button
                className="notification-button"
                onClick={() => void navigate("/workspace/requests")}
                aria-label="View information requests"
              >
                <Bell size={18} />
                {data.requests.some((r) => r.status === "Open") && <span />}
              </button>
            )}
            <span className="topbar-avatar">{initials(actor.name)}</span>
          </div>
        </header>
        <main className="app-content">
          {factHits.length > 0 && (
            <section className="fact-results panel">
              <div className="panel-title">
                <h3>Answers in your workspace</h3>
                <span>Provided information · review before filing</span>
              </div>
              {factHits.slice(0, 10).map((h, i) => (
                <div
                  className="fact-result"
                  key={h.personId + h.sectionKey + h.label + i}
                >
                  <div>
                    <strong>{h.label}</strong>
                    <p>{h.value}</p>
                    <small>
                      {h.personName} · {h.sectionTitle} · {h.status}
                    </small>
                  </div>
                  <button
                    className="icon-btn"
                    aria-label={"Copy " + h.label}
                    onClick={() => {
                      navigator.clipboard
                        .writeText(h.value)
                        .then(() =>
                          notify(
                            "Answer copied. Review source and current applicability before use.",
                          ),
                        )
                        .catch(() =>
                          notify(
                            "Copy unavailable. Select the answer text instead.",
                          ),
                        );
                    }}
                  >
                    <Copy size={15} />
                  </button>
                  <button
                    className="icon-btn"
                    aria-label={"Open source for " + h.label}
                    onClick={() =>
                      void navigate(
                        "/workspace/students/" +
                          h.personId +
                          "?section=" +
                          h.sectionKey,
                      )
                    }
                  >
                    <ArrowUpRight size={15} />
                  </button>
                </div>
              ))}
            </section>
          )}
          {!writable && !isPlatform && (
            <div className="notice">
              <ShieldCheck size={17} />
              This workspace is read-only. Your existing information and files
              remain available.
            </div>
          )}
          {error && !modal && (
            <div className="notice error" role="alert">
              <AlertCircle size={17} />
              {error}
            </div>
          )}
          {view === "overview" && !isPlatform && (
            <>
              {title(
                isStudent
                  ? "Your next chapter starts here."
                  : "A little clarity. A good morning.",
                isStudent
                  ? "Start with what you have. Every section can wait until you’re ready."
                  : "Here’s what’s moving forward in your workspace today.",
                <span className="date-chip">
                  <Calendar size={14} />
                  {new Date().toLocaleDateString("en-GB", {
                    day: "numeric",
                    month: "long",
                    timeZone: "Asia/Karachi",
                  })}
                </span>,
              )}
              <div className="welcome-banner">
                <div>
                  <span className="eyebrow">LESS ADMIN. MORE POSSIBILITY.</span>
                  <h2>
                    {isStudent
                      ? "Small steps. A clearer path."
                      : "One shared home for every next step."}
                  </h2>
                  <p>
                    {isStudent
                      ? "Your profile, admissions and visa information stay separate and connected."
                      : "Start a profile, organize the evidence, then move an application forward."}
                  </p>
                  <button
                    className="btn primary small"
                    onClick={() =>
                      void navigate(
                        isStudent && data.people[0]
                          ? "/workspace/students/" + data.people[0].id
                          : "/workspace/students",
                      )
                    }
                  >
                    {isStudent
                      ? "Continue my information"
                      : "Explore applicants"}
                    <ArrowUpRight size={15} />
                  </button>
                </div>
                <img
                  src="/assets/campus.webp"
                  alt="Students on a university campus"
                />
              </div>
              <div className="stats-grid">
                {[
                  [
                    Users,
                    "Applicants",
                    data.people.length,
                    "One profile. Many possibilities.",
                  ],
                  [
                    GraduationCap,
                    "Applications",
                    data.applications.length,
                    "Admissions and visa cases",
                  ],
                  [
                    FolderOpen,
                    "Documents",
                    data.documents.length,
                    "Private, original files",
                  ],
                  [
                    CheckSquare,
                    "Open tasks",
                    data.tasks.filter((t) => t.stage !== "Done").length,
                    "Your next important steps",
                  ],
                ].map(([Icon, label, count, note], i) => {
                  const I = Icon as LucideIcon;
                  return (
                    <article
                      className={i === 2 ? "stat-box highlighted" : "stat-box"}
                      key={String(label)}
                    >
                      <div>
                        <span>{String(label)}</span>
                        <I size={18} />
                      </div>
                      <strong>{String(count)}</strong>
                      <small>{String(note)}</small>
                    </article>
                  );
                })}
              </div>
              <div className="overview-grid">
                <section className="panel">
                  <div className="panel-title">
                    <h3>
                      {isStudent
                        ? "Your information"
                        : "Applicants at a glance"}
                    </h3>
                    <button
                      onClick={() => void navigate("/workspace/students")}
                    >
                      View all <ArrowUpRight size={13} />
                    </button>
                  </div>
                  <div className="people-list">
                    {data.people.slice(0, 5).map((p) => (
                      <button
                        className="people-list-row"
                        key={p.id}
                        onClick={() =>
                          void navigate("/workspace/students/" + p.id)
                        }
                      >
                        <Avatar person={p} />
                        <span>
                          <strong>{p.name}</strong>
                          <small>{p.course || "Study plans to add"}</small>
                        </span>
                        <span className="destination-text">
                          {p.destination || "Destination to add"}
                        </span>
                        <ChevronRight size={15} />
                      </button>
                    ))}
                  </div>
                </section>
                <section className="panel">
                  <div className="panel-title">
                    <h3>
                      {isStudent
                        ? "Requests from your consultant"
                        : "A few things for today"}
                    </h3>
                    <button
                      onClick={() =>
                        void navigate(
                          isStudent
                            ? "/workspace/requests"
                            : "/workspace/tasks",
                        )
                      }
                    >
                      View all <ArrowUpRight size={13} />
                    </button>
                  </div>
                  {isStudent
                    ? data.requests.slice(0, 3).map((r) => (
                        <div className="overview-request" key={r.id}>
                          <Badge>{r.status}</Badge>
                          <h4>{r.title}</h4>
                          <p>{r.message}</p>
                        </div>
                      ))
                    : data.tasks
                        .filter((t) => t.stage !== "Done")
                        .slice(0, 4)
                        .map((t) => (
                          <button
                            className="overview-task"
                            key={t.id}
                            onClick={() => void navigate("/workspace/tasks")}
                          >
                            <span className="task-checkbox" />
                            <span>
                              <strong>{t.title}</strong>
                              <small>
                                {t.person_name} · {dateLabel(t.due_date)}
                              </small>
                            </span>
                            <Badge tone={t.urgent ? "red" : "green"}>
                              {quadrant(t)}
                            </Badge>
                          </button>
                        ))}
                  {isStudent && !data.requests.length && (
                    <p className="panel-muted">
                      You’re all caught up. Keep adding details at your pace.
                    </p>
                  )}
                </section>
              </div>
            </>
          )}
          {view === "students" && (
            <>
              {title(
                isStudent
                  ? "Your information, together."
                  : "People, not paperwork.",
                isStudent
                  ? "Choose your profile to continue."
                  : "A home for each applicant’s information, documents and next steps.",
                staff && writable
                  ? button("Add applicant", () => showModal("student"))
                  : undefined,
              )}
              <div className="filter-bar">
                <span>
                  <Users size={16} />
                  {filteredPeople.length} applicant
                  {filteredPeople.length === 1 ? "" : "s"}
                </span>
                <span className="subtle">
                  Shared profile · separate admission & visa journeys
                </span>
              </div>
              <div className="applicant-grid">
                {filteredPeople.map((p) => (
                  <button
                    className="applicant-card"
                    key={p.id}
                    onClick={() => void navigate("/workspace/students/" + p.id)}
                  >
                    <div className="applicant-card-top">
                      <Avatar person={p} />
                      <ArrowUpRight size={17} />
                    </div>
                    <h3>{p.name}</h3>
                    <p>{p.email}</p>
                    <div className="applicant-course">
                      <GraduationCap size={14} />
                      {p.course || "Add study plans later"}
                    </div>
                    <div className="applicant-card-bottom">
                      <span>
                        <Globe size={13} />
                        {p.destination || "Undecided"}
                      </span>
                      <Badge>{p.status}</Badge>
                    </div>
                  </button>
                ))}
              </div>
              {!filteredPeople.length && (
                <Empty
                  title={
                    search
                      ? "No matching applicants."
                      : "Your first next chapter."
                  }
                  description={
                    search
                      ? "Try a name, email, subject or destination."
                      : "Create an applicant profile to begin collecting information."
                  }
                />
              )}
            </>
          )}
          {view === "profile" && p && (
            <>
              <button
                className="subtle-link"
                onClick={() => void navigate("/workspace/students")}
              >
                ← All applicants
              </button>
              <div className="profile-heading">
                <Avatar person={p} />
                <div>
                  <h1>{p.name}</h1>
                  <p>
                    {p.destination || "Destination to add"} <span>·</span>{" "}
                    {p.course || "Study plans to add"}
                  </p>
                </div>
                <Badge>{p.status}</Badge>
                {staff && writable && (
                  <button
                    className="btn secondary small"
                    onClick={() => showModal("request")}
                  >
                    Request information <MessageSquare size={14} />
                  </button>
                )}
              </div>
              <div className="journey-tabs">
                {[
                  ["profile", "Shared profile", User],
                  ["admission", "University admission", GraduationCap],
                  ["visa", "Visa information", Globe],
                  ["documents", "Documents", FolderOpen],
                ].map(([key, label, Icon]) => {
                  const I = Icon as LucideIcon;
                  return (
                    <button
                      key={String(key)}
                      className={journey === key ? "active" : ""}
                      onClick={() => void changeJourney(String(key))}
                    >
                      <I size={16} />
                      {String(label)}
                    </button>
                  );
                })}
              </div>
              {journey === "visa" && (
                <div className="visa-context">
                  <label>
                    Preparing for
                    <select
                      value={visaCountry}
                      onChange={async (e) => {
                        const value = e.target.value;
                        if (editor.current && !(await editor.current.flush()))
                          return;
                        setVisaCountry(value);
                        setSectionKey("travel-history");
                      }}
                    >
                      {destinations.map((c) => (
                        <option key={c}>{c}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Journey purpose
                    <select
                      value={visaKind}
                      onChange={async (e) => {
                        const value = e.target.value;
                        if (editor.current && !(await editor.current.flush()))
                          return;
                        setVisaKind(value);
                        setSectionKey("travel-history");
                      }}
                    >
                      {["Study", "Visit", "Business visit", "Family visit"].map(
                        (k) => (
                          <option key={k}>{k}</option>
                        ),
                      )}
                    </select>
                  </label>
                  <span>
                    Filters relevant groups; answers are reusable preparation
                    notes.
                  </span>
                </div>
              )}
              {personRequests.some((r) => r.status === "Open") && (
                <div className="notice">
                  <MessageSquare size={17} />
                  {
                    personRequests.filter((r) => r.status === "Open").length
                  }{" "}
                  open request(s).{" "}
                  <button onClick={() => void navigate("/workspace/requests")}>
                    View requests →
                  </button>
                </div>
              )}
              {journey === "documents" ? (
                <>
                  {
                    <div className="section-title-row">
                      <h2>Your supporting documents</h2>
                      {writable &&
                        button(
                          "Upload document",
                          () => showModal("upload"),
                          Upload,
                        )}
                    </div>
                  }
                  {docsTable(personDocs)}
                </>
              ) : (
                <div className="intake-layout">
                  <aside className="section-navigation">
                    <span className="eyebrow">YOUR PACE. YOUR PROGRESS.</span>
                    {availableSections
                      .filter(
                        (s) =>
                          !search ||
                          (
                            s.title +
                            " " +
                            s.fields.map((f) => f.label).join(" ")
                          )
                            .toLowerCase()
                            .includes(search.toLowerCase()),
                      )
                      .map((s) => {
                        const row = intakeRows.find(
                            (r) => r.section_key === s.key,
                          ),
                          I = iconMap[s.icon] || FileText;
                        return (
                          <button
                            key={s.key}
                            className={sectionKey === s.key ? "active" : ""}
                            onClick={() => void changeSection(s.key)}
                          >
                            <I size={15} />
                            <span>
                              {s.title}
                              <small>
                                {row?.state === "ready"
                                  ? "Entered"
                                  : row?.state === "skipped"
                                    ? "Add later"
                                    : row
                                      ? "In progress"
                                      : "Not started"}
                              </small>
                            </span>
                            {row?.state === "ready" ? (
                              <CheckCircle2 size={14} />
                            ) : (
                              <ChevronRight size={12} />
                            )}
                          </button>
                        );
                      })}
                    <div className="section-nav-note">
                      <CloudCheck size={18} />
                      <p>
                        Every section is skippable. Saved answers can be reused
                        across applications.
                      </p>
                    </div>
                  </aside>
                  <SectionEditor
                    key={p.id + sectionKey}
                    ref={editor}
                    personId={p.id}
                    section={currentSection}
                    initial={intakeRows.find(
                      (r) => r.section_key === sectionKey,
                    )}
                    onSaved={(row) =>
                      setIntakeRows((old) => [
                        ...old.filter((r) => r.section_key !== row.section_key),
                        row,
                      ])
                    }
                    readOnly={!writable}
                    onDocuments={() => {
                      setJourney("documents");
                    }}
                    onNext={() => {
                      const i = availableSections.findIndex(
                        (s) => s.key === sectionKey,
                      );
                      setSectionKey(
                        availableSections[(i + 1) % availableSections.length]
                          .key,
                      );
                    }}
                  />
                </div>
              )}
            </>
          )}
          {view === "documents" && (
            <>
              {title(
                "Everything, in its place.",
                "Private original files, visible versions and a clear review state.",
                writable && data.people.length ? (
                  <div className="heading-actions">
                    <button
                      className="btn secondary"
                      onClick={() => showModal("import")}
                    >
                      <FolderOpen size={15} />
                      Import folder
                    </button>
                    {button(
                      "Upload document",
                      () => showModal("upload"),
                      Upload,
                    )}
                  </div>
                ) : undefined,
              )}
              <div className="notice quiet">
                <ShieldCheck size={16} />
                Local pilot storage · PDF, PNG and JPEG up to 15 MB. Automated
                malware scanning is not connected; use fictional test files.
              </div>
              {docsTable(filteredDocs)}
              <ImportHistory refreshKey={importRefresh} />
            </>
          )}
          {view === "applications" && (
            <>
              {title(
                "Your next chapters.",
                "Admission, study and visitor cases—each with its own context.",
                staff && writable
                  ? button("Create application", () => showModal("application"))
                  : undefined,
              )}
              <div className="application-grid">
                {filteredApps.map((a) => (
                  <article className="application-card" key={a.id}>
                    <div className="application-card-header">
                      <span className="application-icon">
                        {a.kind === "Admission" ? (
                          <GraduationCap size={22} />
                        ) : (
                          <Globe size={22} />
                        )}
                      </span>
                      <Badge>{a.status}</Badge>
                    </div>
                    <span className="eyebrow">
                      {a.kind.toUpperCase()} · {a.country.toUpperCase()}
                    </span>
                    <h3>{a.institution || a.country + " application"}</h3>
                    <p>{a.program || "Program / purpose to add"}</p>
                    <div className="application-details">
                      <span>
                        <User size={13} />
                        {a.person_name}
                      </span>
                      <span>
                        <Calendar size={13} />
                        {a.intake || "Intake to add"}
                      </span>
                    </div>
                    <div className="application-footer">
                      <button
                        onClick={() => {
                          setSelectedApp(a);
                          showModal("application-details");
                        }}
                      >
                        Review preparation <ArrowUpRight size={14} />
                      </button>
                      <span>v{a.revision}</span>
                    </div>
                  </article>
                ))}
              </div>
              {!filteredApps.length && (
                <Empty
                  title="A new possibility starts here."
                  description="Create an application and connect it to the applicant’s reusable information."
                />
              )}
            </>
          )}
          {view === "assistant" && staff && (
            <TaskAssistant actor={actor} onChange={refresh} />
          )}
          {view === "tasks" && (
            <>
              {title(
                "Busy isn’t the goal. Progress is.",
                "Keep importance and urgency visible as work moves forward.",
                staff && writable ? (
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <a href="/workspace/assistant" className="btn secondary">
                      <Sparkles size={14} /> Ask Humeto
                    </a>
                    {button("Add task", () => showModal("task"))}
                  </div>
                ) : undefined,
              )}
              <div className="filter-bar">
                <div className="segmented">
                  {[
                    ["board", "Board", Columns3],
                    ["matrix", "Priority matrix", Grid2X2],
                    ["list", "List", List],
                  ].map(([key, label, Icon]) => {
                    const I = Icon as LucideIcon;
                    return (
                      <button
                        key={String(key)}
                        className={taskView === key ? "active" : ""}
                        onClick={() => setTaskView(String(key))}
                      >
                        <I size={14} />
                        {String(label)}
                      </button>
                    );
                  })}
                </div>
                <span className="subtle">
                  {filteredTasks.length} tasks · stage and priority are
                  independent
                </span>
              </div>
              {taskView === "board" ? (
                <div className="kanban-board">
                  {states.map((s) => (
                    <section className="kanban-column" key={s}>
                      <h2>
                        <span
                          className={
                            "stage-dot " + s.toLowerCase().replace(" ", "-")
                          }
                        />
                        {s}
                        <span>
                          {filteredTasks.filter((t) => t.stage === s).length}
                        </span>
                      </h2>
                      {filteredTasks.filter((t) => t.stage === s).map(taskCard)}
                      {!filteredTasks.some((t) => t.stage === s) && (
                        <p className="empty-column">
                          A little space for what’s next.
                        </p>
                      )}
                    </section>
                  ))}
                </div>
              ) : taskView === "matrix" ? (
                <div className="priority-matrix">
                  {[
                    ["Do now", "Important + urgent"],
                    ["Schedule", "Important + not urgent"],
                    ["Delegate", "Not important + urgent"],
                    ["Later", "Not important + not urgent"],
                  ].map(([q, desc]) => (
                    <section key={q}>
                      <div className="matrix-heading">
                        <h2>{q}</h2>
                        <small>{desc}</small>
                      </div>
                      {filteredTasks
                        .filter((t) => quadrant(t) === q)
                        .map(taskCard)}
                    </section>
                  ))}
                </div>
              ) : (
                <div className="panel">
                  {filteredTasks.map((t) => (
                    <div className="task-list-row" key={t.id}>
                      <span>
                        {t.title}
                        <small>{t.person_name || "Team task"}</small>
                      </span>
                      <Badge>{quadrant(t)}</Badge>
                      <span>{dateLabel(t.due_date)}</span>
                      <select
                        disabled={!staff || !writable || busy}
                        value={t.stage}
                        onChange={(e) =>
                          void mutate(
                            "tasks/" + t.id,
                            "PATCH",
                            { stage: e.target.value, revision: t.revision },
                            "Task updated.",
                          )
                        }
                        aria-label={`Stage for ${t.title}`}
                      >
                        {states.map((s) => (
                          <option key={s}>{s}</option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
          {view === "requests" && (
            <>
              {title(
                "A little clarity, together.",
                "Requests point to the exact information needed. No external messages are sent.",
                staff && writable
                  ? button("New request", () => showModal("request"))
                  : undefined,
              )}
              <div className="request-grid">
                {data.requests
                  .filter((r) =>
                    (r.title + r.message + r.person_name)
                      .toLowerCase()
                      .includes(search.toLowerCase()),
                  )
                  .map((r) => (
                    <article className="request-card" key={r.id}>
                      <div>
                        <MessageSquare size={20} />
                        <Badge>{r.status}</Badge>
                      </div>
                      <h3>{r.title}</h3>
                      <p>{r.message}</p>
                      <small>
                        {r.person_name} ·{" "}
                        {sections.find((s) => s.key === r.section_key)?.title ||
                          "General information"}
                      </small>
                      <div className="request-actions">
                        <button
                          className="btn secondary small"
                          onClick={() =>
                            void navigate("/workspace/students/" + r.person_id)
                          }
                        >
                          Open profile <ArrowUpRight size={13} />
                        </button>
                        {writable && r.status !== "Resolved" && (
                          <button
                            className="btn ghost small"
                            disabled={busy}
                            onClick={() =>
                              void mutate(
                                "requests/" + r.id,
                                "PATCH",
                                { status: staff ? "Resolved" : "Responded" },
                                staff
                                  ? "Request resolved."
                                  : "Response recorded for your consultant.",
                              )
                            }
                          >
                            {staff ? "Resolve" : "Mark responded"}{" "}
                            <Check size={13} />
                          </button>
                        )}
                      </div>
                    </article>
                  ))}
              </div>
              {!data.requests.length && (
                <Empty
                  title="All caught up."
                  description="Information requests from your consultant will appear here."
                />
              )}
            </>
          )}
          {view === "activity" && (
            <>
              {title(
                "The little steps add up.",
                "A record of changes in this workspace. Sensitive field values stay out of this feed.",
              )}
              <section className="panel activity-panel">
                {data.activity.map((a) => (
                  <div className="activity-row" key={a.id}>
                    <span className="activity-dot">
                      <Check size={13} />
                    </span>
                    <div>
                      <strong>{a.summary}</strong>
                      <p>{a.actor_name || "Workspace member"}</p>
                    </div>
                    <small>{a.created_at}</small>
                  </div>
                ))}
                {!data.activity.length && (
                  <Empty
                    title="The next step starts the story."
                    description="Saved edits, uploads and task changes will appear here."
                  />
                )}
              </section>
            </>
          )}
          {view === "settings" && (
            <>
              {title(
                "Your workspace, thoughtfully set up.",
                "Local subscription and session details. No live payments are connected.",
              )}
              <div className="settings-grid">
                <section className="panel settings-panel">
                  <Building2 size={25} />
                  <h2>{actor.tenantName}</h2>
                  <p>{actor.workspaceType} workspace</p>
                  <dl>
                    <dt>Your role</dt>
                    <dd>{actor.role.replace("_", " ")}</dd>
                    <dt>Signed in as</dt>
                    <dd>{actor.email}</dd>
                    <dt>Plan</dt>
                    <dd>{data.subscription.plan}</dd>
                    <dt>Status</dt>
                    <dd>
                      <Badge>{data.subscription.status}</Badge>
                    </dd>
                    <dt>Case allowance</dt>
                    <dd>
                      {data.people.length} / {data.subscription.case_limit}
                    </dd>
                    <dt>Storage allowance</dt>
                    <dd>{data.subscription.storage_mb} MB</dd>
                  </dl>
                  {staff && (
                    <div className="team-members">
                      <h3>People in this workspace</h3>
                      {team.map((m) => (
                        <div key={m.id}>
                          <strong>{m.name}</strong>
                          <small>
                            {m.email} · {m.role}
                          </small>
                        </div>
                      ))}
                      {actor.role === "owner" && writable && (
                        <button
                          className="btn secondary small"
                          onClick={() => showModal("member")}
                        >
                          <Plus size={14} />
                          Add team / student access
                        </button>
                      )}
                    </div>
                  )}
                </section>
                {staff && (
                  <section className="panel settings-panel">
                    <Sparkles size={25} />
                    <h2>Your assistant & channels</h2>
                    <p>
                      Test task conversations inside Humeto. Your messages are
                      private to your account; applied changes appear in the
                      shared task views.
                    </p>
                    <a
                      className="btn secondary small"
                      href="/workspace/assistant"
                    >
                      Open Humeto assistant <ArrowUpRight size={14} />
                    </a>
                    <dl>
                      <dt>In-app task chat</dt>
                      <dd>
                        <Badge>Local testing available</Badge>
                      </dd>
                      <dt>WhatsApp account linking</dt>
                      <dd>Planned</dd>
                      <dt>Telegram</dt>
                      <dd>Planned</dd>
                      <dt>Email</dt>
                      <dd>Planned</dd>
                    </dl>
                    <p>
                      External channels are not connected. Start with the in-app
                      assistant; account connections will be added in a later
                      delivery.
                    </p>
                  </section>
                )}
                <section className="panel settings-panel">
                  <ShieldCheck size={25} />
                  <h2>Local build notes</h2>
                  <p>
                    Changes are stored in the local SQLite database and survive
                    reloads. Uploaded originals are stored outside public assets
                    and checked against your session and applicant access.
                  </p>
                  <p>
                    This is a development build. Production identity recovery,
                    MFA, document scanning, encryption/backup operations,
                    integrations and billing still need implementation and
                    review.
                  </p>
                  {!isPlatform && (
                    <div className="assistant-settings">
                      <h3>Humeto Assist · local alpha</h3>
                      <p>
                        Pair one applicant’s basic identity/contact fields for
                        one hour. The extension is read-only until you approve
                        each match on a page.
                      </p>
                      <a
                        className="btn secondary small"
                        href="/humeto-assist.zip"
                        download
                      >
                        Download extension files <Download size={14} />
                      </a>
                      <button
                        className="btn secondary small"
                        onClick={() => {
                          setPairingSecret("");
                          showModal("pairing");
                        }}
                      >
                        Create read-only pairing <Link2 size={14} />
                      </button>
                      {pairings
                        .filter((t) => !t.revoked && t.expires_at > Date.now())
                        .map((t) => (
                          <div className="pairing-row" key={t.id}>
                            <span>
                              {data.people.find((p) => p.id === t.person_id)
                                ?.name || "Applicant"}{" "}
                              · expires{" "}
                              {new Date(t.expires_at).toLocaleTimeString()}
                            </span>
                            <button
                              onClick={async () => {
                                try {
                                  await api(
                                    "assist-tokens/" + t.id,
                                    "PATCH",
                                    {},
                                  );
                                  setPairings(
                                    pairings.map((p) =>
                                      p.id === t.id ? { ...p, revoked: 1 } : p,
                                    ),
                                  );
                                  notify("Assistant pairing revoked.");
                                } catch (e) {
                                  setError((e as Error).message);
                                }
                              }}
                            >
                              Revoke
                            </button>
                          </div>
                        ))}
                    </div>
                  )}
                  <button
                    className="btn secondary"
                    onClick={() => void logout()}
                  >
                    Sign out <LogOut size={15} />
                  </button>
                </section>
              </div>
            </>
          )}
          {(view === "platform" || (isPlatform && view === "overview")) && (
            <>
              {title(
                "Room for another ambitious team.",
                "Create institutes and manage manual subscription access. Applicant files remain outside this console.",
                button(
                  "Add workspace",
                  () => showModal("institute"),
                  Building2,
                ),
              )}
              <div className="stats-grid">
                {[
                  ["Workspaces", tenants.length],
                  [
                    "Active",
                    tenants.filter((t) => t.status === "active").length,
                  ],
                  ["Trial", tenants.filter((t) => t.status === "trial").length],
                  [
                    "Total cases",
                    tenants.reduce((s, t) => s + t.case_count, 0),
                  ],
                ].map(([label, n]) => (
                  <article className="stat-box" key={String(label)}>
                    <span>{label}</span>
                    <strong>{n}</strong>
                    <small>Persisted local records</small>
                  </article>
                ))}
              </div>
              <div className="data-table-container">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>WORKSPACE</th>
                      <th>PLAN</th>
                      <th>STATUS</th>
                      <th>CASES</th>
                      <th>SEATS</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {tenants
                      .filter((t) =>
                        (t.name + t.plan)
                          .toLowerCase()
                          .includes(search.toLowerCase()),
                      )
                      .map((t) => (
                        <tr key={t.id}>
                          <td>
                            <strong>{t.name}</strong>
                            <small>{t.type}</small>
                          </td>
                          <td>{t.plan}</td>
                          <td>
                            <Badge>{t.status}</Badge>
                          </td>
                          <td>
                            {t.case_count} / {t.case_limit}
                          </td>
                          <td>{t.seats}</td>
                          <td>
                            <button
                              className="btn secondary small"
                              onClick={() => {
                                setSelectedTenant(t);
                                showModal("subscription");
                              }}
                            >
                              Manage plan
                            </button>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </main>
      </div>
      {toast && (
        <div className="app-toast" role="status">
          <CheckCircle2 size={17} />
          {toast}
        </div>
      )}
      {modal && (
        <div
          className="modal-backdrop"
          onClick={(e) => {
            if (e.target === e.currentTarget && !busy) setModal(null);
          }}
        >
          <div
            className="app-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="modal-title"
          >
            <button
              className="modal-close icon-btn"
              aria-label="Close dialog"
              onClick={() => !busy && setModal(null)}
            >
              <X size={19} />
            </button>
            {error && (
              <div className="notice error" role="alert">
                {error}
              </div>
            )}
            {modal === "import" && (
              <ImportPanel
                people={data.people}
                defaultPerson={p?.id}
                onComplete={() => {
                  setImportRefresh((n) => n + 1);
                  void refresh();
                  notify(
                    "Import results saved. Review documents before using them.",
                  );
                }}
              />
            )}
            {modal === "pairing" && (
              <>
                <span className="eyebrow">BROWSER ASSISTANT · LOCAL ALPHA</span>
                <h2 id="modal-title">A little head start.</h2>
                <p>
                  Create a scoped token. Only the selected applicant’s
                  identity/contact sections are exposed. Tokens expire in one
                  hour and can be revoked here.
                </p>
                {pairingSecret ? (
                  <>
                    <div className="notice">
                      Copy this token into the extension once. It is not shown
                      again after this dialog is closed.
                    </div>
                    <textarea
                      className="pairing-secret"
                      readOnly
                      value={pairingSecret}
                      aria-label="One-time pairing token"
                    />
                    <button
                      className="btn primary full"
                      onClick={() =>
                        navigator.clipboard
                          .writeText(pairingSecret)
                          .then(() => notify("Pairing token copied."))
                      }
                    >
                      Copy token <Copy size={15} />
                    </button>
                    <p>
                      Unzip the extension, then in Chrome’s Extensions page
                      enable Developer mode and Load unpacked. Select the
                      extracted folder. Open Humeto Assist from its toolbar
                      icon.
                    </p>
                  </>
                ) : (
                  <form
                    onSubmit={async (e) => {
                      e.preventDefault();
                      setBusy(true);
                      const f = new FormData(e.currentTarget);
                      try {
                        const result = await api("assist-tokens", "POST", {
                          personId: f.get("personId"),
                          sectionKeys: ["identity", "contact"],
                        });
                        setPairingSecret(result.token);
                        setPairings((await api("assist-tokens")).tokens);
                      } catch (e) {
                        setError((e as Error).message);
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    <label>
                      Applicant
                      <select name="personId" required>
                        {data.people.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button className="btn primary full" disabled={busy}>
                      Create one-hour pairing
                    </button>
                  </form>
                )}
              </>
            )}
            {modal === "member" && (
              <>
                <span className="eyebrow">WORKSPACE ACCESS</span>
                <h2 id="modal-title">Bring someone in.</h2>
                <p>
                  Create a local account. Nothing is emailed. Set an initial
                  password and share it directly through an appropriate channel.
                </p>
                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    await mutate(
                      "team",
                      "POST",
                      Object.fromEntries(new FormData(e.currentTarget)),
                      "Workspace member created.",
                    );
                  }}
                >
                  <label>
                    Name
                    <input name="name" required />
                  </label>
                  <label>
                    Email
                    <input name="email" type="email" required />
                  </label>
                  <label>
                    Initial password
                    <input
                      name="password"
                      type="password"
                      minLength={12}
                      required
                      autoComplete="new-password"
                    />
                  </label>
                  <label>
                    Role
                    <select name="role">
                      <option value="consultant">
                        Consultant (uses a staff seat)
                      </option>
                      <option value="student">
                        Student / applicant (own record only)
                      </option>
                    </select>
                  </label>
                  <label>
                    Linked applicant, for student access
                    <select name="personId">
                      <option value="">Choose if student</option>
                      {data.people.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button className="btn primary full" disabled={busy}>
                    Create workspace account
                  </button>
                </form>
              </>
            )}
            {modal === "student" && (
              <>
                <span className="eyebrow">A NEW POSSIBILITY</span>
                <h2 id="modal-title">Start with the person.</h2>
                <p>
                  A few basics are enough. They can add everything else later.
                </p>
                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    const f = new FormData(e.currentTarget);
                    const result = await mutate(
                      "students",
                      "POST",
                      Object.fromEntries(f),
                      "Applicant created.",
                    );
                    if (result) router.push("/workspace/students/" + result.id);
                  }}
                >
                  <label>
                    Full name
                    <input name="name" required minLength={2} />
                  </label>
                  <label>
                    Email
                    <input name="email" type="email" required />
                  </label>
                  <label>
                    Destination
                    <select name="destination">
                      <option value="">Decide later</option>
                      {destinations.map((c) => (
                        <option key={c}>{c}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Intended subject / course
                    <input name="course" />
                  </label>
                  <button className="btn primary full" disabled={busy}>
                    {busy ? (
                      <LoaderCircle size={16} className="spin" />
                    ) : (
                      "Create applicant"
                    )}
                    <ArrowRight size={16} />
                  </button>
                </form>
              </>
            )}
            {modal === "upload" && (
              <>
                <span className="eyebrow">BRING WHAT YOU HAVE</span>
                <h2 id="modal-title">One file. A clearer picture.</h2>
                <p>
                  PDF, PNG or JPEG up to 15 MB. Use fictional files during local
                  development.
                </p>
                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    await mutate(
                      "documents",
                      "POST",
                      new FormData(e.currentTarget),
                      "Document uploaded privately.",
                    );
                  }}
                >
                  <label>
                    Applicant
                    <select name="personId" defaultValue={p?.id} required>
                      {data.people.map((p) => (
                        <option value={p.id} key={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Document title
                    <input name="title" placeholder="e.g. Final transcript" />
                  </label>
                  <label>
                    Category
                    <select name="category">
                      {[
                        "Identity",
                        "Education",
                        "Language test",
                        "Finance",
                        "Authored document",
                        "Insurance",
                        "Other",
                      ].map((c) => (
                        <option key={c}>{c}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Link to a question group
                    <select
                      name="sectionKey"
                      defaultValue={
                        view === "profile" && journey !== "documents"
                          ? sectionKey
                          : ""
                      }
                    >
                      <option value="">Organize later</option>
                      {sections.map((s) => (
                        <option key={s.key} value={s.key}>
                          {s.title}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="upload-field">
                    <Upload size={25} />
                    <strong>Choose an original file</strong>
                    <input
                      name="file"
                      type="file"
                      accept="application/pdf,image/png,image/jpeg"
                      required
                    />
                  </label>
                  <button className="btn primary full" disabled={busy}>
                    {busy ? "Uploading…" : "Upload private document"}
                    <Upload size={15} />
                  </button>
                </form>
              </>
            )}
            {modal === "document" && selectedDocument && (
              <>
                <span className="eyebrow">DOCUMENT ORGANIZATION</span>
                <h2 id="modal-title">{selectedDocument.title}</h2>
                <p>
                  Original: {selectedDocument.original_name} · Version{" "}
                  {selectedDocument.current_version}
                </p>
                <div className="version-history">
                  <strong>Preserved file versions</strong>
                  {versions.map((v) => (
                    <a
                      key={v.version}
                      href={`/api/workspace/documents/${selectedDocument.id}/download?version=${v.version}`}
                    >
                      Version {v.version} · {v.original_name}
                      <Download size={13} />
                    </a>
                  ))}
                </div>
                <div className="document-modal-actions">
                  <a
                    className="btn secondary small"
                    target="_blank"
                    rel="noreferrer"
                    href={`/api/workspace/documents/${selectedDocument.id}/download?inline=1`}
                  >
                    Preview <Eye size={14} />
                  </a>
                  <a
                    className="btn secondary small"
                    href={`/api/workspace/documents/${selectedDocument.id}/download`}
                  >
                    Download <Download size={14} />
                  </a>
                </div>
                {staff && writable && (
                  <form
                    onSubmit={async (e) => {
                      e.preventDefault();
                      await mutate(
                        "documents/" + selectedDocument.id,
                        "PATCH",
                        Object.fromEntries(new FormData(e.currentTarget)),
                        "Document organization updated.",
                      );
                    }}
                  >
                    <label>
                      Display title
                      <input
                        name="title"
                        defaultValue={selectedDocument.title}
                        required
                      />
                    </label>
                    <label>
                      Category
                      <input
                        name="category"
                        defaultValue={selectedDocument.category}
                      />
                    </label>
                    <label>
                      Linked section
                      <select
                        name="sectionKey"
                        defaultValue={selectedDocument.section_key}
                      >
                        <option value="">Not linked</option>
                        {sections.map((s) => (
                          <option key={s.key} value={s.key}>
                            {s.title}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Review state
                      <select
                        name="status"
                        defaultValue={selectedDocument.status}
                      >
                        {[
                          "Received",
                          "Needs review",
                          "Changes requested",
                          "Reviewed",
                        ].map((s) => (
                          <option key={s}>{s}</option>
                        ))}
                      </select>
                    </label>
                    <button className="btn primary full" disabled={busy}>
                      Save organization
                    </button>
                  </form>
                )}
                {writable && (
                  <form
                    className="version-form"
                    onSubmit={async (e) => {
                      e.preventDefault();
                      const f = new FormData(e.currentTarget);
                      f.set("personId", selectedDocument.person_id);
                      await mutate(
                        "documents/" + selectedDocument.id + "/version",
                        "POST",
                        f,
                        "New version saved. Original preserved.",
                      );
                    }}
                  >
                    <h3>Add a replacement version</h3>
                    <p>
                      The existing original stays in private version history.
                    </p>
                    <input
                      type="file"
                      name="file"
                      accept="application/pdf,image/png,image/jpeg"
                      required
                    />
                    <button className="btn secondary full" disabled={busy}>
                      Upload next version
                    </button>
                  </form>
                )}
              </>
            )}
            {modal === "task" && (
              <>
                <span className="eyebrow">A LITTLE PROGRESS</span>
                <h2 id="modal-title">What’s the next step?</h2>
                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    const f = new FormData(e.currentTarget);
                    await mutate(
                      "tasks",
                      "POST",
                      {
                        title: f.get("title"),
                        personId: f.get("personId"),
                        dueDate: f.get("dueDate"),
                        assignee: f.get("assignee"),
                        important: f.get("important") === "on",
                        urgent: f.get("urgent") === "on",
                      },
                      "Task created.",
                    );
                  }}
                >
                  <label>
                    Task title
                    <input name="title" required minLength={2} />
                  </label>
                  <label>
                    Applicant
                    <select name="personId">
                      <option value="">Team task</option>
                      {data.people.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="field-grid">
                    <label>
                      Due date
                      <input type="date" name="dueDate" />
                    </label>
                    <label>
                      Assignee
                      <input name="assignee" defaultValue={actor.name} />
                    </label>
                  </div>
                  <div className="checkbox-options">
                    <label>
                      <input type="checkbox" name="important" />
                      Important
                    </label>
                    <label>
                      <input type="checkbox" name="urgent" />
                      Urgent
                    </label>
                  </div>
                  <button className="btn primary full" disabled={busy}>
                    Create task
                  </button>
                </form>
              </>
            )}
            {modal.startsWith("task-priority:") &&
              (() => {
                const t = data.tasks.find((t) => t.id === modal.split(":")[1]);
                return (
                  t && (
                    <>
                      <span className="eyebrow">MAKE THE PRIORITY CLEAR</span>
                      <h2 id="modal-title">{t.title}</h2>
                      <form
                        onSubmit={async (e) => {
                          e.preventDefault();
                          const f = new FormData(e.currentTarget);
                          await mutate(
                            "tasks/" + t.id,
                            "PATCH",
                            {
                              stage: t.stage,
                              revision: t.revision,
                              important: f.get("important") === "on",
                              urgent: f.get("urgent") === "on",
                            },
                            "Priority updated. Stage preserved.",
                          );
                        }}
                      >
                        <div className="checkbox-options">
                          <label>
                            <input
                              type="checkbox"
                              name="important"
                              defaultChecked={!!t.important}
                            />
                            Important
                          </label>
                          <label>
                            <input
                              type="checkbox"
                              name="urgent"
                              defaultChecked={!!t.urgent}
                            />
                            Urgent
                          </label>
                        </div>
                        <button className="btn primary full" disabled={busy}>
                          Save priority
                        </button>
                      </form>
                    </>
                  )
                );
              })()}
            {modal === "application" && (
              <>
                <span className="eyebrow">A NEW NEXT CHAPTER</span>
                <h2 id="modal-title">Create an application.</h2>
                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    await mutate(
                      "applications",
                      "POST",
                      Object.fromEntries(new FormData(e.currentTarget)),
                      "Application draft created.",
                    );
                  }}
                >
                  <label>
                    Applicant
                    <select name="personId" required>
                      {data.people.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="field-grid">
                    <label>
                      Purpose
                      <select name="kind">
                        {[
                          "Admission",
                          "Study visa",
                          "Visitor visa",
                          "Schengen visa",
                          "Scholarship",
                        ].map((k) => (
                          <option key={k}>{k}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Country / area
                      <select name="country">
                        {destinations.map((c) => (
                          <option key={c}>{c}</option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <label>
                    Institution / route
                    <input name="institution" />
                  </label>
                  <label>
                    Program / purpose
                    <input name="program" />
                  </label>
                  <label>
                    Intake / intended period
                    <input name="intake" />
                  </label>
                  <button className="btn primary full" disabled={busy}>
                    Create draft
                  </button>
                </form>
              </>
            )}
            {modal === "application-details" && selectedApp && (
              <>
                <span className="eyebrow">APPLICATION PREPARATION</span>
                <h2 id="modal-title">
                  {selectedApp.institution || selectedApp.country}
                </h2>
                <p>
                  {selectedApp.person_name} · {selectedApp.kind} ·{" "}
                  {selectedApp.program}
                </p>
                <ApplicationChecklist
                  applicationId={selectedApp.id}
                  staff={staff}
                  writable={writable}
                  onChange={() => void refresh()}
                />
                {selectedApp.submission_reference && (
                  <div className="notice">
                    Recorded portal reference:{" "}
                    {selectedApp.submission_reference}
                  </div>
                )}
                <button
                  className="btn secondary full"
                  onClick={() =>
                    void navigate(
                      "/workspace/students/" + selectedApp.person_id,
                    )
                  }
                >
                  Open applicant information <ArrowUpRight size={15} />
                </button>
                {staff && writable && (
                  <>
                    <form
                      onSubmit={async (e) => {
                        e.preventDefault();
                        const f = new FormData(e.currentTarget);
                        await mutate(
                          "applications/" + selectedApp.id,
                          "PATCH",
                          {
                            status: f.get("status"),
                            revision: selectedApp.revision,
                            submissionReference: f.get("submissionReference"),
                          },
                          "Application status recorded.",
                        );
                      }}
                    >
                      <label>
                        Status
                        <select name="status" defaultValue={selectedApp.status}>
                          {[
                            "Draft",
                            "Collecting",
                            "Review",
                            "Ready",
                            "Submitted",
                            "Decision received",
                          ].map((s) => (
                            <option key={s}>{s}</option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Actual portal reference, if submitted
                        <input
                          name="submissionReference"
                          placeholder="Required to record Submitted"
                        />
                      </label>
                      <button className="btn primary full" disabled={busy}>
                        Save status
                      </button>
                    </form>
                    <button
                      className="btn secondary full"
                      disabled={busy}
                      onClick={async () => {
                        setBusy(true);
                        try {
                          const r = await api(
                            "applications/" + selectedApp.id + "/snapshot",
                            "POST",
                            {},
                          );
                          const url = URL.createObjectURL(
                            new Blob([JSON.stringify(r.payload, null, 2)], {
                              type: "application/json",
                            }),
                          );
                          const a = document.createElement("a");
                          a.href = url;
                          a.download = "humeto-preparation-snapshot.json";
                          a.click();
                          setTimeout(() => URL.revokeObjectURL(url), 1000);
                          notify("Preparation snapshot saved and downloaded.");
                          await refresh();
                        } catch (e) {
                          setError((e as Error).message);
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      <Camera size={15} />
                      Save preparation snapshot
                    </button>
                  </>
                )}
              </>
            )}
            {modal === "request" && (
              <>
                <span className="eyebrow">A CLEARER ASK</span>
                <h2 id="modal-title">Request a little detail.</h2>
                <p>
                  This creates an in-app request. It does not send email or
                  WhatsApp.
                </p>
                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    await mutate(
                      "requests",
                      "POST",
                      Object.fromEntries(new FormData(e.currentTarget)),
                      "Information request created.",
                    );
                  }}
                >
                  <label>
                    Applicant
                    <select name="personId" defaultValue={p?.id} required>
                      {data.people.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Related section
                    <select name="sectionKey" defaultValue={sectionKey}>
                      <option value="">General</option>
                      {sections.map((s) => (
                        <option key={s.key} value={s.key}>
                          {s.title}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Title
                    <input name="title" required />
                  </label>
                  <label>
                    What’s needed, and why?
                    <textarea name="message" required rows={4} />
                  </label>
                  <button className="btn primary full" disabled={busy}>
                    Create in-app request
                  </button>
                </form>
              </>
            )}
            {modal === "institute" && (
              <>
                <span className="eyebrow">PLATFORM ADMINISTRATION</span>
                <h2 id="modal-title">A new workspace.</h2>
                <p>
                  Create an owner and a manual trial subscription. Share
                  credentials yourself through an appropriate channel.
                </p>
                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    const f = new FormData(e.currentTarget);
                    await mutate(
                      "platform",
                      "POST",
                      {
                        ...Object.fromEntries(f),
                        seats: Number(f.get("seats")),
                        caseLimit: Number(f.get("caseLimit")),
                      },
                      "Workspace and owner created.",
                    );
                  }}
                >
                  <label>
                    Workspace name
                    <input name="name" required />
                  </label>
                  <label>
                    Owner name
                    <input name="ownerName" required />
                  </label>
                  <label>
                    Owner email
                    <input type="email" name="ownerEmail" required />
                  </label>
                  <label>
                    Initial password
                    <input
                      name="password"
                      type="password"
                      minLength={12}
                      required
                      autoComplete="new-password"
                    />
                  </label>
                  <label>
                    Plan
                    <select name="plan">
                      {["Institute", "Individual", "Enterprise"].map((s) => (
                        <option key={s}>{s}</option>
                      ))}
                    </select>
                  </label>
                  <div className="field-grid">
                    <label>
                      Seats
                      <input
                        name="seats"
                        type="number"
                        min={1}
                        defaultValue={5}
                        required
                      />
                    </label>
                    <label>
                      Case limit
                      <input
                        name="caseLimit"
                        type="number"
                        min={1}
                        defaultValue={100}
                        required
                      />
                    </label>
                  </div>
                  <button className="btn primary full" disabled={busy}>
                    Create workspace
                  </button>
                </form>
              </>
            )}
            {modal === "subscription" && selectedTenant && (
              <>
                <span className="eyebrow">MANUAL SUBSCRIPTION</span>
                <h2 id="modal-title">{selectedTenant.name}</h2>
                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    const f = new FormData(e.currentTarget);
                    await mutate(
                      "platform/" + selectedTenant.id,
                      "PATCH",
                      {
                        ...Object.fromEntries(f),
                        seats: Number(f.get("seats")),
                        caseLimit: Number(f.get("caseLimit")),
                        storageMb: Number(f.get("storageMb")),
                      },
                      "Subscription entitlements updated.",
                    );
                  }}
                >
                  <label>
                    Plan
                    <select name="plan" defaultValue={selectedTenant.plan}>
                      {["Institute", "Individual", "Enterprise"].map((s) => (
                        <option key={s}>{s}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Access status
                    <select name="status" defaultValue={selectedTenant.status}>
                      {[
                        "trial",
                        "active",
                        "grace",
                        "read-only",
                        "cancelled",
                      ].map((s) => (
                        <option key={s}>{s}</option>
                      ))}
                    </select>
                  </label>
                  <div className="field-grid">
                    <label>
                      Seats
                      <input
                        name="seats"
                        type="number"
                        min={1}
                        defaultValue={selectedTenant.seats}
                        required
                      />
                    </label>
                    <label>
                      Case limit
                      <input
                        name="caseLimit"
                        type="number"
                        min={1}
                        defaultValue={selectedTenant.case_limit}
                        required
                      />
                    </label>
                    <label>
                      Storage MB
                      <input
                        name="storageMb"
                        type="number"
                        min={1}
                        defaultValue={selectedTenant.storage_mb}
                        required
                      />
                    </label>
                    <label>
                      Access through date
                      <input
                        type="date"
                        name="expiresAt"
                        defaultValue={selectedTenant.expires_at}
                      />
                    </label>
                  </div>
                  <button className="btn primary full" disabled={busy}>
                    Save access & allowances
                  </button>
                </form>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
