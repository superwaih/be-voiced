import { CaretLineLeft, CaretLineRight, ChatCircleDots, ClosedCaptioning, GearSix, House, MoonStars, SquaresFour, Sun, TextAlignLeft } from "@phosphor-icons/react";
import { motion } from "motion/react";
import { useEffect, useState, type ReactNode } from "react";
import { duration } from "@be-voiced/engine/format";
import { useApp, type View } from "../store/app";
import { useProject } from "../store/project";
import { ProjectCover } from "./Covers";
import { JobTray } from "./JobTray";

const NAV: { view: View; label: string; icon: ReactNode }[] = [
  { view: "home", label: "Home", icon: <House /> },
  { view: "projects", label: "Projects", icon: <SquaresFour /> },
  { view: "transcripts", label: "Transcripts", icon: <TextAlignLeft /> },
  { view: "captions", label: "Captions", icon: <ClosedCaptioning /> },
  { view: "ask", label: "Ask a link", icon: <ChatCircleDots /> },
];

const COLLAPSE_KEY = "bevoiced.sidebarCollapsed";

function readCollapsed() {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === "1";
  } catch {
    return false;
  }
}

export function BrandMark({ size = 22, tone = "rail" }: { size?: number; tone?: "rail" | "accent" }) {
  const strong = tone === "rail" ? "var(--brand-strong)" : "var(--accent)";
  const soft = tone === "rail" ? "var(--brand-soft)" : "var(--accent-line)";
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden="true">
      <rect x="1.5" y="7" width="3.2" height="6" rx="1.6" fill={soft} />
      <rect x="6.3" y="3" width="3.2" height="14" rx="1.6" fill={strong} />
      <rect x="11.1" y="5.5" width="3.2" height="9" rx="1.6" fill={strong} />
      <rect x="15.9" y="8" width="2.6" height="4" rx="1.3" fill={soft} />
    </svg>
  );
}

function NavItem({ active, label, icon, onClick }: { active: boolean; label: string; icon: ReactNode; onClick: () => void }) {
  return (
    <button className={`side-item ${active ? "is-active" : ""}`} onClick={onClick} aria-current={active ? "page" : undefined} title={label}>
      {active && <motion.span layoutId="side-active" className="side-active" transition={{ type: "spring", stiffness: 420, damping: 38 }} />}
      <span className="side-chip">{icon}</span>
      <span className="side-label">{label}</span>
    </button>
  );
}

export function Sidebar() {
  const view = useApp((s) => s.view);
  const setView = useApp((s) => s.setView);
  const theme = useApp((s) => s.settings.theme);
  const updateSettings = useApp((s) => s.updateSettings);
  const project = useProject((s) => s.project);
  const projectMeta = useApp((s) => (project ? s.library.find((m) => m.id === project.id) : undefined));
  const dark = theme === "dark" || (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  const [collapsed, setCollapsed] = useState(readCollapsed);

  useEffect(() => {
    document.documentElement.dataset.sidebar = collapsed ? "collapsed" : "expanded";
    try {
      localStorage.setItem(COLLAPSE_KEY, collapsed ? "1" : "0");
    } catch {
      // Storage can be unavailable; the sidebar still works for this session.
    }
  }, [collapsed]);

  return (
    <nav className={`side ${collapsed ? "is-collapsed" : ""}`} aria-label="Main">
      <div className="side-top">
        <button className="side-brand" onClick={() => setView("home")} title="Be Voiced">
          <BrandMark />
          <span className="side-wordmark">Be Voiced</span>
        </button>
        <button
          className="side-toggle"
          onClick={() => setCollapsed((c) => !c)}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? <CaretLineRight /> : <CaretLineLeft />}
        </button>
      </div>

      <div className="side-group">
        {NAV.map((item) => (
          <NavItem key={item.view} active={view === item.view} label={item.label} icon={item.icon} onClick={() => setView(item.view)} />
        ))}
      </div>

      <div className="side-bottom">
        <JobTray />
        {project && (
          <button
            className={`side-project ${view === "project" ? "is-active" : ""}`}
            onClick={() => setView("project")}
            title={`Continue editing ${project.name}`}
            aria-current={view === "project" ? "page" : undefined}
          >
            <ProjectCover thumbnailPath={project.thumbnailPath} wave={projectMeta?.wave} name={project.name} size="sm" className="side-project-cover" />
            <span className="side-project-text">
              <span className="side-project-name">{project.name}</span>
              <span className="side-project-meta">
                Continue editing
                {projectMeta ? <span className="mono"> {duration(projectMeta.duration)}</span> : null}
              </span>
            </span>
          </button>
        )}
        <NavItem active={view === "settings"} label="Settings" icon={<GearSix />} onClick={() => setView("settings")} />
        <NavItem
          active={false}
          label={dark ? "Light mode" : "Dark mode"}
          icon={dark ? <Sun /> : <MoonStars />}
          onClick={() => void updateSettings({ theme: dark ? "light" : "dark" })}
        />
      </div>
    </nav>
  );
}
