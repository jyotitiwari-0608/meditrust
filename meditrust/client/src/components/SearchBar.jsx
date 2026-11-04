import { useState, useEffect, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { searchDrugs } from "../api.js";

export default function SearchBar({ onSelect }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const timerRef = useRef(null);

  useEffect(() => {
    const initial = searchParams.get("q");
    if (initial) setQuery(initial);
  }, [searchParams]);

  useEffect(() => {
    if (!query || query.length < 2) {
      setResults([]);
      return;
    }
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const data = await searchDrugs(query);
        setResults(data.results || data || []);
      } catch (e) {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => clearTimeout(timerRef.current);
  }, [query]);

  const runSearch = async (q) => {
    if (!q || q.length < 2) return;
    setLoading(true);
    try {
      const data = await searchDrugs(q);
      setResults(data.results || data || []);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  const handleSelect = (drug) => {
    setResults([]);
    setQuery(drug.name || drug.brand || "");
    if (onSelect) onSelect(drug);
    else navigate(`/search?q=${encodeURIComponent(drug.name || drug.brand || "")}`);
  };

  return (
    <div className="searchbar">
      <label htmlFor="search-input" className="sr-only">
        Search medicine
      </label>
      {loading ? (
        <span className="spinner" role="status">loading…</span>
      ) : (
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M21 21l-5.197-5.197a7 7 0 111.395-1.396l5.197 5.197a1 1 0 01-1.414 1.414l-5.197-5.197a7 7 0 01-1.396 1.397 1 1 0 01-1.414-1.414zM11 17a6 6 0 100-12 6 6 0 000 12z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      )}
      <input
        id="search-input"
        type="search"
        placeholder="Search a medicine, e.g. Dolo 650, Augmentin…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        autoComplete="off"
        className="search-input"
      />
      <button
        type="button"
        className="search-btn"
        onClick={() => runSearch(query)}
        disabled={query.length < 2 || loading}
      >
        Search
      </button>
      {results.length > 0 && (
        <div className="results-dropdown" role="listbox">
          {results.map((r, i) => (
            <div
              key={i}
              role="option"
              className="dropdown-item"
              onClick={() => handleSelect(r)}
            >
              <strong>{r.brand || r.name}</strong>{" "}
              <span className="muted">— {r.salt || ""}</span>
              <span className="muted"> ({r.mfr || ""})</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
