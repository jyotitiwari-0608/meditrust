import { useState, useEffect } from "react";
import { BrowserRouter as Router, Routes, Route, Link, useLocation } from "react-router-dom";
import Home from "./pages/Home.jsx";
import Scan from "./pages/Scan.jsx";
import Doctor from "./pages/Doctor.jsx";
import { AppProvider } from "./context/AppContext.jsx";
import DisclaimerFooter from "./components/DisclaimerFooter.jsx";

const NAV_LINKS = [
  { to: "/", label: "Home" },
  { to: "/search", label: "Search" },
  { to: "/scan", label: "Scan" },
  { to: "/doctor", label: "Doctor" },
  { to: "/#about", label: "About" },
  { to: "/#contact", label: "Contact" },
];

function Navbar() {
  const location = useLocation();
  return (
    <nav className="navbar">
      <div className="container">
        <div className="navbar-inner">
          <Link to="/" className="logo">
            <span className="logo-icon">💊</span>
            <span className="logo-text">MediTrust</span>
          </Link>

          <div className="nav-links">
            {NAV_LINKS.map((link) => (
              <Link
                key={link.label}
                to={link.to}
                className={`nav-link ${location.pathname === link.to ? "active" : ""}`}
              >
                {link.label}
              </Link>
            ))}
          </div>

          <div className="nav-actions">
            <Link to="/" className="nav-link ghost">
              Sign in
            </Link>
            <Link to="/" className="btn-primary">
              Find Equivalent
            </Link>
          </div>
        </div>
      </div>
    </nav>
  );
}

export default function App() {
  const [demo, setDemo] = useState(null);

  useEffect(() => {
    fetch("/api/meta")
      .then((res) => res.json())
      .then((data) => setDemo(!!data.demo))
      .catch(() => setDemo(false));
  }, []);

  return (
    <AppProvider>
      <Router>
        <div className="app">
          <Navbar />
          {demo && (
            <div className="status-banner status-offline" role="banner">
              ⚠️ DEMO DATA — Synthetic seed data for demonstration. Not real patient or regulatory data.
            </div>
          )}
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/search" element={<Home />} />
            <Route path="/scan" element={<Scan />} />
            <Route path="/doctor" element={<Doctor />} />
          </Routes>
          <DisclaimerFooter />
        </div>
      </Router>
    </AppProvider>
  );
}
