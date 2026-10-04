import React, { createContext, useContext, useState } from 'react';

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
  const notify = (next: string) => {
    setMessage(next);
    window.setTimeout(() => setMessage((current) => (current === next ? null : current)), 4_000);
  };
  const confirm = (next: string, options?: { suppressible?: boolean; onSuppress?: () => void }) =>
    new Promise<boolean>((resolve) => {
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
      {children}
      {message && (
        <div className="toast" role="status" aria-live="polite">
          {message}
        </div>
      )}
      {confirmation && (
        <div className="confirm-backdrop" role="presentation">
          <div
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
              <button className="outline" autoFocus onClick={() => respond(false)}>
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
