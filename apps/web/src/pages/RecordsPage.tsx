import { Link } from "react-router-dom";
import { Panel, EmptyState } from "@business/ui";
import { usePreview } from "../preview/PreviewProvider";
import { Transactions, PeriodFilter } from "../components/Transactions";
import { TrySample } from "../components/PreviewActions";
export function RecordsPage({
  title,
  kind,
}: {
  title: string;
  kind: "Sale" | "Purchase";
}) {
  const { sample } = usePreview();
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">BUSINESS RECORDS</p>
          <h1>{title}</h1>
          <p>
            {kind === "Sale"
              ? "Your sales, payments and outstanding amounts."
              : "Supplier bills and outstanding amounts."}
          </p>
        </div>
        <div className="heading-actions">
          {sample && <PeriodFilter />}
          {kind === "Sale" && (
            <Link to="/sales/new" className="btn-primary">
              ＋ New Sale
            </Link>
          )}
        </div>
      </div>
      <Panel className="records-panel">
        {sample ? (
          <Transactions kind={kind} />
        ) : (
          <>
            <EmptyState title={"No " + title.toLowerCase() + " connected"}>
              Your business records will appear here when business setup and
              posting are available.
            </EmptyState>
            <div className="empty-actions">
              <TrySample to={kind === "Sale" ? "/sales" : "/purchases"} />
              <Link to="/settings" className="btn-secondary">
                View setup
              </Link>
            </div>
          </>
        )}
      </Panel>
    </>
  );
}
