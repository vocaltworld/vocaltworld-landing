import React from "react";
import Hero from "./components/Hero.jsx";
import ConceptSection from "./components/ConceptSection.jsx";
import SurveyForm from "./components/SurveyForm.jsx";
import Footer from "./components/Footer.jsx";
import AdminDashboard from "./components/AdminDashboard.jsx";
import { BrowserRouter, Routes, Route } from "react-router-dom";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>

        {/* ADMIN DASHBOARD — identical UI as before */}
        <Route
          path="/admin"
          element={<AdminDashboard />}
        />

        {/* LANDING PAGE — exactly the same structure and style */}
        <Route
          path="/"
          element={
            <div className="app-root">
              <header className="hero-logo-container">
                <img
                  src="/logo-vtw.png"
                  alt="Vocal T World"
                  className="hero-logo"
                />
              </header>
              <main className="app-main">
                <Hero />
                <ConceptSection />
                <SurveyForm />
                <Footer />
              </main>
            </div>
          }
        />

      </Routes>
    </BrowserRouter>
  );
}