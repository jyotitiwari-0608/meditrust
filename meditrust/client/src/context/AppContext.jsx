import { createContext, useContext, useState } from "react";

const AppContext = createContext(null);

export function AppProvider({ children }) {
  const [disclaimerSeen, setDisclaimerSeen] = useState(false);
  return (
    <AppContext.Provider value={{ disclaimerSeen, setDisclaimerSeen }}>
      {children}
    </AppContext.Provider>
  );
}

export const useApp = () => {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used within AppProvider");
  return ctx;
};
