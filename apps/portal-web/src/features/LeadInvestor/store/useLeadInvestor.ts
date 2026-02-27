import { create } from "zustand";
import type { FormInvestorValues } from "../hooks/useFormInvestor";

interface LeadInvestorState {
  isSubmitted: boolean;
  leadData: FormInvestorValues | null;
  setSubmitted: (data: FormInvestorValues) => void;
  reset: () => void;
}

export const useLeadInvestor = create<LeadInvestorState>((set) => ({
  isSubmitted: false,
  leadData: null,
  setSubmitted: (data) => set({ isSubmitted: true, leadData: data }),
  reset: () => set({ isSubmitted: false, leadData: null }),
}));
