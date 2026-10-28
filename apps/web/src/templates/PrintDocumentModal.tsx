import { useEffect, useState } from "react";
import { Button } from "@business/ui";
import {
  type PrintableDocumentData,
  type PrintSettings,
  type TemplateFormat,
  type LogoSize,
  loadPrintSettings,
  savePrintSettings,
} from "./types";
import { A4InvoiceTemplate } from "./A4InvoiceTemplate";
import { Thermal80mmTemplate } from "./Thermal80mmTemplate";
import { Thermal58mmTemplate } from "./Thermal58mmTemplate";

export function PrintDocumentModal({
  data,
  onClose,
  initialTemplate,
}: {
  data: PrintableDocumentData;
  onClose: () => void;
  initialTemplate?: TemplateFormat;
}) {
  const [settings, setSettings] = useState<PrintSettings>(() => loadPrintSettings());
  const [currentTemplate, setCurrentTemplate] = useState<TemplateFormat>(
    initialTemplate || settings.template || "a4",
  );

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "p") {
        e.preventDefault();
        window.print();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  function updateTemplate(t: TemplateFormat) {
    setCurrentTemplate(t);
    const updated = savePrintSettings({ template: t });
    setSettings(updated);
  }

  function updateLogoSize(size: LogoSize) {
    const updated = savePrintSettings({ logoSize: size });
    setSettings(updated);
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Document print preview"
      className="fixed inset-0 z-50 flex flex-col bg-slate-900/80 backdrop-blur-sm overflow-hidden"
    >
      {/* Top action toolbar (hidden on print) */}
      <div className="print-hide flex flex-wrap items-center justify-between gap-3 px-4 py-3 bg-gray-900 text-white border-b border-gray-800 shadow-md">
        <div className="flex items-center gap-2">
          <span className="font-bold text-sm tracking-wide">
            Print Preview: <span className="text-blue-400 font-mono">{data.number ?? "Draft"}</span>
          </span>
          {data.isReprint && (
            <span className="px-2 py-0.5 text-[10px] font-bold bg-amber-500 text-black rounded uppercase">
              Reprint
            </span>
          )}
        </div>

        {/* Template format selector */}
        <div className="flex items-center gap-1 bg-gray-800 p-1 rounded-md text-xs">
          <span className="text-gray-400 px-2 font-medium">Format:</span>
          <button
            type="button"
            className={`px-3 py-1 rounded transition font-medium ${
              currentTemplate === "a4"
                ? "bg-blue-600 text-white shadow-sm"
                : "text-gray-300 hover:text-white hover:bg-gray-700"
            }`}
            onClick={() => updateTemplate("a4")}
          >
            A4 Full Page
          </button>
          <button
            type="button"
            className={`px-3 py-1 rounded transition font-medium ${
              currentTemplate === "80mm"
                ? "bg-blue-600 text-white shadow-sm"
                : "text-gray-300 hover:text-white hover:bg-gray-700"
            }`}
            onClick={() => updateTemplate("80mm")}
          >
            80mm Thermal (POS)
          </button>
          <button
            type="button"
            className={`px-3 py-1 rounded transition font-medium ${
              currentTemplate === "58mm"
                ? "bg-blue-600 text-white shadow-sm"
                : "text-gray-300 hover:text-white hover:bg-gray-700"
            }`}
            onClick={() => updateTemplate("58mm")}
          >
            58mm Compact
          </button>
        </div>

        {/* Logo toggle */}
        <div className="hidden sm:flex items-center gap-1 bg-gray-800 p-1 rounded-md text-xs">
          <span className="text-gray-400 px-1 font-medium">Logo:</span>
          {(["none", "sm", "md", "lg"] as LogoSize[]).map((sz) => (
            <button
              key={sz}
              type="button"
              className={`px-2 py-1 rounded capitalize font-medium ${
                settings.logoSize === sz
                  ? "bg-blue-600 text-white shadow-sm"
                  : "text-gray-300 hover:text-white hover:bg-gray-700"
              }`}
              onClick={() => updateLogoSize(sz)}
            >
              {sz}
            </button>
          ))}
        </div>

        {/* Primary actions */}
        <div className="flex items-center gap-2">
          <Button
            type="button"
            onClick={() => window.print()}
            className="btn-primary flex items-center gap-1.5 text-xs py-1.5 px-4 shadow font-bold"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z"
              />
            </svg>
            <span>Print saved receipt</span>
          </Button>
          <Button
            type="button"
            onClick={onClose}
            className="btn-secondary text-xs py-1.5 px-3"
            aria-label="Close print preview"
          >
            Close
          </Button>
        </div>
      </div>

      {/* Main scrollable preview canvas */}
      <div className="flex-1 overflow-auto p-4 sm:p-8 flex justify-center items-start print:p-0 print:overflow-visible">
        <div className="printable-document-container w-full max-w-full">
          {currentTemplate === "a4" && (
            <A4InvoiceTemplate data={data} settings={settings} />
          )}
          {currentTemplate === "80mm" && (
            <Thermal80mmTemplate data={data} settings={settings} />
          )}
          {currentTemplate === "58mm" && (
            <Thermal58mmTemplate data={data} settings={settings} />
          )}
        </div>
      </div>
    </div>
  );
}
