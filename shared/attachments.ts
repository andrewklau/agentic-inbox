// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Outgoing attachment limits, shared by the compose UI and the API.
 *
 * Cloudflare Email Service caps a message at 25 MiB including attachments
 * and at 32 attachments. Attachments are base64-encoded on the wire
 * (~4/3 expansion plus line breaks), so the raw-byte budget is kept well
 * under 25 MiB to leave room for encoding, headers and the HTML body.
 */
export const MAX_ATTACHMENTS = 32;
export const MAX_TOTAL_ATTACHMENT_BYTES = 18 * 1024 * 1024;

/** Fallback MIME type when the browser can't determine one. */
export const DEFAULT_ATTACHMENT_TYPE = "application/octet-stream";

/** Strip characters that could break a MIME header or a storage key. */
export function sanitizeAttachmentFilename(name: string): string {
	const cleaned = (name || "").replace(/[\x00-\x1f\x7f]/g, "").trim();
	return cleaned || "untitled";
}

/** Exact decoded byte length of a base64 string, without decoding it. */
export function base64DecodedLength(b64: string): number {
	const len = b64.length;
	if (len === 0) return 0;
	const padding = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
	return Math.floor((len * 3) / 4) - padding;
}
