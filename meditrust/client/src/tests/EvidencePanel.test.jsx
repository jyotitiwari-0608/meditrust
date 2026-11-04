import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import EvidencePanel from "../components/EvidencePanel.jsx";

describe("EvidencePanel", () => {
  it("renders factor breakdown and sources when open", () => {
    const factors = [
      { name: "regulatory_approval", value: 100, weight: 0.2, contribution: 20, evidence: [] },
      { name: "recent_nsq_count", value: 80, weight: 0.25, contribution: 20, evidence: [] },
    ];
    const links = [
      { name: "CDSCO", url: "https://cdsco.gov.in", date: "2024" },
    ];
    render(
      <EvidencePanel factors={factors} evidenceLinks={links} open={true} />
    );
    expect(screen.getByText("Trust score breakdown")).toBeInTheDocument();
    expect(screen.getByText("regulatory_approval")).toBeInTheDocument();
    const contribs = screen.getAllByText("20");
    expect(contribs.length).toBe(2);
    expect(screen.getByText("CDSCO")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "CDSCO" });
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("renders nothing when not open", () => {
    render(<EvidencePanel factors={[]} evidenceLinks={[]} open={false} />);
    expect(screen.queryByText("Trust score breakdown")).not.toBeInTheDocument();
  });
});
