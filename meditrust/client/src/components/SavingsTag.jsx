export default function SavingsTag({ price, referencePrice }) {
  if (!referencePrice || referencePrice <= 0) return null;
  const savings = referencePrice - price;
  const pct = ((savings / referencePrice) * 100).toFixed(0);
  return (
    <span className="savings-tag">
      Save ₹{savings.toFixed(2)} ({pct}%)
    </span>
  );
}
