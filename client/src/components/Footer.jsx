import React from "react";

export default function Footer() {
  return (
    <footer className="footer">
      <p>© {new Date().getFullYear()} Vocal T World. All rights reserved.</p>
      <p className="footer-secondary">
        Progetto indipendente in fase di validazione.  
        Grazie per il tuo supporto e per aver partecipato al sondaggio ❤️
      </p>
    </footer>
  );
}