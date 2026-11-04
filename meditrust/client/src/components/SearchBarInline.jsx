import { useState } from "react";

export function SearchBarInline({ onSearch }) {
  const [q, setQ] = useState("");
  return (
    <form
      className="inline-search"
      onSubmit={(event) => {
        event.preventDefault();
        onSearch(q.trim());
      }}
    >
      <input
        type="search"
        placeholder="Type medicine name…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <button type="submit" className="confirm-btn" disabled={q.trim().length < 2}>
        Search
      </button>
    </form>
  );
}
