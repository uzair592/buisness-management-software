import { createContext, useContext, useState, type ReactNode } from "react";
import { addQuantities, validQuantity } from "@business/domain";
import {
  sampleItems,
  sampleParties,
  sampleTransactions,
  type ItemId,
  type SampleLine,
} from "./fixtures";
function usePreviewState() {
  const [sample, setSample] = useState(false);
  const [cart, setCart] = useState<SampleLine[]>([]);
  const [customer, setCustomer] = useState("walk-in");
  function reset(enabled: boolean) {
    setCart([]);
    setCustomer("walk-in");
    setSample(enabled);
  }
  return {
    sample,
    cart,
    customer,
    items: sample ? sampleItems : [],
    parties: sample ? sampleParties : [],
    transactions: sample ? sampleTransactions : [],
    enter: () => reset(true),
    exit: () => reset(false),
    selectCustomer: (id: string) => {
      if (
        sample &&
        sampleParties.some((p) => p.id === id && p.type === "Customer")
      )
        setCustomer(id);
    },
    addItem: (itemId: ItemId) => {
      if (!sample) return;
      setCart((lines) => {
        const found = lines.find((l) => l.itemId === itemId);
        return found
          ? lines.map((l) =>
              l.itemId === itemId && validQuantity(l.quantity)
                ? { ...l, quantity: addQuantities(l.quantity, "1") }
                : l,
            )
          : [...lines, { itemId, quantity: "1" }];
      });
    },
    setQuantity: (itemId: ItemId, quantity: string) => {
      if (sample)
        setCart((lines) =>
          lines.map((l) => (l.itemId === itemId ? { ...l, quantity } : l)),
        );
    },
    removeItem: (itemId: ItemId) => {
      if (sample) setCart((lines) => lines.filter((l) => l.itemId !== itemId));
    },
    clear: () => {
      if (sample) setCart([]);
    },
  };
}
type PreviewState = ReturnType<typeof usePreviewState>;
const PreviewContext = createContext<PreviewState | null>(null);
// No storage, API client, tenant record or posting dependency belongs here.
export function PreviewProvider({ children }: { children: ReactNode }) {
  return (
    <PreviewContext.Provider value={usePreviewState()}>
      {children}
    </PreviewContext.Provider>
  );
}
export function usePreview() {
  const state = useContext(PreviewContext);
  if (!state) throw new Error("PreviewProvider required");
  return state;
}
