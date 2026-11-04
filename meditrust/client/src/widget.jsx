import React from "react";
import ReactDOM from "react-dom/client";
import DoctorWidget from "./components/DoctorWidget.jsx";

const rootEl = document.getElementById("doctor-widget-root");
if (rootEl) {
  ReactDOM.createRoot(rootEl).render(
    <React.StrictMode>
      <DoctorWidget
        drugId={rootEl.dataset.drugId || ""}
        brandId={rootEl.dataset.brandId || ""}
        onConfirm={(data) => {
          window.dispatchEvent(
            new CustomEvent("doctor-widget-confirm", { detail: data })
          );
        }}
      />
    </React.StrictMode>
  );
}
