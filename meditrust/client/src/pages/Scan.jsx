import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Html5Qrcode } from "html5-qrcode";
import { SearchBarInline } from "../components/SearchBarInline.jsx";
import { searchDrugs } from "../api.js";

export default function Scan() {
  const navigate = useNavigate();
  const [mode, setMode] = useState("qr"); // 'qr' | 'photo'
  const [matches, setMatches] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [cameraError, setCameraError] = useState(null);
  const [cameraRequested, setCameraRequested] = useState(false);
  const [cameraRunning, setCameraRunning] = useState(false);
  const [apiStatus, setApiStatus] = useState(null);
  const qrcodeRef = useRef(null);

  const stopQr = () => {
    if (qrcodeRef.current) {
      qrcodeRef.current
        .stop()
        .then(() => { qrcodeRef.current = null; })
        .catch(() => { qrcodeRef.current = null; })
        .finally(() => setCameraRunning(false));
    } else {
      setCameraRunning(false);
    }
  };

  const clearScanner = () => {
    stopQr();
  };

  useEffect(() => {
    clearScanner();
    return () => clearScanner();
  }, [mode]);

  useEffect(() => {
    if (mode === "qr" && cameraRequested && !cameraError) startQr();
  }, [mode, cameraRequested, cameraError]);

  useEffect(() => {
    let cancelled = false;
    async function checkStatus() {
      setApiStatus("checking");
      try {
        await fetch("/api/health", { signal: AbortSignal.timeout(3000) });
        if (!cancelled) setApiStatus("online");
      } catch (e) {
        if (!cancelled) setApiStatus("offline");
      }
    }
    checkStatus();
    return () => { cancelled = true; };
  }, []);

  const handleSearch = async (q) => {
    setError(null);
    setLoading(true);
    try {
      const data = await searchDrugs(q);
      setMatches((data.results || data || []).slice(0, 10));
    } catch (e) {
      setError(e.message);
      setMatches([]);
    } finally {
      setLoading(false);
    }
  };

  const handleQrDecoded = (decodedText) => {
    setLoading(true);
    searchDrugs(decodedText)
      .then((data) => {
        setMatches((data.results || data || []).slice(0, 10));
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };

  const startQr = () => {
    setCameraError(null);
    if (qrcodeRef.current) return;
    const elemId = "qr-reader";
    const container = document.getElementById(elemId);
    if (!container) return;
    const scanner = new Html5Qrcode(elemId);
    qrcodeRef.current = scanner;
    scanner
      .start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 250, height: 250 } },
        handleQrDecoded,
        (errMessage) => {
          // decoding error, ignore
        }
      )
      .then(() => setCameraRunning(true))
      .catch((err) => {
        qrcodeRef.current = null;
        setCameraRunning(false);
        setCameraRequested(false);
        setCameraError(
          "Camera access denied or unavailable. Use photo upload or manual search."
        );
        console.error(err);
      });
  };

  const handlePhoto = async (file) => {
    setError(null);
    setLoading(true);
    try {
      const { createWorker } = await import("tesseract.js");
      const worker = createWorker("eng");
      await worker.load();
      await worker.loadLanguage("eng");
      await worker.initialize("eng");
      const { data: ocrData } = await worker.recognize(file);
      await worker.terminate();
      const text = ocrData.text || "";
      const tokens = text
        .split(/[\s\n,;]+/)
        .map((t) => t.replace(/[^a-z0-9]/gi, "").toLowerCase())
        .filter((t) => t.length >= 4);
      const query = tokens.slice(0, 5).join(" ");
      const searchData = await searchDrugs(query || text.slice(0, 100));
      setMatches((searchData.results || searchData || []).slice(0, 10));
    } catch (e) {
      setError("OCR failed: " + e.message);
      setMatches([]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="page scan">
      <div className="container">
        {apiStatus === "offline" && (
          <div className="status-banner status-offline">
            ⚠️ Running in demo mode (backend not reachable).
          </div>
        )}
        <div className="page-header">
          <span className="script-label">Scan & Match</span>
          <h1 className="heading-serif">Scan medicine strip / barcode</h1>
          <p>Scan a barcode/QR or upload a photo of the strip. Matches need your confirmation.</p>
        </div>

        <div className="scan-tabs">
          <button
            className={`tab-btn ${mode === "qr" ? "active" : ""}`}
            onClick={() => { setMode("qr"); setCameraRequested(true); }}
            disabled={mode === "qr" && !!cameraError}
          >
            Barcode / QR (camera)
          </button>
          <button
            className={`tab-btn ${mode === "photo" ? "active" : ""}`}
            onClick={() => { setMode("photo"); setCameraRequested(false); stopQr(); }}
          >
            Photo of strip (OCR)
          </button>
        </div>

        {mode === "qr" && (
          <div className="qr-area">
            <div id="qr-reader" style={{ width: "100%", maxWidth: 420 }} />
            {cameraError && <div className="error">{cameraError}</div>}
            <button className="toggle-btn stop" onClick={() => { setCameraRequested(false); stopQr(); }} disabled={!cameraRunning}>
              {cameraRunning ? "Stop camera" : cameraRequested ? "Starting camera…" : "Camera stopped"}
            </button>
            <p className="hint">Camera permission required. If blocked, switch to photo upload.</p>
          </div>
        )}

        {mode === "photo" && (
          <div className="photo-area">
            <label className="photo-upload">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8zM14 2v6h6M14 2v6h-6M14 8h6v-6"/></svg>
              <span>Upload photo of strip</span>
              <input type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handlePhoto(f);
              }} />
            </label>
            <p className="hint">Take a clear photo of the medicine strip and upload it.</p>
          </div>
        )}

        {loading && <div className="loading">Processing…</div>}
        {error && <div className="error">{error}</div>}

        <div className="manual-fallback">
          <h3>Manual search fallback</h3>
          <SearchBarInline onSearch={handleSearch} />
        </div>

        {matches.length > 0 && (
          <section className="matches">
            <h3 className="heading-serif" style={{ fontSize: "18px", marginBottom: "14px" }}>Top matches — confirm one</h3>
            <ul>
              {matches.map((m, i) => (
                <li key={i} className="match-item">
                  <div className="match-info">
                    <strong>{m.brand || m.name || m.salt}</strong>
                    <span className="muted"> — {m.mfr || ""} ({m.salt || ""})</span>
                  </div>
                  <button className="confirm-btn" onClick={() => navigate("/search", { state: { selectedDrug: m } })}>
                    Confirm
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </main>
  );
}
