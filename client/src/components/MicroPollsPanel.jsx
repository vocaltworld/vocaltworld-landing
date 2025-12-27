import React, { useEffect, useMemo, useRef, useState } from "react";

function formatDate(iso) {
  if (!iso) return "-";
  const d = new Date(iso);
  return d.toLocaleString("it-IT", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export default function MicroPollsPanel({ adminKey }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [questions, setQuestions] = useState([]);
  const [selectedId, setSelectedId] = useState("");

  const [rows, setRows] = useState([]);
  const [stats, setStats] = useState(null);

  const pollingRef = useRef(null);

  const headers = useMemo(
    () => ({
      "Content-Type": "application/json",
      "x-admin-key": adminKey || "",
    }),
    [adminKey]
  );

  async function fetchQuestions({ silent = false } = {}) {
    try {
      if (!silent) setLoading(true);
      if (!silent) setError("");

      const res = await fetch("/.netlify/functions/admin-micro-polls?mode=questions", {
        method: "GET",
        headers,
      });

      if (res.status === 401) throw new Error("Unauthorized (admin key)");
      if (!res.ok) throw new Error("Errore caricamento questions (" + res.status + ")");

      const data = await res.json();
      const list = Array.isArray(data.questions) ? data.questions : [];
      setQuestions(list);

      // Se non hai selezione, prende la prima (più recente)
      if (!selectedId && list.length > 0) {
        setSelectedId(list[0].id);
      }
    } catch (e) {
      setError(e?.message || "Errore inatteso");
    } finally {
      if (!silent) setLoading(false);
    }
  }

  async function fetchResults({ silent = false } = {}) {
    if (!selectedId) return;
    try {
      if (!silent) setLoading(true);
      if (!silent) setError("");

      const url =
        "/.netlify/functions/admin-micro-polls?mode=results&question_id=" +
        encodeURIComponent(selectedId);

      const res = await fetch(url, { method: "GET", headers });

      if (res.status === 401) throw new Error("Unauthorized (admin key)");
      if (!res.ok) throw new Error("Errore caricamento results (" + res.status + ")");

      const data = await res.json();
      setRows(Array.isArray(data.rows) ? data.rows : []);
      setStats(data.stats || null);
    } catch (e) {
      if (!silent) setError(e?.message || "Errore inatteso");
    } finally {
      if (!silent) setLoading(false);
    }
  }

  useEffect(() => {
    fetchQuestions({ silent: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ogni volta che cambia domanda, ricarica risultati
  useEffect(() => {
    if (!selectedId) return;
    fetchResults({ silent: false });

    // polling come admin-dashboard: ogni 15 sec, solo se tab visibile
    if (pollingRef.current) clearInterval(pollingRef.current);
    pollingRef.current = setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      fetchResults({ silent: true });
    }, 15000);

    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
      pollingRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  const selected = useMemo(
    () => questions.find((q) => q.id === selectedId) || null,
    [questions, selectedId]
  );

  if (loading && questions.length === 0) {
    return <div className="admin-page"><p className="admin-loading">Caricamento Micro Polls…</p></div>;
  }

  if (error && questions.length === 0) {
    return <div className="admin-page"><p className="admin-error">Errore: {error}</p></div>;
  }

  return (
    <div className="admin-page">
      <div className="admin-header" style={{ alignItems: "flex-start" }}>
        <div className="admin-header-left">
          <h1 className="admin-title">Micro Polls</h1>
          <p style={{ margin: "6px 0 0 0", opacity: 0.85 }}>
            Seleziona una domanda e vedi SI/NO + risposte in tempo reale.
          </p>
        </div>

        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <button
            type="button"
            className="admin-logout-btn"
            onClick={() => {
              fetchQuestions({ silent: true });
              fetchResults({ silent: false });
            }}
            title="Aggiorna"
          >
            Aggiorna
          </button>
        </div>
      </div>

      <section className="admin-section">
        <h2 className="admin-subtitle">Seleziona sondaggio</h2>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <select
            value={selectedId}
            onChange={(e) => setSelectedId(e.target.value)}
            style={{
              padding: "10px 12px",
              borderRadius: 10,
              border: "1px solid rgba(255,255,255,0.12)",
              background: "rgba(0,0,0,0.35)",
              color: "white",
              minWidth: 320,
            }}
          >
            {questions.map((q) => (
              <option key={q.id} value={q.id}>
                {(q.campaign_label || q.campaign_key || "Micro Poll")} — {q.question}
              </option>
            ))}
          </select>

          {selected && (
            <div style={{ opacity: 0.85, fontSize: 13 }}>
              <div><strong>Campaign:</strong> {selected.campaign_label || selected.campaign_key || "-"}</div>
              <div><strong>Attivo:</strong> {selected.active ? "SI" : "NO"}</div>
            </div>
          )}
        </div>
      </section>

      {error && (
        <div className="admin-page">
          <p className="admin-error">Errore: {error}</p>
        </div>
      )}

      {stats && (
        <div className="admin-stats">
          <div className="admin-stat-card admin-stat-total">
            <span className="admin-stat-label">Totale risposte</span>
            <span className="admin-stat-value">{stats.total}</span>
          </div>

          <div className="admin-stat-card admin-stat-yes">
            <span className="admin-stat-label">SI</span>
            <span className="admin-stat-value">
              {stats.yes}
              <span className="admin-stat-sub"> ({stats.pctYes}%)</span>
            </span>
          </div>

          <div className="admin-stat-card admin-stat-no">
            <span className="admin-stat-label">NO</span>
            <span className="admin-stat-value">
              {stats.no}
              <span className="admin-stat-sub"> ({stats.pctNo}%)</span>
            </span>
          </div>
        </div>
      )}

      <section className="admin-section">
        <h2 className="admin-subtitle">Risposte (ultime 500)</h2>

        <div className="admin-table">
          <div className="admin-table-header">
            <div className="admin-th admin-th-date">Data</div>
            <div className="admin-th admin-th-email">Email</div>
            <div className="admin-th admin-th-int">Risposta</div>
          </div>

          <div className="admin-table-body">
            {rows.map((r, idx) => {
              const choice = String(r.choice);
              const label = choice === "1" ? "SI" : choice === "2" ? "NO" : choice;
              const isYes = choice === "1";

              return (
                <div key={idx} className="admin-row" style={{ cursor: "default" }}>
                  <div className="admin-td admin-td-date">{formatDate(r.created_at)}</div>
                  <div className="admin-td admin-td-email" title={r.email || ""}>
                    {r.email || "-"}
                  </div>
                  <div className="admin-td admin-td-int">
                    <span className={"admin-pill " + (isYes ? "admin-pill-yes" : "admin-pill-no")}>
                      {label}
                    </span>
                  </div>
                </div>
              );
            })}

            {rows.length === 0 && <div className="admin-table-empty">Nessuna risposta trovata.</div>}
          </div>
        </div>
      </section>
    </div>
  );
}