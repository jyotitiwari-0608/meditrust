import { useState, useEffect } from "react";
import { getEquivalents, confirmSubstitution, getNti } from "../api.js";

export default function DoctorWidget({ drugId, brandId, onConfirm }) {
  const [equivalents, setEquivalents] = useState([]);
  const [reference, setReference] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [modal, setModal] = useState(null);
  const [confirmChecked, setConfirmChecked] = useState(false);
  const [auditing, setAuditing] = useState(false);
  const [auditDone, setAuditDone] = useState(false);
  const [nti, setNti] = useState([]);

  useEffect(() => {
    getNti()
      .then((data) => setNti(data.nti || []))
      .catch(() => setNti([]));
  }, []);

  useEffect(() => {
    if (!drugId) return;
    setLoading(true);
    getEquivalents(drugId)
      .then((data) => {
        setReference(data.reference || null);
        setEquivalents(data.equivalents || []);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [drugId]);

  const riskFlags = (drugName) => {
    const lower = (drugName || "").toLowerCase();
    return nti.filter((t) => lower.includes(t.toLowerCase()));
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
        actor: "widget",
        action: "propose_substitution",
        fromBrand: reference?.brand || "",
        toBrand: modal.brand,
        drug: reference?.drug || "",
        riskFlags: riskFlags(modal.brand),
        confirmed: true,
        band: modal.band,
        metadata: { score: modal.score, mrp: modal.mrp, fromWidget: true },
      });
      setAuditDone(true);
      if (onConfirm) onConfirm({ from: reference?.brand, to: modal.brand, band: modal.band });
    } catch (e) {
      setError("Submission failed: " + e.message);
    } finally {
      setAuditing(false);
    }
  };

  const badgeClass = (band) => {
    const map = { High: "badge-high", Moderate: "badge-mod", Low: "badge-low", LimitedData: "badge-limited" };
    return `badge ${map[band] || "badge-limited"}`;
  };

  if (loading) return <div className="loading">Loading equivalents…</div>;
  if (!reference) return <div className="empty">No data available.</div>;

  return (
    <div className="doctor-widget">
      <div className="widget-header">
        <strong>Reference:</strong> {reference.brand} ({reference.mfr}) — ₹{reference.mrp?.toFixed(2)} — score {reference.score} ({reference.band})
      </div>
      {error && <div className="error">{error}</div>}
      <table className="doctor-table">
        <thead>
          <tr>
            <th>Brand</th><th>Manufacturer</th><th>Price (₹)</th><th>Score</th><th>Band</th><th>Action</th>
          </tr>
        </thead>
        <tbody>
          {equivalents.map((item) => {
            const flags = riskFlags(item.brand);
            return (
              <tr key={item.productId || item.brand}>
                <td>
                  <strong>{item.brand}</strong>
                  {flags.length > 0 && <span className="risk-tag">NARROW TI: {flags.join(", ")}</span>}
                </td>
                <td>{item.mfr}</td>
                <td>₹{(item.mrp || 0).toFixed(2)}</td>
                <td>{item.score}</td>
                <td><span className={badgeClass(item.band)}>{item.band}</span></td>
                <td>
                  <button
                    className="propose-btn"
                    onClick={() => openConfirm(item)}
                  >
                    Propose substitution
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {modal && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal">
            <h2>Confirm substitution</h2>
            <p>
              From <strong>{reference?.brand}</strong> → to <strong>{modal.brand}</strong>{" "}
              ({modal.mfr}) for {reference?.drug || "this medicine"}.
            </p>
            <p>
              New price: ₹{(modal.mrp || 0).toFixed(2)} | Trust score: {modal.score} ({modal.band})
            </p>
            {modal.limitedData && <p className="risk-tag">Note: Limited data for this manufacturer.</p>}
            {riskFlags(modal.brand).length > 0 && (
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
    </div>
  );
}
