import type { Env } from "../types";

/**
 * Whether the AI agent (side panel, auto-drafts and the /mcp endpoint) is on.
 * Controlled by the AGENT_ENABLED var; anything other than "false"/"0"/"off"
 * (including unset) keeps it enabled.
 */
export function isAgentEnabled(env: Env): boolean {
	const raw = (env as { AGENT_ENABLED?: unknown }).AGENT_ENABLED;
	if (raw === undefined || raw === null || raw === "") return true;
	if (typeof raw === "boolean") return raw;
	return !["false", "0", "off", "no"].includes(String(raw).trim().toLowerCase());
}

/** Domains configured in the DOMAINS var, lower-cased. */
export function getConfiguredDomains(env: Env): string[] {
	return String(env.DOMAINS || "")
		.split(",")
		.map((d) => d.trim().toLowerCase())
		.filter(Boolean);
}

/** Addresses configured in the EMAIL_ADDRESSES var, lower-cased. */
export function getConfiguredAddresses(env: Env): string[] {
	let raw: unknown = env.EMAIL_ADDRESSES ?? [];
	if (typeof raw === "string") {
		const text = raw;
		try {
			raw = JSON.parse(text);
		} catch {
			raw = text.split(",");
		}
	}
	const list = Array.isArray(raw) ? raw : [raw];
	return list.map((a) => String(a).trim().toLowerCase()).filter(Boolean);
}

/** Domain part of an address, lower-cased ("" when there is none). */
export function domainOf(address: string): string {
	const at = address.lastIndexOf("@");
	return at === -1 ? "" : address.slice(at + 1).toLowerCase();
}

/**
 * Whether an address belongs to one of the configured domains.
 * When DOMAINS is empty every domain is accepted.
 */
export function isConfiguredDomain(env: Env, address: string): boolean {
	const domains = getConfiguredDomains(env);
	if (domains.length === 0) return true;
	return domains.includes(domainOf(address));
}
