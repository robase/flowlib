/**
 * HumanInputCard — inline form rendered for a `human-input-request`
 * event. v1 supports a single freeform text response. The response is
 * delivered via `onRespond(value)` which `useChatStream` forwards as a
 * typed WebSocket message via `hilResponse(id, response)`.
 *
 * `blocking` events show a red "waiting" indicator; `blocking: false`
 * shows a softer "optional" hint — the agent continues either way.
 */
import * as React from 'react';
import type { HumanInputRequestEvent } from '../../shared/events';

export interface HumanInputCardProps {
  event: HumanInputRequestEvent;
  onRespond: (response: unknown) => void;
  /** Once submitted the form locks. */
  resolved?: boolean;
}

export const HumanInputCard: React.FC<HumanInputCardProps> = ({
  event,
  onRespond,
  resolved = false,
}) => {
  const [value, setValue] = React.useState('');
  const [submitted, setSubmitted] = React.useState(resolved);

  React.useEffect(() => {
    setSubmitted(resolved);
  }, [resolved]);

  const submit = () => {
    if (submitted) {
      return;
    }
    setSubmitted(true);
    onRespond(value);
  };

  return (
    <div
      className="rounded border border-fl-border bg-fl-card my-2 px-3 py-2"
      data-testid="human-input"
      data-blocking={event.blocking ? 'true' : 'false'}
    >
      <div className="flex items-center justify-between mb-1">
        <span className="text-sm font-medium text-fl-foreground">Agent needs input</span>
        <span
          className={`text-xs ${
            event.blocking ? 'text-fl-destructive' : 'text-fl-muted-foreground'
          }`}
        >
          {event.blocking ? 'blocking' : 'optional'}
        </span>
      </div>
      <p className="text-sm text-fl-muted-foreground whitespace-pre-wrap mb-2">{event.prompt}</p>
      <textarea
        className="w-full border border-fl-border rounded bg-fl-background text-fl-foreground p-2 text-sm font-sans focus:outline-none focus:ring-2 focus:ring-fl-ring resize-y"
        rows={2}
        value={value}
        disabled={submitted}
        aria-label="Response"
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            submit();
          }
        }}
      />
      <div className="flex justify-end mt-2">
        <button
          type="button"
          className="px-3 py-1 rounded bg-fl-primary text-fl-primary-foreground text-sm hover:bg-fl-primary/90 disabled:opacity-50"
          disabled={submitted}
          onClick={submit}
        >
          {submitted ? 'Sent' : 'Send'}
        </button>
      </div>
    </div>
  );
};

HumanInputCard.displayName = 'HumanInputCard';
