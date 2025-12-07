// client/src/survey-form.js

// Aspetta che l'HTML sia pronto
document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("survey-form");
  const emailInput = document.getElementById("email");
  const emailError = document.getElementById("email-error");
  const submitBtn = document.getElementById("submit-btn");

  // Se per qualche motivo non trova il form, esce e non fa danni
  if (!form || !emailInput || !submitBtn || !emailError) return;

  // Regex semplice per controllare se l'email "sembra" valida
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  form.addEventListener("submit", (event) => {
    // Nascondo eventuali errori vecchi
    emailError.style.display = "none";
    emailError.textContent = "";

    const email = emailInput.value.trim();

    // 1) Email vuota
    if (!email) {
      event.preventDefault(); // blocca l'invio del form
      emailError.textContent = "Inserisci la tua email.";
      emailError.style.display = "block";
      return;
    }

    // 2) Email non valida
    if (!emailRegex.test(email)) {
      event.preventDefault();
      emailError.textContent = "Inserisci un indirizzo email valido.";
      emailError.style.display = "block";
      return;
    }

    // 3) Evita doppi click sul bottone
    submitBtn.disabled = true;
    submitBtn.textContent = "Invio in corso...";
    // Da qui in poi il form può essere inviato normalmente
  });
});