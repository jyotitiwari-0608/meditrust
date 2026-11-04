export default function EvidencePanel({ factors, evidenceLinks = [], open }) {
  if (!open) return null;
  return (
    <section className="evidence-panel" aria-label="Evidence and factor breakdown">
      <h3>Trust score breakdown</h3>
      <ul className="factor-list">
        {(factors || []).map((f, i) => (
          <li key={i} className="factor-item">
            <span className="factor-name">{f.name}</span>
            <span className="factor-contrib">{f.contribution}</span>
          </li>
        ))}
      </ul>
      {evidenceLinks.length > 0 && (
        <div className="evidence-links">
          <h4>Sources</h4>
          <ul>
            {evidenceLinks.map((l, i) => (
              <li key={i}>
                <a href={l.url} target="_blank" rel="noopener noreferrer">
                  {l.name}
                </a>
                <span className="muted"> ({l.date})</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
