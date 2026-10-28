import { formatMoney } from "@business/domain";
import { type PrintableDocumentData, type PrintSettings } from "./types";

export function Thermal58mmTemplate({
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
    settings.logoSize === "sm" ? 28 : settings.logoSize === "md" ? 40 : settings.logoSize === "lg" ? 54 : 0;

  return (
    <div className="template-58mm-root font-mono bg-white text-gray-900 text-[10px] leading-tight w-[220px] max-w-[58mm] mx-auto p-2 border border-gray-300 shadow-sm print:p-0 print:border-none print:shadow-none print:w-[48mm]">
      {/* Reprint badge */}
      {data.isReprint && settings.showReprintWatermark && (
        <div className="text-center font-bold text-[9px] py-0.5 border border-dashed border-gray-400 mb-1.5">
          * REPRINT *
        </div>
      )}

      {/* Header */}
      <div className="text-center space-y-0.5 mb-1.5">
        {settings.logoSize !== "none" && settings.logoUrl && (
          <img
            src={settings.logoUrl}
            alt="Logo"
            style={{ height: `${logoHeight}px`, maxHeight: `${logoHeight}px` }}
            className="mx-auto object-contain mb-0.5"
          />
        )}
        <h1 className="font-extrabold text-xs uppercase leading-tight">{businessName}</h1>
        {settings.businessPhone && (
          <p className="text-[9px] text-gray-600">Ph: {settings.businessPhone}</p>
        )}
        <p className="font-bold uppercase text-[9px] pt-0.5">
          {settings.customTitle || (data.documentType === "Sale" ? "CASH MEMO" : "BILL")}
        </p>
      </div>

      <div className="border-b border-dashed border-gray-400 my-1" />

      {/* Meta */}
      <div className="text-[9px] space-y-0.5">
        <div className="flex justify-between">
          <span>No:</span>
          <strong className="font-bold">{data.number ?? "DRAFT"}</strong>
        </div>
        <div className="flex justify-between">
          <span>Date:</span>
          <span>{data.businessDate ? data.businessDate.slice(0, 10) : new Date().toISOString().slice(0, 10)}</span>
        </div>
        <div className="flex justify-between">
          <span>Party:</span>
          <span className="truncate max-w-[140px]">
            {data.customerOrSupplier.name || (data.documentType === "Sale" ? "Walk-in" : "Supplier")}
          </span>
        </div>
      </div>

      <div className="border-b border-dashed border-gray-400 my-1" />

      {/* Items */}
      <div className="space-y-1 text-[9px]">
        {data.lines.map((line, idx) => (
          <div key={idx} className="print:break-inside-avoid">
            <p className="font-bold leading-none break-words">{line.name}</p>
            <div className="flex justify-between text-gray-700">
              <span>
                {line.quantity} × {line.unitPrice}
              </span>
              <span className="font-bold text-gray-900">{line.total}</span>
            </div>
          </div>
        ))}
      </div>

      <div className="border-b border-dashed border-gray-400 my-1" />

      {/* Totals */}
      <div className="space-y-0.5 text-[9px]">
        <div className="flex justify-between">
          <span>Subtotal:</span>
          <span>{safeMoney(data.calculation.base)}</span>
        </div>
        {data.calculation.documentDiscount && parseFloat(data.calculation.documentDiscount) > 0 && (
          <div className="flex justify-between text-red-700">
            <span>Disc:</span>
            <span>-{safeMoney(data.calculation.documentDiscount)}</span>
          </div>
        )}
        {settings.showTaxDetails && (
          <div className="flex justify-between">
            <span>Tax:</span>
            <span>{safeMoney(data.calculation.tax)}</span>
          </div>
        )}
        <div className="flex justify-between font-black text-[11px] pt-1 border-t border-gray-300">
          <span>TOTAL:</span>
          <span>{safeMoney(data.calculation.total)}</span>
        </div>
        <div className="flex justify-between">
          <span>Paid:</span>
          <span>{safeMoney(data.payment.paid)}</span>
        </div>
        {parseFloat(data.payment.due) > 0.001 && (
          <div className="flex justify-between font-bold text-red-700">
            <span>Due:</span>
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

      <div className="border-b border-dashed border-gray-400 my-1" />

      {/* Barcode */}
      <div className="text-center py-0.5">
        <div className="tracking-[4px] font-black text-xs select-none">
          || | |||| || | ||
        </div>
        <span className="text-[8px] text-gray-600 font-mono">{data.number ?? "DRAFT"}</span>
      </div>

      {settings.footerNotes && (
        <p className="text-center text-[8px] text-gray-500 mt-1 leading-tight">
          {settings.footerNotes}
        </p>
      )}

      {/* Paper cut feed spacer */}
      <div className="h-4 print:h-8" />
    </div>
  );
}
