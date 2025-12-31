import { UseFormReturn, Path } from 'react-hook-form';

/**
 * Maps FastAPI/Pydantic validation errors (422) to react-hook-form errors.
 * 
 * @param error The error object from axios
 * @param methods The react-hook-form methods object
 * @param options Configuration options
 */
export const handleBackendError = <T extends Record<string, unknown>>(
  error: unknown,
  methods: UseFormReturn<T>,
  options: {
    rootPath?: string;
    stripPrefix?: string;
  } = {}
) => {
  const { rootPath, stripPrefix } = options;

  if (typeof error === 'object' && error !== null && 'response' in error) {
    const axiosError = error as { response?: { status?: number; data?: { detail?: Array<{ loc?: (string | number)[]; msg?: string }> } } };
    if (axiosError.response?.status === 422 && Array.isArray(axiosError.response?.data?.detail)) {
      const details = axiosError.response.data.detail;
      let hasSetError = false;
      
      details.forEach((detail: { loc?: (string | number)[]; msg?: string }) => {
      if (Array.isArray(detail.loc)) {
        // FastAPI loc is usually ["body", "path", "to", "field"]
        // We want to map this to "path.to.field"
        
        // Skip "body" or "query" if present
        let locParts = detail.loc;
        if (locParts[0] === 'body' || locParts[0] === 'query') {
          locParts = locParts.slice(1);
        }

        // If a rootPath is provided and matches the start of the loc, use it as the base
        // If stripPrefix is provided and matches the start of the loc, remove it
        if (stripPrefix && locParts[0] === stripPrefix) {
          locParts = locParts.slice(1);
        }

        let fieldName = locParts.join('.');
        
        // If rootPath is provided, prepend it
        if (rootPath) {
          fieldName = `${rootPath}.${fieldName}`;
        }

        // Only set error if it's a valid path in our form
        // We use Path<T> type cast to satisfy RHF
        methods.setError(fieldName as Path<T>, {
          type: 'server',
          message: detail.msg || '輸入欄位有誤',
        });
        hasSetError = true;
      }
      });
      
      return hasSetError;
    }
  }
  
  return false;
};

