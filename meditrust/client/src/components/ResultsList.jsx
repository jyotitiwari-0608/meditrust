import { useState } from "react";
import TrustBadge from "./TrustBadge.jsx";
import SavingsTag from "./SavingsTag.jsx";

export default function ResultsList({ items, loading, empty, onSelect, referencePrice, defaultSortBy = "trust" }) {
  const [sortBy, setSortBy] = useState(defaultSortBy);
  const sorted = [...(items || [])].sort((a, b) => {
    if (sortBy === "price") {
      const pa = Number(a.mrp || a.price || 0);
      const pb = Number(b.mrp || b.price || 0);
      return pa - pb;
    }
    const sa = Number(a.score || 0);
    const sb = Number(b.score || 0);
    return sb - sa || (Number(a.mrp || a.price || 0) - Number(b.mrp || b.price || 0));
  });

  const ref = referencePrice ?? (sorted[0] ? Number(sorted[0].mrp || sorted[0].price || 0) : null);

  if (loading) return <div className="loading">Loading equivalents…</div>;
  if (empty) return <div className="empty">No data found for this medicine.</div>;
  if (!sorted || sorted.length === 0)
    return <div className="empty">No equivalents available.</div>;

  return (
    <section className="results-list" aria-label="Ranked equivalents">
      <div className="results-toolbar">
        <h2>Cost-ranked generic equivalents</h2>
        <div className="sort-toggle">
          <label>Sort: </label>
          <button
            className={sortBy === "trust" ? "active" : ""}
            onClick={() => setSortBy("trust")}
            role="button"
            aria-pressed={sortBy === "trust"}
          >
            Trust
          </button>
          <button
            className={sortBy === "price" ? "active" : ""}
            onClick={() => setSortBy("price")}
            role="button"
            aria-pressed={sortBy === "price"}
          >
            Price
          </button>
        </div>
      </div>
      <ul className="results">
        {sorted.map((item) => (
          <li key={item.productId || item._id || item.id} className="result-card">
            <div className="result-info">
              <strong>{item.brand || item.name}</strong>
              <span className="muted"> — {item.mfr || ""}</span>
              {item.isJanAushadhi && <span className="jan-tag">Jan Aushadhi</span>}
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
