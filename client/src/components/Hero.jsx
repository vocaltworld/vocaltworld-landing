import React from "react";

export default function Hero() {
  const onScrollToSurvey = () => {
    const el = document.getElementById("survey-section");
    if (el) el.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <section className="hero">
      <div className="hero-content">
        <h1 className="hero-title">Vocal T World</h1>
        <p className="hero-subtitle">
          Il traduttore vocale portatile che abbatte le barriere linguistiche.
          <br />
          <span className="accent-text">
            100% offline. 100% sotto il tuo controllo.
          </span>
        </p>
        <button
          className="cta-button"
          onClick={() => {
            try {
              if ("vibrate" in navigator) navigator.vibrate(20);
            } catch (e) {
              console.warn("Vibration non supportata:", e);
            }
            onScrollToSurvey();
          }}
        >
          Partecipa al sondaggio (60 secondi)
        </button>
      </div>
    </section>
  );
}