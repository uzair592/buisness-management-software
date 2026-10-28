import { formatMoney } from "@business/domain";
import { type PrintableDocumentData, type PrintSettings, amountInWords } from "./types";

export function A4InvoiceTemplate({
  data,
  settings,
}: {
  data: PrintableDocumentData;
  settings: PrintSettings;
}) {
  const isSale = data.documentType === "Sale";
  const businessName = settings.businessNameOverride || data.businessName || "My Business";

  const safeMoney = (val: string | undefined | null) => {
    if (!val) return "PKR 0.00";
    const isNeg = val.startsWith("-");
    const clean = isNeg ? val.slice(1) : val;
    try {
      return `${isNeg ? "-" : ""}${formatMoney(clean)}`;
    } catch {
      return `PKR ${val}`;
    }
  };

  const logoHeight =
    settings.logoSize === "sm" ? 44 : settings.logoSize === "md" ? 64 : settings.logoSize === "lg" ? 96 : 0;

  return (
    <div className="template-a4-root font-sans bg-white text-gray-900 text-xs leading-normal p-8 max-w-[210mm] mx-auto border border-gray-200 shadow-sm print:p-0 print:border-none print:shadow-none">
      {/* Reprint Watermark Banner */}
      {data.isReprint && settings.showReprintWatermark && (
        <div className="mb-4 py-1.5 px-3 bg-amber-100 text-amber-900 border border-amber-300 rounded text-center font-bold tracking-widest text-xs uppercase print:bg-gray-100 print:text-black print:border-gray-400">
          *** REPRINT / DUPLICATE COPY ***
        </div>
      )}

      {/* Header: Company & Invoice Info */}
      <div className="flex justify-between items-start border-b-2 border-gray-900 pb-5 mb-5 gap-4">
        <div className="space-y-1 max-w-[60%]">
          <div className="flex items-center gap-3">
            {settings.logoSize !== "none" && settings.logoUrl && (
              <img
                src={settings.logoUrl}
                alt="Logo"
                style={{ height: `${logoHeight}px`, maxHeight: `${logoHeight}px` }}
                className="object-contain"
              />
            )}
            <div>
              <h1 className="text-xl font-extrabold tracking-tight text-gray-900 uppercase">
                {businessName}
              </h1>
              {settings.taxNumber && (
                <p className="text-[11px] font-semibold text-gray-700">{settings.taxNumber}</p>
              )}
            </div>
          </div>
          <p className="text-gray-600 text-[11px] leading-snug whitespace-pre-line mt-1">
            {settings.businessAddress}
          </p>
          {settings.businessPhone && (
            <p className="text-gray-600 text-[11px]">Phone: {settings.businessPhone}</p>
          )}
        </div>

        <div className="text-right space-y-1">
          <span className="inline-block px-3 py-1 bg-gray-900 text-white font-black text-sm tracking-wider uppercase rounded-sm print:bg-black">
            {settings.customTitle || (isSale ? "TAX INVOICE" : "PURCHASE BILL")}
          </span>
          <div className="pt-2 text-[11px] space-y-0.5">
            <p>
              <span className="text-gray-500 font-medium">Invoice No: </span>
              <strong className="font-mono text-sm text-gray-900">{data.number ?? "DRAFT"}</strong>
            </p>
            <p>
              <span className="text-gray-500 font-medium">Date: </span>
              <strong>{data.businessDate ? data.businessDate.slice(0, 10) : new Date().toISOString().slice(0, 10)}</strong>
            </p>
            {data.supplierReference && (
              <p>
                <span className="text-gray-500 font-medium">Supplier Ref: </span>
                <strong className="font-mono">{data.supplierReference}</strong>
              </p>
            )}
            <p>
              <span className="text-gray-500 font-medium">Status: </span>
              <span
                className={`px-1.5 py-0.2 rounded font-semibold text-[10px] ${
                  data.status === "Posted" ? "bg-green-100 text-green-800" : "bg-amber-100 text-amber-800"
                }`}
              >
                {data.status === "Posted" ? "ISSUED" : "DRAFT"}
              </span>
            </p>
          </div>
        </div>
      </div>

      {/* Bill To / Supplier Details */}
      <div className="grid grid-cols-2 gap-6 bg-gray-50 p-3.5 rounded border border-gray-200 mb-5 print:bg-white print:border-gray-300">
        <div>
          <h2 className="text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1">
            {isSale ? "Bill To (Customer):" : "Supplier Details:"}
          </h2>
          <p className="font-bold text-sm text-gray-900">{data.customerOrSupplier.name || (isSale ? "Walk-in Customer" : "Direct Supplier")}</p>
          {data.customerOrSupplier.phone && (
            <p className="text-gray-600 text-[11px]">Phone: {data.customerOrSupplier.phone}</p>
          )}
          {data.customerOrSupplier.address && (
            <p className="text-gray-600 text-[11px] whitespace-pre-line">{data.customerOrSupplier.address}</p>
          )}
          {data.customerOrSupplier.taxId && (
            <p className="text-gray-600 text-[11px]">NTN/GST: {data.customerOrSupplier.taxId}</p>
          )}
        </div>
        <div className="text-right text-[11px] space-y-1">
          <h2 className="text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1">
            Payment Terms:
          </h2>
          <p>
            {parseFloat(data.payment.due) <= 0.001 ? (
              <span className="text-green-700 font-bold bg-green-50 px-2 py-0.5 rounded border border-green-200">
                Fully Paid
              </span>
            ) : parseFloat(data.payment.paid) > 0.001 ? (
              <span className="text-amber-700 font-bold bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
                Partial Payment (Credit Balance)
              </span>
            ) : (
              <span className="text-red-700 font-bold bg-red-50 px-2 py-0.5 rounded border border-red-200">
                Full Credit / Payable
              </span>
            )}
          </p>
          {data.duplicateRefReviewed && (
            <p className="text-xs text-amber-700 font-semibold">Reviewed Duplicate Supplier Invoice</p>
          )}
        </div>
      </div>

      {/* Line Items Table */}
      <div className="mb-6">
        <table className="w-full text-left border-collapse border border-gray-300">
          <thead>
            <tr className="bg-gray-100 text-gray-800 text-[11px] uppercase font-bold border-b border-gray-300 print:bg-gray-100">
              <th className="py-2 px-2.5 w-8 text-center border-r border-gray-300">#</th>
              <th className="py-2 px-2.5 border-r border-gray-300">Item & Description</th>
              <th className="py-2 px-2.5 w-16 text-center border-r border-gray-300">Unit</th>
              <th className="py-2 px-2.5 w-16 text-right border-r border-gray-300">Qty</th>
              <th className="py-2 px-2.5 w-20 text-right border-r border-gray-300">Rate</th>
              {settings.showTaxDetails && (
                <th className="py-2 px-2.5 w-16 text-right border-r border-gray-300">Tax</th>
              )}
              <th className="py-2 px-2.5 w-24 text-right">Amount</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {data.lines.map((line, idx) => (
              <tr key={idx} className="print:break-inside-avoid">
                <td className="py-2 px-2.5 text-center text-gray-500 border-r border-gray-200 font-mono text-[11px]">
                  {idx + 1}
                </td>
                <td className="py-2 px-2.5 border-r border-gray-200">
                  <p className="font-semibold text-gray-900 break-words">{line.name}</p>
                  {line.discount && parseFloat(line.discount) > 0 && (
                    <span className="text-[10px] text-gray-500">Disc: -{line.discount}</span>
                  )}
                </td>
                <td className="py-2 px-2.5 text-center text-gray-600 border-r border-gray-200">
                  {line.unitName || "Each"}
                </td>
                <td className="py-2 px-2.5 text-right font-medium border-r border-gray-200">
                  {line.quantity}
                </td>
                <td className="py-2 px-2.5 text-right text-gray-700 border-r border-gray-200">
                  {line.unitPrice}
                </td>
                {settings.showTaxDetails && (
                  <td className="py-2 px-2.5 text-right text-gray-600 border-r border-gray-200">
                    {line.taxPercent ? `${line.taxPercent}%` : "0%"}
                  </td>
                )}
                <td className="py-2 px-2.5 text-right font-semibold text-gray-900">
                  {line.total}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Totals & Payments Section */}
      <div className="grid grid-cols-2 gap-8 items-start mb-6">
        {/* Left column: Amount in Words, Payments Made */}
        <div className="space-y-3">
          <div className="p-2.5 bg-gray-50 rounded border border-gray-200 print:bg-white">
            <h3 className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-0.5">
              Amount In Words:
            </h3>
            <p className="font-semibold text-gray-800 text-[11px] italic">
              {amountInWords(data.calculation.total)}
            </p>
          </div>

          {/* Payment breakdown */}
          <div className="p-2.5 bg-gray-50 rounded border border-gray-200 space-y-1.5 print:bg-white text-[11px]">
            <h3 className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1">
              Payment Details:
            </h3>
            {data.payment.payments && data.payment.payments.length > 0 ? (
              data.payment.payments.map((p, pIdx) => (
                <div key={pIdx} className="flex justify-between text-gray-700">
                  <span>
                    {p.kind} {p.reference ? `(Ref: ${p.reference})` : ""}
                  </span>
                  <span className="font-medium">{safeMoney(p.applied)}</span>
                </div>
              ))
            ) : (
              <p className="text-gray-500 italic">No direct payment attached</p>
            )}
            {data.payment.change && parseFloat(data.payment.change) > 0 && (
              <div className="flex justify-between text-green-700 pt-1 border-t border-gray-200 font-semibold">
                <span>Change Returned:</span>
                <span>{safeMoney(data.payment.change)}</span>
              </div>
            )}
          </div>
        </div>

        {/* Right column: Subtotal, Discount, Tax, Grand Total, Due */}
        <div className="border border-gray-300 rounded overflow-hidden">
          <div className="divide-y divide-gray-200 text-[11px]">
            <div className="flex justify-between py-1.5 px-3">
              <span className="text-gray-600">Subtotal</span>
              <span className="font-medium">{safeMoney(data.calculation.base)}</span>
            </div>
            {data.calculation.documentDiscount && parseFloat(data.calculation.documentDiscount) > 0 && (
              <div className="flex justify-between py-1.5 px-3 text-red-700">
                <span>Document Discount</span>
                <span>-{safeMoney(data.calculation.documentDiscount)}</span>
              </div>
            )}
            {settings.showTaxDetails && (
              <div className="flex justify-between py-1.5 px-3">
                <span className="text-gray-600">Tax</span>
                <span className="font-medium">{safeMoney(data.calculation.tax)}</span>
              </div>
            )}
            <div className="flex justify-between py-2.5 px-3 bg-gray-100 font-extrabold text-sm border-t-2 border-gray-900 print:bg-gray-100">
              <span className="uppercase">Grand Total</span>
              <span className="text-base text-gray-900">{safeMoney(data.calculation.total)}</span>
            </div>
            <div className="flex justify-between py-1.5 px-3 bg-green-50 text-green-900 font-semibold">
              <span>Total Paid</span>
              <span>{safeMoney(data.payment.paid)}</span>
            </div>
            <div className="flex justify-between py-1.5 px-3 bg-red-50 text-red-900 font-bold">
              <span>Balance Due</span>
              <span>{safeMoney(data.payment.due)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Footer Notes & Signature */}
      <div className="pt-4 border-t border-gray-300 grid grid-cols-2 gap-8 items-end mt-4">
        <div>
          <h3 className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1">
            Terms & Conditions:
          </h3>
          <p className="text-gray-600 text-[10px] leading-relaxed whitespace-pre-line">
            {settings.footerNotes}
          </p>
        </div>

        {settings.showSignature && (
          <div className="text-center space-y-1">
            <div className="border-b border-gray-400 w-48 mx-auto h-12" />
            <p className="text-[11px] font-bold text-gray-800 uppercase">Authorized Signatory</p>
            <p className="text-[9px] text-gray-500">For {businessName}</p>
          </div>
        )}
      </div>
    </div>
  );
}
