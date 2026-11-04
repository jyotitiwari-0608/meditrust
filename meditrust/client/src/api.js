const API_BASE = "/api";

export const api = {
  get: async (path) => {
    const res = await fetch(`${API_BASE}${path}`, {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`API error ${res.status}`);
    return res.json();
  },
  post: async (path, body) => {
    const res = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`API error ${res.status}`);
    return res.json();
  },
};

export const searchDrugs = (q) => api.get(`/search?q=${encodeURIComponent(q)}`);
export const getEquivalents = (id) => api.get(`/drugs/${id}/equivalents`);
export const getEvidence = (id) => api.get(`/products/${id}/evidence`);
export const logAudit = (payload) => api.post("/audit", payload);
export const confirmSubstitution = (payload) => api.post("/substitutions/confirm", payload);
export const getMeta = () => api.get("/meta");
export const getLookup = (code) => api.get(`/lookup?code=${encodeURIComponent(code)}`);
export const getNti = () => api.get("/config/nti");
