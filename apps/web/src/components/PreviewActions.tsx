import { useNavigate } from "react-router-dom";
import { Button } from "@business/ui";
import { usePreview } from "../preview/PreviewProvider";
export function TrySample({ to = "/home" }: { to?: string }) {
  const preview = usePreview();
  const navigate = useNavigate();
  return (
    <Button
      className="primary-action"
      onClick={() => {
        preview.enter();
        navigate(to);
      }}
    >
      Try sample workspace
    </Button>
  );
}
