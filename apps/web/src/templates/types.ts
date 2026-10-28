export type TemplateFormat = "a4" | "80mm" | "58mm";
export type LogoSize = "none" | "sm" | "md" | "lg";

export interface PrintSettings {
  template: TemplateFormat;
  logoUrl: string;
  logoSize: LogoSize;
  businessNameOverride: string;
  businessPhone: string;
  businessAddress: string;
  taxNumber: string; // e.g. NTN, STRN, GST ID
  customTitle: string; // e.g. "TAX INVOICE", "SALES RECEIPT", "CASH MEMO"
  footerNotes: string;
  showTaxDetails: boolean;
  showSignature: boolean;
  showReprintWatermark: boolean;
}

export const DEFAULT_PRINT_SETTINGS: PrintSettings = {
  template: "a4",
  logoUrl: "",
  logoSize: "md",
  businessNameOverride: "",
  businessPhone: "+92 300 1234567",
  businessAddress: "Shop #12, Commercial Market, Main Road",
  taxNumber: "NTN: 1234567-8",
  customTitle: "TAX INVOICE",
  footerNotes: "Thank you for your business! Goods once sold can be exchanged within 7 days with original receipt.",
  showTaxDetails: true,
  showSignature: true,
  showReprintWatermark: true,
};

const STORAGE_KEY = "bms_print_settings";

export function loadPrintSettings(): PrintSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_PRINT_SETTINGS;
    return { ...DEFAULT_PRINT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_PRINT_SETTINGS;
  }
}

export function savePrintSettings(settings: Partial<PrintSettings>): PrintSettings {
  const current = loadPrintSettings();
  const updated = { ...current, ...settings };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    window.dispatchEvent(new Event("bms-print-settings-changed"));
  } catch {
    // Ignore storage quota errors
  }
  return updated;
}

export interface DocumentLineItem {
  name: string;
  unitName?: string;
  quantity: string;
  unitPrice: string;
  discount?: string;
  taxPercent?: string;
  taxMode?: string;
  taxAmount?: string;
  total: string;
}

export interface PrintableDocumentData {
  documentType: "Sale" | "Purchase";
  id: string;
  number: string | null;
  businessName: string;
  businessDate: string;
  issuedAt?: string;
  status: "Draft" | "Posted";
  isReprint?: boolean;
  customerOrSupplier: {
    name: string;
    phone?: string;
    address?: string;
    taxId?: string;
  };
  supplierReference?: string;
  duplicateRefReviewed?: boolean;
  lines: DocumentLineItem[];
  calculation: {
    base: string;
    tax: string;
    documentDiscount?: string;
    total: string;
  };
  payment: {
    total: string;
    paid: string;
    due: string;
    cashApplied?: string;
    bankApplied?: string;
    cashTendered?: string;
    change?: string;
    bankReference?: string | null;
    payments?: Array<{
      id: string;
      kind: string;
      applied: string;
      reference: string | null;
    }>;
  };
}

/**
 * Converts a numeric amount to English words (e.g. "Three Thousand Five Hundred PKR Only").
 */
export function amountInWords(amountStr: string): string {
  try {
    const num = Math.floor(Math.abs(parseFloat(amountStr)));
    if (isNaN(num) || num === 0) return "Zero PKR Only";

    const ones = [
      "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
      "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen",
      "Seventeen", "Eighteen", "Nineteen",
    ];
    const tens = [
      "", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety",
    ];

    function convertGroup(n: number): string {
      let str = "";
      if (n >= 100) {
        str += ones[Math.floor(n / 100)] + " Hundred ";
        n %= 100;
      }
      if (n >= 20) {
        str += tens[Math.floor(n / 10)] + " ";
        n %= 10;
      }
      if (n > 0) {
        str += ones[n] + " ";
      }
      return str.trim();
    }

    let result = "";
    if (num >= 10_000_000) {
      const crore = Math.floor(num / 10_000_000);
      result += convertGroup(crore) + " Crore ";
    }
    const remCrore = num % 10_000_000;
    if (remCrore >= 100_000) {
      const lakh = Math.floor(remCrore / 100_000);
      result += convertGroup(lakh) + " Lakh ";
    }
    const remLakh = remCrore % 100_000;
    if (remLakh >= 1000) {
      const thousand = Math.floor(remLakh / 1000);
      result += convertGroup(thousand) + " Thousand ";
    }
    const remThousand = remLakh % 1000;
    if (remThousand > 0) {
      result += convertGroup(remThousand);
    }

    return `${result.trim()} PKR Only`;
  } catch {
    return `${amountStr} PKR Only`;
  }
}
