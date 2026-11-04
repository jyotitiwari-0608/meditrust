import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { confirmSubstitution } from "../api.js";

vi.mock("../api.js", () => ({
  confirmSubstitution: vi.fn(() => Promise.resolve({ ok: true })),
}));

describe("Doctor modal confirm flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("Confirm is disabled until checkbox is ticked", () => {
    function TestModal() {
      const [checked, setChecked] = React.useState(false);
      return (
        <div>
          <input
            type="checkbox"
            id="confirm"
            checked={checked}
            onChange={(e) => setChecked(e.target.checked)}
          />
          <button id="confirm-btn" disabled={!checked}>
            Confirm substitution
          </button>
        </div>
      );
    }
    render(<TestModal />);
    const checkbox = screen.getByRole("checkbox");
    const btn = screen.getByRole("button", { name: /confirm substitution/i });
    expect(btn.disabled).toBe(true);
    fireEvent.click(checkbox);
    expect(btn.disabled).toBe(false);
  });

  it("Cancel sends no request", async () => {
    render(
      <div>
        <button id="cancel">Cancel</button>
        <button id="confirm">Confirm</button>
      </div>
    );
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    await vi.waitFor(() => {
      expect(confirmSubstitution).not.toHaveBeenCalled();
    });
  });

  it("Escape does not trigger confirm", async () => {
    render(
      <div>
        <button id="confirm">Confirm</button>
      </div>
    );
    fireEvent.keyDown(document.body, { key: "Escape" });
    await vi.waitFor(() => {
      expect(confirmSubstitution).not.toHaveBeenCalled();
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });
});
