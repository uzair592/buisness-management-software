import { useAuth } from "../context/AuthContext";
import { usePreview } from "../preview/PreviewProvider";
import { LiveSalePage } from "./LiveSalePage";
import { SampleSalePage } from "./sample/SampleSalePage";

export function NewSalePage() {
  const { authenticated, selectedBusinessId } = useAuth();
  const { sample } = usePreview();

  if (authenticated && selectedBusinessId && !sample) {
    return <LiveSalePage key={selectedBusinessId} />;
  }

  return <SampleSalePage />;
}
