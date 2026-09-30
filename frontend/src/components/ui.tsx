import { Activity, ArrowRight, Check, Moon, Sun, X } from "lucide-react";
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Link } from "react-router-dom";

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <Link className="brand" to="/" aria-label="Pulseflare home">
      <span className="brand-symbol">
        <Activity size={22} strokeWidth={2.5} />
      </span>
      {!compact && (
        <span>
          pulseflare<span className="brand-period">.</span>
        </span>
      )}
    </Link>
  );
}
export function Badge({ state }: { state: string }) {
  return (
    <span className={`badge ${state.toLowerCase()}`}>
      {state.replaceAll("_", " ")}
    </span>
  );
}
export function ThemeToggle() {
  const [theme, setTheme] = useState(
    () => document.documentElement.dataset.theme || "dark",
  );
  useEffect(() => {
    const sync = () =>
      setTheme(document.documentElement.dataset.theme || "dark");
    const observer = new MutationObserver(sync);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => observer.disconnect();
  }, []);
  function toggle() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem("pulseflare_theme", next);
    } catch {
      /* Private browsing may disable persistence. */
    }
  }
  return (
    <button
      className="icon-btn"
      onClick={toggle}
      aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
    >
      {theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}
    </button>
  );
}
const DialogContext = createContext<(title?: string, body?: string) => void>(
  () => {},
);
export function useNotice() {
  return useContext(DialogContext);
}
export function NoticeProvider({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [content, setContent] = useState({
    title: "Coming soon",
    body: "We’re getting this ready. In the meantime, explore the interactive demo.",
  });
  const open = (
    title = "Coming soon",
    body = "We’re getting this ready. In the meantime, explore the interactive demo.",
  ) => {
    setContent({ title, body });
    ref.current?.showModal();
  };
  return (
    <DialogContext.Provider value={open}>
      {children}
      <dialog
        ref={ref}
        className="notice-dialog"
        aria-labelledby="notice-title"
        onClick={(e) => {
          if (e.target === e.currentTarget) ref.current?.close();
        }}
      >
        <button
          className="icon-btn dialog-close"
          aria-label="Close dialog"
          onClick={() => ref.current?.close()}
        >
          <X size={18} />
        </button>
        <span className="dialog-mark">
          <Activity size={28} />
        </span>
        <h2 id="notice-title">{content.title}</h2>
        <p>{content.body}</p>
        <Link
          className="button primary"
          to="/demo"
          onClick={() => ref.current?.close()}
        >
          Explore the demo <ArrowRight size={16} />
        </Link>
      </dialog>
    </DialogContext.Provider>
  );
}
export function CopyButton({
  text,
  label = "Copy",
}: {
  text: string;
  label?: string;
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const notice = useNotice();
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <button
      className="button small secondary"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          timer.current = setTimeout(() => setCopied(false), 1800);
        } catch {
          notice(
            "Copy unavailable",
            "Your browser blocked clipboard access. Select the displayed text to copy it manually.",
          );
        }
      }}
    >
      {copied && <Check size={14} />}
      {copied ? "Copied" : label}
    </button>
  );
}
export function Empty({
  title,
  text,
  children,
}: {
  title: string;
  text: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <Activity size={28} />
      <h3>{title}</h3>
      <p>{text}</p>
      {children}
    </div>
  );
}
