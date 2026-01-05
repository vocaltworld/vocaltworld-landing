import React, { useEffect, useMemo, useState } from "react";

const DEFAULT_Q =
  "Quale direzione ti convince di più per il futuro di Vocal T World?";

export default function MicroPoll() {
  const [status, setStatus] = useState("idle"); // idle | saving | saved | already | error
  const [err, setErr] = useState("");

  const url = typeof window !== "undefined" ? window.location.href : "";

  const [tokenOverride, setTokenOverride] = useState("");
  const tokenFromUrl = useMemo(() => {
    try {
      const u = new URL(url);
      return u.searchParams.get("token") || "";
    } catch {
      return "";
    }
  }, [url]);

  const effectiveToken = (tokenOverride || tokenFromUrl || "").trim();

  // ---- helpers
  function base64urlToString(b64url) {
    const b64 = String(b64url || "").replace(/-/g, "+").replace(/_/g, "/");
    const pad = b64.length % 4 ? "=".repeat(4 - (b64.length % 4)) : "";
    try {
      return atob(b64 + pad);
    } catch {
      return "";
    }
  }

  function safeJsonParse(s) {
    try {
      return JSON.parse(s);
    } catch {
      return null;
    }
  }

  // ---- token payload (JWT support)
  const tokenPayload = useMemo(() => {
    const raw = String(effectiveToken || "").trim();
    if (!raw) return null;

    const parts = raw.split(".");
    if (parts.length !== 3) return null; // JWT only
    const payloadB64 = parts[1];
    const txt = base64urlToString(payloadB64);
    return safeJsonParse(txt);
  }, [effectiveToken]);

  // ---- derive question_id (from query OR token payload)
  const questionId = useMemo(() => {
    try {
      const u = new URL(url);
      const qid = (u.searchParams.get("question_id") ||
        u.searchParams.get("qid") ||
        "").trim();
      if (qid) return qid;
    } catch {
      // ignore
    }

    const tq = String(tokenPayload?.q || "").trim();
    return tq || "";
  }, [url, tokenPayload]);

  // ---- flow + mode (prefer server truth later)
  const [flow, setFlow] = useState("");
  const [mode, setMode] = useState("yn"); // yn | multi

  // ---- question + options UI
  const [questionText, setQuestionText] = useState(DEFAULT_Q);
  const [options, setOptions] = useState({
    yn: { yes: "Sì", no: "No" },
    multi: ["Opzione 1", "Opzione 2", "Opzione 3", "Opzione 4"],
  });

  // ---- UI: selection + confirm modal (NO window.confirm)
  const [selectedChoice, setSelectedChoice] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingChoice, setPendingChoice] = useState(null);
  const [pendingLabel, setPendingLabel] = useState("");

  const openConfirm = (choice, label) => {
    setPendingChoice(String(choice));
    setPendingLabel(String(label || ""));
    setConfirmOpen(true);
  };

  const closeConfirm = () => {
    setConfirmOpen(false);
    setPendingChoice(null);
    setPendingLabel("");
  };

  // ---- If coming with clean link (no token): generate token via server
  useEffect(() => {
    let cancelled = false;

    const hydrateTokenIfNeeded = async () => {
      if (effectiveToken) return;

      let u;
      try {
        u = new URL(url);
      } catch {
        return;
      }

      const qid = (u.searchParams.get("question_id") || "").trim();
      const email = (u.searchParams.get("email") || "").trim();
      if (!qid || !email) return;

      const f = String(u.searchParams.get("flow") || "").trim().toLowerCase();
      const m = String(
        u.searchParams.get("mode") || u.searchParams.get("m") || ""
      )
        .trim()
        .toLowerCase();

      const qs = new URLSearchParams();
      qs.set("question_id", qid);
      qs.set("email", email);
      if (f) qs.set("flow", f);
      if (m) qs.set("mode", m);
      qs.set("format", "json");

      try {
        const res = await fetch(
          `/.netlify/functions/micro-poll-link?${qs.toString()}`,
          { method: "GET", headers: { Accept: "application/json" } }
        );

        const data = await res.json().catch(() => null);
        if (!res.ok || !data) throw new Error(data?.error || "Token non generato");

        const t = String(data.token || "").trim();
        if (!t) throw new Error("Token non generato");

        if (cancelled) return;

        setTokenOverride(t);

        if (data.question) setQuestionText(String(data.question));
        if (Array.isArray(data.options) && data.options.length >= 2) {
          setOptions((prev) => ({ ...prev, multi: data.options.map(String) }));
        }
        if (data.flow) setFlow(String(data.flow));
        if (data.mode) setMode(String(data.mode));
      } catch (e) {
        if (!cancelled) {
          setStatus("error");
          setErr(e?.message || "Errore nel caricamento del micro-sondaggio");
        }
      }
    };

    hydrateTokenIfNeeded();
    return () => {
      cancelled = true;
    };
  }, [url, effectiveToken]);

  // ---- When we have a token: fetch real question/options from server
  useEffect(() => {
    let cancelled = false;

    const fetchMeta = async () => {
      const t = String(effectiveToken || "").trim();
      if (!t) return;

      try {
        const qs = new URLSearchParams();
        qs.set("token", t);
        qs.set("format", "json");

        const res = await fetch(
          `/.netlify/functions/micro-poll-link?${qs.toString()}`,
          { method: "GET", headers: { Accept: "application/json" } }
        );
        const data = await res.json().catch(() => null);
        if (!res.ok || !data) throw new Error(data?.error || "Meta non disponibile");

        if (cancelled) return;

        if (data.question) setQuestionText(String(data.question));
        if (Array.isArray(data.options) && data.options.length >= 2) {
          setOptions((prev) => ({ ...prev, multi: data.options.map(String) }));
        }

        if (data.flow) setFlow(String(data.flow));
        if (data.mode) setMode(String(data.mode));
      } catch (e) {
        if (!cancelled) {
          setStatus((s) => (s === "idle" ? "error" : s));
          setErr(e?.message || "Errore lettura dati sondaggio");
        }
      }
    };

    fetchMeta();
    return () => {
      cancelled = true;
    };
  }, [effectiveToken]);

  const submitVote = async (choice) => {
    if (!effectiveToken) {
      setStatus("error");
      setErr("Token mancante. Apri il link dall’email.");
      return;
    }

    try {
      setStatus("saving");
      setErr("");

      const res = await fetch("/.netlify/functions/micro-poll-vote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: effectiveToken,
          choice,
          question_id: questionId,
          flow,
          mode,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Errore salvataggio");

      if (data.already_voted) setStatus("already");
      else setStatus("saved");
    } catch (e) {
      setStatus("error");
      setErr(e?.message || "Errore inatteso");
    }
  };

  // ---------------- UI STYLES
  const cardStyle = {
    maxWidth: 760,
    width: "100%",
    background: "rgba(255,255,255,0.04)",
    border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: 18,
    padding: 22,
    boxShadow: "0 20px 80px rgba(0,0,0,0.55)",
  };

  const btnBase = {
    width: "100%",
    padding: "14px 16px",
    borderRadius: 999,
    border: 0,
    fontWeight: 900,
    cursor: "pointer",
    color: "#fff",
    letterSpacing: 0.2,
    transition: "transform 140ms ease, box-shadow 140ms ease, filter 140ms ease",
  };

  const btnYes = {
    ...btnBase,
    background: "linear-gradient(90deg, #1fb6ff, #2f62ff)",
  };

  const btnNo = {
    ...btnBase,
    background: "linear-gradient(90deg, #ff2ea6, #ff7b3d)",
  };

  // ✅ Multi: 4 gradient “pieni” (stesso vibe di sì/no)
  const multiGradients = [
    "linear-gradient(90deg, #1fb6ff, #2f62ff)", // blu
    "linear-gradient(90deg, #ff2ea6, #ff7b3d)", // pink/orange
    "linear-gradient(90deg, #22c55e, #16a34a)", // green
    "linear-gradient(90deg, #a855f7, #6366f1)", // purple/indigo
  ];

  const getMultiBtnStyle = (idx, isSelected) => {
    const bg = multiGradients[idx % multiGradients.length];
    return {
      ...btnBase,
      background: bg,
      boxShadow: isSelected ? "0 0 0 3px rgba(255,255,255,0.12)" : "none",
      filter: isSelected ? "brightness(1.06)" : "none",
      transform: isSelected ? "scale(1.01)" : "none",
    };
  };

  const disabled = status === "saving" || status === "saved" || status === "already";

  // ✅ Quando hai finito (saved/already) mostri SOLO la schermata finale al centro
  const isDone = status === "saved" || status === "already";

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#020308",
        color: "#fff",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
    >
      <div style={cardStyle}>
        <img
          alt="Vocal T World"
          src="https://survey.vocaltworld.com/logo-vtw.png"
          style={{ maxWidth: 140, display: "block", margin: "0 auto 14px auto" }}
        />

        {/* ✅ DONE VIEW (solo conferma / già votato) */}
        {isDone ? (
          <div style={styles.doneCenter}>
            {status === "saved" ? (
              <div style={styles.resultWrap}>
                <div style={styles.checkCircle}>✓</div>
                <div style={styles.resultTitle}>Risposta salvata con successo ✅</div>
                <div style={styles.resultSub}>
                  Grazie! La tua risposta è stata registrata.
                </div>
              </div>
            ) : (
              <div style={styles.resultWrap}>
                <div style={styles.infoCircle}>i</div>
                <div style={styles.resultTitle}>Hai già votato</div>
                <div style={styles.resultSub}>
                  Questo link è valido per una sola risposta.
                </div>
              </div>
            )}
          </div>
        ) : (
          <>
            <h1
              style={{
                textAlign: "center",
                margin: "0 0 10px 0",
                fontSize: 18,
                letterSpacing: 1,
                textTransform: "uppercase",
              }}
            >
              Vocal T World
            </h1>

            <p
              style={{
                textAlign: "center",
                color: "rgba(255,255,255,0.88)",
                lineHeight: 1.6,
                margin: "0 0 16px 0",
                fontSize: 18,
                fontWeight: 800,
              }}
            >
              {questionText}
            </p>

            <p
              style={{
                textAlign: "center",
                color: "rgba(255,255,255,0.60)",
                margin: "0 0 18px 0",
                fontSize: 13,
              }}
            >
              Puoi partecipare una sola volta. Scegli un’opzione e poi conferma.
            </p>

            {mode === "multi" ? (
              <div style={{ display: "grid", gap: 12 }}>
                {(options.multi || []).slice(0, 4).map((label, idx) => {
                  const choice = String(idx + 1);
                  const isSelected = selectedChoice === choice;
                  return (
                    <button
                      key={choice}
                      onClick={() => {
                        setSelectedChoice(choice);
                        openConfirm(choice, label || `Opzione ${idx + 1}`);
                      }}
                      disabled={disabled}
                      style={getMultiBtnStyle(idx, isSelected)}
                    >
                      {label || `Opzione ${idx + 1}`}
                    </button>
                  );
                })}
              </div>
            ) : (
              <div style={{ display: "flex", gap: 12 }}>
                <button
                  onClick={() => {
                    setSelectedChoice("1");
                    openConfirm("1", options.yn?.yes || "Sì");
                  }}
                  disabled={disabled}
                  style={{
                    ...btnYes,
                    flex: 1,
                    ...(selectedChoice === "1" ? styles.optionSelectedYn : null),
                  }}
                >
                  {options.yn?.yes || "Sì"}
                </button>

                <button
                  onClick={() => {
                    setSelectedChoice("2");
                    openConfirm("2", options.yn?.no || "No");
                  }}
                  disabled={disabled}
                  style={{
                    ...btnNo,
                    flex: 1,
                    ...(selectedChoice === "2" ? styles.optionSelectedYn : null),
                  }}
                >
                  {options.yn?.no || "No"}
                </button>
              </div>
            )}

            {confirmOpen && (
              <div style={styles.modalOverlay} onClick={closeConfirm}>
                <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
                  <div style={styles.modalTitle}>Confermi la tua scelta?</div>
                  <div style={styles.modalText}>Non potrai cambiarla.</div>
                  {pendingLabel ? <div style={styles.modalChoice}>“{pendingLabel}”</div> : null}

                  <div style={styles.modalActions}>
                    <button style={styles.modalBtnGhost} onClick={closeConfirm}>
                      Annulla
                    </button>
                    <button
                      style={styles.modalBtnPrimary}
                      onClick={() => {
                        const c = pendingChoice;
                        closeConfirm();
                        if (c) submitVote(String(c));
                      }}
                    >
                      OK
                    </button>
                  </div>
                </div>
              </div>
            )}

            <div style={{ marginTop: 14 }}>
              {status === "saving" && <div style={styles.notice}>Sto salvando…</div>}
              {status === "error" && <div style={styles.errorBox}>Errore: {err}</div>}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

const styles = {
  optionSelectedYn: {
    boxShadow: "0 0 0 3px rgba(120,180,255,0.18)",
  },

  // ✅ center done view
  doneCenter: {
    padding: "10px 0 6px 0",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    minHeight: 260,
  },

  // modal
  modalOverlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.60)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 9999,
    padding: 16,
  },
  modal: {
    width: "min(520px, 100%)",
    borderRadius: 18,
    border: "1px solid rgba(255,255,255,0.10)",
    background: "rgba(14,16,20,0.92)",
    backdropFilter: "blur(16px)",
    padding: 18,
    boxShadow: "0 20px 70px rgba(0,0,0,0.55)",
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: 900,
    color: "rgba(255,255,255,0.92)",
    marginBottom: 6,
  },
  modalText: {
    fontSize: 13,
    color: "rgba(255,255,255,0.70)",
    lineHeight: 1.5,
  },
  modalChoice: {
    marginTop: 12,
    padding: "10px 12px",
    borderRadius: 12,
    background: "rgba(255,255,255,0.06)",
    border: "1px solid rgba(255,255,255,0.10)",
    color: "rgba(255,255,255,0.88)",
    fontWeight: 800,
    textAlign: "center",
  },
  modalActions: {
    marginTop: 14,
    display: "flex",
    justifyContent: "flex-end",
    gap: 10,
  },
  modalBtnGhost: {
    padding: "10px 14px",
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(255,255,255,0.06)",
    color: "rgba(255,255,255,0.85)",
    fontWeight: 800,
    cursor: "pointer",
  },
  modalBtnPrimary: {
    padding: "10px 14px",
    borderRadius: 12,
    border: "1px solid rgba(120,180,255,0.55)",
    background: "rgba(120,180,255,0.18)",
    color: "rgba(255,255,255,0.92)",
    fontWeight: 900,
    cursor: "pointer",
  },

  // feedback
  notice: {
    textAlign: "center",
    color: "rgba(255,255,255,0.80)",
    minHeight: 22,
  },
  resultWrap: {
    width: "min(560px, 100%)",
    padding: "18px 16px",
    borderRadius: 18,
    border: "1px solid rgba(255,255,255,0.10)",
    background: "rgba(255,255,255,0.05)",
    textAlign: "center",
  },
  checkCircle: {
    width: 50,
    height: 50,
    borderRadius: 999,
    margin: "0 auto",
    display: "grid",
    placeItems: "center",
    border: "2px solid rgba(90,220,160,0.55)",
    color: "rgba(90,220,160,0.95)",
    fontWeight: 900,
    fontSize: 24,
  },
  infoCircle: {
    width: 50,
    height: 50,
    borderRadius: 999,
    margin: "0 auto",
    display: "grid",
    placeItems: "center",
    border: "2px solid rgba(120,180,255,0.55)",
    color: "rgba(255,255,255,0.85)",
    fontWeight: 900,
    fontSize: 18,
  },
  resultTitle: {
    marginTop: 12,
    fontSize: 16,
    fontWeight: 900,
    color: "rgba(255,255,255,0.92)",
  },
  resultSub: {
    marginTop: 6,
    fontSize: 13,
    color: "rgba(255,255,255,0.70)",
    lineHeight: 1.4,
  },
  errorBox: {
    marginTop: 0,
    padding: "12px 12px",
    borderRadius: 14,
    border: "1px solid rgba(255,123,123,0.22)",
    background: "rgba(255,123,123,0.08)",
    color: "#ff7b7b",
    fontWeight: 800,
    textAlign: "center",
  },
};