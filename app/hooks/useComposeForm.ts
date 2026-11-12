// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { useKumoToastManager } from "@cloudflare/kumo";
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
	buildQuotedReplyBlock,
	escapeHtml,
	formatComposeDate,
	getSignatureBlock,
	htmlToPlainText,
	splitEmailList,
	stripHtml,
	toEmailListValue,
} from "~/lib/utils";
import { useDeleteEmail, useForwardEmail, useReplyToEmail, useSaveDraft, useSendEmail } from "~/queries/emails";
import { useMailbox } from "~/queries/mailboxes";
import { useUIStore } from "~/hooks/useUIStore";
import {
	type ComposeAttachment,
	checkLimits,
	fromFile,
	fromStoredEmail,
	limitError,
	toPayload,
} from "~/lib/compose-attachments";
import { base64ToBytes } from "shared/attachments";

function appendUniqueAddress(
	addresses: string[],
	seen: Set<string>,
	address: string,
	exclude?: string,
) {
	const trimmed = address.trim();
	if (!trimmed) return;

	const normalized = trimmed.toLowerCase();
	if (normalized === exclude || seen.has(normalized)) return;

	seen.add(normalized);
	addresses.push(trimmed);
}

interface ComposeFormFields {
	to: string;
	cc: string;
	bcc: string;
	showCcBcc: boolean;
	subject: string;
	body: string;
	attachments: ComposeAttachment[];
}

const EMPTY_FIELDS: ComposeFormFields = {
	to: "",
	cc: "",
	bcc: "",
	showCcBcc: false,
	subject: "",
	body: "",
	attachments: [],
};

function getPrefixedSubject(subject: string, prefix: "Re" | "Fwd") {
	const expectedPrefix = `${prefix}: `;
	return subject.startsWith(expectedPrefix)
		? subject
		: `${expectedPrefix}${subject}`;
}

/**
 * True when the text the user wrote (not the quoted/forwarded part)
 * mentions an attachment. Used for the "forgot to attach?" prompt.
 */
export function mentionsAttachment(html: string): boolean {
	const cut = html.search(/<blockquote|Forwarded message:/i);
	const own = htmlToPlainText(cut >= 0 ? html.slice(0, cut) : html);
	return /\b(attach(ed|ing|ment|ments)?|enclosed)\b/i.test(own);
}

function buildForwardBody(
	original: NonNullable<ReturnType<typeof useUIStore.getState>["composeOptions"]["originalEmail"]>,
	sigBlock: string,
) {
	const safeSender = escapeHtml(original.sender);
	const safeSubject = escapeHtml(original.subject);
	const safeBody = escapeHtml(stripHtml(original.body || "")).replace(/\n/g, "<br>");

	return `<p><br></p>${sigBlock ? `${sigBlock}<br>` : ""}<div style="border: 1px solid #ddd; padding: 1em; background-color: #f9f9f9; margin: 1em 0;"><strong>Forwarded message:</strong><br><strong>From:</strong> ${safeSender}<br><strong>Date:</strong> ${formatComposeDate(original.date)}<br><strong>Subject:</strong> ${safeSubject}<br><br>${safeBody}</div>`;
}

function buildReplyAllFields(
	original: NonNullable<ReturnType<typeof useUIStore.getState>["composeOptions"]["originalEmail"]>,
	selfAddress?: string,
) {
	const toRecipients: string[] = [];
	const toSeen = new Set<string>();
	appendUniqueAddress(toRecipients, toSeen, original.sender, selfAddress);

	for (const recipient of splitEmailList(original.recipient)) {
		appendUniqueAddress(toRecipients, toSeen, recipient, selfAddress);
	}

	const ccRecipients: string[] = [];
	const ccSeen = new Set<string>();
	for (const recipient of splitEmailList(original.cc)) {
		const normalized = recipient.toLowerCase();
		if (
			normalized === selfAddress ||
			toSeen.has(normalized) ||
			ccSeen.has(normalized)
		) {
			continue;
		}
		ccSeen.add(normalized);
		ccRecipients.push(recipient);
	}

	return {
		to: toRecipients.join(", "),
		cc: ccRecipients.join(", "),
		showCcBcc: ccRecipients.length > 0,
	};
}

function buildInitialComposeFields(
	composeOptions: ReturnType<typeof useUIStore.getState>["composeOptions"],
	mailboxEmail: string | undefined,
	sigBlock: string,
): ComposeFormFields {
	const { draftEmail: draft, originalEmail: original, mode } = composeOptions;

	if (draft) {
		return {
			to: draft.recipient || "",
			cc: draft.cc || "",
			bcc: draft.bcc || "",
			showCcBcc: Boolean(draft.cc || draft.bcc),
			subject: draft.subject || "",
			body: draft.body || "",
			attachments: fromStoredEmail(draft.id, draft.attachments),
		};
	}

	if (!original) {
		return {
			...EMPTY_FIELDS,
			body: sigBlock ? `<p><br></p>${sigBlock}` : "",
		};
	}

	if (mode === "reply") {
		return {
			...EMPTY_FIELDS,
			to: original.sender,
			subject: getPrefixedSubject(original.subject, "Re"),
			body: `<p><br></p>${sigBlock ? `${sigBlock}<br>` : ""}${buildQuotedReplyBlock(original.date, original.sender, original.body || "")}`,
		};
	}

	if (mode === "reply-all") {
		const recipients = buildReplyAllFields(original, mailboxEmail?.toLowerCase());
		return {
			...EMPTY_FIELDS,
			...recipients,
			subject: getPrefixedSubject(original.subject, "Re"),
			body: `<p><br></p>${sigBlock ? `${sigBlock}<br>` : ""}${buildQuotedReplyBlock(original.date, original.sender, original.body || "")}`,
		};
	}

	if (mode === "forward") {
		return {
			...EMPTY_FIELDS,
			subject: getPrefixedSubject(original.subject, "Fwd"),
			body: buildForwardBody(original, sigBlock),
			// Like other mail clients, forwarding carries the original's files.
			attachments: fromStoredEmail(original.id, original.attachments),
		};
	}

	return {
		...EMPTY_FIELDS,
		body: sigBlock ? `<p><br></p>${sigBlock}` : "",
	};
}

export function useComposeForm(mailboxId?: string, _folder?: string) {
	const toastManager = useKumoToastManager();
	const { composeOptions, closePanel, closeCompose } = useUIStore();
	const { data: currentMailbox } = useMailbox(mailboxId);
	const sendEmailMutation = useSendEmail();
	const saveDraftMutation = useSaveDraft();
	const replyMutation = useReplyToEmail();
	const forwardMutation = useForwardEmail();
	const deleteEmailMutation = useDeleteEmail();

	const [to, setTo] = useState("");
	const [cc, setCc] = useState("");
	const [bcc, setBcc] = useState("");
	const [showCcBcc, setShowCcBcc] = useState(false);
	const [subject, setSubject] = useState("");
	const [body, setBody] = useState("");
	const [attachments, setAttachmentsState] = useState<ComposeAttachment[]>([]);
	const attachmentsRef = useRef<ComposeAttachment[]>([]);
	const setAttachments = (next: ComposeAttachment[] | ((prev: ComposeAttachment[]) => ComposeAttachment[])) => {
		const value = typeof next === "function" ? next(attachmentsRef.current) : next;
		attachmentsRef.current = value;
		setAttachmentsState(value);
	};
	// Id of the draft this form last saved to; changes on every save.
	const [savedDraftId, setSavedDraftId] = useState<string | undefined>(undefined);
	const [error, setError] = useState<string | null>(null);
	const [isSavingDraft, setIsSavingDraft] = useState(false);
	const [isSending, setIsSending] = useState(false);
	// Synchronous lock: state updates land too late to stop rapid double clicks.
	const busyRef = useRef(false);
	const lastInitializedOptionsRef = useRef<typeof composeOptions | null>(null);
	const isDraftEdit = !!composeOptions.draftEmail;

	const formTitle = useMemo(() => {
		if (isDraftEdit) return "Edit Draft";
		switch (composeOptions.mode) { case "reply": return "Reply"; case "reply-all": return "Reply All"; case "forward": return "Forward"; default: return "New Message"; }
	}, [composeOptions.mode, isDraftEdit]);

	const sigBlock = useMemo(() => getSignatureBlock(currentMailbox?.settings), [currentMailbox]);

	useEffect(() => {
		if (lastInitializedOptionsRef.current === composeOptions) return;
		lastInitializedOptionsRef.current = composeOptions;

		const initialFields = buildInitialComposeFields(
			composeOptions,
			currentMailbox?.email,
			sigBlock,
		);
		setError(null);
		setTo(initialFields.to);
		setCc(initialFields.cc);
		setBcc(initialFields.bcc);
		setShowCcBcc(initialFields.showCcBcc);
		setSubject(initialFields.subject);
		setBody(initialFields.body);
		setAttachments(initialFields.attachments);
		setSavedDraftId(composeOptions.draftEmail?.id || undefined);
	}, [composeOptions, currentMailbox?.email, sigBlock]);

	const addFiles = (files: FileList | File[]) => {
		const list = Array.from(files);
		if (list.length === 0) return;
		// Read the latest list from a ref so two quick adds can't both pass
		// the limit check, and keep side effects out of the state updater.
		const { accepted, error: limitError } = checkLimits(attachmentsRef.current, list);
		if (limitError) {
			setError(limitError);
			toastManager.add({ title: limitError, variant: "error" });
		}
		if (accepted.length) setAttachments((current) => [...current, ...accepted.map(fromFile)]);
	};

	const removeAttachment = (key: string) => {
		setAttachments((current) => current.filter((a) => a.key !== key));
	};

	/**
	 * Server-stored attachments belong to the email they were fetched from.
	 * After a draft is re-saved that email is gone, so keep the bytes we
	 * already loaded as local files instead.
	 */
	const localizeAttachments = (sent: ComposeAttachment[], payload: Awaited<ReturnType<typeof toPayload>>) => {
		const contentByKey = new Map(sent.map((att, i) => [att.key, payload[i]?.content]));
		setAttachments((current) => current.map((att) => {
			const content = contentByKey.get(att.key);
			if (att.source.kind === "file" || !content) return att;
			const bytes = base64ToBytes(content);
			const file = new File([bytes], att.filename, { type: att.type });
			return { ...att, source: { kind: "file", file } };
		}));
	};

	const handleSaveDraft = async () => {
		if (!mailboxId || busyRef.current) return;
		const overLimit = limitError(attachmentsRef.current);
		if (overLimit) { setError(overLimit); return; }
		busyRef.current = true;
		setIsSavingDraft(true); setError(null);
		// If the user moves on to another message while this save is in
		// flight, its result must not leak into the new compose session.
		const session = composeOptions;
		try {
			const sentAttachments = attachmentsRef.current;
			const attachmentPayload = await toPayload(mailboxId, sentAttachments);
			const saved = await saveDraftMutation.mutateAsync({ mailboxId, draft: {
				to,
				cc: cc || undefined,
				bcc: bcc || undefined,
				subject,
				body,
				in_reply_to: composeOptions.originalEmail?.id || composeOptions.draftEmail?.in_reply_to || undefined,
				thread_id: composeOptions.originalEmail?.thread_id || composeOptions.draftEmail?.thread_id || undefined,
				draft_id: savedDraftId,
				attachments: attachmentPayload.length ? attachmentPayload : undefined,
			} });
			if (lastInitializedOptionsRef.current === session) {
				setSavedDraftId(saved?.id);
				localizeAttachments(sentAttachments, attachmentPayload);
			}
			toastManager.add({ title: "Draft saved!" });
		}
		catch (err: unknown) {
			const message = (err instanceof Error ? err.message : null) || "Failed to save draft.";
			setError(message);
			toastManager.add({ title: message, variant: "error" });
		}
		finally { busyRef.current = false; setIsSavingDraft(false); }
	};

	const handleSend = async (e: FormEvent, onClose: () => void) => {
		e.preventDefault(); if (busyRef.current) return; setError(null);
		if (!currentMailbox || !mailboxId) { setError("No mailbox selected."); return; }
		const toRecipients = splitEmailList(to);
		if (toRecipients.length === 0) { setError("Add at least one recipient."); return; }
		const overLimit = limitError(attachments);
		if (overLimit) { setError(overLimit); return; }
		if (attachments.length === 0 && mentionsAttachment(body)
			&& !window.confirm("Your message mentions an attachment, but no files are attached. Send anyway?")) return;
		const ccRecipients = splitEmailList(cc); const bccRecipients = splitEmailList(bcc);
		const fromName = currentMailbox.settings?.fromName || currentMailbox.name;
		const from = fromName && fromName !== currentMailbox.email ? { email: currentMailbox.email, name: fromName } : currentMailbox.email;
		const emailData: Record<string, unknown> = {
			to: toEmailListValue(toRecipients),
			cc: toEmailListValue(ccRecipients),
			bcc: toEmailListValue(bccRecipients),
			from,
			subject,
			html: body,
			text: htmlToPlainText(body),
		};
		const draftId = savedDraftId; const mode = composeOptions.mode; const originalId = composeOptions.originalEmail?.id || composeOptions.draftEmail?.in_reply_to;
		busyRef.current = true;
		setIsSending(true); toastManager.add({ title: "Sending email..." });
		try {
			if (attachments.length > 0) emailData.attachments = await toPayload(mailboxId, attachments);
			if ((mode === "reply" || mode === "reply-all") && originalId) await replyMutation.mutateAsync({ mailboxId, emailId: originalId, email: emailData });
			else if (mode === "forward" && originalId) await forwardMutation.mutateAsync({ mailboxId, emailId: originalId, email: emailData });
			else await sendEmailMutation.mutateAsync({ mailboxId, email: emailData });
			if (draftId) deleteEmailMutation.mutate({ mailboxId, id: draftId });
			toastManager.add({ title: "Email sent!" });
			onClose();
		} catch (err: unknown) { const message = (err instanceof Error ? err.message : null) || "Failed to send email."; setError(message); toastManager.add({ title: message, variant: "error" }); }
		finally { busyRef.current = false; setIsSending(false); }
	};

	return { to, setTo, cc, setCc, bcc, setBcc, showCcBcc, setShowCcBcc, subject, setSubject, body, setBody, attachments, addFiles, removeAttachment, error, setError, isSavingDraft, isSending, formTitle, handleSaveDraft, handleSend, closeCompose, closePanel };
}
