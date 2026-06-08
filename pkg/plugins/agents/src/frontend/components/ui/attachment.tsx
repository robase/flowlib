/**
 * Attachment UI shells.
 *
 * The agent backend does not currently accept file attachments. These
 * components render the assistant-ui composer/message attachment primitives
 * so the UI surface matches a real chat app — but submitting attachments
 * will only work once the backend pipeline is wired through.
 *
 * `ComposerPrimitive.AddAttachment` is an action button that auto-hides
 * when the runtime has no attachment adapter, so this is safe to mount
 * unconditionally.
 */
import * as React from 'react';
import { AttachmentPrimitive, ComposerPrimitive, MessagePrimitive } from '@assistant-ui/react';
import { PaperclipIcon, XIcon } from 'lucide-react';
import { TooltipIconButton } from './tooltip-icon-button';
import { cn } from '../../lib/cn';

function AttachmentChip({ removable }: { removable: boolean }): React.ReactElement {
  return (
    <AttachmentPrimitive.Root
      className={cn(
        'group relative flex items-center gap-2 rounded-md border border-border bg-card px-2 py-1 text-xs',
        'max-w-[12rem] min-w-0',
      )}
    >
      <PaperclipIcon className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="truncate text-foreground">
        <AttachmentPrimitive.Name />
      </span>
      {removable ? (
        <AttachmentPrimitive.Remove asChild>
          <button
            type="button"
            aria-label="Remove attachment"
            className="shrink-0 text-muted-foreground hover:text-foreground"
          >
            <XIcon className="size-3.5" />
          </button>
        </AttachmentPrimitive.Remove>
      ) : null}
    </AttachmentPrimitive.Root>
  );
}

export function ComposerAttachments(): React.ReactElement {
  return (
    <div className="flex flex-wrap gap-1.5 px-3 pb-1.5 empty:hidden">
      <ComposerPrimitive.Attachments>
        {() => <AttachmentChip removable />}
      </ComposerPrimitive.Attachments>
    </div>
  );
}

export function ComposerAddAttachment(): React.ReactElement {
  return (
    <ComposerPrimitive.AddAttachment asChild>
      <TooltipIconButton tooltip="Attach file" variant="ghost" size="sm" className="rounded-full">
        <PaperclipIcon className="size-4" />
      </TooltipIconButton>
    </ComposerPrimitive.AddAttachment>
  );
}

export function UserMessageAttachments(): React.ReactElement {
  return (
    <div className="col-start-2 flex flex-wrap justify-end gap-1.5 empty:hidden">
      <MessagePrimitive.Attachments>
        {() => <AttachmentChip removable={false} />}
      </MessagePrimitive.Attachments>
    </div>
  );
}
