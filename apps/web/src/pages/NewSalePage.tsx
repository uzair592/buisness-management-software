import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Panel, Button, Dialog, EmptyState } from "@business/ui";
import { formatMoney, lineAmount, validQuantity } from "@business/domain";
import { usePreview } from "../preview/PreviewProvider";
import { cartAmount, itemById, partyName } from "../preview/fixtures";
import { TrySample } from "../components/PreviewActions";
export function NewSalePage() {
  const preview = usePreview();
  const search = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [showResults, setShowResults] = useState(false);
  const [clearOpen, setClearOpen] = useState(false);
  const [receiptOpen, setReceiptOpen] = useState(false);
  const [customerOpen, setCustomerOpen] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const results = preview.items.filter((i) =>
    (i.name + " " + i.barcode).toLowerCase().includes(query.toLowerCase()),
  );
  const valid = preview.cart.every((l) => validQuantity(l.quantity));
  const total = valid ? cartAmount(preview.cart) : null;
  useEffect(() => {
    search.current?.focus();
  }, [preview.sample]);
  useEffect(() => {
    if (showResults)
      document
        .getElementById("item-result-" + active)
        ?.scrollIntoView({ block: "nearest" });
  }, [active, showResults, query]);
  function add(index: number) {
    const item = results[index];
    if (!item) return;
    preview.addItem(item.id);
    setQuery("");
    setShowResults(false);
    setActive(0);
    setAnnouncement(item.name + " added to sample cart");
    search.current?.focus();
  }
  function returnToSearch() {
    requestAnimationFrame(() => search.current?.focus());
  }
  return (
    <>
      <div className="page-heading sale-heading">
        <div>
          <p className="eyebrow">
            <Link to="/sales">SALES</Link> / NEW SALE
          </p>
          <h1>New Sale</h1>
        </div>
        <div className="heading-actions">
          {preview.sample ? (
            <span className="subtle-label">Unsaved sample cart</span>
          ) : (
            <TrySample to="/sales/new" />
          )}
          <Button
            disabled={!preview.sample || !preview.cart.length}
            onClick={() => setClearOpen(true)}
          >
            Clear cart
          </Button>
        </div>
      </div>
      <div className="sale-layout">
        <div className="sale-cart">
          <Panel className="customer-panel">
            <Button
              className="customer-toggle"
              aria-expanded={customerOpen}
              aria-controls="customer-details"
              onClick={() => setCustomerOpen(!customerOpen)}
            >
              {preview.sample
                ? partyName(preview.customer)
                : "Walk-in customer"}{" "}
              · Customer details
            </Button>
            <div
              id="customer-details"
              className={"customer-grid " + (customerOpen ? "is-expanded" : "")}
            >
              <label>
                Customer
                <select
                  className="input"
                  aria-label="Customer"
                  value={preview.customer}
                  disabled={!preview.sample}
                  onChange={(e) => preview.selectCustomer(e.target.value)}
                >
                  {preview.sample ? (
                    preview.parties
                      .filter((p) => p.type === "Customer")
                      .map((p) => (
                        <option value={p.id} key={p.id}>
                          {p.name}
                        </option>
                      ))
                  ) : (
                    <option value="walk-in">Walk-in customer</option>
                  )}
                </select>
              </label>
              <label>
                Business date
                <input
                  className="input"
                  aria-label="Business date"
                  value={preview.sample ? "15 Oct 2026" : "Not connected"}
                  readOnly
                />
              </label>
            </div>
          </Panel>
          <Panel className="cart-panel">
            <div className="section-heading">
              <h2>Items</h2>
              <span className="muted">
                {preview.cart.length}{" "}
                {preview.cart.length === 1 ? "line" : "lines"}
              </span>
            </div>
            <div className="item-search-wrap">
              <label htmlFor="item-search" className="sr-only">
                Item search or barcode
              </label>
              <input
                ref={search}
                id="item-search"
                className="input item-search"
                placeholder={
                  preview.sample
                    ? "Search items or scan a barcode…"
                    : "Item search — catalogue not connected"
                }
                value={query}
                readOnly={!preview.sample}
                role="combobox"
                aria-autocomplete="list"
                aria-expanded={preview.sample && showResults}
                aria-controls="item-results"
                aria-activedescendant={
                  showResults && results.length
                    ? "item-result-" + Math.min(active, results.length - 1)
                    : undefined
                }
                aria-describedby="item-search-help"
                onFocus={() => {
                  if (preview.sample && query) setShowResults(true);
                }}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setActive(0);
                  setShowResults(true);
                }}
                onKeyDown={(e) => {
                  if (!preview.sample) return;
                  if (e.key === "Escape") {
                    setShowResults(false);
                    return;
                  }
                  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                    e.preventDefault();
                    setShowResults(true);
                    setActive((i) =>
                      results.length
                        ? (i +
                            (e.key === "ArrowDown" ? 1 : -1) +
                            results.length) %
                          results.length
                        : 0,
                    );
                  }
                  if (e.key === "Enter" && showResults) {
                    e.preventDefault();
                    add(active);
                  }
                }}
              />
              <p id="item-search-help" className="muted search-hint">
                {preview.sample
                  ? "Search by name or barcode. Use ↑ ↓ then Enter to add."
                  : "Try the sample workspace to explore item search and billing."}
              </p>
              {preview.sample && showResults && (
                <div
                  className="item-results"
                  id="item-results"
                  role="listbox"
                  aria-label="Sample items"
                >
                  {results.map((i, index) => (
                    <button
                      role="option"
                      aria-selected={index === active}
                      id={"item-result-" + index}
                      key={i.id}
                      onClick={() => add(index)}
                    >
                      <span>
                        <b>{i.name}</b>
                        <small>
                          {i.barcode} · per {i.unit}
                        </small>
                      </span>
                      <span>
                        {formatMoney(i.price)} <b aria-hidden="true">＋</b>
                      </span>
                    </button>
                  ))}
                  {!results.length && (
                    <p role="status">
                      No matching sample items. Try “tea” or “8901003”.
                    </p>
                  )}
                  <Button
                    onClick={() => {
                      setShowResults(false);
                      search.current?.focus();
                    }}
                  >
                    Close item results
                  </Button>
                </div>
              )}
            </div>
            <div className="cart-columns" aria-hidden="true">
              <span>Item / Description</span>
              <span>Quantity</span>
              <span>Rate</span>
              <span>Amount</span>
              <span />
            </div>
            <div className="cart-lines" role="list" aria-label="Cart lines">
              {preview.cart.map((l) => {
                const item = itemById(l.itemId);
                const quantityValid = validQuantity(l.quantity);
                return (
                  <div className="cart-line" role="listitem" key={item.id}>
                    <div className="cart-description">
                      <b>{item.name}</b>
                      <small>
                        {item.barcode} · {item.unit}
                      </small>
                    </div>
                    <div className="quantity-control">
                      <label className="sr-only" htmlFor={"qty-" + item.id}>
                        Quantity for {item.name}
                      </label>
                      <input
                        id={"qty-" + item.id}
                        className="input"
                        inputMode="decimal"
                        value={l.quantity}
                        maxLength={25}
                        aria-invalid={!quantityValid}
                        aria-describedby={
                          !quantityValid ? "error-" + item.id : undefined
                        }
                        onChange={(e) =>
                          preview.setQuantity(item.id, e.target.value)
                        }
                      />
                      {!quantityValid && (
                        <small className="field-error" id={"error-" + item.id}>
                          Use a quantity greater than zero, up to 6 decimals.
                        </small>
                      )}
                    </div>
                    <span className="line-rate">{formatMoney(item.price)}</span>
                    <strong className="line-amount">
                      {quantityValid
                        ? formatMoney(lineAmount(item.price, l.quantity))
                        : "—"}
                    </strong>
                    <Button
                      className="remove-line"
                      aria-label={"Remove " + item.name}
                      onClick={() => {
                        preview.removeItem(item.id);
                        setAnnouncement(item.name + " removed");
                        returnToSearch();
                      }}
                    >
                      ×
                    </Button>
                  </div>
                );
              })}
            </div>
            {!preview.cart.length && (
              <EmptyState
                title={
                  preview.sample
                    ? "Start with your first item"
                    : "Your cart is ready when you are"
                }
              >
                {preview.sample
                  ? "Search above to add an item. Try A5 notebook or barcode 8901003."
                  : "No catalogue is connected. Try a sample sale to explore the workflow."}
              </EmptyState>
            )}
            <div className="cart-footer">
              <span>Prices in PKR</span>
              <span>
                {preview.sample
                  ? "Sample prices · no tax or discounts applied"
                  : "No invoice has been issued"}
              </span>
            </div>
          </Panel>
          <p className="keyboard-note">
            Tip: Ctrl K opens pages and actions. Search stays ready for your
            next item.
          </p>
        </div>
        <Panel className="sale-summary">
          <div className="section-heading">
            <h2>Sale summary</h2>
            <span className="currency-label">PKR</span>
          </div>
          <dl className="totals">
            <div>
              <dt>Subtotal</dt>
              <dd>{preview.sample && total ? formatMoney(total) : "—"}</dd>
            </div>
            <div>
              <dt>Tax / Discount</dt>
              <dd>{preview.sample ? "Not applied" : "—"}</dd>
            </div>
            <div className="grand-total">
              <dt>Total</dt>
              <dd data-testid="cart-total">
                {preview.sample && total ? formatMoney(total) : "—"}
              </dd>
            </div>
          </dl>
          {preview.sample && (
            <div className="summary-context">
              <span aria-hidden="true">▤</span>
              <p>Review the sample receipt before starting another sale.</p>
            </div>
          )}
          <Button
            className="checkout primary-action"
            disabled={!preview.sample || !preview.cart.length || !valid}
            aria-describedby={
              !preview.sample ? "posting-unavailable" : undefined
            }
            onClick={() => setReceiptOpen(true)}
          >
            {preview.sample ? "Preview sample receipt" : "Save invoice"}
          </Button>
          {!preview.sample && (
            <p id="posting-unavailable" className="operational-hint">
              Invoice posting is not available yet.
            </p>
          )}
          {!valid && (
            <p className="field-error">
              Correct the highlighted quantities to preview this receipt.
            </p>
          )}
        </Panel>
      </div>
      <span role="status" className="sr-only">
        {announcement}
      </span>
      {clearOpen && (
        <Dialog title="Clear sample cart?" onClose={() => setClearOpen(false)}>
          <p>
            This removes all {preview.cart.length} lines from this sample cart.
          </p>
          <div className="dialog-actions">
            <Button data-dialog-autofocus onClick={() => setClearOpen(false)}>
              Keep cart
            </Button>
            <Button
              className="danger-action"
              onClick={() => {
                preview.clear();
                setClearOpen(false);
                setAnnouncement("Sample cart cleared");
                returnToSearch();
              }}
            >
              Clear sample cart
            </Button>
          </div>
        </Dialog>
      )}
      {receiptOpen && total && (
        <Dialog
          title="Sample receipt"
          onClose={() => setReceiptOpen(false)}
          className="receipt-dialog"
        >
          <div className="receipt-watermark">SAMPLE · NOT ISSUED</div>
          <div className="receipt-store">
            <h3>Sample general store</h3>
            <p>15 Oct 2026 · {partyName(preview.customer)}</p>
          </div>
          <ul className="receipt-lines">
            {preview.cart.map((l) => (
              <li key={l.itemId}>
                <span>
                  {itemById(l.itemId).name}
                  <small>
                    {l.quantity} × {formatMoney(itemById(l.itemId).price)}
                  </small>
                </span>
                <b>
                  {formatMoney(
                    lineAmount(itemById(l.itemId).price, l.quantity),
                  )}
                </b>
              </li>
            ))}
          </ul>
          <div className="receipt-total">
            <b>Total</b>
            <strong>{formatMoney(total)}</strong>
          </div>
          <p className="dialog-hint">
            Design preview only. Not a tax invoice. No invoice number, payment
            or business transaction is created. Nothing is saved.
          </p>
          <Button
            className="primary-action"
            onClick={() => setReceiptOpen(false)}
          >
            Back to sample sale
          </Button>
        </Dialog>
      )}
    </>
  );
}
