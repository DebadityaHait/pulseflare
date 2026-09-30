import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  ArrowUpRight,
  RefreshCw,
  Send,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { Link } from "react-router-dom";
import { api } from "../api/client";

type Source = { id: string; label: string; text: string };
type Turn = {
  id: string;
  question: string;
  answer: string | null;
  status: string;
  sources: Source[];
  createdAt: string;
};
type Conversation = { turns: Turn[]; remaining: number; model: string };
const starters = [
  "What does the evidence tell us?",
  "What should I check next?",
  "Help me write a customer update.",
];

export function IncidentChat({
  incidentId,
  demo,
}: {
  incidentId: string;
  demo: boolean;
}) {
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [question, setQuestion] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(!demo);
  const [sending, setSending] = useState(false);
  const [pendingQuestion, setPendingQuestion] = useState("");
  const [refresh, setRefresh] = useState(0);
  const busy = useRef(false);
  const active = useRef(true);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  useEffect(() => {
    if (demo) return;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    api<Conversation>(`/api/incidents/${incidentId}/chat`, {
      signal: controller.signal,
    })
      .then(setConversation)
      .catch((err: Error) => {
        if (!controller.signal.aborted) setError(err.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [incidentId, demo, refresh]);
  useEffect(() => {
    if (conversation?.turns.length || sending)
      end.current?.scrollIntoView({ block: "nearest" });
  }, [conversation?.turns.length, sending]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const text = question.trim();
    if (demo || busy.current || !conversation || !text) return;
    busy.current = true;
    setSending(true);
    setPendingQuestion(text);
    setError("");
    try {
      const response = await api<Turn>(`/api/incidents/${incidentId}/chat`, {
        method: "POST",
        body: JSON.stringify({
          question: text,
          requestId: crypto.randomUUID(),
        }),
      });
      if (!active.current) return;
      setConversation((current) =>
        current
          ? {
              ...current,
              turns: [...current.turns, response],
              remaining: Math.max(0, current.remaining - 1),
            }
          : current,
      );
      setQuestion("");
    } catch (err) {
      if (active.current) {
        setError((err as Error).message);
        // Failed attempts may consume quota and are retained in the conversation.
        try {
          const saved = await api<Conversation>(
            `/api/incidents/${incidentId}/chat`,
          );
          if (active.current) setConversation(saved);
        } catch {
          /* Preserve the original actionable error. */
        }
      }
    } finally {
      busy.current = false;
      if (active.current) {
        setSending(false);
        setPendingQuestion("");
      }
    }
  }
  return (
    <section
      className="data-panel incident-chat"
      aria-label="Incident assistant"
    >
      <div className="panel-heading">
        <div>
          <h2>
            <Sparkles size={17} /> Ask about this incident
          </h2>
          <p>
            {demo
              ? "A preview of evidence-backed investigation."
              : "Llama 3.3 · Private conversation · Saved in your workspace"}
          </p>
        </div>
        {!demo && (
          <button
            className="button secondary small"
            aria-label="Refresh conversation"
            disabled={sending || loading}
            onClick={() => setRefresh((value) => value + 1)}
          >
            <RefreshCw size={14} />
          </button>
        )}
      </div>
      <div className="chat-transcript" aria-busy={loading || sending}>
        {loading ? (
          <p className="chat-status" role="status">
            Loading your conversation…
          </p>
        ) : demo ? (
          <>
            <div className="chat-message user">
              <small>Example question</small>
              <p>What does the evidence tell us?</p>
            </div>
            <div className="chat-message assistant">
              <small>
                <Sparkles size={13} /> Sample answer
              </small>
              <p>
                The recorded checks show a service-health incident. Monitoring
                evidence can establish timing and symptoms, but not the root
                cause. Compare the failed check with origin logs before
                attributing the issue to a deployment or dependency.
              </p>
              <p>
                In your workspace, answers reference the incident and recorded
                checks, and follow-up questions retain the conversation context.
              </p>
            </div>
          </>
        ) : conversation?.turns.length ? (
          conversation.turns.map((item) => (
            <div className="chat-turn" key={item.id}>
              <div className="chat-message user">
                <small>You</small>
                <p>{item.question}</p>
              </div>
              <div className="chat-message assistant">
                <small>
                  <Sparkles size={13} />{" "}
                  {item.status === "complete"
                    ? "Pulseflare"
                    : item.status === "pending"
                      ? "Answer in progress"
                      : "Answer unavailable"}
                </small>
                <p>
                  {item.answer ||
                    (item.status === "pending"
                      ? "Refresh shortly to see the saved response. If this request was interrupted, you can send a new question after two minutes."
                      : "The model could not answer this question. You can send it again.")}
                </p>
                {item.sources.length > 0 && (
                  <details className="chat-sources">
                    <summary>
                      Evidence used · {item.sources.length} sources
                    </summary>
                    {item.sources.map((source) => (
                      <div key={source.id}>
                        <strong>
                          [{source.id}] {source.label}
                        </strong>
                        <pre>{source.text}</pre>
                      </div>
                    ))}
                  </details>
                )}
              </div>
            </div>
          ))
        ) : (
          <div className="chat-empty">
            <Sparkles size={26} />
            <h3>Turn evidence into a next step.</h3>
            <p>
              Ask what happened, what to investigate, or how to explain the
              incident to customers.
            </p>
          </div>
        )}
        {sending && (
          <div className="chat-turn">
            <div className="chat-message user">
              <small>You</small>
              <p>{pendingQuestion}</p>
            </div>
            <div className="chat-message assistant">
              <small>
                <Sparkles size={13} /> Pulseflare
              </small>
              <p role="status">Reviewing the recorded evidence…</p>
            </div>
          </div>
        )}
        <div ref={end} />
      </div>
      <div aria-live="polite">
        {error && (
          <p className="chat-error" role="alert">
            {error}
          </p>
        )}
      </div>
      {demo ? (
        <div className="chat-demo-cta">
          <p>This sample conversation is read-only.</p>
          <Link className="button primary small" to="/signup">
            Ask about your incidents <ArrowUpRight size={14} />
          </Link>
        </div>
      ) : (
        <form className="chat-composer" onSubmit={submit}>
          {!conversation?.turns.length && (
            <div className="chat-starters">
              {starters.map((text) => (
                <button
                  key={text}
                  type="button"
                  disabled={sending || loading}
                  onClick={() => setQuestion(text)}
                >
                  {text}
                </button>
              ))}
            </div>
          )}
          <label htmlFor="incident-question">Your question</label>
          <textarea
            id="incident-question"
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder="What should I investigate next?"
            maxLength={1000}
            required
            rows={3}
            disabled={
              sending ||
              loading ||
              !conversation ||
              conversation.remaining === 0
            }
          />
          <div className="button-row">
            <small>
              {conversation
                ? `${conversation.remaining} workspace questions remaining today`
                : "Conversation unavailable"}
            </small>
            <button
              className="button primary small"
              disabled={
                sending ||
                loading ||
                !question.trim() ||
                !conversation ||
                conversation.remaining === 0
              }
            >
              {" "}
              {sending ? "Investigating…" : "Send question"} <Send size={14} />
            </button>
          </div>
        </form>
      )}
      <div className="chat-footnote">
        <ShieldCheck size={13} /> Uses incident evidence, not secrets or
        external logs. Verify suggestions before acting. Avoid including
        credentials in your questions.
      </div>
    </section>
  );
}
