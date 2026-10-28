import { useAuth } from "../context/AuthContext";
import { usePreview } from "../preview/PreviewProvider";
import { LivePurchasePage } from "./LivePurchasePage";
import { RecordsPage } from "./RecordsPage";

export function NewPurchasePage() {
  const auth = useAuth();
  const { sample } = usePreview();
  if (auth.authenticated && auth.selectedBusinessId && !sample) return <LivePurchasePage />;
  return <RecordsPage title="New Purchase" kind="Purchase" />;
}
