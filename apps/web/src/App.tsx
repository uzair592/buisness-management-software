import { Routes, Route, Navigate } from "react-router-dom";
import { Shell } from "./components/Shell";
import { HomePage } from "./pages/HomePage";
import { SalesPage } from "./pages/SalesPage";
import { NewSalePage } from "./pages/NewSalePage";
import { PlannedPage } from "./pages/PlannedPage";
const planned = [
  ["purchases", "Purchases", "Supplier bills and purchase orders", "M07"],
  ["parties", "Parties", "Customers, suppliers and their statements", "M04"],
  ["items", "Items & Stock", "Catalogue, units and stock movements", "M04"],
  ["cash-bank", "Cash & Bank", "Account books, receipts and payments", "M07"],
  ["expenses", "Expenses", "Categories and cash expenses", "M07"],
  ["reports", "Reports", "Business reports with explicit data coverage", "M09"],
  [
    "settings",
    "Settings",
    "Business profile, users and approved devices",
    "M02",
  ],
  [
    "sync",
    "Sync & Backup",
    "Offline transactions, device sync and recovery",
    "M06 / M11",
  ],
];
export default function App() {
  return (
    <Shell>
      <Routes>
        <Route path="/" element={<Navigate to="/home" replace />} />
        <Route path="/home" element={<HomePage />} />
        <Route path="/sales" element={<SalesPage />} />
        <Route path="/sales/new" element={<NewSalePage />} />
        {planned.map(([path, title, description, milestone]) => (
          <Route
            key={path}
            path={"/" + path}
            element={
              <PlannedPage
                title={title}
                description={description}
                milestone={milestone}
              />
            }
          />
        ))}
        <Route
          path="*"
          element={
            <PlannedPage
              title="Page not found"
              description="Choose a workspace from navigation."
              milestone="Unavailable route"
            />
          }
        />
      </Routes>
    </Shell>
  );
}
