import { useState, useEffect } from "react";
import SearchBar from "../components/SearchBar.jsx";
import ResultsList from "../components/ResultsList.jsx";
import EvidencePanel from "../components/EvidencePanel.jsx";
import DisclaimerFooter from "../components/DisclaimerFooter.jsx";
import { getEquivalents, getEvidence } from "../api.js";

export default function Home() {
  const [query, setQuery] = useState("");
  const [equivalents, setEquivalents] = useState([]);
  const [referencePrice, setReferencePrice] = useState(null);
  const [evidence, setEvidence] = useState(null);
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [apiStatus, setApiStatus] = useState(null);

  useEffect(() => {
    let cancelled = false;
    async function checkStatus() {
      setApiStatus("checking");
      try {
        await fetch("/api/health", { signal: AbortSignal.timeout(3000) });
        if (!cancelled) setApiStatus("online");
      } catch (e) {
        if (!cancelled) setApiStatus("offline");
      }
    }
    checkStatus();
    return () => { cancelled = true; };
  }, []);

  const handleSelect = async (drug) => {
    setError(null);
    setLoading(true);
    try {
      const data = await getEquivalents(drug.id || drug._id || drug.productId);
      const items = data.equivalents || data.items || data || [];
      const reference = data.reference || data;
      setEquivalents(items);
      setReferencePrice(reference.mrp || null);
      setQuery(reference.brand || reference.name || drug.brand || drug.name || "");
      const ev = await getEvidence(drug.id || drug._id || drug.productId);
      setEvidence(ev);
    } catch (e) {
      setError(e.message);
      setEquivalents([]);
    } finally {
      setLoading(false);
    }
  };


  return (
    <main className="page home">
      <div className="container">
        {apiStatus === "offline" && (
          <div className="status-banner status-offline">
            ⚠️ Running in demo mode (backend not reachable). Start the backend server for live data.
          </div>
        )}
        {apiStatus === "online" && (
          <div className="status-banner status-online">
            ✅ Backend connected — live data mode.
          </div>
        )}

        {/* HERO */}
        <section className="hero">
          <div className="hero-glow" />
          <div className="container">
            <div className="hero-text">
              <span className="hero-script">Safe. Smart. Affordable.</span>
              <h1>
                Find Medicine <br />
                Equivalents Like <br />
                <span className="caramel">Never Before</span>
              </h1>
              <p className="hero-sub">
                Compare brand and generic medicines with the same active ingredient, strength and
                form, and save on every prescription.
              </p>
              <div className="hero-search">
                <SearchBar onSelect={handleSelect} />
              </div>
              <div className="hero-actions">
                <button className="btn-primary">Search Medicines</button>
                <button className="btn-secondary">How It Works <span aria-hidden="true">▶</span></button>
              </div>
              <div className="hero-trust">
                <div className="trust-item">
                  <div className="icon-badge" aria-label="Verified">✓</div>
                  <div>
                    <strong>Verified</strong>
                    <span>Composition data</span>
                  </div>
                </div>
                <div className="trust-item">
                  <div className="icon-badge" aria-label="Generic &amp; Brand">↔</div>
                  <div>
                    <strong>Generic &amp; Brand</strong>
                    <span>Options</span>
                  </div>
                </div>
                <div className="trust-item">
                  <div className="icon-badge" aria-label="Updated">↻</div>
                  <div>
                    <strong>Updated</strong>
                    <span>Prices</span>
                  </div>
                </div>
              </div>
            </div>
            <div className="hero-visual">
              <div className="placeholder-block" />
            </div>
          </div>
        </section>

        {/* ABOUT / WHY US */}
        <section className="about section-alt">
          <div className="container">
            <div className="about-visual">
              <div className="placeholder-block" />
            </div>
            <div className="about-text">
              <span className="script-label">Why MediTrust</span>
              <h2 className="heading-serif">
                More Than Just a <br />
                <span className="caramel">Search</span>
              </h2>
              <p>
                At MediTrust, we believe finding the right medicine should be simple, transparent
                and safe. Every result is built on verified composition data, matched by ingredient,
                strength and form.
              </p>
              <div className="about-checklist">
                <div className="check-item">
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" d="M20 6 9 17l-5-5"/></svg>
                  <span>Same Active Ingredient Matching</span>
                </div>
                <div className="check-item">
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" d="M20 6 9 17l-5-5"/></svg>
                  <span>Strength &amp; Dosage Form Verified</span>
                </div>
                <div className="check-item">
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" d="M20 6 9 17l-5-5"/></svg>
                  <span>Brand vs Generic Price Comparison</span>
                </div>
                <div className="check-item">
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" d="M20 6 9 17l-5-5"/></svg>
                  <span>Pharmacist-Reviewed Data</span>
                </div>
              </div>
              <button className="btn-primary">Learn More <span aria-hidden="true">→</span></button>
            </div>
          </div>
        </section>

        {/* FEATURE STRIP */}
        <section className="feature-strip" aria-label="Key benefits">
          <div className="feature-item">
            <div className="icon-badge" aria-label="Verified data">✓</div>
            <div className="feature-text">
              <div>Verified Data</div>
              <div>Sourced from official drug databases</div>
            </div>
          </div>
          <div className="feature-item">
            <div className="icon-badge" aria-label="Instant results">⚡</div>
            <div className="feature-text">
              <div>Instant Results</div>
              <div>Alternatives in seconds</div>
            </div>
          </div>
          <div className="feature-item">
            <div className="icon-badge" aria-label="Save money">₹</div>
            <div className="feature-text">
              <div>Save Money</div>
              <div>Up to 80% on generics</div>
            </div>
          </div>
          <div className="feature-item">
            <div className="icon-badge" aria-label="Privacy">🔒</div>
            <div className="feature-text">
              <div>Privacy First</div>
              <div>Your searches stay private</div>
            </div>
          </div>
        </section>

        {/* RESULTS / EVIDENCE (shown after a selection) */}
        {query && (
          <>
            {error && <div className="error">{error}</div>}
            <ResultsList
              items={equivalents}
              loading={loading}
              empty={!loading && equivalents.length === 0 && query}
              onSelect={handleSelect}
              referencePrice={referencePrice}
            />
            <EvidencePanel
              score={evidence ? evidence.score : null}
              band={evidence ? evidence.band : null}
              factors={(evidence && evidence.factors) || []}
              justification={evidence ? evidence.justification : null}
              evidenceLinks={(evidence && evidence.provenance) || []}
              open={evidenceOpen}
              computedAt={evidence ? evidence.computedAt : null}
            />
            {evidence && (
              <button
                className="toggle-btn"
                onClick={() => setEvidenceOpen(!evidenceOpen)}
                aria-expanded={evidenceOpen}
              >
                {evidenceOpen ? "Hide evidence" : "Show evidence"}
              </button>
            )}
          </>
        )}
        <DisclaimerFooter />
      </div>
    </main>
  );
}
