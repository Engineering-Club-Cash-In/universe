import { create } from "zustand";
import { type Opportunity } from "../services";

interface ProfileState {
  opportunities: Opportunity[];
  setOpportunities: (opps: Opportunity[]) => void;
  clearProfile: () => void;
}

export const useStoreProfile = create<ProfileState>((set) => ({
  opportunities: [],
  setOpportunities: (opps) => set({ opportunities: opps }),
  clearProfile: () => set({ opportunities: [] }),
}));
