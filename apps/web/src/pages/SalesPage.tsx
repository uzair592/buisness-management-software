import { RecordsPage } from "./RecordsPage";
import { useAuth } from "../context/AuthContext";
import { usePreview } from "../preview/PreviewProvider";
import { LiveSalesPage } from "./LiveSalesPage";
export function SalesPage() {
  const auth = useAuth();
  const { sample } = usePreview();
  if (auth.authenticated && auth.selectedBusinessId && !sample) return <LiveSalesPage />;
  return <RecordsPage title="Sales" kind="Sale" />;
}
