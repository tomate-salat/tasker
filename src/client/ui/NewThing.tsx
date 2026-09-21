import { useEffect, useRef, useState } from 'react';

/**
 * Ein Knopf, der sich beim Klick in ein Eingabefeld verwandelt: Enter legt an,
 * Escape bricht ab. Dieselbe Bedienung für Projekte, Milestones und Gruppen –
 * mehr Dialog braucht es für einen Namen nicht.
 */
export function NewThing({
  label,
  placeholder,
  onCreate,
  className = 'btn',
  startOpen = false,
}: {
  label: string;
  placeholder: string;
  onCreate: (name: string) => void | Promise<void>;
  className?: string;
  startOpen?: boolean;
}) {
  const [open, setOpen] = useState(startOpen);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  const committing = useRef(false);

  useEffect(() => {
    if (open) ref.current?.focus();
  }, [open]);

  if (!open) {
    return (
      <button className={className} onClick={() => setOpen(true)}>
        {label}
      </button>
    );
  }

  const commit = async (value: string): Promise<void> => {
    // Enter sperrt das Feld, das gesperrte Feld verliert den Fokus, und der Blur
    // käme mit demselben Namen ein zweites Mal hier an.
    if (committing.current) return;
    const name = value.trim();
    if (!name) {
      setOpen(false);
      return;
    }
    committing.current = true;
    setBusy(true);
    try {
      await onCreate(name);
    } finally {
      committing.current = false;
      setBusy(false);
      setOpen(false);
    }
  };

  return (
    <input
      ref={ref}
      className="new-thing"
      placeholder={placeholder}
      disabled={busy}
      onBlur={(e) => void commit(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          void commit(e.currentTarget.value);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          e.currentTarget.value = '';
          setOpen(false);
        }
      }}
    />
  );
}
