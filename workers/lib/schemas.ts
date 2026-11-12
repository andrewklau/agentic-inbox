// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Shared types and Zod schemas for email data.
 *
 * Types (from email-types.ts): used by the agent, MCP server, and route
 * handlers to avoid `as any` casting.
 *
 * Zod schemas: used across route handlers to eliminate duplication.
 */
import { z } from "zod";
import {
	base64DecodedLength,
	DEFAULT_ATTACHMENT_TYPE,
	MAX_ATTACHMENTS,
	MAX_TOTAL_ATTACHMENT_BYTES,
	sanitizeAttachmentFilename,
} from "../../shared/attachments";

// ── TypeScript Interfaces ──────────────────────────────────────────

export interface EmailMetadata {
	id: string;
	subject: string;
	sender: string;
	recipient: string;
	cc?: string | null;
	bcc?: string | null;
	date: string;
	read: boolean;
	starred: boolean;
	in_reply_to?: string | null;
	email_references?: string | null;
	thread_id?: string | null;
	folder_id?: string | null;
	snippet?: string | null;
}

export interface EmailFull extends EmailMetadata {
	body?: string | null;
	message_id?: string | null;
	raw_headers?: string | null;
	attachments?: AttachmentInfo[];
}

export interface AttachmentInfo {
	id: string;
	filename: string;
	mimetype: string;
	size: number;
	content_id?: string | null;
	disposition?: string | null;
}

// ── Zod Schemas ────────────────────────────────────────────────────

const RecipientFieldSchema = z.union([
	z.string().email(),
	z.array(z.string().email()).min(1),
]);

export const ErrorResponseSchema = z.object({
	error: z.string(),
});

const BASE64_RE = /^[A-Za-z0-9+/]*={0,2}$/;

export const OutgoingAttachmentSchema = z.object({
	// Normalise MIME-wrapped (line-broken) and unpadded base64, then validate.
	content: z
		.string()
		.transform((v) => {
			const s = v.replace(/\s+/g, "");
			return s + "=".repeat((4 - (s.length % 4)) % 4);
		})
		.refine((v) => v.length % 4 === 0 && BASE64_RE.test(v), {
			message: "Attachment content must be valid base64",
		}),
	filename: z.string().transform(sanitizeAttachmentFilename),
	type: z
		.string()
		.optional()
		.transform((v) => v?.trim() || DEFAULT_ATTACHMENT_TYPE),
	disposition: z.enum(["attachment", "inline"]).default("attachment"),
	contentId: z.string().optional(),
});

export const OutgoingAttachmentsSchema = z
	.array(OutgoingAttachmentSchema)
	.max(MAX_ATTACHMENTS, `At most ${MAX_ATTACHMENTS} attachments are allowed`)
	.refine(
		(atts) => atts.reduce((sum, a) => sum + base64DecodedLength(a.content), 0) <= MAX_TOTAL_ATTACHMENT_BYTES,
		{ message: `Attachments exceed the ${MAX_TOTAL_ATTACHMENT_BYTES / (1024 * 1024)} MB total limit` },
	)
	.optional();

export const SendEmailRequestSchema = z
	.object({
		to: RecipientFieldSchema,
		cc: RecipientFieldSchema.optional(),
		bcc: RecipientFieldSchema.optional(),
		from: z.union([
			z.string().email(),
			z.object({ email: z.string().email(), name: z.string() }),
		]),
		subject: z.string(),
		html: z.string().optional(),
		text: z.string().optional(),
		attachments: OutgoingAttachmentsSchema,
		in_reply_to: z.string().optional(),
		references: z.array(z.string()).optional(),
		thread_id: z.string().optional(),
	})
	.refine((data) => data.html || data.text, {
		message: "Either 'html' or 'text' must be provided",
	});

export const SendEmailResponseSchema = z.object({
	id: z.string(),
	status: z.string(),
});
