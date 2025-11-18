import React, { createContext, useContext, useState } from 'react';
import type { ChecklistItem, PhotoData } from '../services/vehicles';

interface InspectionContextType {
  formData: any;
  setFormData: (data: any) => void;
  checklistItems: ChecklistItem[];
  setChecklistItems: (items: ChecklistItem[]) => void;
  photos: PhotoData[];
  setPhotos: (photos: PhotoData[]) => void;
  resetInspection: () => void;
}

const InspectionContext = createContext<InspectionContextType | undefined>(undefined);

export const InspectionProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [formData, setFormData] = useState<any>({});
  const [checklistItems, setChecklistItems] = useState<ChecklistItem[]>([]);
  const [photos, setPhotos] = useState<PhotoData[]>([]);

  const resetInspection = () => {
    setFormData({});
    setChecklistItems([]);
    setPhotos([]);
  };

  return (
    <InspectionContext.Provider
      value={{
        formData,
        setFormData,
        checklistItems,
        setChecklistItems,
        photos,
        setPhotos,
        resetInspection,
      }}
    >
      {children}
    </InspectionContext.Provider>
  );
};

export const useInspection = () => {
  const context = useContext(InspectionContext);
  if (context === undefined) {
    throw new Error('useInspection must be used within an InspectionProvider');
  }
  return context;
};