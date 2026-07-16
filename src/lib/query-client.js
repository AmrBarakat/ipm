import { QueryClient } from '@tanstack/react-query';


export const queryClientInstance = new QueryClient({
	defaultOptions: {
	queries: {
		staleTime: 60_000,
		refetchOnWindowFocus: true,
		retry: 1,
	},
	},
});