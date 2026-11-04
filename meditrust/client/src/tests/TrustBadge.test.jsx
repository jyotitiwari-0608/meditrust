import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import TrustBadge from "../components/TrustBadge.jsx";

describe("TrustBadge", () => {
  const bands = [
    ["High", "badge-high", "High trust"],
    ["Moderate", "badge-mod", "Moderate trust"],
    ["Low", "badge-low", "Low trust"],
    ["LimitedData", "badge-limited", "Limited data"],
  ];

  it.each(bands)("renders %s band with text and class", (band, cls, label) => {
    render(<TrustBadge band={band} />);
    const el = screen.getByText(label);
    expect(el).toBeInTheDocument();
    expect(el).toHaveClass(cls);
    expect(el).toHaveClass("badge");
  });

  it("defaults to LimitedData for unknown band", () => {
    render(<TrustBadge band="Unknown" />);
    expect(screen.getByText("Limited data")).toBeInTheDocument();
  });
});
