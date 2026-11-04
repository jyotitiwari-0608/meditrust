import TrustBadge from "./TrustBadge.jsx";
import SavingsTag from "./SavingsTag.jsx";

export default function ResultsList({ items, loading, empty, onSelect, referencePrice }) {
  const ref = referencePrice ?? (items && items[0] ? items[0].mrp : null);
  if (loading) return <div className="loading">Loading equivalents…</div>;
  if (empty) return <div className="empty">No data found for this medicine.</div>;
  if (!items || items.length === 0)
    return <div className="empty">No equivalents available.</div>;

  return (
    <section className="results-list" aria-label="Ranked equivalents">
      <h2>Cost-ranked generic equivalents</h2>
      <ul className="results">
        {items.map((item) => (
          <li key={item.productId || item._id || item.id} className="result-card">
            <div className="result-info">
              <strong>{item.brand || item.name}</strong>
              <span className="muted"> — {item.mfr || ""}</span>
            </div>
            <div className="result-meta">
              <span className="price">₹{(item.mrp || item.price || 0).toFixed(2)}</span>
              <SavingsTag price={item.mrp || item.price || 0} referencePrice={ref} />
              <TrustBadge band={item.band} />
            </div>
            <button
              className="select-btn"
              onClick={() => onSelect(item)}
              aria-label={`Select ${item.brand || item.name}`}
            >
              Select
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
