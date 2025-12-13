import React, { useEffect, useState, useRef, useMemo } from "react";

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

/**
 * Normalizza i dati provenienti dal backend in modo coerente.
 * - Risolve il bug tipico: interestScore = 0 ma score = 5 (o >0)
 * - Unifica i campi: isInterested / interested
 * - Unifica email/date e porta su top-level anche answers
 */
function normalizeSurvey(raw) {
  const answers = raw?.answers && typeof raw.answers === "object" ? raw.answers : {};

  const email =
    raw?.email ??
    answers?.email ??
    raw?.properties?.email ??
    raw?.profile?.email ??
    "-";

  const createdAt = raw?.createdAt ?? raw?.surveyCompletedAt ?? raw?.date ?? answers?.createdAt ?? answers?.surveyCompletedAt ?? null;

  // score grezzo da varie sorgenti possibili
  const rawScore =
    (typeof raw?.score === "number" ? raw.score : null) ??
    (typeof answers?.score === "number" ? answers.score : null) ??
    (typeof raw?.interestScore === "number" ? raw.interestScore : null) ??
    (typeof answers?.interestScore === "number" ? answers.interestScore : null);

  const rawInterestScore =
    (typeof raw?.interestScore === "number" ? raw.interestScore : null) ??
    (typeof answers?.interestScore === "number" ? answers.interestScore : null);

  // ✅ Fix mismatch:
  // - se interestScore è null/undefined -> usa score
  // - se interestScore è 0 MA score è >0 -> usa score (caso “bug”)
  let normalizedInterestScore = null;
  if (typeof rawInterestScore === "number") {
    if (rawInterestScore === 0 && typeof raw?.score === "number" && raw.score > 0) {
      normalizedInterestScore = raw.score;
    } else if (rawInterestScore === 0 && typeof answers?.score === "number" && answers.score > 0) {
      normalizedInterestScore = answers.score;
    } else {
      normalizedInterestScore = rawInterestScore;
    }
  } else if (typeof rawScore === "number") {
    normalizedInterestScore = rawScore;
  }

  // isInterested coerente
  const rawIsInterested =
    (typeof raw?.isInterested === "boolean" ? raw.isInterested : null) ??
    (typeof raw?.interested === "boolean" ? raw.interested : null) ??
    (typeof answers?.isInterested === "boolean" ? answers.isInterested : null) ??
    (typeof answers?.interested === "boolean" ? answers.interested : null);

  // Se non arriva dal backend, lo calcoliamo
  const computedIsInterested =
    typeof normalizedInterestScore === "number" ? normalizedInterestScore >= 6 : false;

  const normalizedIsInterested =
    typeof rawIsInterested === "boolean" ? rawIsInterested : computedIsInterested;

  return {
    ...raw,
    answers,
    email,
    createdAt,
    // manteniamo anche i grezzi per debug in UI
    _rawScore: typeof raw?.score === "number" ? raw.score : (typeof answers?.score === "number" ? answers.score : null),
    _rawInterestScore: typeof raw?.interestScore === "number" ? raw.interestScore : (typeof answers?.interestScore === "number" ? answers.interestScore : null),
    normalizedInterestScore,
    normalizedIsInterested,
  };
}

export default function AdminDashboard() {
  const [stats, setStats] = useState(null);
  const [surveys, setSurveys] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedSurvey, setSelectedSurvey] = useState(null);
  const [lastRowId, setLastRowId] = useState(null);

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

  useEffect(() => {
    if (!isAuth) return;

    async function load() {
      try {
        setLoading(true);
        setError("");

        const res = await fetch("/.netlify/functions/admin-dashboard", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-admin-key": adminKey || "",
          },
          body: JSON.stringify({
            secret: adminKey || "",
          }),
        });

        if (res.status === 401) {
          setError("Codice segreto non valido.");
          setIsAuth(false);
          if (typeof window !== "undefined") {
            window.localStorage.removeItem("vt_admin_key");
          }
          setLoading(false);
          return;
        }

        if (!res.ok) {
          throw new Error("Errore nel caricamento dei dati (" + res.status + ")");
        }

        const data = await res.json();

        let nextSurveys = data.surveys || data.responses || [];
        if (!Array.isArray(nextSurveys)) nextSurveys = [];

        // ✅ Normalizzazione robusta (fix mismatch score/interestScore)
        nextSurveys = nextSurveys.map(normalizeSurvey);

        // Ordina per data (più recenti in alto)
        nextSurveys = [...nextSurveys].sort((a, b) => {
          const da = new Date(a.createdAt || a.surveyCompletedAt || a.date || 0).getTime();
          const db = new Date(b.createdAt || b.surveyCompletedAt || b.date || 0).getTime();
          return db - da;
        });

        setSurveys(nextSurveys);

        // Stats: usa quelle backend SOLO se sembrano coerenti,
        // altrimenti calcola qui su dati normalizzati.
        const total = nextSurveys.length;
        const interestedCount = nextSurveys.filter((s) => !!s.normalizedIsInterested).length;
        const notInterestedCount = total - interestedCount;

        const interestedPercent = total ? Math.round((interestedCount / total) * 100) : 0;
        const notInterestedPercent = total ? Math.round((notInterestedCount / total) * 100) : 0;

        if (data.stats && typeof data.stats.total === "number") {
          // Se ti va, puoi commentare questa parte e usare sempre stats calcolate localmente.
          // Io lascio questa regola “safe”: se stats backend non matchano, uso quelle locali.
          const backendTotal = data.stats.total;
          if (backendTotal === total) {
            setStats({
              ...data.stats,
              total,
              interested: typeof data.stats.interested === "number" ? data.stats.interested : interestedCount,
              notInterested: typeof data.stats.notInterested === "number" ? data.stats.notInterested : notInterestedCount,
              interestedPercent: typeof data.stats.interestedPercent === "number" ? data.stats.interestedPercent : interestedPercent,
              notInterestedPercent: typeof data.stats.notInterestedPercent === "number" ? data.stats.notInterestedPercent : notInterestedPercent,
            });
          } else {
            setStats({
              total,
              interested: interestedCount,
              interestedPercent,
              notInterested: notInterestedCount,
              notInterestedPercent,
            });
          }
        } else {
          setStats({
            total,
            interested: interestedCount,
            interestedPercent,
            notInterested: notInterestedCount,
            notInterestedPercent,
          });
        }
      } catch (err) {
        setError(err.message || "Errore inatteso");
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [isAuth, adminKey]);

  const handleRowClick = (survey, rowId) => {
    setSelectedSurvey(survey);
    setLastRowId(rowId);

    setTimeout(() => {
      if (detailRef.current) {
        detailRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }, 80);
  };

  const handleCloseDetails = () => {
    setSelectedSurvey(null);

    setTimeout(() => {
      if (!lastRowId) return;
      const rowEl = document.getElementById(lastRowId);
      if (!rowEl) return;

      rowEl.scrollIntoView({ behavior: "smooth", block: "center" });
      rowEl.classList.add("admin-row-last");
      setTimeout(() => {
        rowEl.classList.remove("admin-row-last");
      }, 1200);
    }, 80);
  };

  const handleLogout = () => {
    if (typeof window !== "undefined") {
      window.localStorage.removeItem("vt_admin_key");
    }

    setAdminKey("");
    setIsAuth(false);
    setStats(null);
    setSurveys([]);
    setSelectedSurvey(null);
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
            if (typeof window !== "undefined") {
              window.localStorage.setItem("vt_admin_key", adminKey);
            }
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
              {lastInfo.isFresh ? (
                <span className="last-badge-ok">✅</span>
              ) : (
                <span className="last-badge-alert">‼️</span>
              )}
            </div>
          )}
        </div>

        <button type="button" className="admin-logout-btn" onClick={handleLogout}>
          Esci
        </button>
      </div>

      <div className="stats-grid">{/* opzionale */}</div>

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
              const showScore =
                typeof s.normalizedInterestScore === "number"
                  ? s.normalizedInterestScore
                  : "-";

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
                    {s.email || "-"}
                  </div>

                  <div className="admin-td admin-td-date">
                    {formatDate(s.createdAt || s.surveyCompletedAt || s.date)}
                  </div>

                  <div className="admin-td admin-td-score">{showScore}</div>

                  <div className="admin-td admin-td-int">
                    <span
                      className={"admin-pill " + (isInterested ? "admin-pill-yes" : "admin-pill-no")}
                    >
                      {isInterested ? "SI" : "NO"}
                    </span>
                  </div>
                </button>
              );
            })}

            {surveys.length === 0 && (
              <div className="admin-table-empty">Nessun partecipante registrato.</div>
            )}
          </div>
        </div>
      </section>

      <section className="admin-section" ref={detailRef}>
        {selectedSurvey && (
          <div className="admin-detail">
            <div className="admin-detail-header">
              <h2>Dettaglio risposte</h2>
              <button
                type="button"
                className="admin-detail-close"
                onClick={handleCloseDetails}
              >
                Chiudi
              </button>
            </div>

            <p className="admin-detail-meta">
              <strong>Email:</strong> {selectedSurvey.email || "-"}
              <br />
              <strong>Data compilazione:</strong>{" "}
              {formatDate(selectedSurvey.createdAt || selectedSurvey.surveyCompletedAt || selectedSurvey.date)}
            </p>

            <div className="admin-detail-grid">
              <div className="admin-detail-card">
                <div className="admin-detail-label">Uso principale</div>
                <div className="admin-detail-value">
                  {selectedSurvey.mainUseCase || answers.mainUseCase || "-"}
                </div>
              </div>

              <div className="admin-detail-card">
                <div className="admin-detail-label">
                  Quanto spesso ti capita di avere bisogno di tradurre?
                </div>
                <div className="admin-detail-value">
                  {selectedSurvey.usageFrequency || answers.usageFrequency || "-"}
                </div>
              </div>

              <div className="admin-detail-card">
                <div className="admin-detail-label">
                  Quanto ti interesserebbe un traduttore vocale offline?
                </div>
                <div className="admin-detail-value">
                  {selectedSurvey.offlineInterest || answers.offlineInterest || "-"}
                </div>
              </div>

              <div className="admin-detail-card">
                <div className="admin-detail-label">Fascia di prezzo che consideri ok</div>
                <div className="admin-detail-value">
                  {selectedSurvey.priceRange || answers.priceRange || "-"}
                </div>
              </div>

              <div className="admin-detail-card">
                <div className="admin-detail-label">Score interesse (algoritmo)</div>
                <div className="admin-detail-value">
                  {typeof selectedSurvey.normalizedInterestScore === "number"
                    ? selectedSurvey.normalizedInterestScore
                    : "-"}
                </div>

                {/* 🔎 Debug mismatch (visibile e chiarissimo) */}
                <div className="admin-detail-subnote" style={{ marginTop: 6, opacity: 0.85, fontSize: 12 }}>
                  <div>
                    <strong>Raw score:</strong>{" "}
                    {typeof selectedSurvey._rawScore === "number" ? selectedSurvey._rawScore : "-"}
                  </div>
                  <div>
                    <strong>Raw interestScore:</strong>{" "}
                    {typeof selectedSurvey._rawInterestScore === "number" ? selectedSurvey._rawInterestScore : "-"}
                  </div>
                </div>
              </div>

              <div className="admin-detail-card">
                <div className="admin-detail-label">Profilo calcolato</div>
                <div className="admin-detail-value">
                  {selectedSurvey.normalizedIsInterested ? "Interessato" : "Non interessato"}
                </div>
              </div>

              <div className="admin-detail-card">
                <div className="admin-detail-label">
                  Hai difficoltà a comunicare in lingua straniera?
                </div>
                <div className="admin-detail-value">
                  {selectedSurvey.communicationDifficulty || answers.communicationDifficulty || "-"}
                </div>
              </div>

              <div className="admin-detail-card">
                <div className="admin-detail-label">Soluzione che usi oggi per tradurre</div>
                <div className="admin-detail-value">
                  {selectedSurvey.currentSolution || answers.currentSolution || "-"}
                </div>
              </div>

              <div className="admin-detail-card">
                <div className="admin-detail-label">
                  Interesse immediato per traduttore offline
                </div>
                <div className="admin-detail-value">
                  {selectedSurvey.instantOfflineInterest || answers.instantOfflineInterest || "-"}
                </div>
              </div>

              {(selectedSurvey.extraNote || answers.extraNote) && (
                <div className="admin-detail-card admin-detail-card-wide">
                  <div className="admin-detail-label">Note aggiuntive</div>
                  <div className="admin-detail-value">
                    {selectedSurvey.extraNote || answers.extraNote}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}