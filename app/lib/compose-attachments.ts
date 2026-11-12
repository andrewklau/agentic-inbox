// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import {
	DEFAULT_ATTACHMENT_TYPE,
	MAX_ATTACHMENTS,
	MAX_TOTAL_ATTACHMENT_BYTES,
	sanitizeAttachmentFilename,
} from "shared/attachments";
import { formatBytes, getAttachmentUrl, getNonInlineAttachments } from "~/lib/utils";
import type { Attachment } from "~/types";

/**
 * An attachment in the compose form. Either a file the user picked, or a
 * file already stored on the server (forwarded original or a saved draft)
 * that is fetched only when the message is sent or saved.
 */
export interface ComposeAttachment {
	key: string;
	filename: string;
	type: string;
	size: number;
	source:
		| { kind: "file"; file: File }
		| { kind: "stored"; emailId: string; attachmentId: string };
}

/** Shape the API expects in the `attachments` array. */
export interface AttachmentPayload {
	content: string;
	filename: string;
	type: string;
	disposition: "attachment";
}

export function fromFile(file: File): ComposeAttachment {
	return {
		key: crypto.randomUUID(),
		filename: sanitizeAttachmentFilename(file.name),
		type: file.type || DEFAULT_ATTACHMENT_TYPE,
		size: file.size,
		source: { kind: "file", file },
	};
}

/** Regular (non-inline) attachments of a stored email, as compose items. */
export function fromStoredEmail(emailId: string, attachments?: Attachment[]): ComposeAttachment[] {
	return getNonInlineAttachments(attachments).map((att) => ({
		key: `${emailId}:${att.id}`,
		filename: att.filename,
		type: att.mimetype || DEFAULT_ATTACHMENT_TYPE,
		size: att.size,
		source: { kind: "stored", emailId, attachmentId: att.id },
	}));
}

/**
 * Validate adding `incoming` files on top of `current`. Returns the files
 * that fit and a message describing anything rejected.
 */
export function checkLimits(
	current: ComposeAttachment[],
	incoming: File[],
): { accepted: File[]; error: string | null } {
	const accepted: File[] = [];
	const problems: string[] = [];
	let count = current.length;
	let total = current.reduce((sum, a) => sum + a.size, 0);

	for (const file of incoming) {
		if (count >= MAX_ATTACHMENTS) {
			problems.push(`You can attach at most ${MAX_ATTACHMENTS} files.`);
			break;
		}
		if (file.size === 0) {
			problems.push(`"${file.name}" is empty and was not attached.`);
			continue;
		}
		if (total + file.size > MAX_TOTAL_ATTACHMENT_BYTES) {
			problems.push(
				`"${file.name}" (${formatBytes(file.size)}) would exceed the ${formatBytes(MAX_TOTAL_ATTACHMENT_BYTES)} attachment limit.`,
			);
			continue;
		}
		accepted.push(file);
		count += 1;
		total += file.size;
	}
	return { accepted, error: problems.length ? problems.join(" ") : null };
}

function blobToBase64(blob: Blob): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => {
			const result = reader.result as string;
			// data:<type>;base64,<payload>
			resolve(result.slice(result.indexOf(",") + 1));
		};
		reader.onerror = () => reject(reader.error ?? new Error("Failed to read file"));
		reader.readAsDataURL(blob);
	});
}

async function loadBlob(mailboxId: string, att: ComposeAttachment): Promise<Blob> {
	if (att.source.kind === "file") return att.source.file;
	// Fetch raw bytes directly: the JSON api client would try to parse
	// attachments served as application/json.
	const res = await fetch(getAttachmentUrl(mailboxId, att.source.emailId, att.source.attachmentId));
	if (!res.ok) throw new Error(`Could not load attachment "${att.filename}".`);
	return res.blob();
}

/** Read every attachment into the base64 payload the API accepts. */
export async function toPayload(
	mailboxId: string,
	attachments: ComposeAttachment[],
): Promise<AttachmentPayload[]> {
	return Promise.all(
		attachments.map(async (att) => ({
			content: await blobToBase64(await loadBlob(mailboxId, att)),
			filename: att.filename,
			type: att.type,
			disposition: "attachment" as const,
		})),
	);
}
