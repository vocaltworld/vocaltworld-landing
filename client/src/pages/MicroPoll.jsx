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
    if (parts.length !== 3) return null; // we only support JWT now
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

    // from token payload (our server uses q)
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

  // ---- If coming with clean link (no token): generate token via server and redirect OR set tokenOverride
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

        // if server also returns meta, use it immediately
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

  // ---- When we have a token: fetch real question/options from server (because JWT may not include options)
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

        // server truth for flow/mode
        if (data.flow) setFlow(String(data.flow));
        if (data.mode) setMode(String(data.mode));
      } catch (e) {
        // non blocchiamo la pagina: lasciamo fallback, ma mostriamo errore soft
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

    const ok = window.confirm("Sei sicuro della tua risposta? Non potrai cambiarla.");
    if (!ok) return;

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

  // --- UI (come prima, gradient)
  const cardStyle = {
    maxWidth: 720,
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
    fontWeight: 800,
    cursor: "pointer",
    color: "#fff",
    letterSpacing: 0.2,
  };

  const btnYes = {
    ...btnBase,
    background: "linear-gradient(90deg, #1fb6ff, #2f62ff)",
  };

  const btnNo = {
    ...btnBase,
    background: "linear-gradient(90deg, #ff2ea6, #ff7b3d)",
  };

  const btnMulti = {
    ...btnBase,
    background: "linear-gradient(90deg, rgba(255,255,255,0.16), rgba(255,255,255,0.10))",
    color: "rgba(255,255,255,0.92)",
    border: "1px solid rgba(255,255,255,0.10)",
  };

  const disabled =
    status === "saving" || status === "saved" || status === "already";

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
            fontWeight: 700,
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
              return (
                <button
                  key={choice}
                  onClick={() => submitVote(choice)}
                  disabled={disabled}
                  style={btnMulti}
                >
                  {label || `Opzione ${idx + 1}`}
                </button>
              );
            })}
          </div>
        ) : (
          <div style={{ display: "flex", gap: 12 }}>
            <button
              onClick={() => submitVote("1")}
              disabled={disabled}
              style={{ ...btnYes, flex: 1 }}
            >
              {options.yn?.yes || "Sì"}
            </button>

            <button
              onClick={() => submitVote("2")}
              disabled={disabled}
              style={{ ...btnNo, flex: 1 }}
            >
              {options.yn?.no || "No"}
            </button>
          </div>
        )}

        <div
          style={{
            marginTop: 14,
            textAlign: "center",
            minHeight: 22,
            color: "rgba(255,255,255,0.8)",
          }}
        >
          {status === "saving" && "Sto salvando…"}
          {status === "saved" && "Risposta salvata ✅ Grazie."}
          {status === "already" && "Hai già partecipato ✅"}
          {status === "error" && (
            <span style={{ color: "#ff7b7b" }}>Errore: {err}</span>
          )}
        </div>

        <div
          style={{
            marginTop: 10,
            textAlign: "center",
            color: "rgba(255,255,255,0.35)",
            fontSize: 12,
          }}
        >
          ID domanda: {questionId || "-"} • mode: {mode || "-"} • flow:{" "}
          {flow || "-"} • token: {effectiveToken ? "ok" : "-"}
        </div>
      </div>
    </div>
  );
}