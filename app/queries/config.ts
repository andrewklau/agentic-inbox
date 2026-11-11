import { useQuery } from "@tanstack/react-query";
import api from "~/services/api";
import { queryKeys } from "./keys";

export function useAppConfig() {
	return useQuery({
		queryKey: queryKeys.config,
		queryFn: () => api.getConfig(),
		staleTime: Infinity, // config rarely changes
	});
}

/** True only once the server has confirmed the agent is enabled. */
export function useAgentEnabled(): boolean {
	const { data } = useAppConfig();
	return data?.agentEnabled === true;
}
