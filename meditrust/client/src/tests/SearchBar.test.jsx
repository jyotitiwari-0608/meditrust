import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("../api.js", () => ({
  searchDrugs: vi.fn(() => Promise.resolve({ results: [] })),
}));

import { searchDrugs } from "../api.js";
import SearchBar from "../components/SearchBar.jsx";

function renderWithRouter(ui) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

describe("SearchBar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls search on button click", async () => {
    searchDrugs.mockResolvedValue({ results: [{ brand: "Test", salt: "X", mfr: "Y" }] });
    renderWithRouter(<SearchBar onSelect={vi.fn()} />);
    const input = screen.getByPlaceholderText(/search a medicine/i);
    fireEvent.change(input, { target: { value: "test" } });
    fireEvent.click(screen.getByRole("button", { name: /search/i }));
    await vi.waitFor(() => {
      expect(searchDrugs).toHaveBeenCalledWith("test");
    });
  });

  it("shows loading state", async () => {
    let resolve;
    searchDrugs.mockImplementation(() => new Promise((r) => (resolve = r)));
    renderWithRouter(<SearchBar onSelect={vi.fn()} />);
    const input = screen.getByPlaceholderText(/search a medicine/i);
    fireEvent.change(input, { target: { value: "test" } });
    fireEvent.click(screen.getByRole("button", { name: /search/i }));
    expect(screen.getByRole("status")).toBeInTheDocument();
    resolve({ results: [] });
    await vi.waitFor(() => {
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
    });
  });

  it("does not search when query is too short", async () => {
    renderWithRouter(<SearchBar onSelect={vi.fn()} />);
    const input = screen.getByPlaceholderText(/search a medicine/i);
    fireEvent.change(input, { target: { value: "a" } });
    fireEvent.click(screen.getByRole("button", { name: /search/i }));
    expect(searchDrugs).not.toHaveBeenCalled();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });
});
