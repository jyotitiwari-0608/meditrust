import { useState } from "react";

export function SearchBarInline({ onSearch }) {
  const [q, setQ] = useState("");
  return (
    <div className="inline-search">
      <input
        type="search"
        placeholder="Type medicine name…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <button className="confirm-btn" onClick={() => onSearch(q)} disabled={!q || q.length < 2}>
        Search
      </button>
    </div>
  );
}
