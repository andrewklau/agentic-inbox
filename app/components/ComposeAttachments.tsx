// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Button } from "@cloudflare/kumo";
import { FileIcon, ImageIcon, PaperclipIcon, XIcon } from "@phosphor-icons/react";
import { type DragEvent, useRef, useState } from "react";
import { MAX_TOTAL_ATTACHMENT_BYTES } from "shared/attachments";
import type { ComposeAttachment } from "~/lib/compose-attachments";
import { formatBytes } from "~/lib/utils";

function hasFiles(e: DragEvent) {
	return Array.from(e.dataTransfer?.types ?? []).includes("Files");
}

/**
 * Drag-and-drop handlers for the whole compose form. Files dropped anywhere
 * on it (including the editor) are attached rather than opened by the browser.
 */
export function useAttachmentDrop(onFiles: (files: File[]) => void, disabled = false) {
	const [isDragging, setIsDragging] = useState(false);
	const depth = useRef(0);

	return {
		isDragging,
		dropHandlers: {
			onDragEnter: (e: DragEvent) => {
				if (!hasFiles(e)) return;
				e.preventDefault();
				depth.current += 1;
				setIsDragging(true);
			},
			onDragOver: (e: DragEvent) => {
				if (!hasFiles(e)) return;
				e.preventDefault();
				e.dataTransfer.dropEffect = disabled ? "none" : "copy";
			},
			onDragLeave: (e: DragEvent) => {
				if (!hasFiles(e)) return;
				depth.current = Math.max(0, depth.current - 1);
				if (depth.current === 0) setIsDragging(false);
			},
			onDrop: (e: DragEvent) => {
				if (!hasFiles(e)) return;
				e.preventDefault();
				e.stopPropagation();
				depth.current = 0;
				setIsDragging(false);
				if (!disabled) onFiles(Array.from(e.dataTransfer.files));
			},
		},
	};
}

export function DropOverlay() {
	return (
		<div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-md border-2 border-dashed border-kumo-brand bg-kumo-base/90">
			<div className="flex items-center gap-2 text-sm font-medium text-kumo-default">
				<PaperclipIcon size={18} />
				Drop files to attach
			</div>
		</div>
	);
}

export function AttachButton({ onFiles, disabled }: { onFiles: (files: File[]) => void; disabled?: boolean }) {
	const inputRef = useRef<HTMLInputElement>(null);
	return (
		<>
			<input
				ref={inputRef}
				type="file"
				multiple
				hidden
				data-testid="compose-attachment-input"
				onChange={(e) => {
					if (e.target.files) onFiles(Array.from(e.target.files));
					// Reset so picking the same file again still fires onChange.
					e.target.value = "";
				}}
			/>
			<Button
				type="button"
				variant="ghost"
				size="sm"
				disabled={disabled}
				icon={<PaperclipIcon size={14} />}
				onClick={() => inputRef.current?.click()}
				aria-label="Attach files"
			>
				Attach
			</Button>
		</>
	);
}

export function AttachmentChips({
	attachments,
	onRemove,
	disabled,
}: {
	attachments: ComposeAttachment[];
	onRemove: (key: string) => void;
	disabled?: boolean;
}) {
	if (attachments.length === 0) return null;
	const total = attachments.reduce((sum, a) => sum + a.size, 0);

	return (
		<div data-testid="compose-attachments">
			<div className="flex items-center gap-2 mb-2 text-xs text-kumo-subtle">
				<PaperclipIcon size={12} />
				<span>
					{attachments.length} attachment{attachments.length !== 1 ? "s" : ""} · {formatBytes(total)} of{" "}
					{formatBytes(MAX_TOTAL_ATTACHMENT_BYTES)}
				</span>
			</div>
			<ul className="flex flex-wrap gap-2">
				{attachments.map((att) => {
					const Icon = att.type.startsWith("image/") ? ImageIcon : FileIcon;
					return (
						<li
							key={att.key}
							className="flex items-center gap-2 rounded-md border border-kumo-line pl-3 pr-1 py-1 text-sm max-w-full"
						>
							<Icon size={16} className="text-kumo-subtle shrink-0" />
							<span className="text-kumo-default font-medium truncate max-w-[180px]" title={att.filename}>
								{att.filename}
							</span>
							<span className="text-kumo-subtle shrink-0">{formatBytes(att.size)}</span>
							<button
								type="button"
								onClick={() => onRemove(att.key)}
								disabled={disabled}
								className="shrink-0 rounded p-1 text-kumo-subtle hover:bg-kumo-tint hover:text-kumo-default disabled:opacity-50"
								aria-label={`Remove ${att.filename}`}
							>
								<XIcon size={14} />
							</button>
						</li>
					);
				})}
			</ul>
		</div>
	);
}
