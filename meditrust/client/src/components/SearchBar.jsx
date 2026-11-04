import { useState, useEffect, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { searchDrugs } from "../api.js";

export default function SearchBar({ onSelect, inputRef }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const timerRef = useRef(null);
  const resultsRef = useRef(null);
  const errorRef = useRef(null);
  const scrollAfterSearchRef = useRef(false);

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

  useEffect(() => {
    if (!scrollAfterSearchRef.current) return;
    scrollAfterSearchRef.current = false;
    const frame = window.requestAnimationFrame(() => {
      (resultsRef.current || errorRef.current)?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [results, error]);

  const runSearch = async (q) => {
    const searchTerm = q.trim();
    if (searchTerm.length < 2) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    setError("");
    setLoading(true);
    try {
      const data = await searchDrugs(searchTerm);
      const matches = data.results || data || [];
      setResults(matches);
      if (matches.length === 1 && onSelect) {
        setResults([]);
        await onSelect(matches[0]);
      } else if (matches.length > 0) {
        scrollAfterSearchRef.current = true;
      } else {
        scrollAfterSearchRef.current = true;
        setError(`No medicines found for “${searchTerm}”.`);
      }
    } catch (e) {
      scrollAfterSearchRef.current = true;
      setResults([]);
      setError(`Search failed: ${e.message}. Check that the server is running.`);
    } finally {
      setLoading(false);
    }
  };

  const handleSelect = (drug) => {
    setResults([]);
    setQuery(drug.name || drug.brand || drug.salt || "");
    if (onSelect) onSelect(drug);
    else navigate(`/search?q=${encodeURIComponent(drug.name || drug.brand || drug.salt || "")}`);
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
      <form
        className="searchbar-form"
        onSubmit={(event) => {
          event.preventDefault();
          runSearch(query);
        }}
      >
      <input
        ref={inputRef}
        id="search-input"
        type="search"
        placeholder="Search a medicine, e.g. Dolo 650, Augmentin…"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setError("");
        }}
        autoComplete="off"
        className="search-input"
      />
      <button
        type="submit"
        className="search-btn"
        disabled={query.length < 2 || loading}
      >
        Search
      </button>
      </form>
      {error && <p ref={errorRef} className="search-error" role="alert">{error}</p>}
      {results.length > 0 && (
        <div ref={resultsRef} className="results-dropdown" role="listbox">
          {results.map((r, i) => (
            <button
              type="button"
              key={i}
              className="dropdown-item"
              onClick={() => handleSelect(r)}
            >
              <strong>{r.brand || r.name || r.salt}</strong>{" "}
              <span className="muted">— {r.salt || ""}</span>
              <span className="muted"> ({r.mfr || ""})</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
