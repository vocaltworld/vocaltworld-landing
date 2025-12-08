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

  // Trova il sondaggio più recente usando createdAt o, in fallback, surveyCompletedAt
  const latest = surveys.reduce((acc, s) => {
    if (!acc) return s;
    const d1 = new Date(s.createdAt || s.surveyCompletedAt);
    const d2 = new Date(acc.createdAt || acc.surveyCompletedAt);
    return d1 > d2 ? s : acc;
  }, null);

  const lastIso = latest?.createdAt || latest?.surveyCompletedAt;
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
    // Più di un giorno fa → data precisa
    const formatted = lastDate.toLocaleString("it-IT", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
    label = `Ultimo sondaggio: ${formatted}`;
  } else if (diffHours >= 1) {
    // Ore fa
    label = `Nuovo sondaggio ${diffHours}h fa`;
    isFresh = true;
  } else if (diffMin >= 1) {
    // Minuti fa
    label = `Nuovo sondaggio ${diffMin} minuti fa`;
    isFresh = true;
  } else {
    // Meno di un minuto
    label = "Nuovo sondaggio adesso";
    isFresh = true;
  }

  return { label, isFresh };
}

export default function AdminDashboard() {
  const [stats, setStats] = useState(null);
  const [surveys, setSurveys] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedSurvey, setSelectedSurvey] = useState(null);
  const [lastRowId, setLastRowId] = useState(null);

  // 🔐 Stato per la chiave admin (salvata in localStorage)
  const [adminKey, setAdminKey] = useState(() => {
    if (typeof window === "undefined") return "";
    return window.localStorage.getItem("vt_admin_key") || "";
  });

  const [isAuth, setIsAuth] = useState(() => {
    if (typeof window === "undefined") return false;
    return !!window.localStorage.getItem("vt_admin_key");
  });

  const lastInfo = getLastResponseInfo(surveys);

  // 🧠 Logica di validazione prodotto in base alle statistiche
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
    if (!isAuth) return; // se non sono autenticato, non carico i dati

    async function load() {
      try {
        setLoading(true);
        setError("");

        // Chiamiamo la Netlify Function che espone i dati della dashboard
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
          // chiave non valida: torno alla schermata di login
          setError("Codice segreto non valido.");
          setIsAuth(false);
          if (typeof window !== "undefined") {
            window.localStorage.removeItem("vt_admin_key");
          }
          setLoading(false);
          return;
        }

        if (!res.ok) {
          throw new Error(
            "Errore nel caricamento dei dati (" + res.status + ")"
          );
        }

        const data = await res.json();

        // data.stats e data.surveys sono i formati attesi;
        // in fallback gestiamo anche data.responses se la function li chiama così.
        let nextSurveys = data.surveys || data.responses || [];
        if (!Array.isArray(nextSurveys)) {
          nextSurveys = [];
        }

        // Ultimi in alto
        setSurveys(nextSurveys);

        // Se la function fornisce già le statistiche le usiamo direttamente,
        // altrimenti proviamo a calcolarle in modo compatibile con la UI esistente.
        if (data.stats) {
          setStats(data.stats);
        } else {
          const total = nextSurveys.length;

          const interestedCount = nextSurveys.filter(
            (s) => s.isInterested ?? s.interested
          ).length;
          const notInterestedCount = total - interestedCount;

          const interestedPercent = total
            ? Math.round((interestedCount / total) * 100)
            : 0;
          const notInterestedPercent = total
            ? Math.round((notInterestedCount / total) * 100)
            : 0;

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

    // scroll verso il pannello dettagli
    setTimeout(() => {
      if (detailRef.current) {
        detailRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }, 80);
  };

  const handleCloseDetails = () => {
    setSelectedSurvey(null);

    // ritorna alla riga che abbiamo appena visto e falla lampeggiare
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

  // 🔐 Se non sono autenticato, mostro la schermata di login
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
            <div
              className={`last-badge ${lastInfo.isFresh ? "fresh" : "stale"}`}
            >
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

        <button
          type="button"
          className="admin-logout-btn"
          onClick={handleLogout}
        >
          Esci
        </button>
      </div>

      <div className="stats-grid">
        {/* box partecipanti, interessati, non interessati (vuoto, lo lasciamo) */}
      </div>

      {/* 🔍 Box di validazione prodotto */}
      {validation && (
        <section className={`validation-card validation-${validation.level}`}>
          <div className="validation-main">
            <h2 className="validation-title">{validation.title}</h2>
            <p className="validation-subtitle">{validation.subtitle}</p>
          </div>
          <p className="validation-hint">{validation.hint}</p>
        </section>
      )}

      {/* BOX RIASSUNTO IN ALTO */}
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
              <span className="admin-stat-sub">
                {" "}
                ({stats.interestedPercent}%)
              </span>
            </span>
          </div>

          <div className="admin-stat-card admin-stat-no">
            <span className="admin-stat-label">Non interessati</span>
            <span className="admin-stat-value">
              {stats.notInterested}
              <span className="admin-stat-sub">
                {" "}
                ({stats.notInterestedPercent}%)
              </span>
            </span>
          </div>
        </div>
      )}

      {/* TABELLA PRINCIPALE */}
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
                  <div className="admin-td admin-td-score">
                    {s.interestScore ?? s.score ?? "-"}
                  </div>
                  <div className="admin-td admin-td-int">
                    <span
                      className={
                        "admin-pill " +
                        ((s.isInterested ?? s.interested)
                          ? "admin-pill-yes"
                          : "admin-pill-no")
                      }
                    >
                      {(s.isInterested ?? s.interested) ? "SI" : "NO"}
                    </span>
                  </div>
                </button>
              );
            })}

            {surveys.length === 0 && (
              <div className="admin-table-empty">
                Nessun partecipante registrato.
              </div>
            )}
          </div>
        </div>
      </section>

      {/* DETTAGLIO RISPOSTE SINGOLO UTENTE */}
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
              {formatDate(
                selectedSurvey.createdAt ||
                  selectedSurvey.surveyCompletedAt ||
                  selectedSurvey.date
              )}
            </p>

            <div className="admin-detail-grid">
              <div className="admin-detail-card">
                <div className="admin-detail-label">Uso principale</div>
                <div className="admin-detail-value">
                  {selectedSurvey.mainUseCase || "-"}
                </div>
              </div>

              <div className="admin-detail-card">
                <div className="admin-detail-label">
                  Quanto spesso ti capita di avere bisogno di tradurre?
                </div>
                <div className="admin-detail-value">
                  {selectedSurvey.usageFrequency || "-"}
                </div>
              </div>

              <div className="admin-detail-card">
                <div className="admin-detail-label">
                  Quanto ti interesserebbe un traduttore vocale offline?
                </div>
                <div className="admin-detail-value">
                  {selectedSurvey.offlineInterest || "-"}
                </div>
              </div>

              <div className="admin-detail-card">
                <div className="admin-detail-label">
                  Fascia di prezzo che consideri ok
                </div>
                <div className="admin-detail-value">
                  {selectedSurvey.priceRange || "-"}
                </div>
              </div>

              <div className="admin-detail-card">
                <div className="admin-detail-label">
                  Score interesse (algoritmo)
                </div>
                <div className="admin-detail-value">
                  {selectedSurvey.interestScore ?? selectedSurvey.score ?? "-"}
                </div>
              </div>

              <div className="admin-detail-card">
                <div className="admin-detail-label">Profilo calcolato</div>
                <div className="admin-detail-value">
                  {selectedSurvey.isInterested ?? selectedSurvey.interested
                    ? "Interessato"
                    : "Non interessato"}
                </div>
              </div>

              <div className="admin-detail-card">
                <div className="admin-detail-label">
                  Hai difficoltà a comunicare in lingua straniera?
                </div>
                <div className="admin-detail-value">
                  {selectedSurvey.communicationDifficulty || "-"}
                </div>
              </div>

              <div className="admin-detail-card">
                <div className="admin-detail-label">
                  Soluzione che usi oggi per tradurre
                </div>
                <div className="admin-detail-value">
                  {selectedSurvey.currentSolution || "-"}
                </div>
              </div>

              <div className="admin-detail-card">
                <div className="admin-detail-label">
                  Interesse immediato per traduttore offline
                </div>
                <div className="admin-detail-value">
                  {selectedSurvey.instantOfflineInterest || "-"}
                </div>
              </div>

              {selectedSurvey.extraNote && (
                <div className="admin-detail-card admin-detail-card-wide">
                  <div className="admin-detail-label">Note aggiuntive</div>
                  <div className="admin-detail-value">
                    {selectedSurvey.extraNote}
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