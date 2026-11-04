import { useState, useEffect, useRef } from "react";
import SearchBar from "../components/SearchBar.jsx";
import ResultsList from "../components/ResultsList.jsx";
import TrustBadge from "../components/TrustBadge.jsx";
import EvidencePanel from "../components/EvidencePanel.jsx";
import DisclaimerFooter from "../components/DisclaimerFooter.jsx";
import HowItWorksModal from "../components/HowItWorksModal.jsx";
import { getEquivalents, getEvidence } from "../api.js";
import { useLocation, useNavigate } from "react-router-dom";

const FAVORITES_STORAGE_KEY = "meditrust:favorites";

function loadFavorites() {
  try {
    const saved = JSON.parse(window.localStorage.getItem(FAVORITES_STORAGE_KEY) || "[]");
    return Array.isArray(saved) ? saved : [];
  } catch {
    return [];
  }
}

export default function Home() {
  const [query, setQuery] = useState("");
  const [selectedDrugId, setSelectedDrugId] = useState(null);
  const [selectedProductId, setSelectedProductId] = useState(null);
  const [favorites, setFavorites] = useState(loadFavorites);
  const [evidenceLoadingId, setEvidenceLoadingId] = useState(null);
  const [equivalents, setEquivalents] = useState([]);
  const [referencePrice, setReferencePrice] = useState(null);
  const [evidence, setEvidence] = useState(null);
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [apiStatus, setApiStatus] = useState(null);
  const [howItWorksOpen, setHowItWorksOpen] = useState(false);
  const searchInputRef = useRef(null);
  const evidencePanelRef = useRef(null);
  const medicineResultsRef = useRef(null);
  const handledLocationKey = useRef(null);
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    try {
      window.localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(favorites));
    } catch {
      // Keep the current session usable when browser storage is unavailable.
    }
  }, [favorites]);

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
    const isEquivalentSelection = !drug.drugId && drug.kind !== "drug" && selectedDrugId && drug.productId;
    setError(null);
    setLoading(true);
    if (isEquivalentSelection) {
      try {
        setSelectedProductId(drug.productId);
        setQuery(drug.brand || drug.name || query);
        setEvidence(await getEvidence(drug.productId));
        setEvidenceOpen(true);
      } catch (e) {
        setEvidence(null);
        setError(`Could not load product evidence: ${e.message}`);
      } finally {
        setLoading(false);
      }
      return;
    }
    const drugId = drug.drugId || (drug.kind === "drug" ? drug.id || drug._id : selectedDrugId);
    const productId = drug.kind === "product" ? drug.id || drug._id || drug.productId : drug.productId;
    try {
      if (!drugId) throw new Error("Could not identify the medicine for equivalents lookup.");
      const data = await getEquivalents(drugId);
      const items = data.equivalents || data.items || data || [];
      const reference = data.reference || data;
      setSelectedDrugId(drugId);
      setSelectedProductId(productId || items[0]?.productId || null);
      setEquivalents(items);
      setReferencePrice(reference.mrp || null);
      setQuery(reference.brand || reference.name || drug.brand || drug.name || drug.salt || query);
      window.requestAnimationFrame(() => {
        medicineResultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      });

      const evidenceProductId = productId || items[0]?.productId;
      if (evidenceProductId) {
        try {
          setEvidence(await getEvidence(evidenceProductId));
        } catch (e) {
          setEvidence(null);
          setError(`Equivalents loaded, but evidence is unavailable: ${e.message}`);
        }
      } else {
        setEvidence(null);
      }
    } catch (e) {
      setError(e.message);
      setEquivalents([]);
    } finally {
      setLoading(false);
    }
  };

  const toggleFavorite = (item) => {
    const productId = item.productId || item._id || item.id;
    if (!productId) return;
    const key = String(productId);
    setFavorites((current) => {
      if (current.some((favorite) => String(favorite.productId) === key)) {
        return current.filter((favorite) => String(favorite.productId) !== key);
      }
      const favorite = {
        productId: key,
        brand: item.brand || item.name || "Medicine",
        drug: item.drug || item.salt || "",
        strength: item.strength || "",
        form: item.form || "",
        mfr: item.mfr || "",
        mrp: Number(item.mrp || item.price || 0),
        score: item.score,
        band: item.band,
        limitedData: Boolean(item.limitedData),
        isJanAushadhi: Boolean(item.isJanAushadhi),
      };
      return [...current, favorite];
    });
  };

  const viewEvidence = async (item) => {
    const productId = item.productId || item._id || item.id;
    if (!productId) {
      setError("Evidence is unavailable because this result has no product ID.");
      return;
    }
    setError(null);
    setEvidenceLoadingId(String(productId));
    try {
      const result = await getEvidence(productId);
      setSelectedProductId(String(productId));
      setEvidence(result);
      setEvidenceOpen(true);
      window.requestAnimationFrame(() => {
        evidencePanelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    } catch (e) {
      setError(`Could not load evidence: ${e.message}`);
    } finally {
      setEvidenceLoadingId(null);
    }
  };

  useEffect(() => {
    const selectedDrug = location.state?.selectedDrug;
    if (!selectedDrug || handledLocationKey.current === location.key) return;
    handledLocationKey.current = location.key;
    handleSelect(selectedDrug);
    navigate(location.pathname, { replace: true, state: null });
  }, [location.key]);

  useEffect(() => {
    const sectionId = location.hash.slice(1);
    if (!sectionId) return;
    const frame = window.requestAnimationFrame(() => {
      document.getElementById(sectionId)?.scrollIntoView({ behavior: "smooth" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [location.hash, location.key]);


  return (
    <main className="page home">
      <div className="container">
        {apiStatus === "offline" && (
          <div className="status-banner status-offline">
            ⚠️ Running in demo mode (backend not reachable). Start the backend server for live data.
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
                <SearchBar onSelect={handleSelect} inputRef={searchInputRef} />
              </div>
              <div className="hero-actions">
                <button className="btn-primary" onClick={() => searchInputRef.current?.focus()}>
                  Search Medicines
                </button>
                <button className="btn-secondary" onClick={() => setHowItWorksOpen(true)}>
                  How It Works <span aria-hidden="true">▶</span>
                </button>
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

        {/* ABOUT */}
        <section className="about section-alt" id="about">
          <div className="container">
            <div className="about-intro">
              <span className="script-label">About MediTrust</span>
              <h2 className="heading-serif">A clearer path from <span className="caramel">search to review</span></h2>
              <p>MediTrust organizes medicine matches, price comparisons, and manufacturer evidence so people can review the information behind each result.</p>
            </div>
            <div className="about-steps">
              <article className="about-step">
                <span className="about-step-number">01</span>
                <h3>Find a medicine</h3>
                <p>Search by brand or active ingredient, then check the ingredient, strength, and dosage form shown for the match.</p>
              </article>
              <article className="about-step">
                <span className="about-step-number">02</span>
                <h3>Compare equivalents</h3>
                <p>Review cost-ranked options alongside the manufacturer trust band and any limited-data label.</p>
              </article>
              <article className="about-step">
                <span className="about-step-number">03</span>
                <h3>Inspect the evidence</h3>
                <p>Open the factor breakdown and source links. A clinician must review and explicitly confirm any proposed substitution.</p>
              </article>
            </div>
            <button className="btn-primary about-journey-button" onClick={() => setHowItWorksOpen(true)}>
              View the full user journey <span aria-hidden="true">→</span>
            </button>
          </div>
        </section>

        <section className="contact-section" id="contact" aria-labelledby="contact-title">
          <div className="contact-heading">
            <span className="script-label">Contact</span>
            <h2 id="contact-title" className="heading-serif">Demo contact directory</h2>
            <p>These are fictional sample identities and contact details for the project demo. They are not monitored, and messages will not be delivered.</p>
          </div>
          <div className="contact-cards">
            <article className="contact-card">
              <span className="contact-initials">X45</span>
              <div><h3>xyz45</h3><p>Demo project contact</p></div>
              <span className="contact-detail">xyz45@meditrust.example</span>
              <span className="contact-detail">+91 00000 00000</span>
            </article>
            <article className="contact-card">
              <span className="contact-initials">MS</span>
              <div><h3>Mira Sample</h3><p>Search and product feedback</p></div>
              <span className="contact-detail">mira.sample@meditrust.example</span>
              <span className="contact-detail">+91 00000 00001</span>
            </article>
            <article className="contact-card">
              <span className="contact-initials">DT</span>
              <div><h3>Dev Test</h3><p>Demo workflow support</p></div>
              <span className="contact-detail">dev.test@meditrust.example</span>
              <span className="contact-detail">+91 00000 00002</span>
            </article>
          </div>
        </section>

        {/* FEATURE STRIP */}
        <section className="feature-strip" id="features" aria-label="Key benefits">
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
          <div ref={medicineResultsRef} className="medicine-results">
            {error && <div className="error">{error}</div>}
            <ResultsList
              items={equivalents}
              loading={loading}
              empty={!loading && equivalents.length === 0 && query}
              onSelect={viewEvidence}
              onToggleFavorite={toggleFavorite}
              favoriteIds={favorites.map((item) => String(item.productId))}
              evidenceLoadingId={evidenceLoadingId}
              referencePrice={referencePrice}
              selectedProductId={selectedProductId}
            />
            <div ref={evidencePanelRef}>
              <EvidencePanel
                score={evidence ? evidence.score : null}
                band={evidence ? evidence.band : null}
                factors={(evidence && evidence.factors) || []}
                justification={evidence ? evidence.justification : null}
                evidenceLinks={(evidence && evidence.provenance) || []}
                open={evidenceOpen}
                computedAt={evidence ? evidence.computedAt : null}
              />
            </div>
            {evidence && (
              <button
                className="toggle-btn"
                onClick={() => setEvidenceOpen(!evidenceOpen)}
                aria-expanded={evidenceOpen}
              >
                {evidenceOpen ? "Hide evidence" : "Show evidence"}
              </button>
            )}
          </div>
        )}
        <section className="favorites-section" aria-labelledby="favorites-title">
          <div className="favorites-heading">
            <div>
              <span className="script-label">Saved for later</span>
              <h2 id="favorites-title" className="heading-serif">Favourites</h2>
            </div>
            <span className="favorites-count">{favorites.length} saved</span>
          </div>
          {favorites.length === 0 ? (
            <p className="favorites-empty">Select a medicine from your results to add it here.</p>
          ) : (
            <ul className="favorites-list">
              {favorites.map((favorite) => (
                <li className="favorite-card" key={favorite.productId}>
                  <div className="favorite-info">
                    <strong>{favorite.brand}</strong>
                    <span>{[favorite.drug, favorite.strength, favorite.form, favorite.mfr].filter(Boolean).join(" · ")}</span>
                    {favorite.isJanAushadhi && <span className="jan-tag">Jan Aushadhi</span>}
                  </div>
                  <div className="favorite-meta">
                    <span className="price">₹{favorite.mrp.toFixed(2)}</span>
                    {favorite.score != null && <TrustBadge band={favorite.band} />}
                    {favorite.limitedData && <span className="limited-label">Limited data</span>}
                  </div>
                  <button
                    className="favorite-remove"
                    type="button"
                    onClick={() => toggleFavorite(favorite)}
                    aria-label={`Remove ${favorite.brand} from favourites`}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
        <DisclaimerFooter />
      </div>
      {howItWorksOpen && <HowItWorksModal onClose={() => setHowItWorksOpen(false)} />}
    </main>
  );
}
