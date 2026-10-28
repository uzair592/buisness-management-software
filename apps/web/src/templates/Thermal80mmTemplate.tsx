import { formatMoney } from "@business/domain";
import { type PrintableDocumentData, type PrintSettings } from "./types";

export function Thermal80mmTemplate({
  data,
  settings,
}: {
  data: PrintableDocumentData;
  settings: PrintSettings;
}) {
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
    settings.logoSize === "sm" ? 36 : settings.logoSize === "md" ? 50 : settings.logoSize === "lg" ? 68 : 0;

  return (
    <div className="template-80mm-root font-mono bg-white text-gray-900 text-[11px] leading-snug w-[300px] max-w-[80mm] mx-auto p-3 border border-gray-300 shadow-sm print:p-0 print:border-none print:shadow-none print:w-[72mm]">
      {/* Reprint badge */}
      {data.isReprint && settings.showReprintWatermark && (
        <div className="text-center font-bold text-[10px] py-1 border border-dashed border-gray-500 mb-2">
          *** REPRINT / DUPLICATE ***
        </div>
      )}

      {/* Header */}
      <div className="text-center space-y-1 mb-2">
        {settings.logoSize !== "none" && settings.logoUrl && (
          <img
            src={settings.logoUrl}
            alt="Logo"
            style={{ height: `${logoHeight}px`, maxHeight: `${logoHeight}px` }}
            className="mx-auto object-contain mb-1"
          />
        )}
        <h1 className="font-bold text-sm tracking-tight uppercase">{businessName}</h1>
        {settings.businessAddress && (
          <p className="text-[10px] leading-tight text-gray-700">{settings.businessAddress}</p>
        )}
        {settings.businessPhone && (
          <p className="text-[10px] text-gray-700">Tel: {settings.businessPhone}</p>
        )}
        {settings.taxNumber && (
          <p className="text-[10px] font-semibold">{settings.taxNumber}</p>
        )}
        <p className="font-bold uppercase text-[11px] pt-1">
          {settings.customTitle || (data.documentType === "Sale" ? "SALES RECEIPT" : "PURCHASE VOUCHER")}
        </p>
      </div>

      <div className="border-b border-dashed border-gray-400 my-2" />

      {/* Meta */}
      <div className="space-y-0.5 text-[10px]">
        <div className="flex justify-between">
          <span className="text-gray-600">Bill No:</span>
          <strong className="font-bold">{data.number ?? "DRAFT"}</strong>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-600">Date:</span>
          <span>{data.businessDate ? data.businessDate.slice(0, 10) : new Date().toISOString().slice(0, 10)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-600">Party:</span>
          <strong className="truncate max-w-[180px]">
            {data.customerOrSupplier.name || (data.documentType === "Sale" ? "Walk-in" : "Supplier")}
          </strong>
        </div>
        {data.supplierReference && (
          <div className="flex justify-between">
            <span className="text-gray-600">Supplier Ref:</span>
            <span>{data.supplierReference}</span>
          </div>
        )}
      </div>

      <div className="border-b border-dashed border-gray-400 my-2" />

      {/* Items List */}
      <div className="space-y-1.5 text-[10px]">
        <div className="flex justify-between font-bold border-b border-gray-300 pb-0.5">
          <span>ITEM</span>
          <span>TOTAL</span>
        </div>
        {data.lines.map((line, idx) => (
          <div key={idx} className="space-y-0.5 print:break-inside-avoid">
            <p className="font-semibold break-words leading-tight">{line.name}</p>
            <div className="flex justify-between text-gray-700 text-[10px]">
              <span>
                {line.quantity} {line.unitName || ""} × {line.unitPrice}
                {line.discount && parseFloat(line.discount) > 0 ? ` (-${line.discount})` : ""}
              </span>
              <span className="font-bold text-gray-900">{line.total}</span>
            </div>
          </div>
        ))}
      </div>

      <div className="border-b border-dashed border-gray-400 my-2" />

      {/* Totals */}
      <div className="space-y-1 text-[10px]">
        <div className="flex justify-between">
          <span className="text-gray-600">Subtotal:</span>
          <span>{safeMoney(data.calculation.base)}</span>
        </div>
        {data.calculation.documentDiscount && parseFloat(data.calculation.documentDiscount) > 0 && (
          <div className="flex justify-between text-red-700">
            <span>Discount:</span>
            <span>-{safeMoney(data.calculation.documentDiscount)}</span>
          </div>
        )}
        {settings.showTaxDetails && (
          <div className="flex justify-between">
            <span className="text-gray-600">Tax:</span>
            <span>{safeMoney(data.calculation.tax)}</span>
          </div>
        )}
        <div className="flex justify-between font-bold text-xs pt-1 border-t border-gray-300">
          <span className="uppercase">TOTAL:</span>
          <span className="text-sm font-extrabold">{safeMoney(data.calculation.total)}</span>
        </div>
        <div className="flex justify-between font-semibold">
          <span>Paid:</span>
          <span>{safeMoney(data.payment.paid)}</span>
        </div>
        {parseFloat(data.payment.due) > 0.001 && (
          <div className="flex justify-between font-bold text-red-700">
            <span>Balance Due:</span>
            <span>{safeMoney(data.payment.due)}</span>
          </div>
        )}
        {data.payment.change && parseFloat(data.payment.change) > 0 && (
          <div className="flex justify-between text-green-700">
            <span>Change:</span>
            <span>{safeMoney(data.payment.change)}</span>
          </div>
        )}
      </div>

      {/* Tender Details */}
      {data.payment.payments && data.payment.payments.length > 0 && (
        <>
          <div className="border-b border-dashed border-gray-400 my-2" />
          <div className="text-[9px] space-y-0.5 text-gray-600">
            {data.payment.payments.map((p, idx) => (
              <p key={idx}>
                • {p.kind}: {safeMoney(p.applied)}
                {p.reference ? ` (Ref: ${p.reference})` : ""}
              </p>
            ))}
          </div>
        </>
      )}

      <div className="border-b border-dashed border-gray-400 my-2" />

      {/* Barcode representation */}
      <div className="text-center py-1">
        <div className="tracking-[5px] font-black text-sm select-none">
          ||| | |||| || | || ||||
        </div>
        <span className="text-[9px] text-gray-600 font-mono">{data.number ?? "DRAFT"}</span>
      </div>

      {/* Footer message */}
      {settings.footerNotes && (
        <p className="text-center text-[9px] text-gray-600 mt-2 leading-tight">
          {settings.footerNotes}
        </p>
      )}

      {/* Paper cut feed spacer */}
      <div className="h-6 print:h-10" />
    </div>
  );
}
