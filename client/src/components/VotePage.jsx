import React, { useEffect, useMemo, useState } from "react";
import { useParams, Link, useSearchParams } from "react-router-dom";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

export default function VotePage() {
  const { questionId } = useParams();
  const [searchParams] = useSearchParams();

  // Supporta sia ?token=... (nuovo) sia ?t=... (vecchio)
  const tokenFromUrl = useMemo(() => {
    return (searchParams.get("token") || searchParams.get("t") || "").trim();
  }, [searchParams]);

  const safeId = useMemo(() => (questionId || "").trim(), [questionId]);

  // Email passata da Klaviyo (link uguale per tutti ma email dinamica)
  // Nota: in alcuni casi può arrivare url-encoded (anche 2 volte) o ancora come template non risolto.
  const emailFromUrl = useMemo(() => {
    let raw = (searchParams.get("e") || "").trim();

    // Se per qualche motivo arriva ancora il template Klaviyo, trattalo come mancante
    if (raw.includes("{{") || raw.includes("}}")) return "";

    // Prova a decodificare (anche doppia-encoding)
    for (let i = 0; i < 2; i++) {
      try {
        const decoded = decodeURIComponent(raw);
        if (decoded === raw) break;
        raw = decoded;
      } catch {
        break;
      }
    }

    raw = raw.trim().toLowerCase();

    // Sanity check base email (evita chiamate inutili al backend)
    if (!raw || !raw.includes("@") || raw.length > 320) return "";
    return raw;
  }, [searchParams]);

  // Pre-selezione scelta: ?c=1 o ?c=2 (opzionale)
  const choicePrefill = useMemo(() => {
    const c = (searchParams.get("c") || "").trim();
    return c === "1" || c === "2" ? c : "";
  }, [searchParams]);

  const [loading, setLoading] = useState(true);
  const [question, setQuestion] = useState(null);
  const [error, setError] = useState("");

  const [token, setToken] = useState("");
  const [tokenLoading, setTokenLoading] = useState(false);

  const [chosen, setChosen] = useState(""); // "1" | "2"
  const [showConfirm, setShowConfirm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const supabase = useMemo(() => {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return null;
    return createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }, [SUPABASE_URL, SUPABASE_ANON_KEY]);

  // 1) Carica domanda da Supabase
  useEffect(() => {
    let isMounted = true;

    async function loadQuestion() {
      setLoading(true);
      setError("");
      setQuestion(null);

      if (!safeId) {
        setError("Link non valido: manca l’ID della domanda.");
        setLoading(false);
        return;
      }

      if (!supabase) {
        setError("Configurazione mancante: SUPABASE_URL o SUPABASE_ANON_KEY non impostate.");
        setLoading(false);
        return;
      }

      try {
        const { data, error: qErr } = await supabase
          .from("micro_questions")
          .select("id, question, option_yes, option_no, active")
          .eq("id", safeId)
          .single();

        if (qErr) throw qErr;

        if (!data?.active) {
          throw new Error("Questa votazione non è disponibile (o è stata chiusa).");
        }

        if (isMounted) setQuestion(data);
      } catch (e) {
        if (isMounted) setError(e?.message || "Errore nel caricamento della domanda.");
      } finally {
        if (isMounted) setLoading(false);
      }
    }

    loadQuestion();
    return () => {
      isMounted = false;
    };
  }, [safeId, supabase]);

  // 2) Imposta token: usa quello in URL oppure generane uno via micro-poll-link usando email
  useEffect(() => {
    let isMounted = true;

    async function ensureToken() {
      setError("");

      if (tokenFromUrl) {
        if (isMounted) setToken(tokenFromUrl);
        return;
      }

      if (!emailFromUrl) {
        if (isMounted) setError("Link non valido: manca il token (o l’email per generarlo).");
        return;
      }

      if (!safeId) {
        if (isMounted) setError("Link non valido: manca l’ID della domanda.");
        return;
      }

      if (token) return;

      setTokenLoading(true);
      try {
        const qs = new URLSearchParams({
          question_id: safeId,
          email: emailFromUrl,
          format: "json",
        });

        const res = await fetch(`/.netlify/functions/micro-poll-link?${qs.toString()}`);

        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data?.token) {
          throw new Error((data?.error || "Impossibile generare il token.").toString());
        }

        if (isMounted) setToken(String(data.token));
      } catch (e) {
        if (isMounted) setError(e?.message || "Errore nella generazione del token.");
      } finally {
        if (isMounted) setTokenLoading(false);
      }
    }

    ensureToken();
    return () => {
      isMounted = false;
    };
  }, [tokenFromUrl, emailFromUrl, safeId]);

  // 3) Se arriva ?c=1/2, pre-seleziona e mostra conferma
  useEffect(() => {
    if (!choicePrefill) return;
    if (submitted) return;
    if (chosen) return;
    setChosen(choicePrefill);
    setShowConfirm(true);
  }, [choicePrefill, submitted, chosen]);

  function pick(value) {
    setChosen(value);
    setShowConfirm(true);
  }

  async function confirmVote() {
    if (!chosen) return;
    if (!token) {
      setError("Link non valido: token mancante.");
      return;
    }

    setSubmitting(true);
    setError("");

    try {
      const res = await fetch("/.netlify/functions/micro-poll-vote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, choice: chosen }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        const msg = (data?.error || "").toString();
        if (msg.toLowerCase().includes("expired")) throw new Error("Link scaduto.");
        if (msg.toLowerCase().includes("signature")) throw new Error("Link non valido.");
        throw new Error(msg || "Errore durante il voto");
      }

      if (data?.already_voted) {
        setError("Hai già votato.");
        setSubmitted(true);
        return;
      }

      setSubmitted(true);
    } catch (e) {
      setError(e?.message || "Errore durante l’invio.");
    } finally {
      setSubmitting(false);
      setShowConfirm(false);
    }
  }

  const cardStyle = {
    maxWidth: 560,
    margin: "0 auto",
    padding: 22,
    borderRadius: 16,
    background: "rgba(0,0,0,0.55)",
    border: "1px solid rgba(255,255,255,0.08)",
    boxShadow: "0 18px 40px rgba(0,0,0,0.55)",
  };

  const btnStyle = {
    width: "100%",
    padding: "12px 14px",
    borderRadius: 999,
    border: "none",
    color: "#fff",
    fontWeight: 700,
    cursor: "pointer",
    fontSize: 14,
  };

  const canVote = !loading && !error && !!question && !submitted && !!token && !tokenLoading;

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#020308",
        color: "#f8f9ff",
        fontFamily: "system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
        padding: "28px 16px",
      }}
    >
      <div style={{ textAlign: "center", marginBottom: 18 }}>
        <img
          src="/logo-vtw.png"
          alt="Vocal T World"
          style={{ maxWidth: 140, height: "auto", display: "block", margin: "0 auto" }}
        />
      </div>

      <div style={cardStyle}>
        {(loading || tokenLoading) && (
          <p style={{ opacity: 0.85, textAlign: "center" }}>
            {loading ? "Caricamento…" : "Preparazione del voto…"}
          </p>
        )}

        {!loading && error && (
          <div style={{ textAlign: "center" }}>
            <p style={{ color: "#ff9aa8", fontWeight: 700 }}>{error}</p>
            <p style={{ opacity: 0.8, fontSize: 13 }}>Se pensi sia un errore, riprova più tardi o contattaci.</p>
            <div style={{ marginTop: 14 }}>
              <Link to="/" style={{ color: "#7f88ff", textDecoration: "none" }}>
                ← Torna al sito
              </Link>
            </div>
          </div>
        )}

        {!loading && !error && question && !submitted && (
          <>
            <h1 style={{ textAlign: "center", fontSize: 18, lineHeight: 1.35, margin: "4px 0 14px 0" }}>
              {question.question}
            </h1>

            <p style={{ textAlign: "center", opacity: 0.8, fontSize: 13, margin: "0 0 16px 0" }}>
              Puoi partecipare <b>una sola volta</b>. (Conferma prima di inviare)
            </p>

            <div style={{ display: "grid", gap: 10, opacity: canVote ? 1 : 0.6 }}>
              <button
                onClick={() => pick("1")}
                disabled={!canVote}
                style={{ ...btnStyle, background: "linear-gradient(135deg,#20d3ff,#447bff)" }}
              >
                {question.option_yes || "Sì"}
              </button>

              <button
                onClick={() => pick("2")}
                disabled={!canVote}
                style={{ ...btnStyle, background: "linear-gradient(135deg,#ff4fb5,#ff8f6b)" }}
              >
                {question.option_no || "No"}
              </button>
            </div>
          </>
        )}

        {!loading && !error && submitted && (
          <div style={{ textAlign: "center" }}>
            <h2 style={{ margin: "6px 0 8px 0" }}>Risposta registrata ✅</h2>
            <p style={{ opacity: 0.8, fontSize: 13 }}>Grazie. Nelle prossime email vedrai cosa succede “dietro le quinte”.</p>
            <div style={{ marginTop: 14 }}>
              <Link to="/" style={{ color: "#7f88ff", textDecoration: "none" }}>
                ← Torna al sito
              </Link>
            </div>
          </div>
        )}
      </div>

      {showConfirm && !submitted && (
        <div
          style={{
            position: "fixed",
            left: 16,
            right: 16,
            bottom: 16,
            margin: "0 auto",
            maxWidth: 560,
            background: "rgba(8,10,18,0.95)",
            border: "1px solid rgba(255,255,255,0.12)",
            borderRadius: 16,
            padding: 14,
            boxShadow: "0 18px 40px rgba(0,0,0,0.65)",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ fontSize: 13, opacity: 0.9, textAlign: "center" }}>
              Sei sicuro? <b>Dopo non potrai cambiarla o reinviarla.</b>
            </div>

            <div style={{ display: "grid", gap: 10, gridTemplateColumns: "1fr 1fr" }}>
              <button
                onClick={() => setShowConfirm(false)}
                disabled={submitting}
                style={{
                  ...btnStyle,
                  background: "rgba(255,255,255,0.08)",
                  border: "1px solid rgba(255,255,255,0.14)",
                }}
              >
                Annulla
              </button>

              <button
                onClick={confirmVote}
                disabled={submitting}
                style={{ ...btnStyle, background: "linear-gradient(90deg,#35b6ff,#4c6bff,#7a3dff)" }}
              >
                {submitting ? "Invio…" : "Conferma"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}