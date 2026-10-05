/**
 * Messages tab: one input per message key, with the default as placeholder.
 */

import { Input } from "@cloudflare/kumo";

import type { FormMessages, MessageKey } from "../../core/types.js";
import { DEFAULT_MESSAGES, MESSAGE_GROUPS } from "../helpers.js";

export function MessagesTab({
	messages,
	onChange,
}: {
	messages: FormMessages;
	onChange: (key: MessageKey, value: string | undefined) => void;
}) {
	return (
		<div className="cfa-stack">
			<p className="cfa-help">
				Leave a message empty to use the default shown in the field. Messages are plain text; HTML is shown as typed.
			</p>
			{MESSAGE_GROUPS.map((group) => (
				<fieldset key={group.title} className="cfa-card cfa-stack">
					<legend>{group.title}</legend>
					<p className="cfa-help">{group.description}</p>
					{group.fields.map((field) => (
						<Input
							key={field.key}
							id={`cfa-message-${field.key}`}
							label={field.label}
							description={field.help}
							placeholder={DEFAULT_MESSAGES[field.key]}
							value={messages[field.key] ?? ""}
							onChange={(event) => onChange(field.key, event.target.value === "" ? undefined : event.target.value)}
						/>
					))}
				</fieldset>
			))}
		</div>
	);
}
