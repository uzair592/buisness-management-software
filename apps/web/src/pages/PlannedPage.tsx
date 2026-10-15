import { Link } from "react-router-dom";
import { Badge, Panel, EmptyState } from "@business/ui";
export function PlannedPage({
  title,
  description,
  milestone,
}: {
  title: string;
  description: string;
  milestone: string;
}) {
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">WORKSPACE PREVIEW</p>
          <h1>{title}</h1>
          <p>{description}</p>
        </div>
        <Badge>Planned · {milestone}</Badge>
      </div>
      <Panel>
        <EmptyState title="Not yet available">
          This workspace has no connected business data or working business
          actions. Follow the milestone roadmap for implementation.
        </EmptyState>
        <Link to="/home" className="btn-secondary">
          Back to Home
        </Link>
      </Panel>
    </>
  );
}
