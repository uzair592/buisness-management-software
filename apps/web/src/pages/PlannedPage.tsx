import { Link } from "react-router-dom";
import { Panel, EmptyState } from "@business/ui";
export function PlannedPage({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">WORKSPACE</p>
          <h1>{title}</h1>
          <p>{description}</p>
        </div>
      </div>
      <Panel>
        <EmptyState title="Not yet available">
          This area is still being built. Explore Home, the directories and New
          Sale in the sample workspace.
        </EmptyState>
        <div className="empty-actions">
          <Link className="btn-secondary" to="/home">
            Back to Home
          </Link>
        </div>
      </Panel>
    </>
  );
}
