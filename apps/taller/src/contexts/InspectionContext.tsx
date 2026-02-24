import React, { createContext, useContext, useState, useEffect } from 'react';
import type { ChecklistItem, PhotoData } from '../services/vehicles';

const STORAGE_KEY = 'taller-inspection-draft';

export interface SectionTimes {
  [sectionId: string]: number; // tiempo en segundos
}

export enum InspectionStatus {
  GOOD = 'GOOD',
  REGULAR = 'REGULAR',
  BAD = 'BAD',
  NA = 'NA',
  // Backward compatibility keys
  OK = 'OK',
  LEGACY_BAD = 'LEGACY_BAD'
}

export interface Inspection360Item {
  category: string;
  item: string;
  status: InspectionStatus | 'ok' | 'bad' | 'na' | 'bueno' | 'regular' | 'malo' | 'GOOD' | 'REGULAR' | 'BAD' | 'NA' | 'OK' | 'LEGACY_BAD';
  notes?: string;
  metadata?: Record<string, any>;
}

interface InspectionContextType {
  formData: any;
  setFormData: (data: any) => void;
  checklistItems: ChecklistItem[];
  setChecklistItems: (items: ChecklistItem[]) => void;
  items360: Inspection360Item[];
  setItems360: (items: Inspection360Item[]) => void;
  photos: PhotoData[];
  setPhotos: (photos: PhotoData[]) => void;
  sectionTimes: SectionTimes;
  setSectionTimes: (times: SectionTimes | ((prev: SectionTimes) => SectionTimes)) => void;
  rejectionEvidenceUrl?: string;
  setRejectionEvidenceUrl: (url: string | undefined) => void;
  currentStep: number;
  setCurrentStep: (step: number) => void;
  resetInspection: () => void;
}

interface StoredData {
  formData: any;
  checklistItems: ChecklistItem[];
  items360: Inspection360Item[];
  photos: PhotoData[];
  sectionTimes: SectionTimes;
  rejectionEvidenceUrl?: string; // Add to stored data
  currentStep: number;
  savedAt: string;
}

// Serializar datos para localStorage (excluir File objects)
const serializeForStorage = (
  formData: any,
  checklistItems: ChecklistItem[],
  items360: Inspection360Item[],
  photos: PhotoData[],
  sectionTimes: SectionTimes,
  rejectionEvidenceUrl: string | undefined, // Add arg
  currentStep: number
): StoredData => {
  return {
    formData: {
      ...formData,
      scannerResult: undefined, // File no se puede serializar
      inspectionDate: formData?.inspectionDate?.toISOString?.() || formData?.inspectionDate,
    },
    checklistItems,
    items360,
    photos: photos.map(p => ({
      category: p.category,
      photoType: p.photoType,
      title: p.title,
      description: p.description,
      url: p.url,
      valuatorComment: p.valuatorComment,
      noCommentsChecked: p.noCommentsChecked,
    })),
    sectionTimes,
    rejectionEvidenceUrl,
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
    items360: stored.items360 || [],
    photos: stored.photos || [],
    sectionTimes: stored.sectionTimes || {},
    rejectionEvidenceUrl: stored.rejectionEvidenceUrl,
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
  return { formData: {}, checklistItems: [], items360: [], photos: [], sectionTimes: {}, rejectionEvidenceUrl: undefined, currentStep: 0 };
};

const InspectionContext = createContext<InspectionContextType | undefined>(undefined);

export const InspectionProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // Cargar datos guardados al inicializar
  const initialData = loadSavedData();

  const [formData, setFormData] = useState<any>(initialData.formData);
  const [checklistItems, setChecklistItems] = useState<ChecklistItem[]>(initialData.checklistItems);
  const [items360, setItems360] = useState<Inspection360Item[]>(initialData.items360 || []);
  const [photos, setPhotos] = useState<PhotoData[]>(initialData.photos);
  const [sectionTimes, setSectionTimes] = useState<SectionTimes>(initialData.sectionTimes);
  const [rejectionEvidenceUrl, setRejectionEvidenceUrl] = useState<string | undefined>(initialData.rejectionEvidenceUrl);
  const [currentStep, setCurrentStep] = useState<number>(initialData.currentStep);

  // Guardar automáticamente cuando cambian los datos
  useEffect(() => {
    const dataToSave = serializeForStorage(formData, checklistItems, items360, photos, sectionTimes, rejectionEvidenceUrl, currentStep);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(dataToSave));
    } catch (e) {
      console.error('Error saving inspection draft:', e);
    }
  }, [formData, checklistItems, items360, photos, sectionTimes, rejectionEvidenceUrl, currentStep]);

  const resetInspection = () => {
    setFormData({});
    setChecklistItems([]);
    setItems360([]);
    setPhotos([]);
    setSectionTimes({});
    setRejectionEvidenceUrl(undefined);
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
        items360,
        setItems360,
        photos,
        setPhotos,
        sectionTimes,
        setSectionTimes,
        rejectionEvidenceUrl,
        setRejectionEvidenceUrl,
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
