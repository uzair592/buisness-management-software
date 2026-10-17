import { Routes, Route, Navigate } from "react-router-dom";
import { Shell } from "./components/Shell";
import { HomePage } from "./pages/HomePage";
import { SalesPage } from "./pages/SalesPage";
import { NewSalePage } from "./pages/NewSalePage";
import { PlannedPage } from "./pages/PlannedPage";
import { PreviewProvider } from "./preview/PreviewProvider";
import { RecordsPage } from "./pages/RecordsPage";
import { DirectoryPage } from "./pages/DirectoryPage";
import { SettingsPage } from "./pages/SettingsPage";
import { AccountSetupPage } from "./pages/AccountSetupPage";
import { AuthProvider } from "./context/AuthContext";

const planned = [
  ["expenses", "Expenses", "Categories and cash expenses"],
  ["reports", "Reports", "Business reports with explicit data coverage"],
  ["sync", "Sync & Backup", "Offline transactions, device sync and recovery"],
];

export default function App() {
  return (
    <AuthProvider>
      <PreviewProvider>
        <Shell>
          <Routes>
            <Route path="/" element={<Navigate to="/home" replace />} />
            <Route path="/home" element={<HomePage />} />
            <Route path="/sales" element={<SalesPage />} />
            <Route path="/sales/new" element={<NewSalePage />} />
            <Route
              path="/purchases"
              element={<RecordsPage title="Purchases" kind="Purchase" />}
            />
            <Route
              path="/parties"
              element={<DirectoryPage key="parties" type="parties" />}
            />
            <Route
              path="/items"
              element={<DirectoryPage key="items" type="items" />}
            />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/cash-bank" element={<AccountSetupPage />} />
            {planned.map(([path, title, description]) => (
              <Route
                key={path}
                path={"/" + path}
                element={<PlannedPage title={title} description={description} />}
              />
            ))}
            <Route
              path="*"
              element={
                <PlannedPage
                  title="Page not found"
                  description="Choose a workspace from navigation."
                />
              }
            />
          </Routes>
        </Shell>
      </PreviewProvider>
    </AuthProvider>
  );
}
