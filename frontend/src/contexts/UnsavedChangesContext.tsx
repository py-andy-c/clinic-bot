import React, { createContext, useContext, useState, ReactNode, useMemo, useCallback } from 'react';

interface UnsavedChangesContextType {
  hasUnsavedChanges: boolean;
  setHasUnsavedChanges: (hasChanges: boolean) => void;
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

  const updateHasUnsavedChanges = useCallback((hasChanges: boolean) => {
    setHasUnsavedChanges(hasChanges);
  }, []);

  const value = useMemo(() => ({
    hasUnsavedChanges,
    setHasUnsavedChanges: updateHasUnsavedChanges
  }), [hasUnsavedChanges, updateHasUnsavedChanges]);

  return (
    <UnsavedChangesContext.Provider value={value}>
      {children}
    </UnsavedChangesContext.Provider>
  );
};
