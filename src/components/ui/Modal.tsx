import { ReactNode } from 'react';
import { X } from 'lucide-react';

interface ModalProps {
  title: string;
  /** Optional icon rendered to the left of the title. */
  icon?: ReactNode;
  onClose: () => void;
  /** Set while an async action runs to keep the modal from being dismissed. */
  closeDisabled?: boolean;
  /** Tailwind width class for the dialog box (default `w-[520px]`). */
  widthClass?: string;
  /** Content of the bottom action bar; omitted → no footer row. */
  footer?: ReactNode;
  children: ReactNode;
}

/**
 * Generic overlay dialog: dimmed backdrop, header with title/close button,
 * scrollable body and an optional footer. Parents own their open/close state
 * and render the modal conditionally (`{open && <Modal ...>}`).
 */
export default function Modal({
  title,
  icon,
  onClose,
  closeDisabled = false,
  widthClass = 'w-[520px]',
  footer,
  children,
}: ModalProps) {
  const close = () => {
    if (!closeDisabled) onClose();
  };

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/55"
      onClick={close}
    >
      <div
        className={`${widthClass} max-h-[80vh] bg-forge-sidebar border border-forge-border rounded-md shadow-2xl flex flex-col`}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') close();
        }}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-forge-border">
          <div className="flex items-center gap-2">
            {icon}
            <h2 className="text-forge-text-strong text-sm font-medium">{title}</h2>
          </div>
          <button
            onClick={close}
            className="text-forge-text hover:text-forge-text-strong"
            title="Cerrar"
          >
            <X size={16} />
          </button>
        </div>

        <div className="p-4 overflow-y-auto space-y-4 sidebar-scroll">
          {children}
        </div>

        {footer && (
          <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-forge-border">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
