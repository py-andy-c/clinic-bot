import React, { createContext, useContext, useState, ReactNode, useMemo, useCallback, useRef } from 'react';

interface UnsavedChangesContextType {
  hasUnsavedChanges: boolean;
  setHasUnsavedChanges: (hasChanges: boolean) => void;
  onSaveRef: React.MutableRefObject<(() => Promise<void>) | null>;
}

const UnsavedChangesContext = createContext<UnsavedChangesContextType | undefined>(undefined);

export const useUnsavedChanges = () => {
  const context = useContext(UnsavedChangesContext);
  if (context === undefined) {
    throw new Error('useUnsavedChanges must be used within an UnsavedChangesProvider');
  }
  return context;
};

interface UnsavedChangesProviderProps {
  children: ReactNode;
}

export const UnsavedChangesProvider: React.FC<UnsavedChangesProviderProps> = ({ children }) => {
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const onSaveRef = useRef<(() => Promise<void>) | null>(null);

  const updateHasUnsavedChanges = useCallback((hasChanges: boolean) => {
    setHasUnsavedChanges(hasChanges);
  }, []);

  const value = useMemo(() => ({
    hasUnsavedChanges,
    setHasUnsavedChanges: updateHasUnsavedChanges,
    onSaveRef
  }), [hasUnsavedChanges, updateHasUnsavedChanges]);

  return (
    <UnsavedChangesContext.Provider value={value}>
      {children}
    </UnsavedChangesContext.Provider>
  );
};
