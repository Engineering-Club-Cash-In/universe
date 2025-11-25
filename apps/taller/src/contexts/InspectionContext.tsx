import React, { createContext, useContext, useState, useEffect } from 'react';
import type { ChecklistItem, PhotoData } from '../services/vehicles';

const STORAGE_KEY = 'taller-inspection-draft';

interface InspectionContextType {
  formData: any;
  setFormData: (data: any) => void;
  checklistItems: ChecklistItem[];
  setChecklistItems: (items: ChecklistItem[]) => void;
  photos: PhotoData[];
  setPhotos: (photos: PhotoData[]) => void;
  currentStep: number;
  setCurrentStep: (step: number) => void;
  resetInspection: () => void;
}

interface StoredData {
  formData: any;
  checklistItems: ChecklistItem[];
  photos: PhotoData[];
  currentStep: number;
  savedAt: string;
}

// Serializar datos para localStorage (excluir File objects)
const serializeForStorage = (
  formData: any,
  checklistItems: ChecklistItem[],
  photos: PhotoData[],
  currentStep: number
): StoredData => {
  return {
    formData: {
      ...formData,
      scannerResult: undefined, // File no se puede serializar
      inspectionDate: formData?.inspectionDate?.toISOString?.() || formData?.inspectionDate,
    },
    checklistItems,
    photos: photos.map(p => ({
      category: p.category,
      photoType: p.photoType,
      title: p.title,
      description: p.description,
      url: p.url,
      valuatorComment: p.valuatorComment,
      noCommentsChecked: p.noCommentsChecked,
    })),
    currentStep,
    savedAt: new Date().toISOString(),
  };
};

// Deserializar datos de localStorage
const deserializeFromStorage = (stored: StoredData) => {
  return {
    formData: {
      ...stored.formData,
      inspectionDate: stored.formData?.inspectionDate
        ? new Date(stored.formData.inspectionDate)
        : undefined,
    },
    checklistItems: stored.checklistItems || [],
    photos: stored.photos || [],
    currentStep: stored.currentStep || 0,
  };
};

// Cargar datos guardados de localStorage
const loadSavedData = () => {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      return deserializeFromStorage(parsed);
    }
  } catch (e) {
    console.error('Error loading saved inspection:', e);
  }
  return { formData: {}, checklistItems: [], photos: [], currentStep: 0 };
};

const InspectionContext = createContext<InspectionContextType | undefined>(undefined);

export const InspectionProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // Cargar datos guardados al inicializar
  const initialData = loadSavedData();

  const [formData, setFormData] = useState<any>(initialData.formData);
  const [checklistItems, setChecklistItems] = useState<ChecklistItem[]>(initialData.checklistItems);
  const [photos, setPhotos] = useState<PhotoData[]>(initialData.photos);
  const [currentStep, setCurrentStep] = useState<number>(initialData.currentStep);

  // Guardar automáticamente cuando cambian los datos
  useEffect(() => {
    const dataToSave = serializeForStorage(formData, checklistItems, photos, currentStep);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(dataToSave));
    } catch (e) {
      console.error('Error saving inspection draft:', e);
    }
  }, [formData, checklistItems, photos, currentStep]);

  const resetInspection = () => {
    setFormData({});
    setChecklistItems([]);
    setPhotos([]);
    setCurrentStep(0);
    localStorage.removeItem(STORAGE_KEY);
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
        currentStep,
        setCurrentStep,
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
