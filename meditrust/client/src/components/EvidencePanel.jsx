export default function EvidencePanel({ score, band, factors, justification, evidenceLinks = [], open, computedAt }) {
  if (!open) return null;

  const badgeClass = (b) => {
    const map = { High: "badge-high", Moderate: "badge-mod", Low: "badge-low", LimitedData: "badge-limited" };
    return `badge ${map[b] || "badge-limited"}`;
  };

  return (
    <section className="evidence-panel" aria-label="Evidence and factor breakdown">
      <div className="evidence-header">
        <h3>Trust score breakdown</h3>
        <div className="score-badge">
          <span className={`score-value ${badgeClass(band)}`}>{score}</span>
          <span className={`score-band ${badgeClass(band)}`}>{band}</span>
        </div>
      </div>
      {computedAt && <p className="computed-at">Computed {new Date(computedAt).toLocaleString()}</p>}
      <ul className="factor-list">
        {(factors || []).map((f, i) => (
          <li key={i} className="factor-item">
            <div className="factor-row">
              <span className="factor-name">{f.name}</span>
              <span className="factor-contrib">
                {Number(f.contribution || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}
              </span>
            </div>
            <p className="factor-explanation">{f.explanation || ""}</p>
            {f.evidence && f.evidence.length > 0 && (
              <ul className="evidence-signal-list">
                {f.evidence.map((sigId, j) => (
                  <li key={j} className="evidence-signal">Signal {sigId}</li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
      {justification && (
        <div className="justification-box">
          <h4>Why this score?</h4>
          <p>{justification.text}</p>
          <span className="justification-source">Source: {justification.source || "template"}</span>
        </div>
      )}
      {evidenceLinks.length > 0 && (
        <div className="evidence-links">
          <h4>Sources</h4>
          <ul>
            {evidenceLinks.map((l, i) => (
              <li key={i} className="evidence-item">
                <a href={l.sourceUrl || l.url} target="_blank" rel="noopener noreferrer">
                  {l.sourceName || l.name}
                </a>
                <span className="muted"> ({l.date})</span>
                {l.severity && <span className="severity-tag">{l.severity}</span>}
                {l.reason && <span className="reason-tag">{l.reason}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
