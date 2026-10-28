import { RecordsPage } from "./RecordsPage";
import { useAuth } from "../context/AuthContext";
import { usePreview } from "../preview/PreviewProvider";
import { LivePurchasesPage } from "./LivePurchasesPage";

export function PurchasesPage() {
  const auth = useAuth();
  const { sample } = usePreview();
  if (auth.authenticated && auth.selectedBusinessId && !sample) return <LivePurchasesPage />;
  return <RecordsPage title="Purchases" kind="Purchase" />;
}
