import React, { useEffect, useMemo, useState } from "react";

export default function MicroPoll() {
  const [status, setStatus] = useState("idle"); // idle | saving | saved | already | error
  const [err, setErr] = useState("");

  const url = typeof window !== "undefined" ? window.location.href : "";
  const token = useMemo(() => {
    try {
      const u = new URL(url);
      return u.searchParams.get("token") || "";
    } catch {
      return "";
    }
  }, [url]);

  const questionId = useMemo(() => {
    // path tipo /poll/direction-v1
    try {
      const u = new URL(url);
      const parts = u.pathname.split("/").filter(Boolean);
      const idx = parts.indexOf("poll");
      return idx >= 0 ? (parts[idx + 1] || "") : "";
    } catch {
      return "";
    }
  }, [url]);

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

  const tokenPayload = useMemo(() => {
    if (!token) return null;
    const [data] = String(token).split(".");
    if (!data) return null;
    const txt = base64urlToString(data);
    return safeJsonParse(txt);
  }, [token]);

  const mode = useMemo(() => {
    // Priorità: querystring -> token payload -> default
    try {
      const u = new URL(url);
      const m = String(u.searchParams.get("mode") || u.searchParams.get("m") || "").trim().toLowerCase();
      if (m) return m;
    } catch {}

    const m2 = String(tokenPayload?.m || tokenPayload?.mode || "").trim().toLowerCase();
    if (m2) return m2;

    return "yn"; // compatibilità: Speaker (SI/NO)
  }, [url, tokenPayload]);

  const flow = useMemo(() => {
    try {
      const u = new URL(url);
      return String(u.searchParams.get("flow") || "").trim().toLowerCase();
    } catch {
      return "";
    }
  }, [url]);

  // Domanda + opzioni (fallback safe: non rompe nulla se non arrivano dati extra)
  const [questionText, setQuestionText] = useState(
    "Quale direzione ti convince di più per il futuro di Vocal T World?"
  );

  const [options, setOptions] = useState(() => ({
    yn: { yes: "Sì", no: "No" },
    multi: ["Opzione 1", "Opzione 2", "Opzione 3", "Opzione 4"],
  }));

  // Proviamo a leggere domanda/opzioni da querystring (comodo per debug) o dal token payload
  useEffect(() => {
    try {
      const u = new URL(url);

      const q = u.searchParams.get("q");
      if (q) setQuestionText(q);

      // Y/N labels
      const yesLabel = u.searchParams.get("yes") || u.searchParams.get("option_yes") || u.searchParams.get("o1");
      const noLabel = u.searchParams.get("no") || u.searchParams.get("option_no") || u.searchParams.get("o2");

      // MULTI labels
      const m1 = u.searchParams.get("o1") || u.searchParams.get("opt1") || u.searchParams.get("a");
      const m2 = u.searchParams.get("o2") || u.searchParams.get("opt2") || u.searchParams.get("b");
      const m3 = u.searchParams.get("o3") || u.searchParams.get("opt3") || u.searchParams.get("c");
      const m4 = u.searchParams.get("o4") || u.searchParams.get("opt4") || u.searchParams.get("d");

      // Token payload (se in futuro lo aggiungiamo lato link generator)
      const pQ = tokenPayload?.qt || tokenPayload?.question_text || tokenPayload?.question;
      const pYes = tokenPayload?.yes || tokenPayload?.option_yes;
      const pNo = tokenPayload?.no || tokenPayload?.option_no;
      const pMulti = Array.isArray(tokenPayload?.options) ? tokenPayload.options : null;

      setOptions((prev) => {
        const next = { ...prev };

        if (yesLabel || noLabel || pYes || pNo) {
          next.yn = {
            yes: String(yesLabel || pYes || prev.yn.yes),
            no: String(noLabel || pNo || prev.yn.no),
          };
        }

        const multiFromUrl = [m1, m2, m3, m4].filter((x) => x != null && String(x).trim() !== "");
        if (pMulti && pMulti.length >= 2) {
          next.multi = pMulti.map((x) => String(x));
        } else if (multiFromUrl.length >= 2) {
          // se l’utente passa almeno 2 opzioni, riempiamo le restanti con fallback
          const filled = [m1 || prev.multi?.[0] || "Opzione 1", m2 || prev.multi?.[1] || "Opzione 2", m3 || prev.multi?.[2] || "Opzione 3", m4 || prev.multi?.[3] || "Opzione 4"];
          next.multi = filled.map((x) => String(x));
        }

        return next;
      });

      if (pQ) setQuestionText(String(pQ));
    } catch {
      // ignore
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, tokenPayload]);

  const submitVote = async (choice) => {
    if (!token) {
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
        body: JSON.stringify({ token, choice }),
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

  return (
    <div style={{ minHeight: "100vh", background: "#020308", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div style={{ maxWidth: 520, width: "100%", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 16, padding: 20 }}>
        <img alt="Vocal T World" src="https://survey.vocaltworld.com/logo-vtw.png" style={{ maxWidth: 140, display: "block", margin: "0 auto 14px auto" }} />
        <h1 style={{ textAlign: "center", margin: "0 0 12px 0", fontSize: 18, letterSpacing: 1, textTransform: "uppercase" }}>
          Vocal T World
        </h1>

        <p style={{ textAlign: "center", color: "rgba(255,255,255,0.85)", lineHeight: 1.6, margin: "0 0 16px 0" }}>
          {questionText}
        </p>

        {mode === "multi" ? (
          <div style={{ display: "grid", gap: 10 }}>
            {(options.multi || ["Opzione 1", "Opzione 2", "Opzione 3", "Opzione 4"]).map((label, idx) => {
              const choice = String(idx + 1); // 1..4 (compatibile con backend semplice)
              return (
                <button
                  key={choice}
                  onClick={() => submitVote(choice)}
                  disabled={status === "saving" || status === "saved" || status === "already"}
                  style={{
                    width: "100%",
                    padding: "12px 14px",
                    borderRadius: 999,
                    border: 0,
                    fontWeight: 800,
                    cursor: "pointer",
                  }}
                >
                  {label || `Opzione ${idx + 1}`}
                </button>
              );
            })}
          </div>
        ) : (
          <div style={{ display: "flex", gap: 10 }}>
            <button
              onClick={() => submitVote("1")}
              disabled={status === "saving" || status === "saved" || status === "already"}
              style={{ flex: 1, padding: "12px 14px", borderRadius: 999, border: 0, fontWeight: 800, cursor: "pointer" }}
            >
              {options.yn?.yes || "Sì"}
            </button>

            <button
              onClick={() => submitVote("2")}
              disabled={status === "saving" || status === "saved" || status === "already"}
              style={{ flex: 1, padding: "12px 14px", borderRadius: 999, border: 0, fontWeight: 800, cursor: "pointer" }}
            >
              {options.yn?.no || "No"}
            </button>
          </div>
        )}

        <div style={{ marginTop: 14, textAlign: "center", minHeight: 22, color: "rgba(255,255,255,0.8)" }}>
          {status === "saving" && "Sto salvando…"}
          {status === "saved" && "Risposta salvata ✅ Grazie."}
          {status === "already" && "Hai già partecipato ✅"}
          {status === "error" && <span style={{ color: "#ff7b7b" }}>Errore: {err}</span>}
        </div>

        <div style={{ marginTop: 8, textAlign: "center", color: "rgba(255,255,255,0.35)", fontSize: 12 }}>
          ID domanda: {questionId || "-"}
          {mode ? ` • mode: ${mode}` : ""}
          {flow ? ` • flow: ${flow}` : ""}
        </div>
      </div>
    </div>
  );
}