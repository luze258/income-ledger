import React, { createContext, useContext, useEffect, useRef, useState } from 'react';

type Confirmation = {
  message: string;
  resolve: (accepted: boolean) => void;
  suppressible?: boolean;
  onSuppress?: () => void;
};
type Feedback = {
  notify: (message: string) => void;
  confirm: (
    message: string,
    options?: { suppressible?: boolean; onSuppress?: () => void },
  ) => Promise<boolean>;
};
const FeedbackContext = createContext<Feedback>({ notify: () => {}, confirm: async () => false });

export function FeedbackProvider({ children }: { children: React.ReactNode }) {
  const [message, setMessage] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [suppress, setSuppress] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!confirmation) return;
    const dialog = dialogRef.current;
    dialog?.querySelector<HTMLButtonElement>('button')?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        respond(false);
      }
      if (event.key !== 'Tab' || !dialog) return;
      const nodes = Array.from(
        dialog.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)'),
      );
      const first = nodes[0],
        last = nodes[nodes.length - 1];
      if (!first) {
        event.preventDefault();
        return;
      }
      if (!dialog.contains(document.activeElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      requestAnimationFrame(() => {
        const trigger = triggerRef.current;
        if (
          trigger?.isConnected &&
          trigger.getClientRects().length &&
          !trigger.matches(':disabled')
        )
          trigger.focus();
        else {
          const heading = document.querySelector<HTMLElement>('.app main h1');
          if (heading) {
            heading.setAttribute('tabindex', '-1');
            heading.addEventListener('blur', () => heading.removeAttribute('tabindex'), {
              once: true,
            });
            heading.focus();
          }
        }
      });
    };
  }, [confirmation]);
  const notify = (next: string) => {
    setMessage(next);
    window.setTimeout(() => setMessage((current) => (current === next ? null : current)), 4_000);
  };
  const confirm = (next: string, options?: { suppressible?: boolean; onSuppress?: () => void }) =>
    new Promise<boolean>((resolve) => {
      triggerRef.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setSuppress(false);
      setConfirmation({ message: next, resolve, ...options });
    });
  const respond = (accepted: boolean) => {
    if (accepted && suppress) confirmation?.onSuppress?.();
    confirmation?.resolve(accepted);
    setConfirmation(null);
  };
  return (
    <FeedbackContext.Provider value={{ notify, confirm }}>
      <div className="feedback-content" inert={Boolean(confirmation) || undefined}>
        {children}
      </div>
      {message && (
        <div className="toast" role="status" aria-live="polite">
          {message}
        </div>
      )}
      {confirmation && (
        <div className="confirm-backdrop" role="presentation">
          <div
            ref={dialogRef}
            className="confirm-dialog"
            role="alertdialog"
            aria-modal="true"
            aria-label="请确认操作"
          >
            <p>{confirmation.message}</p>
            {confirmation.suppressible && (
              <label className="confirm-suppress">
                <input
                  type="checkbox"
                  checked={suppress}
                  onChange={(event) => setSuppress(event.target.checked)}
                />
                不再提示，直接移入回收站
              </label>
            )}
            <div className="modal-actions">
              <button className="outline" onClick={() => respond(false)}>
                取消
              </button>
              <button className="danger" onClick={() => respond(true)}>
                确认
              </button>
            </div>
          </div>
        </div>
      )}
    </FeedbackContext.Provider>
  );
}

export const useFeedback = () => useContext(FeedbackContext);
