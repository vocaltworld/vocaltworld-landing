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

function parseNumber(v) {
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) return Number(v);
  return null;
}

function getLastResponseInfo(surveys) {
  if (!surveys || surveys.length === 0) return null;

  const latest = surveys.reduce((acc, s) => {
    if (!acc) return s;
    const d1 = new Date(s.createdAt || s.surveyCompletedAt || s.date);
    const d2 = new Date(acc.createdAt || acc.surveyCompletedAt || acc.date);
    return d1 > d2 ? s : acc;
  }, null);

  const lastIso = latest?.createdAt || latest?.surveyCompletedAt || latest?.date;
  if (!lastIso) return null;

  const lastDate = new Date(lastIso);
  const now = new Date();
  const diffMs = now - lastDate;
  const diffMin = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  let label;
  let isFresh = false;

  if (diffDays >= 1) {
    const formatted = lastDate.toLocaleString("it-IT", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
    label = `Ultimo sondaggio: ${formatted}`;
  } else if (diffHours >= 1) {
    label = `Nuovo sondaggio ${diffHours}h fa`;
    isFresh = true;
  } else if (diffMin >= 1) {
    label = `Nuovo sondaggio ${diffMin} minuti fa`;
    isFresh = true;
  } else {
    label = "Nuovo sondaggio adesso";
    isFresh = true;
  }

  return { label, isFresh };
}

function pick(obj, key, fallback = undefined) {
  return obj && Object.prototype.hasOwnProperty.call(obj, key) ? obj[key] : fallback;
}

/**
 * 🔥 NORMALIZZAZIONE CORRETTA PER IL TUO BACKEND:
 * - molte risposte stanno in raw.answers.survey_answers
 * - score sta spesso in raw.answers.survey_score
 * - unifica campi e calcola Interested = score >= 6
 */
function getEmailSubscribed(raw) {
  // ✅ Priorità 0: se il backend (Netlify Function) ci passa già il boolean, usalo.
  // (admin-dashboard.js restituisce `isEmailSubscribed` in camelCase)
  if (typeof raw?.isEmailSubscribed === "boolean") return raw.isEmailSubscribed;
  if (typeof raw?.email_subscribed === "boolean") return raw.email_subscribed;
  if (typeof raw?.emailSubscribed === "boolean") return raw.emailSubscribed;

  // ✅ Priorità 1: consenso esplicito Klaviyo (spesso arriva in raw.answers.$consent)
  const rawAnswers = raw?.answers && typeof raw.answers === "object" ? raw.answers : {};
  const consentArr =
    (Array.isArray(raw?.$consent) ? raw.$consent : null) ??
    (Array.isArray(rawAnswers?.$consent) ? rawAnswers.$consent : null) ??
    (Array.isArray(rawAnswers?.consent) ? rawAnswers.consent : null);

  if (Array.isArray(consentArr)) {
    // Se include "email" consideriamo l’utente iscritto/consenziente alle email
    if (consentArr.map((x) => String(x).toLowerCase()).includes("email")) return true;
  }

  // ✅ Priorità 2: stato subscription (alcuni export lo mettono qui)
  const status1 = raw?.subscriptions?.email?.marketing?.status; // "SUBSCRIBED"
  const status2 = raw?.subscriptions?.email?.status; // alternativa
  const status3 = raw?.email_status; // alternativa custom

  const status = (status1 || status2 || status3 || "").toString().toUpperCase();
  if (status === "SUBSCRIBED") return true;

  return false;
}
function normalizeSurvey(raw) {
  // 1) blocchi possibili di "answers"
  const rawAnswers = raw?.answers && typeof raw.answers === "object" ? raw.answers : {};

  const surveyAnswers =
    (rawAnswers?.survey_answers && typeof rawAnswers.survey_answers === "object" ? rawAnswers.survey_answers : null) ||
    (rawAnswers?.surveyAnswers && typeof rawAnswers.surveyAnswers === "object" ? rawAnswers.surveyAnswers : null) ||
    (raw?.survey_answers && typeof raw.survey_answers === "object" ? raw.survey_answers : null) ||
    {};

  // 2) answers "finali" (solo risposte vere)
  const answers = { ...surveyAnswers };

  // Stato iscrizione email (Klaviyo consent/subscription)
  const isEmailSubscribed = getEmailSubscribed(raw);

  // 3) email + date coerenti
  const email =
    raw?.email ??
    rawAnswers?.email ??
    surveyAnswers?.email ??
    raw?.properties?.email ??
    raw?.profile?.email ??
    "-";

  const createdAt =
    raw?.createdAt ??
    raw?.surveyCompletedAt ??
    raw?.date ??
    rawAnswers?.createdAt ??
    rawAnswers?.surveyCompletedAt ??
    rawAnswers?.timestamp ??
    null;

  // 4) score: prima survey_score, poi score/interestScore vari
  const rawScore =
    parseNumber(rawAnswers?.survey_score) ??
    parseNumber(rawAnswers?.score) ??
    parseNumber(raw?.score) ??
    parseNumber(surveyAnswers?.score) ??
    parseNumber(rawAnswers?.interestScore) ??
    parseNumber(raw?.interestScore) ??
    parseNumber(surveyAnswers?.interestScore);

  const rawInterestScore =
    parseNumber(rawAnswers?.interestScore) ??
    parseNumber(raw?.interestScore) ??
    parseNumber(surveyAnswers?.interestScore);

  // 5) mismatch fix: interestScore 0 ma score > 0
  let normalizedInterestScore = null;
  if (typeof rawInterestScore === "number") {
    if (rawInterestScore === 0 && typeof rawScore === "number" && rawScore > 0) {
      normalizedInterestScore = rawScore;
    } else {
      normalizedInterestScore = rawInterestScore;
    }
  } else if (typeof rawScore === "number") {
    normalizedInterestScore = rawScore;
  }

  // 6) isInterested: proprietà se esiste, altrimenti score >= 6
  const rawIsInterested =
    (typeof raw?.isInterested === "boolean" ? raw.isInterested : null) ??
    (typeof raw?.interested === "boolean" ? raw.interested : null) ??
    (typeof rawAnswers?.isInterested === "boolean" ? rawAnswers.isInterested : null) ??
    (typeof rawAnswers?.interested === "boolean" ? rawAnswers.interested : null) ??
    (typeof surveyAnswers?.isInterested === "boolean" ? surveyAnswers.isInterested : null) ??
    (typeof surveyAnswers?.interested === "boolean" ? surveyAnswers.interested : null);

  const computedIsInterested =
    typeof normalizedInterestScore === "number" ? normalizedInterestScore >= 6 : false;

  const normalizedIsInterested =
    typeof rawIsInterested === "boolean" ? rawIsInterested : computedIsInterested;

  // 7) mappatura chiavi “comuni” (se arrivano con nomi diversi)
  // (Qui manteniamo anche compatibilità con eventuali profili vecchi)
  const mapped = {
    usageFrequency:
      pick(answers, "usageFrequency", pick(answers, "Usage Frequency", pick(rawAnswers, "usageFrequency"))),
    offlineInterest:
      pick(answers, "offlineInterest", pick(answers, "Offline Interest", pick(rawAnswers, "offlineInterest"))),
    mainUseCase:
      pick(answers, "mainUseCase", pick(answers, "Main Use Case", pick(rawAnswers, "mainUseCase"))),
    priceRange:
      pick(answers, "priceRange", pick(answers, "Price Range", pick(rawAnswers, "priceRange"))),
    extraNote:
      pick(answers, "extraNote", pick(answers, "Extra Note", pick(rawAnswers, "extraNote"))),
    communicationDifficulty:
      pick(answers, "communicationDifficulty", pick(answers, "Communication Difficulty", pick(rawAnswers, "communicationDifficulty"))),
    currentSolution:
      pick(answers, "currentSolution", pick(answers, "Current Solution", pick(rawAnswers, "currentSolution"))),
    instantOfflineInterest:
      pick(answers, "instantOfflineInterest", pick(answers, "Instant Offline Interest", pick(rawAnswers, "instantOfflineInterest"))),
  };

  // 8) hasSurvey: solo dopo che answers/rawScore sono disponibili
  const hasSurvey =
    raw?.survey_completed === true ||
    !!raw?.survey_completed ||
    (answers && Object.keys(answers).length > 0) ||
    typeof rawScore === "number" ||
    typeof rawInterestScore === "number";

  return {
    ...raw,
    // risposte vere (survey_answers)
    answers,
    // campi comodi top-level per UI
    ...mapped,

    email,
    createdAt,
    surveyCompletedAt: raw?.surveyCompletedAt ?? createdAt,

    _rawScore: rawScore,
    _rawInterestScore: rawInterestScore,

    normalizedInterestScore,
    normalizedIsInterested,
    hasSurvey,
    isEmailSubscribed,
  };
}

export default function AdminDashboard() {
  const [stats, setStats] = useState(null);
  const [surveys, setSurveys] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedSurvey, setSelectedSurvey] = useState(null);
  const [lastRowId, setLastRowId] = useState(null);

  // Polling silenzioso (senza refresh pagina) + mantenimento selezione dettaglio
  const pollingRef = useRef(null);
  const selectedKeyRef = useRef(null);

  // Chiave stabile per ritrovare lo stesso record dopo un refresh dei dati
  const getSurveyKey = (s) => {
    const email = String(s?.email || "").toLowerCase();
    const ts = s?.createdAt || s?.surveyCompletedAt || s?.date || "";
    return `${email}__${ts}`;
  };

  const [adminKey, setAdminKey] = useState(() => {
    if (typeof window === "undefined") return "";
    return window.localStorage.getItem("vt_admin_key") || "";
  });

  const [isAuth, setIsAuth] = useState(() => {
    if (typeof window === "undefined") return false;
    return !!window.localStorage.getItem("vt_admin_key");
  });

  const lastInfo = getLastResponseInfo(surveys);
  const answers = selectedSurvey?.answers || {};

  const validation = useMemo(() => {
    if (!stats || !stats.total) {
      return {
        level: "none",
        title: "In attesa di dati",
        subtitle: "Condividi il sondaggio per iniziare a validare Vocal T World.",
        hint: "Obiettivo minimo: almeno 30 risposte reali.",
      };
    }

    const total = stats.total;
    const pct = stats.interestedPercent || 0;

    const MIN_RESPONSES = 30;
    const STRONG_PCT = 70;
    const OK_PCT = 50;

    if (total < MIN_RESPONSES) {
      return {
        level: "low",
        title: "Dati ancora insufficienti",
        subtitle: `Hai ${total} risposte. Obiettivo minimo: ${MIN_RESPONSES}.`,
        hint: "Continua a raccogliere feedback prima di tirare conclusioni.",
      };
    }

    if (pct >= STRONG_PCT) {
      return {
        level: "good",
        title: "Idea promettente ✅",
        subtitle: `${total} risposte, ${pct}% interessati.`,
        hint: "Ha senso pensare a prototipo, lista d'attesa e piano di lancio.",
      };
    }

    if (pct >= OK_PCT) {
      return {
        level: "medium",
        title: "Da approfondire ⚠️",
        subtitle: `${total} risposte, ${pct}% interessati.`,
        hint: "L'idea piace a una parte delle persone: lavora su segmento e posizionamento.",
      };
    }

    return {
      level: "bad",
      title: "Non validata (per ora) ❌",
      subtitle: `${total} risposte, solo ${pct}% interessati.`,
      hint: "Potrebbe servire rivedere prezzo, messaggio o funzionalità chiave.",
    };
  }, [stats]);

  const detailRef = useRef(null);

  async function fetchDashboardData({ silent = false } = {}) {
    try {
      if (!silent) setLoading(true);
      if (!silent) setError("");

      const res = await fetch("/.netlify/functions/admin-dashboard", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-admin-key": adminKey || "",
        },
        body: JSON.stringify({ secret: adminKey || "" }),
      });

      if (res.status === 401) {
        setError("Codice segreto non valido.");
        setIsAuth(false);
        if (typeof window !== "undefined") window.localStorage.removeItem("vt_admin_key");
        if (!silent) setLoading(false);
        return;
      }

      if (!res.ok) throw new Error("Errore nel caricamento dei dati (" + res.status + ")");

      const data = await res.json();

      let nextSurveys = data.surveys || data.responses || [];
      if (!Array.isArray(nextSurveys)) nextSurveys = [];

      nextSurveys = nextSurveys.map(normalizeSurvey);

      nextSurveys = [...nextSurveys].sort((a, b) => {
        const da = new Date(a.createdAt || a.surveyCompletedAt || a.date || 0).getTime();
        const db = new Date(b.createdAt || b.surveyCompletedAt || b.date || 0).getTime();
        return db - da;
      });

      setSurveys(nextSurveys);

      // Se stavi guardando un dettaglio, mantieni la selezione e aggiorna i dati
      if (selectedKeyRef.current) {
        const found = nextSurveys.find((s) => getSurveyKey(s) === selectedKeyRef.current);
        if (found) setSelectedSurvey(found);
      }

      const total = nextSurveys.length;
      const interestedCount = nextSurveys.filter((s) => !!s.normalizedIsInterested).length;
      const notInterestedCount = total - interestedCount;

      const interestedPercent = total ? Math.round((interestedCount / total) * 100) : 0;
      const notInterestedPercent = total ? Math.round((notInterestedCount / total) * 100) : 0;

      setStats({
        total,
        interested: interestedCount,
        interestedPercent,
        notInterested: notInterestedCount,
        notInterestedPercent,
      });
    } catch (err) {
      // In modalità silent non "sporchiamo" la UI con errori
      if (!silent) setError(err?.message || "Errore inatteso");
    } finally {
      if (!silent) setLoading(false);
    }
  }

  useEffect(() => {
    if (!isAuth) return;

    // primo load “normale”
    fetchDashboardData({ silent: false });

    // polling ogni 30 secondi “silenzioso” (nessun refresh pagina)
    pollingRef.current = setInterval(() => {
      // se tab non è visibile, non sprechiamo chiamate
      if (typeof document !== "undefined" && document.hidden) return;
      fetchDashboardData({ silent: true });
    }, 30000);

    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
      pollingRef.current = null;
    };
  }, [isAuth, adminKey]);

  const handleRowClick = (survey, rowId) => {
    setSelectedSurvey(survey);
    setLastRowId(rowId);
    selectedKeyRef.current = getSurveyKey(survey);

    setTimeout(() => {
      if (detailRef.current) detailRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 80);
  };

  const handleCloseDetails = () => {
    setSelectedSurvey(null);
    selectedKeyRef.current = null;

    setTimeout(() => {
      if (!lastRowId) return;
      const rowEl = document.getElementById(lastRowId);
      if (!rowEl) return;

      rowEl.scrollIntoView({ behavior: "smooth", block: "center" });
      rowEl.classList.add("admin-row-last");
      setTimeout(() => rowEl.classList.remove("admin-row-last"), 1200);
    }, 80);
  };

  const handleLogout = () => {
    if (typeof window !== "undefined") window.localStorage.removeItem("vt_admin_key");

    setAdminKey("");
    setIsAuth(false);
    setStats(null);
    setSurveys([]);
    setSelectedSurvey(null);
    selectedKeyRef.current = null;
    setLastRowId(null);
    setError("");
  };

  if (!isAuth) {
    return (
      <div className="admin-page admin-login-page">
        <h1 className="admin-title">Accesso dashboard</h1>
        <p>Inserisci il codice segreto amministratore.</p>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!adminKey) return;
            if (typeof window !== "undefined") window.localStorage.setItem("vt_admin_key", adminKey);
            setIsAuth(true);
            setError("");
          }}
          className="admin-login-form"
        >
          <input
            type="password"
            className="admin-login-input"
            placeholder="Codice segreto"
            value={adminKey}
            onChange={(e) => setAdminKey(e.target.value)}
          />
          <button type="submit" className="admin-login-button">
            Entra
          </button>
        </form>

        {error && <p className="admin-error">Errore: {error}</p>}
      </div>
    );
  }

  if (loading) {
    return (
      <div className="admin-page">
        <p className="admin-loading">Caricamento dashboard…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="admin-page">
        <p className="admin-error">Errore: {error}</p>
      </div>
    );
  }

  return (
    <div className="admin-page">
      <div className="admin-header">
        <div className="admin-header-left">
          <h1 className="admin-title">Dashboard Vocal T World</h1>

          {lastInfo && (
            <div className={`last-badge ${lastInfo.isFresh ? "fresh" : "stale"}`}>
              <span className="last-badge-icon">⏰</span>
              <span className="last-badge-text">{lastInfo.label}</span>
              {lastInfo.isFresh ? <span className="last-badge-ok">✅</span> : <span className="last-badge-alert">‼️</span>}
            </div>
          )}
        </div>

        <button type="button" className="admin-logout-btn" onClick={handleLogout}>
          Esci
        </button>
      </div>

      {validation && (
        <section className={`validation-card validation-${validation.level}`}>
          <div className="validation-main">
            <h2 className="validation-title">{validation.title}</h2>
            <p className="validation-subtitle">{validation.subtitle}</p>
          </div>
          <p className="validation-hint">{validation.hint}</p>
        </section>
      )}

      {stats && (
        <div className="admin-stats">
          <div className="admin-stat-card admin-stat-total">
            <span className="admin-stat-label">Partecipanti totali</span>
            <span className="admin-stat-value">{stats.total}</span>
          </div>

          <div className="admin-stat-card admin-stat-yes">
            <span className="admin-stat-label">Interessati</span>
            <span className="admin-stat-value">
              {stats.interested}
              <span className="admin-stat-sub"> ({stats.interestedPercent}%)</span>
            </span>
          </div>

          <div className="admin-stat-card admin-stat-no">
            <span className="admin-stat-label">Non interessati</span>
            <span className="admin-stat-value">
              {stats.notInterested}
              <span className="admin-stat-sub"> ({stats.notInterestedPercent}%)</span>
            </span>
          </div>
        </div>
      )}

      <section className="admin-section">
        <h2 className="admin-subtitle">Elenco partecipanti</h2>

        <div className="admin-table">
          <div className="admin-table-header">
            <div className="admin-th admin-th-email">Email</div>
            <div className="admin-th admin-th-date">Data</div>
            <div className="admin-th admin-th-score">Score</div>
            <div className="admin-th admin-th-int">Interessato?</div>
          </div>

          <div className="admin-table-body">
            {surveys.map((s, index) => {
              const rowId = `admin-row-${index}`;
              const showScore = typeof s.normalizedInterestScore === "number" ? s.normalizedInterestScore : "-";
              const isInterested = !!s.normalizedIsInterested;

              return (
                <button
                  key={rowId}
                  id={rowId}
                  type="button"
                  className="admin-row"
                  onClick={() => handleRowClick(s, rowId)}
                >
                <div className="admin-td admin-td-email" title={s.email}>
  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
    <div>{s.email || "-"}</div>

    <span
      className={
        "admin-badge " +
        (s.isEmailSubscribed ? "admin-badge-subscribed" : "admin-badge-survey")
      }
    >
      {s.isEmailSubscribed ? "Sondaggio + iscrizione" : "Solo sondaggio"}
    </span>
  </div>
</div>

                  <div className="admin-td admin-td-date">
                    {formatDate(s.createdAt || s.surveyCompletedAt || s.date)}
                  </div>

                  <div className="admin-td admin-td-score">{showScore}</div>

                  <div className="admin-td admin-td-int">
                    <span className={"admin-pill " + (isInterested ? "admin-pill-yes" : "admin-pill-no")}>
                      {isInterested ? "SI" : "NO"}
                    </span>
                  </div>
                </button>
              );
            })}

            {surveys.length === 0 && <div className="admin-table-empty">Nessun partecipante registrato.</div>}
          </div>
        </div>
      </section>

      <section className="admin-section" ref={detailRef}>
        {selectedSurvey && (
          <div className="admin-detail">
            <div className="admin-detail-header">
              <h2>Dettaglio risposte</h2>
              <button type="button" className="admin-detail-close" onClick={handleCloseDetails}>
                Chiudi
              </button>
            </div>

            <p className="admin-detail-meta">
              <strong>Email:</strong> {selectedSurvey.email || "-"}
              <br />
              <strong>Data compilazione:</strong> {formatDate(selectedSurvey.createdAt || selectedSurvey.surveyCompletedAt || selectedSurvey.date)}
            </p>

            <div className="admin-detail-grid">
              <div className="admin-detail-card">
                <div className="admin-detail-label">Uso principale</div>
                <div className="admin-detail-value">{selectedSurvey.mainUseCase || answers.mainUseCase || "-"}</div>
              </div>

              <div className="admin-detail-card">
                <div className="admin-detail-label">Quanto spesso ti capita di avere bisogno di tradurre?</div>
                <div className="admin-detail-value">{selectedSurvey.usageFrequency || answers.usageFrequency || "-"}</div>
              </div>

              <div className="admin-detail-card">
                <div className="admin-detail-label">Quanto ti interesserebbe un traduttore vocale offline?</div>
                <div className="admin-detail-value">{selectedSurvey.offlineInterest || answers.offlineInterest || "-"}</div>
              </div>

              <div className="admin-detail-card">
                <div className="admin-detail-label">Fascia di prezzo che consideri ok</div>
                <div className="admin-detail-value">{selectedSurvey.priceRange || answers.priceRange || "-"}</div>
              </div>

              <div className="admin-detail-card">
                <div className="admin-detail-label">Score interesse (algoritmo)</div>
                <div className="admin-detail-value">
                  {typeof selectedSurvey.normalizedInterestScore === "number" ? selectedSurvey.normalizedInterestScore : "-"}
                </div>

                <div className="admin-detail-subnote" style={{ marginTop: 6, opacity: 0.85, fontSize: 12 }}>
                  <div>
                    <strong>Raw score:</strong> {typeof selectedSurvey._rawScore === "number" ? selectedSurvey._rawScore : "-"}
                  </div>
                  <div>
                    <strong>Raw interestScore:</strong>{" "}
                    {typeof selectedSurvey._rawInterestScore === "number" ? selectedSurvey._rawInterestScore : "-"}
                  </div>
                </div>
              </div>

              <div className="admin-detail-card">
                <div className="admin-detail-label">Profilo calcolato</div>
                <div className="admin-detail-value">{selectedSurvey.normalizedIsInterested ? "Interessato" : "Non interessato"}</div>
              </div>

              <div className="admin-detail-card">
                <div className="admin-detail-label">Hai difficoltà a comunicare in lingua straniera?</div>
                <div className="admin-detail-value">{selectedSurvey.communicationDifficulty || answers.communicationDifficulty || "-"}</div>
              </div>

              <div className="admin-detail-card">
                <div className="admin-detail-label">Soluzione che usi oggi per tradurre</div>
                <div className="admin-detail-value">{selectedSurvey.currentSolution || answers.currentSolution || "-"}</div>
              </div>

              <div className="admin-detail-card">
                <div className="admin-detail-label">Interesse immediato per traduttore offline</div>
                <div className="admin-detail-value">{selectedSurvey.instantOfflineInterest || answers.instantOfflineInterest || "-"}</div>
              </div>

              {(selectedSurvey.extraNote || answers.extraNote) && (
                <div className="admin-detail-card admin-detail-card-wide">
                  <div className="admin-detail-label">Note aggiuntive</div>
                  <div className="admin-detail-value">{selectedSurvey.extraNote || answers.extraNote}</div>
                </div>
              )}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}