import { useEffect } from "react";
import { Link } from "react-router-dom";

const journeys = [
  {
    number: "01",
    title: "Search and compare",
    route: "Home / Search",
    steps: [
      "Start on the home page and enter a medicine name. Matching suggestions appear as you type, with fuzzy matching for typos.",
      "Choose a result to load equivalent products and their evidence.",
      "Review the selected medicine, then compare equivalents ranked by trust score and price, with savings, trust bands, and a Jan Aushadhi tag when available.",
      "Choose Show evidence to inspect the trust score’s factor breakdown and source links.",
    ],
  },
  {
    number: "02",
    title: "Scan a medicine",
    route: "Scan",
    steps: [
      "Open Scan and choose Barcode / QR for camera scanning or Photo of strip for OCR.",
      "Camera scans and photo text recognition search for matching medicines.",
      "Review the matches and select Confirm to open the medicine results.",
      "If camera access is unavailable, use the manual search field. The camera stops when you leave the scan screen.",
    ],
    link: "/scan",
  },
  {
    number: "03",
    title: "Doctor review and confirmation",
    route: "Doctor widget",
    steps: [
      "Search for a medicine to review its reference details and ranked equivalents, including manufacturer, price, trust score, band, risk flags, and evidence links.",
      "Select Propose substitution to review the from/to products, price difference, score, limited-data note, and any narrow-therapeutic-index warning.",
      "Check the confirmation box to enable Confirm substitution. Confirmed actions are sent to the audit log and show Logged when complete.",
      "Cancel or leave the page before confirming and no substitution request is sent.",
    ],
    link: "/doctor",
  },
];

export default function HowItWorksModal({ onClose }) {
  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div
      className="journey-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="journey-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="journey-title"
      >
        <header className="journey-header">
          <div>
            <span className="script-label">A clear path from search to review</span>
            <h2 id="journey-title" className="heading-serif">How MediTrust works</h2>
          </div>
          <button className="journey-close" type="button" onClick={onClose} aria-label="Close How It Works">
            ×
          </button>
        </header>

        <div className="journey-sections">
          {journeys.map((journey) => (
            <article className="journey-card" key={journey.number}>
              <div className="journey-card-heading">
                <span className="journey-number">{journey.number}</span>
                <div>
                  <h3>{journey.title}</h3>
                  <span className="journey-route">{journey.route}</span>
                </div>
              </div>
              <ol>
                {journey.steps.map((step) => <li key={step}>{step}</li>)}
              </ol>
              {journey.link && (
                <Link className="journey-link" to={journey.link} onClick={onClose}>
                  Open {journey.route} <span aria-hidden="true">→</span>
                </Link>
              )}
            </article>
          ))}
        </div>

        <p className="journey-disclaimer">
          MediTrust provides decision support, not medical advice. It never prescribes or makes a substitution automatically.
        </p>
      </section>
    </div>
  );
}
