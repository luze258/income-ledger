import React, { createContext, useContext, useRef, useState } from 'react';
import { useFeedback } from './feedback';

export function createActionGate() {
  let locked = false;
  return async (action: () => unknown, onBusy: (value: boolean) => void = () => {}) => {
    if (locked) return;
    locked = true;
    onBusy(true);
    try {
      await action();
    } finally {
      locked = false;
      onBusy(false);
    }
  };
}

const Actions = createContext({ busy: false, run: async (_action: () => unknown) => {} });

export const useAction = () => useContext(Actions);

export function ActionProvider({ children }: { children: React.ReactNode }) {
  const [busy, setBusy] = useState(false);
  const gate = useRef(createActionGate());
  const { notify } = useFeedback();
  async function run(action: () => unknown) {
    try {
      await gate.current(action, setBusy);
    } catch (error) {
      notify(`操作失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return (
    <Actions.Provider value={{ busy, run }}>
      <fieldset className="action-scope" disabled={busy}>
        {children}
      </fieldset>
      {busy && (
        <div className="working-notice" role="status" aria-live="polite">
          正在处理，请稍候…
        </div>
      )}
    </Actions.Provider>
  );
}

export function AsyncButton({
  onClick,
  disabled,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const { busy, run } = useAction();
  return (
    <button
      {...props}
      disabled={disabled || busy}
      onClick={(event) => {
        if (!onClick) return;
        event.preventDefault();
        void run(() => onClick?.(event));
      }}
    />
  );
}
