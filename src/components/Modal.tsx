import React, { useEffect, useId, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { AsyncButton, useAction } from '../actions';

const focusable =
  'summary, button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const { busy } = useAction();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const triggerRef = useRef(
    document.activeElement instanceof HTMLElement ? document.activeElement : null,
  );
  const dirty = useRef(false);
  const [discardPrompt, setDiscardPrompt] = useState(false);
  const requestClose = () => {
    if (dirty.current) setDiscardPrompt(true);
    else closeRef.current();
  };

  // Restore only when the dialog actually unmounts, after the action gate releases.
  useEffect(() => {
    const dialog = dialogRef.current;
    return () => {
      requestAnimationFrame(() => {
        if (dialog?.isConnected) return;
        const trigger = triggerRef.current;
        if (
          trigger !== document.body &&
          trigger?.isConnected &&
          trigger.getClientRects().length &&
          !trigger.matches(':disabled') &&
          !trigger.closest('[inert]')
        ) {
          trigger.focus();
        } else {
          const heading = document.querySelector<HTMLElement>('.app main h1');
          if (heading) {
            const previousTabIndex = heading.getAttribute('tabindex');
            heading.setAttribute('tabindex', '-1');
            heading.addEventListener(
              'blur',
              () => {
                if (previousTabIndex === null) heading.removeAttribute('tabindex');
                else heading.setAttribute('tabindex', previousTabIndex);
              },
              { once: true },
            );
            heading.focus();
          }
        }
      });
    };
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || busy) return;
    if (!discardPrompt && dialog.contains(document.activeElement)) return;
    const target = Array.from(
      dialog.querySelectorAll<HTMLElement>(
        discardPrompt ? '.discard-prompt button' : 'input, select, textarea, button',
      ),
    ).find(
      (node) =>
        node.getClientRects().length > 0 && !node.matches(':disabled') && !node.closest('[inert]'),
    );
    (target ?? dialog).focus();
  }, [busy, discardPrompt]);

  useEffect(() => {
    const dialog = dialogRef.current;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        if (discardPrompt) setDiscardPrompt(false);
        else requestClose();
        return;
      }
      if (event.key !== 'Tab' || !dialog) return;
      const nodes = Array.from(dialog.querySelectorAll<HTMLElement>(focusable)).filter(
        (node) =>
          node.getClientRects().length > 0 &&
          !node.matches(':disabled') &&
          !node.closest('[inert]'),
      );
      if (!nodes.length) {
        event.preventDefault();
        return;
      }
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
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
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [discardPrompt]);

  return (
    <div
      className="backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) requestClose();
      }}
    >
      <div
        ref={dialogRef}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onChangeCapture={() => {
          dirty.current = true;
        }}
      >
        <div className="modal-head" inert={discardPrompt || undefined}>
          <h2 id={titleId}>{title}</h2>
          <AsyncButton
            className="icon-btn"
            aria-label="关闭对话框"
            title="关闭"
            onClick={requestClose}
          >
            <X />
          </AsyncButton>
        </div>
        <div inert={discardPrompt || undefined}>{children}</div>
        {discardPrompt && (
          <div className="discard-prompt" role="alertdialog" aria-label="放弃未保存的修改">
            <p>当前内容尚未保存。确定放弃修改并关闭吗？</p>
            <div className="page-actions">
              <AsyncButton className="outline" onClick={() => setDiscardPrompt(false)}>
                继续填写
              </AsyncButton>
              <AsyncButton className="danger" onClick={onClose}>
                放弃修改
              </AsyncButton>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
