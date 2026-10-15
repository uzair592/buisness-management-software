import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Panel, Badge, Field, Button, Table, EmptyState } from "@business/ui";
export function NewSalePage() {
  const search = useRef<HTMLInputElement>(null);
  const [customerOpen, setCustomerOpen] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(false);
  useEffect(() => {
    search.current?.focus();
  }, []);
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">
            <Link to="/sales">SALES</Link> / WORKSPACE
          </p>
          <h1>New Sale</h1>
        </div>
        <Badge>Layout only · not saved</Badge>
      </div>
      <div className="notice">
        Billing becomes available in M05. Inputs are for layout preview only;
        nothing is saved or issued.
      </div>
      <div className="sale-layout">
        <div className="sale-cart">
          <Panel>
            <Button
              className="customer-toggle"
              aria-expanded={customerOpen}
              aria-controls="customer-details"
              onClick={() => setCustomerOpen(!customerOpen)}
            >
              Walk-in customer · Optional details
            </Button>
            <div
              id="customer-details"
              className={"customer-grid " + (customerOpen ? "is-expanded" : "")}
            >
              <Field
                id="customer"
                label="Customer"
                placeholder="Walk-in customer"
                disabled
              />
              <Field id="sale-date" label="Invoice date" type="date" disabled />
            </div>
          </Panel>
          <Panel className="cart-panel">
            <label className="label" htmlFor="item-search">
              Item search or barcode
            </label>
            <input
              id="item-search"
              ref={search}
              className="input"
              type="search"
              placeholder="Search items — catalogue not connected"
              aria-describedby="search-help"
            />
            <p id="search-help" className="text-xs text-surface-500 mt-2">
              Search preview only. Items become available after M04.
            </p>
            <div className="desktop-cart mt-5">
              <Table
                headers={[
                  "Item / Description",
                  "Qty / Unit",
                  "Rate",
                  "Discount",
                  "Total",
                ]}
              >
                <tr>
                  <td colSpan={5}>
                    <EmptyState title="Your cart is empty">
                      Items and editable invoice lines will appear here.
                    </EmptyState>
                  </td>
                </tr>
              </Table>
            </div>
            <div className="mobile-cart">
              <EmptyState title="Your cart is empty">
                Items will appear as readable line cards here.
              </EmptyState>
            </div>
          </Panel>
        </div>
        <Panel className="sale-summary">
          <div className="section-heading">
            <h2>Sale summary</h2>
            <Badge>PKR</Badge>
          </div>
          <div className="mobile-summary-heading">
            <span>Total unavailable</span>
            <b>—</b>
          </div>
          <Button
            className="summary-toggle"
            aria-expanded={summaryOpen}
            aria-controls="payment-details"
            onClick={() => setSummaryOpen(!summaryOpen)}
          >
            Payment details {summaryOpen ? "−" : "+"}
          </Button>
          <div
            id="payment-details"
            className={"summary-body " + (summaryOpen ? "is-expanded" : "")}
          >
            <dl className="totals">
              {[
                "Subtotal",
                "Discount",
                "Tax",
                "Total",
                "Paid",
                "Change",
                "Remaining due",
              ].map((s) => (
                <div key={s}>
                  <dt>{s}</dt>
                  <dd>—</dd>
                </div>
              ))}
            </dl>
            <label className="label" htmlFor="payment">
              Payment account
            </label>
            <select id="payment" className="input" disabled>
              <option>Not connected</option>
            </select>
          </div>
          <Button className="checkout" disabled>
            Save & print · M05
          </Button>
          <p className="text-xs text-surface-500 mt-3">
            No invoice number is issued. Payment and totals are unavailable.
          </p>
        </Panel>
      </div>
    </>
  );
}
