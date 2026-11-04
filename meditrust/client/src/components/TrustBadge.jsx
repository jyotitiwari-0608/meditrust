export default function TrustBadge({ band }) {
  const variants = {
    High: "badge-high",
    Moderate: "badge-mod",
    Low: "badge-low",
    LimitedData: "badge-limited",
  };
  const labels = {
    High: "High trust",
    Moderate: "Moderate trust",
    Low: "Low trust",
    LimitedData: "Limited data",
  };
  return (
    <span className={`badge ${variants[band] || "badge-limited"}`} title={labels[band] || "Limited data"}>
      {labels[band] || "Limited data"}
    </span>
  );
}
