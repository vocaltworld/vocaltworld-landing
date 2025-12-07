import React from "react";

export default function ConceptSection() {
  return (
    <section className="concept">
      <h2>Perché stiamo creando Vocal T World?</h2>
      <p className="concept-text">
        Stiamo progettando un dispositivo tascabile che traduce la tua voce in
        tempo reale, senza bisogno di Internet, con privacy totale e supporto
        multi–lingua. Prima di entrare in produzione vogliamo capire se questo
        prodotto può davvero fare la differenza nella vita delle persone.
      </p>

      <div className="concept-grid">
        <div className="concept-card">
          <span className="concept-emoji">🎤</span>
          <h3>Traduzione vocale istantanea</h3>
          <p>
            Parli nella tua lingua e il dispositivo restituisce la frase nella
            lingua di chi hai davanti.
          </p>
        </div>
        <div className="concept-card">
          <span className="concept-emoji">🌍</span>
          <h3>Funziona ovunque</h3>
          <p>
            Totalmente offline: perfetto in viaggio, al lavoro e nei luoghi in
            cui la rete è assente o instabile.
          </p>
        </div>
        <div className="concept-card">
          <span className="concept-emoji">🔒</span>
          <h3>Privacy totale</h3>
          <p>
            La tua voce e le tue  conversazioni restano solo nel dispositivo: niente
            invio a server esterni.
          </p>
        </div>
      </div>

      <p className="concept-invite">
        Il tuo parere ci aiuterà a decidere se investire nella produzione e come
        migliorare il dispositivo prima del lancio.
      </p>
    </section>
  );
}