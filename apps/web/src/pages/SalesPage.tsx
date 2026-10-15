import { Link } from "react-router-dom";
import { Panel, Badge, Table, EmptyState } from "@business/ui";
export function SalesPage() {
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">BUSINESS RECORDS</p>
          <h1>Sales</h1>
          <p>Invoices, quotations and linked corrections.</p>
        </div>
        <Link to="/sales/new" className="btn-primary">
          ＋ New Sale
        </Link>
      </div>
      <div className="notice">
        <Badge>Layout only</Badge>
        <span>
          Invoice storage and billing begin in M05. No records are loaded.
        </span>
      </div>
      <Panel>
        <Table headers={["Invoice", "Date", "Customer", "Amount", "Status"]}>
          <tr>
            <td colSpan={5}>
              <EmptyState title="Sales are not connected">
                Explore New Sale to preview the cart and payment layout.
              </EmptyState>
            </td>
          </tr>
        </Table>
      </Panel>
      <div className="setup-grid mt-5">
        {["Quotations · M12", "Credit notes · M08", "Saved receipts · M05"].map(
          (s) => (
            <Panel key={s}>
              <h2>{s}</h2>
              <p className="text-sm text-surface-500 mt-2">Not yet available</p>
            </Panel>
          ),
        )}
      </div>
    </>
  );
}
