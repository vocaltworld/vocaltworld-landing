import React, { useEffect, useMemo, useState } from "react";

export default function MicroPoll() {
  const [status, setStatus] = useState("idle"); // idle | saving | saved | already | error
  const [err, setErr] = useState("");
  // Supporto link /micro?question_id=...&email=... (senza token in URL)
  const [tokenOverride, setTokenOverride] = useState("");

  const url = typeof window !== "undefined" ? window.location.href : "";
  const tokenFromUrl = useMemo(() => {
    try {
      const u = new URL(url);
      return u.searchParams.get("token") || "";
    } catch {
      return "";
    }
  }, [url]);

  const effectiveToken = tokenOverride || tokenFromUrl;

  const questionId = useMemo(() => {
    // Supporta:
    // - /poll/<id>
    // - /micro?question_id=<uuid>
    try {
      const u = new URL(url);

      const qid = u.searchParams.get("question_id") || u.searchParams.get("qid") || "";
      if (qid) return qid;

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
    if (!tokenFromUrl && !tokenOverride) return null;
    const raw = tokenOverride || tokenFromUrl;
    const [data] = String(raw).split(".");
    if (!data) return null;
    const txt = base64urlToString(data);
    return safeJsonParse(txt);
  }, [tokenFromUrl, tokenOverride]);

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
        body: JSON.stringify({ token: effectiveToken, choice }),
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
  // Se arrivi da un link "pulito" senza token (es: /micro?question_id=...&email=...),
  // chiediamo alla function di generarci un token e poi procediamo normalmente.
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

      // Senza questi due non possiamo generare un token lato server
      if (!qid || !email) return;

      const flowParam = (u.searchParams.get("flow") || "").trim();
      const modeParam = (u.searchParams.get("mode") || u.searchParams.get("m") || "").trim();

      const qs = new URLSearchParams();
      qs.set("question_id", qid);
      qs.set("email", email);
      if (flowParam) qs.set("flow", flowParam);
      if (modeParam) qs.set("mode", modeParam);

      try {
        // Proviamo prima una risposta JSON (se la function la supporta).
        // Se invece risponde con redirect, lo seguiamo.
        const res = await fetch(`/.netlify/functions/micro-poll-link?${qs.toString()}`, {
          method: "GET",
          redirect: "manual",
          headers: { Accept: "application/json" },
        });

        // Redirect server-side: vai alla Location
        if (res.status >= 300 && res.status < 400) {
          const loc = res.headers.get("Location");
          if (loc) {
            window.location.href = loc;
            return;
          }
        }

        // Se è JSON e contiene token, usiamolo senza cambiare URL (fallback)
        const data = await res.json().catch(() => null);
        if (!data) throw new Error("Risposta non valida");

        const t = data.token || data.t || "";
        if (!t) throw new Error(data.error || "Token non generato");

        if (!cancelled) {
          setTokenOverride(String(t));

          // opzionale: se la function ci passa testo/opzioni, li usiamo
          if (data.question_text || data.question) {
            setQuestionText(String(data.question_text || data.question));
          }
          if (Array.isArray(data.options)) {
            setOptions((prev) => ({ ...prev, multi: data.options.map((x) => String(x)) }));
          }
          if (data.option_yes || data.option_no) {
            setOptions((prev) => ({
              ...prev,
              yn: {
                yes: String(data.option_yes || prev.yn.yes),
                no: String(data.option_no || prev.yn.no),
              },
            }));
          }
        }
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, effectiveToken]);

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
          {(tokenFromUrl || tokenOverride) ? " • token: ok" : " • token: -"}
        </div>
      </div>
    </div>
  );
}