import React, { useMemo, useState } from "react";

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

  // Per ora domanda hardcoded (poi lo rendiamo dinamico con una tabella questions)
  const questionText = "Quale direzione ti convince di più per il futuro di Vocal T World?";

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

        <div style={{ display: "flex", gap: 10 }}>
          <button
            onClick={() => submitVote("1")}
            disabled={status === "saving" || status === "saved" || status === "already"}
            style={{ flex: 1, padding: "12px 14px", borderRadius: 999, border: 0, fontWeight: 700, cursor: "pointer" }}
          >
            Opzione 1
          </button>

          <button
            onClick={() => submitVote("2")}
            disabled={status === "saving" || status === "saved" || status === "already"}
            style={{ flex: 1, padding: "12px 14px", borderRadius: 999, border: 0, fontWeight: 700, cursor: "pointer" }}
          >
            Opzione 2
          </button>
        </div>

        <div style={{ marginTop: 14, textAlign: "center", minHeight: 22, color: "rgba(255,255,255,0.8)" }}>
          {status === "saving" && "Sto salvando…"}
          {status === "saved" && "Risposta salvata ✅ Grazie."}
          {status === "already" && "Hai già partecipato ✅"}
          {status === "error" && <span style={{ color: "#ff7b7b" }}>Errore: {err}</span>}
        </div>

        <div style={{ marginTop: 8, textAlign: "center", color: "rgba(255,255,255,0.35)", fontSize: 12 }}>
          ID domanda: {questionId || "-"}
        </div>
      </div>
    </div>
  );
}