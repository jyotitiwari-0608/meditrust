export default function SavingsTag({ price, referencePrice }) {
  const p = Number(price);
  const ref = Number(referencePrice);
  if (!ref || ref <= 0 || !p || p <= 0 || p >= ref) return null;
  const savings = ref - p;
  const pct = ((savings / ref) * 100).toFixed(0);
  return (
    <span className="savings-tag">
      Save ₹{savings.toFixed(2)} ({pct}%)
    </span>
  );
}
