// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

export interface Env extends Cloudflare.Env {
	POLICY_AUD: string;
	TEAM_DOMAIN: string;
	/** Comma-separated list of domains, e.g. "example.com,example.org". */
	DOMAINS?: string;
	/** Optional allowlist of addresses: a JSON array or a comma-separated string. */
	EMAIL_ADDRESSES?: string | string[];
}
