import { useQuery } from '@tanstack/react-query';
import { apiService } from '../../services/api';

export const useServiceItemBundle = (id: number | null, enabled: boolean = true) => {
    return useQuery({
        queryKey: id !== null ? ['settings', 'service-item', id] : ['settings', 'service-item', 'new'],
        queryFn: async () => {
            if (id === null) throw new Error('ID is required for fetching bundle');
            return apiService.getServiceItemBundle(id);
        },
        enabled: enabled && id !== null,
        staleTime: 1000 * 60 * 5, // 5 minutes
    });
};


