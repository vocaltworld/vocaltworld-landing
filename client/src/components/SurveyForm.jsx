import { useState, useEffect, useRef } from "react";

const initialState = {
  usageFrequency: "",
  offlineInterest: "",
  mainUseCase: "",
  priceRange: "",
  extraNote: "",
  email: "",
  communicationDifficulty: "",
  currentSolution: "",
  instantOfflineInterest: "",
};

// Calcola uno score 1–10 in base alle risposte (solo per eventuali usi lato client)
function computeScore(data) {
  let total = 0;

  // Frequenza utilizzo
  switch (data.usageFrequency) {
    case "Spesso":
      total += 4;
      break;
    case "A volte":
      total += 3;
      break;
    case "Raramente":
      total += 2;
      break;
    case "Mai":
      total += 1;
      break;
    default:
      break;
  }

  // Interesse per l'offline
  switch (data.offlineInterest) {
    case "Moltissimo":
      total += 4;
      break;
    case "Abbastanza":
      total += 3;
      break;
    case "Poco":
      total += 2;
      break;
    case "Per niente":
      total += 1;
      break;
    default:
      break;
  }

  // Fascia di prezzo
  switch (data.priceRange) {
    case "> 200 €":
      total += 4;
      break;
    case "100–200 €":
      total += 3;
      break;
    case "50–100 €":
      total += 2;
      break;
    case "< 50 €":
      total += 1;
      break;
    default:
      break;
  }

  // totale massimo = 12 → scala 1–10
  const score = Math.round((total / 12) * 10) || 0;
  return score;
}

// Calcola un semplice "passo" (1–8) in base a quante domande principali sono state completate
function computeStep(data, privacyAccepted, emailConsentAccepted) {
  let step = 1;

  // Step 2: ha risposto alla prima domanda (frequenza)
  if (data.usageFrequency) {
    step = 2;
  }

  // Step 3: ha risposto anche alla seconda domanda (difficoltà)
  if (data.communicationDifficulty) {
    step = 3;
  }

  // Step 4: ha risposto anche alla terza domanda (utilità offline)
  if (data.offlineInterest) {
    step = 4;
  }

  // Step 5: ha risposto anche alla quarta domanda (soluzione attuale)
  if (data.currentSolution) {
    step = 5;
  }

  // Step 6: ha risposto alla quinta domanda (use case principale)
  if (data.mainUseCase) {
    step = 6;
  }

  // Step 7: ha risposto alla sesta domanda (fascia di prezzo)
  if (data.priceRange) {
    step = 7;
  }

  // Step 8: ha risposto alla settima domanda (interesse immediato per il dispositivo)
  if (data.instantOfflineInterest) {
    step = 8;
  }

  return step;
}
// Piccolo helper per attivare il feed aptico (dove supportato, es. mobile)
function triggerHaptic(duration = 20) {
  try {
    if (typeof window !== "undefined" && "vibrate" in navigator) {
      navigator.vibrate(duration);
    }
  } catch (e) {
    // Se il browser non supporta o blocca la vibrazione, ignoriamo l'errore
    console.warn("Vibration non disponibile o bloccata:", e);
  }
}

// Helper: invia eventi a Google Tag Manager (dataLayer) senza rompere il form_submit nativo.
// Usiamo un evento custom così tracciamo SOLO completamenti reali.
function pushDataLayer(eventName, params = {}) {
  try {
    if (typeof window === "undefined") return;
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push({ event: eventName, ...params });
  } catch (e) {
    console.warn("dataLayer push fallito:", e);
  }
}
function StepIndicator({ currentStep }) {
  return (
    <div className="survey-step-wrapper">
      <div className="survey-step-indicator">
        <span className="survey-step-dot" />
        <span className="survey-step-text">Passo {currentStep} di 8</span>
      </div>
    </div>
  );
}
export default function SurveyForm() {
  const formRef = useRef(null);
  const skipStepAutoScrollRef = useRef(false);

  const scrollToFirstInvalid = () => {
    const form = formRef.current;
    if (!form) return;

    // First invalid field according to HTML5 validity
    const firstInvalid = form.querySelector(":invalid");
    if (!firstInvalid) return;

    // ⚠️ Radio/checkbox inputs can be visually small/hidden: scroll to the question block
    const questionBlock = firstInvalid.closest(".form-group") || firstInvalid;

    try {
      questionBlock.scrollIntoView({ behavior: "smooth", block: "center" });
    } catch (e) {
      questionBlock.scrollIntoView();
    }

    // Highlight the question block using the class defined in styles.css
    try {
      questionBlock.classList.add("form-group-missing");
      setTimeout(() => questionBlock.classList.remove("form-group-missing"), 1600);
    } catch (_) {}

    // Focus + light highlight on the actual input as a fallback
    setTimeout(() => {
      try {
        firstInvalid.focus({ preventScroll: true });
      } catch (e) {
        try {
          firstInvalid.focus();
        } catch (_) {}
      }

      try {
        firstInvalid.classList.add("vt-field-error");
        setTimeout(() => firstInvalid.classList.remove("vt-field-error"), 1600);
      } catch (_) {}
    }, 50);
  };
  const [formData, setFormData] = useState(initialState);
  const [status, setStatus] = useState("idle"); // idle | submitting | success | error
  const [errorMsg, setErrorMsg] = useState("");
  const [submittedEmail, setSubmittedEmail] = useState("");

  const EMAIL_ERROR_TEXT = "Per favore inserisci un indirizzo email valido.";

  const [isShowingEmailError, setIsShowingEmailError] = useState(false);
  const [typedErrorText, setTypedErrorText] = useState("");
  const [emailErrorText, setEmailErrorText] = useState(EMAIL_ERROR_TEXT);
  const [isAlreadyRegistered, setIsAlreadyRegistered] = useState(false);
  const [alreadySubmitted, setAlreadySubmitted] = useState(false);
  const [privacyAccepted, setPrivacyAccepted] = useState(false);
  const [privacyError, setPrivacyError] = useState(false);

  // Se il sondaggio risulta già completato in questo browser,
  // mostra direttamente la schermata "Hai già compilato il sondaggio" dopo un refresh.
  useEffect(() => {
    try {
      const completed = localStorage.getItem("vt_survey_completed");
      if (completed === "true") {
        setAlreadySubmitted(true);
      }
    } catch (e) {
      // in ambienti senza localStorage (es. SSR) ignoriamo l'errore
      console.warn("localStorage non disponibile per vt_survey_completed", e);
    }
  }, []);

  useEffect(() => {
    if (!alreadySubmitted) return;
    try {
      const el = document.getElementById("survey-section");
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    } catch (e) {
      console.warn("Impossibile effettuare lo scroll verso survey-section", e);
    }
  }, [alreadySubmitted]);

  const [emailConsentAccepted, setEmailConsentAccepted] = useState(false);
  // 🔐 SISTEMA DI SICUREZZA — 3 tentativi email per dispositivo
  const MAX_EMAIL_ATTEMPTS = 3;

  const [emailAttempts, setEmailAttempts] = useState(() => {
    const saved = Number(localStorage.getItem("vt_email_attempts"));
    return isNaN(saved) ? 0 : saved;
  });

  const [isBlocked, setIsBlocked] = useState(() => {
    return localStorage.getItem("vt_email_blocked") === "true";
  });
  const [emailConsentError, setEmailConsentError] = useState(false);

  const [showDetails, setShowDetails] = useState(false);
  const currentStep = computeStep(formData, privacyAccepted, emailConsentAccepted);
  useEffect(() => {// Se abbiamo appena gestito una validazione fallita, non sovrascrivere lo scroll
if (skipStepAutoScrollRef.current) {
  skipStepAutoScrollRef.current = false;
  return;
}
    // Scroll automatico alla sezione corrente,
    // solo quando siamo nel form (non nelle schermate di successo/errore)
    if (status !== "idle" && status !== "submitting") return;

    // Non fare scroll all'apertura della pagina: partiamo dallo step 2 in poi
    if (currentStep <= 1) return;

    const target = document.getElementById(`step-${currentStep}`);
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [currentStep, status]);
  useEffect(() => {
    if (!isShowingEmailError) return;

    // reset testo dell'errore ed email reale
    setTypedErrorText("");
    setFormData((prev) => ({ ...prev, email: "" }));

    let i = 0;
    const interval = setInterval(() => {
      i++;
      setTypedErrorText(emailErrorText.slice(0, i));
      if (i >= emailErrorText.length) {
        clearInterval(interval);
      }
    }, 25); // velocità: 25ms per lettera

    return () => clearInterval(interval);
  }, [isShowingEmailError, emailErrorText]);

  const handleChange = (e) => {
    const { name, value } = e.target;

    // Gestione speciale per il campo email in caso di errore Kickbox
    if (name === "email") {
      // ogni volta che cambia l'email, resettiamo lo stato "già registrato"
      setIsAlreadyRegistered(false);

      if (isShowingEmailError) {
        // Appena l'utente digita, usciamo dalla modalità errore,
        // puliamo il testo animato e iniziamo a memorizzare la nuova email.
        setIsShowingEmailError(false);
        setTypedErrorText("");
        setFormData((prev) => ({ ...prev, email: value }));
      } else {
        setFormData((prev) => ({ ...prev, email: value }));
      }
      return;
    }

    // Altri campi rimangono invariati
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErrorMsg("");

    // ✅ Se manca una risposta obbligatoria, scrolla automaticamente al primo campo incompleto
    // (non rompe la logica esistente di privacy/email consent che è gestita sotto)
    const form = formRef.current;
    if (form && !form.checkValidity()) {
      // mostra il messaggio nativo del browser (dove supportato)
      skipStepAutoScrollRef.current = true;
      if (typeof form.reportValidity === "function") {
        form.reportValidity();
      }
      scrollToFirstInvalid();
      return;
    }
    // 🔒 BLOCCO IMMEDIATO SE L’UTENTE HA FINITO I TENTATIVI
if (isBlocked) {
  setStatus("error");
  setErrorMsg(
    "Hai superato i tentativi consentiti. Questo dispositivo è stato bloccato per motivi di sicurezza."
  );
  return;
}

    setIsShowingEmailError(false);
    setTypedErrorText("");

    // 🔒 Controllo privacy obbligatoria
    if (!privacyAccepted) {
      setStatus("error");
      setPrivacyError(true);
      setErrorMsg(
        "Devi accettare l'informativa privacy per inviare il sondaggio."
      );

      const el = document.getElementById("privacy-block");
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.classList.add("flash-error");
        setTimeout(() => el.classList.remove("flash-error"), 1200);
      }
      return;
    }

    // 🔒 Controllo consenso email obbligatorio
    if (!emailConsentAccepted) {
      setStatus("error");
      setEmailConsentError(true);
      setErrorMsg(
        "Per ricevere aggiornamenti via email devi dare il tuo consenso."
      );

      const el = document.getElementById("email-consent-block");
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.classList.add("flash-error");
        setTimeout(() => el.classList.remove("flash-error"), 1200);
      }
      return;
    }

    // ⏳ Stato: invio in corso
    setStatus("submitting");
    setPrivacyError(false);
    setEmailConsentError(false);

    // Calcolo lo score (facoltativo lato client)
    const score = computeScore(formData);

    // Payload da mandare a Netlify
    const payload = {
      ...formData,
      consent: emailConsentAccepted, // ⬅️ questo finisce in submit-survey.js
      // score, // se vuoi puoi mandare anche lo score lato client
    };

    try {
      const res = await fetch("/.netlify/functions/submit-survey", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const body = await res.json().catch(() => ({}));
      console.log("Risposta Netlify/Klaviyo:", body);

      if (!res.ok) {
        const errorCode = body.error;
        // usciamo SEMPRE da \"submitting\" in caso di errore
  setStatus("idle");


        // 🔐 Email NON valida (formato o Kickbox)
        if (
          errorCode === "invalid_email" ||
          errorCode === "invalid_email_format"
        ) {
          const newAttempts = emailAttempts + 1;
          setEmailAttempts(newAttempts);
          localStorage.setItem("vt_email_attempts", String(newAttempts));

          if (newAttempts >= MAX_EMAIL_ATTEMPTS) {
            setIsBlocked(true);
            localStorage.setItem("vt_email_blocked", "true");
            setIsShowingEmailError(true);
            setEmailErrorText(
              "Hai superato i tentativi consentiti. Questo dispositivo è stato bloccato per motivi di sicurezza."
            );
            return;
          }

          setIsShowingEmailError(true);
          setEmailErrorText("Per favore inserisci un indirizzo email valido.");
          return;
        }

// 👤 Utente già registrato
if (errorCode === "already_submitted") {
  setIsAlreadyRegistered(true);            // bordo verde (se vuoi mantenerlo)
  setIsShowingEmailError(true);            // mantiene animazione nella casella
  setEmailErrorText("La tua email è già stata registrata, grazie!");
  setAlreadySubmitted(true);               // 💥 attiva schermata dedicata

  // memorizziamo che questo browser ha già completato il sondaggio,
  // così anche dopo un refresh mostriamo di nuovo la schermata "già compilato"
  try {
    localStorage.setItem("vt_survey_completed", "true");
  } catch (e) {
    console.warn("localStorage non disponibile per vt_survey_completed", e);
  }

  return;
}

        // Da qui in giù consideriamo errori globali → messaggio sotto al bottone
        setStatus("error");

        if (errorCode === "too_many_requests") {
          setErrorMsg(
            "Stai inviando troppe richieste in poco tempo. Riprova tra qualche istante."
          );
          return;
        }

        if (errorCode === "kickbox_error") {
          setErrorMsg(
            "C'è stato un problema temporaneo con la verifica dell'email. Riprova tra qualche minuto."
          );
          return;
        }

        if (errorCode === "Klaviyo API error (profile)") {
          setErrorMsg(
            "Si è verificato un problema con il salvataggio del profilo. Riprova tra qualche minuto."
          );
          return;
        }

        setErrorMsg(
          body.message ||
            body.error ||
            "Errore durante l'invio del sondaggio. Riprova più tardi."
        );
        return;
      }

      // ✅ Successo
      // ✅ Tracciamento: evento custom SOLO quando l'invio è davvero andato a buon fine
      // (evita falsi positivi quando l'utente non ha completato i consensi o l'email è invalida)
      pushDataLayer("survey_completed", {
        page_path: typeof window !== "undefined" ? window.location.pathname : undefined,
        score,
        step: 8,
      });
      setSubmittedEmail(formData.email || "");
      setStatus("success");
      setFormData(initialState);
      setPrivacyAccepted(false);
      setEmailConsentAccepted(false);
      setShowDetails(false);
      setErrorMsg("");
      setIsShowingEmailError(false);
      setTypedErrorText("");

      // memorizziamo che questo browser ha completato il sondaggio
      try {
        localStorage.removeItem("vt_email_attempts");
        localStorage.setItem("vt_survey_completed", "true");
        localStorage.setItem("vt_survey_completed_ts", String(Date.now()));
      } catch (e) {
        console.warn("localStorage non disponibile per vt_survey_completed", e);
      }
    } catch (err) {
      console.error("Errore durante l'invio del sondaggio:", err);
      setStatus("error");
      setErrorMsg(
        err.message ||
          "Qualcosa è andato storto durante l'invio. Riprova più tardi."
      );
    }
  };
  // Schermata finale di conferma
  useEffect(() => {
    if (status === "success") {
      const t = setTimeout(() => {
        setShowDetails(true);
      }, 1300); // dopo 1,3 secondi compaiono i testi

      return () => clearTimeout(t);
    }
  }, [status]);

  // Schermata per utente che ha già compilato il sondaggio
  if (alreadySubmitted) {
    return (
      <section id="survey-section" className="survey success-fullscreen">
        <div className="success-screen">
          <h2>Hai già compilato il sondaggio 💙</h2>
          <p>
            Grazie per il tuo supporto a Vocal T World.
          </p>
          <p className="success-note">
            I tuoi dati sono già stati registrati e verranno utilizzati solo per
            validare il progetto e, se hai dato il consenso, per aggiornarti sul
            lancio del dispositivo.
          </p>
          <p className="success-note">
            Se pensi di aver usato l&apos;email sbagliata, puoi contattarmi
            rispondendo direttamente alle email che riceverai oppure scrivermi
            in privato.
          </p>
        </div>
      </section>
    );
  }

  // Schermata finale di conferma
  if (status === "success") {
    return (
      <section id="survey-section" className="survey success-fullscreen">
        <div className="success-screen">
          <div className="checkmark-wrapper">
            <div className="checkmark-circle">
              <div className="checkmark" />
            </div>
          </div>

          {showDetails && (
            <>
              <h2>Sondaggio inviato con successo</h2>

              <p>
                Grazie per aver dedicato il tuo tempo a Vocal T World. La tua
                risposta è stata registrata correttamente.
              </p>

              {submittedEmail && (
                <p className="success-email">
                  Ti abbiamo appena inviato un&apos;email a{" "}
                  <strong>{submittedEmail}</strong>. Controlla la tua casella e
                  conferma l&apos;iscrizione per ricevere tutti gli aggiornamenti
                  sul prodotto.
                </p>
              )}

              <p className="success-note">
                I tuoi dati verranno utilizzati solo per la validazione del
                prodotto e per aggiornarti, in futuro, sull&apos;eventuale
                lancio di Vocal T World. Rimarranno sempre privati e non
                verranno condivisi con terzi.
              </p>
            </>
          )}
        </div>
      </section>
    );
  }

  return (
  <section id="survey-section" className="survey">
    <div className="survey-header">
      <h2>Dicci cosa ne pensi</h2>
      <p className="survey-subtitle">
        Il sondaggio richiede circa <strong>60 secondi</strong>. Le risposte
        sono anonime, l&apos;email serve solo per aggiornarti sul progetto.
      </p>
    </div>

      <form ref={formRef} className="survey-form" onSubmit={handleSubmit}>
      {/* 1. Frequenza utilizzo traduttori */}
<div
  className={
    "form-group" + (currentStep === 1 ? " form-group-active" : "")
  }
  id="step-1"
>
  {currentStep === 1 && <StepIndicator currentStep={currentStep} />}
  <label>
            Ti capita spesso di comunicare con persone che non parlano la tua
            lingua?
          </label>
          <div className="options-row">
            {["Spesso", "A volte", "Raramente", "Mai"].map((opt) => (
              <label
                key={opt}
                className="option-pill"
                onClick={() => triggerHaptic()}
              >
                <input
                  type="radio"
                  name="usageFrequency"
                  value={opt}
                  checked={formData.usageFrequency === opt}
                  onChange={handleChange}
                  required
                />
                <span>{opt}</span>
              </label>
            ))}
          </div>
        </div>

       {/* 1b. Difficoltà reali di comunicazione */}
<div
  className={
    "form-group" + (currentStep === 2 ? " form-group-active" : "")
  }
  id="step-2"
>
  {currentStep === 2 && <StepIndicator currentStep={currentStep} />}
          <label>
            Ti è mai capitato di trovarti in difficoltà a comunicare in
            un&apos;altra lingua in un momento importante?
          </label>
          <div className="options-row">
            {["Sì, spesso", "Sì, alcune volte", "Raramente", "Mai"].map(
              (opt) => (
                <label
                  key={opt}
                  className="option-pill"
                  onClick={() => triggerHaptic()}
                >
                  <input
                    type="radio"
                    name="communicationDifficulty"
                    value={opt}
                    checked={formData.communicationDifficulty === opt}
                    onChange={handleChange}
                    required
                  />
                  <span>{opt}</span>
                </label>
              )
            )}
          </div>
        </div>
{/* 2. Utilità dispositivo offline */}
<div
  className={
    "form-group" + (currentStep === 3 ? " form-group-active" : "")
  }
  id="step-3"
>
  {currentStep === 3 && <StepIndicator currentStep={currentStep} />}
          <label>
            Se esistesse un traduttore portatile completamente offline, quanto
            ti sarebbe utile?
          </label>
          <div className="options-row">
            {["Moltissimo", "Abbastanza", "Poco", "Per niente"].map((opt) => (
              <label
                key={opt}
                className="option-pill"
                onClick={() => triggerHaptic()}
              >
                <input
                  type="radio"
                  name="offlineInterest"
                  value={opt}
                  checked={formData.offlineInterest === opt}
                  onChange={handleChange}
                  required
                />
                <span>{opt}</span>
              </label>
            ))}
          </div>
        </div>
{/* 2b. Cosa utilizzi oggi per tradurre */}
<div
  className={
    "form-group" + (currentStep === 4 ? " form-group-active" : "")
  }
  id="step-4"
>
  {currentStep === 4 && <StepIndicator currentStep={currentStep} />}
          <label>
            Quando devi tradurre qualcosa oggi, cosa utilizzi di solito?
          </label>
          <div className="options-row">
            {[
              "Google Translate",
              "App di traduzione del telefono",
              "Nessun’app: mi arrangio",
              "Un dispositivo fisico",
              "Altro",
            ].map((opt) => (
              <label
                key={opt}
                className="option-pill"
                onClick={() => triggerHaptic()}
              >
                <input
                  type="radio"
                  name="currentSolution"
                  value={opt}
                  checked={formData.currentSolution === opt}
                  onChange={handleChange}
                  required
                />
                <span>{opt}</span>
              </label>
            ))}
          </div>
        </div>
{/* 3. Use case principale */}
<div
  className={
    "form-group" + (currentStep === 5 ? " form-group-active" : "")
  }
  id="step-5"
>
  {currentStep === 5 && <StepIndicator currentStep={currentStep} />}
          <label>In quali situazioni lo useresti di più?</label>
          <select
            name="mainUseCase"
            value={formData.mainUseCase}
            onChange={handleChange}
            required
          >
            <option value="">Seleziona un&apos;opzione</option>
            <option value="Viaggi all'estero">Viaggi all&apos;estero</option>
            <option value="Lavoro o studio">Lavoro o studio</option>
            <option value="Relazioni o incontri">Relazioni o incontri</option>
            <option value="Altro">Altro</option>
          </select>
        </div>

        {/* 4. Fascia di prezzo */}
        <div
          className={
            "form-group" + (currentStep === 6 ? " form-group-active" : "")
          }
          id="step-6"
        >
          {currentStep === 6 && <StepIndicator currentStep={currentStep} />}
          <label>
            Quale fascia di prezzo ti sembra più adatta per questo tipo di
            dispositivo?
          </label>
          <div className="options-row">
            {["< 50 €", "50–100 €", "100–200 €", "> 200 €"].map((opt) => (
              <label
                key={opt}
                className="option-pill"
                onClick={() => triggerHaptic()}
              >
                <input
                  type="radio"
                  name="priceRange"
                  value={opt}
                  checked={formData.priceRange === opt}
                  onChange={handleChange}
                  required
                />
                <span>{opt}</span>
              </label>
            ))}
          </div>
        </div>

        {/* 4b. Interesse verso un dispositivo offline istantaneo */}
        <div
          className={
            "form-group" + (currentStep === 7 ? " form-group-active" : "")
          }
          id="step-7"
        >
          {currentStep === 7 && <StepIndicator currentStep={currentStep} />}
          <label>
            Saresti interessato a un dispositivo che traduce in modo
            istantaneo e funziona completamente senza Internet?
          </label>
          <div className="options-row">
            {[
              "Sì, mi interessa molto",
              "Potrebbe interessarmi",
              "Non lo so",
              "Poco interessato",
              "Non mi interessa",
            ].map((opt) => (
              <label
                key={opt}
                className="option-pill"
                onClick={() => triggerHaptic()}
              >
                <input
                  type="radio"
                  name="instantOfflineInterest"
                  value={opt}
                  checked={formData.instantOfflineInterest === opt}
                  onChange={handleChange}
                  required
                />
                <span>{opt}</span>
              </label>
            ))}
          </div>
        </div>

        {/* 5. Nota libera */}
        <div
          className={
            "form-group" + (currentStep === 8 ? " form-group-active" : "")
          }
          id="step-8"
        >
          {currentStep === 8 && <StepIndicator currentStep={currentStep} />}
          <label>
            C&apos;è qualcosa che per te sarebbe fondamentale in un traduttore
            come Vocal T World?
          </label>
          <textarea
            name="extraNote"
            value={formData.extraNote}
            onChange={handleChange}
            rows={3}
            placeholder="Es. durata batteria, dimensioni, qualità voce, privacy..."
          />
        </div>

        {/* Email */}
        <div className="form-group">
          <label>
            Email (per ricevere aggiornamenti sul progetto e sull&apos;eventuale
            lancio)
          </label>
          <input
            type="email"
            name="email"
            required
            value={isShowingEmailError ? typedErrorText : formData.email}
            onChange={handleChange}
            onFocus={() => {
              if (isShowingEmailError) {
                // Clic sul campo: puliamo il messaggio di errore e l'email
                setIsShowingEmailError(false);
                setTypedErrorText("");
                setFormData((prev) => ({ ...prev, email: "" }));
              }
            }}
            placeholder="nome@email.com"
            className={
              "survey-email-input" +
              (isAlreadyRegistered
                ? " survey-email-input-success"
                : isShowingEmailError
                ? " survey-email-input-error"
                : "")
            }
          />
          <small className="privacy-note">
            Useremo la tua email solo per comunicazioni relative a Vocal T
            World. Nessuno spam, nessuna condivisione con terzi.
          </small>
        </div>

        {/* Privacy */}
        <div className="form-group" id="privacy-block">
          <label
            className={
              "privacy-checkbox" +
              (privacyError ? " privacy-checkbox-error" : "")
            }
          >
            <input
              type="checkbox"
              checked={privacyAccepted}
              onChange={(e) => {
                setPrivacyAccepted(e.target.checked);
                if (e.target.checked) setPrivacyError(false);
              }}
            />
            <span>
              Dichiaro di aver letto e accettato l&apos;informativa privacy. I
              miei dati verranno utilizzati solo per la validazione del prodotto
              e per aggiornarmi sul progetto Vocal T World.
            </span>
          </label>
        </div>

        {/* Consenso email marketing */}
        <div className="form-group" id="email-consent-block">
          <label
            className={
              "privacy-checkbox" +
              (emailConsentError ? " privacy-checkbox-error" : "")
            }
          >
            <input
              type="checkbox"
              checked={emailConsentAccepted}
              onChange={(e) => {
                setEmailConsentAccepted(e.target.checked);
                if (e.target.checked) setEmailConsentError(false);
              }}
            />
            <span>
              Accetto di ricevere email relative a Vocal T World (aggiornamenti
              sul progetto, lancio del prodotto e contenuti personalizzati).
              Potrò disiscrivermi in qualsiasi momento.
            </span>
          </label>
        </div>

        {status === "error" && errorMsg && (
          <p className="status error">{errorMsg}</p>
        )}
{/* Messaggi di sicurezza sui tentativi */}
{!isBlocked && emailAttempts > 0 && emailAttempts < MAX_EMAIL_ATTEMPTS && (
  <p className="attempt-warning">
    Tentativo {emailAttempts} di {MAX_EMAIL_ATTEMPTS}.  
    Assicurati di inserire un'email valida per non essere bloccato.
  </p>
)}

{isBlocked && (
  <p className="attempt-error">
    ❌ Hai superato i tentativi consentiti.  
    Questo dispositivo non può più inviare il sondaggio.
  </p>
)}
  <button
  className="submit-button"
  type="submit"
  disabled={status === "submitting" || isBlocked}
  onClick={() => triggerHaptic(30)}
>
          {status === "submitting" ? "Invio in corso..." : "Invia il sondaggio"}
        </button>
      </form>
    </section>
  );
}