import { create } from "zustand";
import type { FormLeadsValues } from "../hooks/useForm";

interface LeadState {
  isSubmitted: boolean;
  leadData: FormLeadsValues | null;
  setSubmitted: (data: FormLeadsValues) => void;
  reset: () => void;
}

export const useLead = create<LeadState>((set) => ({
  isSubmitted: false,
  leadData: null,
  setSubmitted: (data) => set({ isSubmitted: true, leadData: data }),
  reset: () => set({ isSubmitted: false, leadData: null }),
}));
