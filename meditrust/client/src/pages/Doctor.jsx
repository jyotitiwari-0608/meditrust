import { useState, useEffect } from "react";
import { getEquivalents, confirmSubstitution, getNti, searchDrugs } from "../api.js";

export default function Doctor() {
  const [q, setQ] = useState("");
  const [matches, setMatches] = useState([]);
  const [equivalents, setEquivalents] = useState([]);
  const [reference, setReference] = useState(null);
  const [drugDetails, setDrugDetails] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [modal, setModal] = useState(null);
  const [confirmChecked, setConfirmChecked] = useState(false);
  const [auditing, setAuditing] = useState(false);
  const [auditDone, setAuditDone] = useState(false);
  const [apiStatus, setApiStatus] = useState(null);
  const [nti, setNti] = useState([]);

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

  useEffect(() => {
    getNti()
      .then((data) => setNti(data.nti || []))
      .catch(() => setNti([]));
  }, []);

  const riskFlags = (drugName = drugDetails?.salt) => {
    const lower = (drugName || "").toLowerCase();
    return nti.filter((t) => lower.includes(t.toLowerCase()));
  };

  const handleSearch = async () => {
    const term = q.trim();
    if (term.length < 2) return;
    setError(null);
    setLoading(true);
    setReference(null);
    setDrugDetails(null);
    setEquivalents([]);
    setMatches([]);
    try {
      const searchData = await searchDrugs(term);
      const found = (searchData.results || []).filter((item) => item.kind === "drug" || item.kind === "product");
      setMatches(found);
      if (found.length === 0) setError(`No medicine found for “${term}”.`);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const reviewMedicine = async (match) => {
    const drugId = match.drugId || (match.kind === "drug" ? match.id : null);
    if (!drugId) {
      setError("This search result is missing its medicine ID.");
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const data = await getEquivalents(drugId);
      setDrugDetails(data.drug || {
        salt: match.drug || match.salt || match.name,
        strength: match.strength,
        form: match.form,
      });
      setReference(data.reference || null);
      setEquivalents(data.equivalents || []);
      setMatches([]);
      setQ([match.drug || match.salt || match.name || match.brand, match.strength, match.form].filter(Boolean).join(" "));
    } catch (e) {
      setError(e.message);
      setEquivalents([]);
    } finally {
      setLoading(false);
    }
  };

  const openConfirm = (item) => {
    setModal(item);
    setConfirmChecked(false);
    setAuditDone(false);
  };

  const closeModal = () => {
    setModal(null);
    setConfirmChecked(false);
    setAuditDone(false);
  };

  const handleConfirm = async () => {
    if (!confirmChecked) return;
    setAuditing(true);
    try {
      await confirmSubstitution({
        actor: "doctor",
        action: "propose_substitution",
        fromBrand: reference?.brand || "",
        toBrand: modal.brand,
        drug: drugDetails?.salt || "",
        riskFlags: riskFlags(),
        confirmed: true,
        band: modal.band,
        metadata: { score: modal.score, mrp: modal.mrp },
      });
      setAuditDone(true);
    } catch (e) {
      setError("Audit log failed: " + e.message);
    } finally {
      setAuditing(false);
    }
  };

  const badgeClass = (band) => {
    const map = { High: "badge-high", Moderate: "badge-mod", Low: "badge-low", LimitedData: "badge-limited" };
    return `badge ${map[band] || "badge-limited"}`;
  };

  return (
    <main className="page doctor">
      <div className="container">
        {apiStatus === "offline" && (
          <div className="status-banner status-offline">
            ⚠️ Running in demo mode (backend not reachable).
          </div>
        )}
        <div className="page-header">
          <span className="script-label">Prescribe Smarter</span>
          <h1 className="heading-serif">Clinical medicine review</h1>
          <p>Compare same-ingredient options and review their evidence before considering any change. This tool does not assess patient-specific suitability.</p>
        </div>

        <form
          className="doctor-search"
          onSubmit={(event) => {
            event.preventDefault();
            handleSearch();
          }}
        >
          <input
            type="search"
            placeholder="Search medicine, active ingredient, or brand"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <button type="submit" className="confirm-btn" disabled={loading || q.trim().length < 2}>
            {loading ? "Searching…" : "Search"}
          </button>
        </form>
        {error && <div className="error">{error}</div>}

        {matches.length > 0 && (
          <section className="doctor-matches" aria-label="Medicine search matches">
            <h2>Choose the medicine to review</h2>
            <p>Confirm the ingredient, strength, and dosage form before comparing options.</p>
            <ul>
              {matches.map((match) => (
                <li key={match.id}>
                  <div>
                    <strong>{match.brand || match.name || match.salt || match.drug}</strong>
                    <span>{[match.drug || match.salt, match.strength, match.form, match.mfr].filter(Boolean).join(" · ")}</span>
                  </div>
                  <button className="confirm-btn" type="button" onClick={() => reviewMedicine(match)} disabled={loading}>
                    Review medicine
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {reference && (
          <>
            <section className="clinical-context" aria-label="Selected medicine details">
              <div className="clinical-context-heading">
                <span className="script-label">Selected medicine</span>
                <h2>{drugDetails?.salt || reference.brand}</h2>
              </div>
              <dl>
                <div><dt>Active ingredient</dt><dd>{drugDetails?.salt || "Not available"}</dd></div>
                <div><dt>Strength</dt><dd>{drugDetails?.strength || "Not available"}</dd></div>
                <div><dt>Dosage form</dt><dd>{drugDetails?.form || "Not available"}</dd></div>
                <div><dt>Reference product</dt><dd>{reference.brand} · {reference.mfr} · ₹{reference.mrp?.toFixed(2)}</dd></div>
              </dl>
              <p className="clinical-caution">Verify dose, route, allergies, contraindications, interactions, and patient-specific factors independently. MediTrust does not assess these or recommend a treatment.</p>
            </section>
          </>
        )}

        {equivalents.length > 0 && (
          <table className="doctor-table">
            <thead>
              <tr>
                <th>Equivalent product</th><th>Manufacturer</th><th>Price (₹)</th><th>Trust score</th><th>Data status</th><th>Evidence</th><th>Review</th>
              </tr>
            </thead>
            <tbody>
              {equivalents.map((item) => {
                const flags = riskFlags();
                return (
                  <tr key={item.productId || item.brand}>
                    <td>
                      <strong>{item.brand}</strong>
                      {flags.length > 0 && <span className="risk-tag">NARROW TI: {flags.join(", ")}</span>}
                    </td>
                    <td>{item.mfr}</td>
                    <td>₹{(item.mrp || 0).toFixed(2)}</td>
                    <td>{item.score}</td>
                    <td><span className={badgeClass(item.band)}>{item.limitedData ? "Limited data" : item.band}</span></td>
                    <td><a href={`/api/products/${item.productId}/evidence`} target="_blank" rel="noopener noreferrer">View evidence</a></td>
                    <td>
                      <button
                        className="propose-btn"
                        onClick={() => openConfirm(item)}
                      >
                        Review substitution
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        {modal && (
          <div className="modal-backdrop" role="dialog" aria-modal="true">
            <div className="modal">
              <h2>Confirm substitution</h2>
              <p>
                From <strong>{reference?.brand}</strong> → to <strong>{modal.brand}</strong>{" "}
                ({modal.mfr}) for {drugDetails?.salt || "this medicine"}.
              </p>
              <p>
                New price: ₹{(modal.mrp || 0).toFixed(2)} | Trust score: {modal.score} ({modal.band})
              </p>
              {modal.limitedData && <p className="risk-tag">Note: Limited data for this manufacturer.</p>}
              {riskFlags().length > 0 && (
                <p className="risk-tag">
                  Risk: narrow-therapeutic-index drug — confirm with extra caution.
                </p>
              )}
              <p>
                <label>
                  <input
                    type="checkbox"
                    checked={confirmChecked}
                    onChange={(e) => setConfirmChecked(e.target.checked)}
                  />{" "}
                  I confirm this substitution is appropriate and have reviewed the evidence.
                </label>
              </p>
              <div className="modal-actions">
                <button className="outline-btn" onClick={closeModal}>Cancel</button>
                <button
                  className="confirm-btn"
                  onClick={handleConfirm}
                  disabled={!confirmChecked || auditing || auditDone}
                >
                  {auditDone ? "Logged" : auditing ? "Logging…" : "Confirm substitution"}
                </button>
              </div>
              {auditDone && <p className="ok">Substitution logged to audit trail.</p>}
            </div>
          </div>
        )}

        {!reference && !equivalents.length && !error && !loading && (
          <p className="hint">Search a drug above to see ranked equivalents.</p>
        )}
      </div>
    </main>
  );
}
