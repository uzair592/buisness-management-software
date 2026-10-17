import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Panel, EmptyState, Table } from "@business/ui";
import { atOrBelow, formatMoney, sumAmounts } from "@business/domain";
import { usePreview } from "../preview/PreviewProvider";
import { transactionDue } from "../preview/fixtures";
import { TrySample } from "../components/PreviewActions";
import { useAuth } from "../context/AuthContext";
import { LiveDirectoryPage } from "./LiveDirectoryPage";
export function DirectoryPage({ type }: { type: "items" | "parties" }) {
  const { sample, items, parties, transactions } = usePreview();
  const { authenticated, selectedBusinessId } = useAuth();
  const [query, setQuery] = useState("");
  const [params, setParams] = useSearchParams();
  const low = params.get("filter") === "low";
  const title = type === "items" ? "Items & Stock" : "Parties";
  const matches = (name: string) =>
    name.toLowerCase().includes(query.toLowerCase());
  const filteredItems = items.filter(
    (i) =>
      matches(i.name + " " + i.barcode) &&
      (!low || atOrBelow(i.stock, i.reorder)),
  );
  const filteredParties = parties.filter((p) => matches(p.name + " " + p.type));
  if (!sample && authenticated && selectedBusinessId) return <LiveDirectoryPage type={type} />;
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">BUSINESS DIRECTORY</p>
          <h1>{title}</h1>
          <p>
            {type === "items"
              ? "Find items, prices and stock at a glance."
              : "Customers and suppliers, in one place."}
          </p>
        </div>
        {sample && (
          <span className="muted">
            {type === "items"
              ? "Stock snapshot · 15 Oct 2026"
              : "Sample directory · read only"}
          </span>
        )}
      </div>
      <Panel>
        {sample ? (
          <>
            <div className="table-toolbar">
              <label className="search-field">
                <span className="sr-only">Search {type}</span>
                <input
                  className="input"
                  type="search"
                  placeholder={
                    type === "items"
                      ? "Search items or barcode…"
                      : "Search parties…"
                  }
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </label>
              {type === "items" && (
                <label className="check-label">
                  <input
                    type="checkbox"
                    checked={low}
                    onChange={(e) =>
                      setParams(e.target.checked ? { filter: "low" } : {})
                    }
                  />
                  Low stock only
                </label>
              )}
            </div>
            {type === "items" ? (
              <Table headers={["Item", "Category", "Price", "Stock"]}>
                {filteredItems.map((i) => (
                  <tr key={i.id}>
                    <td>
                      <b>{i.name}</b>
                      <small className="cell-subtitle">
                        {i.barcode} · per {i.unit}
                      </small>
                    </td>
                    <td>{i.category}</td>
                    <td className="amount">{formatMoney(i.price)}</td>
                    <td>
                      <span
                        className={
                          "status-badge " +
                          (atOrBelow(i.stock, i.reorder) ? "due" : "neutral")
                        }
                      >
                        {i.stock} {i.unit}
                        {atOrBelow(i.stock, i.reorder) ? " · Low" : ""}
                      </span>
                    </td>
                  </tr>
                ))}
                {!filteredItems.length && (
                  <tr>
                    <td colSpan={4}>
                      <EmptyState title="No matching items">
                        Try another item name or barcode.
                      </EmptyState>
                    </td>
                  </tr>
                )}
              </Table>
            ) : (
              <Table headers={["Party", "Type", "City", "Outstanding"]}>
                {filteredParties.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <b>{p.name}</b>
                    </td>
                    <td>{p.type}</td>
                    <td>{p.city}</td>
                    <td className="amount">
                      {formatMoney(
                        sumAmounts(
                          transactions
                            .filter((t) => t.partyId === p.id)
                            .map(transactionDue),
                        ),
                      )}
                    </td>
                  </tr>
                ))}
                {!filteredParties.length && (
                  <tr>
                    <td colSpan={4}>
                      <EmptyState title="No matching parties">
                        Try a different name.
                      </EmptyState>
                    </td>
                  </tr>
                )}
              </Table>
            )}
            <p className="table-footer">
              {type === "items" ? filteredItems.length : filteredParties.length}{" "}
              {type} · Sample records are read only
            </p>
          </>
        ) : (
          <>
            <EmptyState
              title={
                type === "items"
                  ? "Your catalogue starts here"
                  : "Keep your business contacts together"
              }
            >
              Business setup and catalogue editing are not available yet.
              Explore a sample directory to see the layout.
            </EmptyState>
            <div className="empty-actions">
              <TrySample to={"/" + type} />
            </div>
          </>
        )}
      </Panel>
    </>
  );
}
