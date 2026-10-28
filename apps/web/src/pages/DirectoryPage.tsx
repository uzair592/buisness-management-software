import { usePreview } from "../preview/PreviewProvider";
import { useAuth } from "../context/AuthContext";
import { LiveDirectoryPage } from "./LiveDirectoryPage";
import { SampleDirectoryPage } from "./sample/SampleDirectoryPage";

export function DirectoryPage({ type }: { type: "items" | "parties" }) {
  const { sample } = usePreview();
  const { authenticated, selectedBusinessId } = useAuth();

  if (!sample && authenticated && selectedBusinessId) {
    return <LiveDirectoryPage type={type} />;
  }

  return <SampleDirectoryPage type={type} />;
}
