import { useEffect, useState } from 'react';
import Disclaimer from './components/Disclaimer.jsx';
import { fetchHealth } from './lib/api.js';

export default function App() {
  const [health, setHealth] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let active = true;

    fetchHealth()
      .then((data) => {
        if (active) setHealth(data);
      })
      .catch((err) => {
        if (active) setError(err.message);
      });

    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="page">
      <header className="hero">
        <p className="eyebrow">College minor project</p>
        <h1>MediTrust</h1>
        <p className="tagline">
          Cost-ranked generic equivalents with an explainable manufacturer trust
          score.
        </p>
      </header>

      <main className="grid">
        <section className="card">
          <h2>API status</h2>
          {error && <p className="status status-error">Unreachable: {error}</p>}
          {!error && !health && <p className="status">Checking /health...</p>}
          {health && (
            <dl className="facts">
              <div>
                <dt>Status</dt>
                <dd className="ok">{health.status}</dd>
              </div>
              <div>
                <dt>Database</dt>
                <dd>{health.db}</dd>
              </div>
              <div>
                <dt>Uptime</dt>
                <dd>{health.uptime}s</dd>
              </div>
              <div>
                <dt>Checked</dt>
                <dd>{new Date(health.timestamp).toLocaleString()}</dd>
              </div>
            </dl>
          )}
        </section>

        <section className="card">
          <h2>Scaffold</h2>
          <ul className="checklist">
            <li>Express API with helmet, cors and morgan</li>
            <li>Mongoose models: Drug, Brand, Manufacturer, Product</li>
            <li>Models: Signal, Score, Extraction</li>
            <li>Text indexes for drug, brand and manufacturer search</li>
            <li>Provenance embedded on products and score factors</li>
            <li>Seed script with sample catalogue and signals</li>
          </ul>
        </section>

        <section className="card">
          <h2>Next</h2>
          <p>
            Search a medicine, compare cost-ranked generics, and open the
            per-factor trust breakdown with sources. Sparse-data manufacturers
            will show a cold-start baseline labelled "Limited data".
          </p>
        </section>
      </main>

      <Disclaimer />
    </div>
  );
}
