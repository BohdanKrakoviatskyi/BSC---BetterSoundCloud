import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Button, IconButton, usePresence } from './ui';
import { useStore } from '../lib/util';
import { t } from '../lib/i18n';
import { createPlaylist, deletePlaylist, library, renamePlaylist } from '../state/library';
import { go, ui, type Dialog, type Snack } from '../state/ui';

export function Drawer({ open, onClose, side, children }: { open: boolean; onClose: () => void; side: 'left' | 'right'; children: ReactNode }) {
  const { mounted, visible } = usePresence(open, 450);
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [open, onClose]);
  if (!mounted) return null;
  return createPortal(
    <div className="drawer-root" data-open={visible} data-side={side}>
      <div className="scrim" onClick={onClose} />
      <div className="drawer">{children}</div>
    </div>,
    document.body,
  );
}

const closeDialog = () => ui.set({ dialog: null });

function NameDialog({ d }: { d: Extract<Dialog, { kind: 'create' | 'rename' }> }) {
  const existing = useStore(library, (s) => (d.kind === 'rename' ? s.playlists.find((p) => p.id === d.id)?.name ?? '' : ''));
  const [name, setName] = useState(existing);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const tm = setTimeout(() => input.current?.select(), 60);
    return () => clearTimeout(tm);
  }, []);
  const submit = () => {
    if (d.kind === 'rename') renamePlaylist(d.id, name);
    else {
      const id = createPlaylist(name || t('newPlaylist'), d.trackId);
      if (!d.trackId) go({ name: 'playlist', id });
    }
    closeDialog();
  };
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <h2 className="headline mb-5 text-2xl">{d.kind === 'rename' ? t('rename') : t('newPlaylist')}</h2>
      <label className="field">
        <input ref={input} value={name} onChange={(e) => setName(e.target.value)} placeholder=" " maxLength={60} autoFocus />
        <span>{t('playlistName')}</span>
      </label>
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="text" onClick={closeDialog}>
          {t('cancel')}
        </Button>
        <Button type="submit" icon={d.kind === 'rename' ? 'check' : 'add'}>
          {d.kind === 'rename' ? t('save') : t('create')}
        </Button>
      </div>
    </form>
  );
}

function DeleteDialog({ id }: { id: string }) {
  const name = useStore(library, (s) => s.playlists.find((p) => p.id === id)?.name ?? '');
  return (
    <div>
      <h2 className="headline mb-3 text-2xl">{t('deletePlaylistQ')}</h2>
      <p className="text-on-surface-variant">{t('deletePlaylistText', { name })}</p>
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="text" onClick={closeDialog}>
          {t('cancel')}
        </Button>
        <Button
          icon="delete"
          className="!bg-error !text-[var(--md-on-error)]"
          onClick={() => {
            deletePlaylist(id);
            closeDialog();
          }}
        >
          {t('delete')}
        </Button>
      </div>
    </div>
  );
}

function DialogHost() {
  const d = useStore(ui, (s) => s.dialog);
  const [last, setLast] = useState<Dialog | null>(d);
  if (d && d !== last) setLast(d);
  const { mounted, visible } = usePresence(!!d, 320);
  useEffect(() => {
    if (!d) return;
    const k = (e: KeyboardEvent) => e.key === 'Escape' && closeDialog();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [d]);
  if (!mounted || !last) return null;
  return createPortal(
    <div className="dialog-root" data-open={visible}>
      <div className="scrim" onClick={closeDialog} />
      <div className="dialog" role="dialog" aria-modal="true">
        {last.kind === 'delete' ? <DeleteDialog id={last.id} /> : <NameDialog key={JSON.stringify(last)} d={last} />}
      </div>
    </div>,
    document.body,
  );
}

function SnackHost() {
  const s = useStore(ui, (x) => x.snack);
  const [last, setLast] = useState<Snack | null>(s);
  if (s && s !== last) setLast(s);
  const { mounted, visible } = usePresence(!!s, 320);
  useEffect(() => {
    if (!s) return;
    const tm = setTimeout(() => ui.set({ snack: null }), s.action ? 5000 : 3200);
    return () => clearTimeout(tm);
  }, [s]);
  if (!mounted || !last) return null;
  return createPortal(
    <div className="snackbar" data-open={visible} role="status">
      <span key={last.id} className="meta-in min-w-0 flex-1 py-2">
        {last.text}
      </span>
      {last.action && (
        <button
          type="button"
          data-ripple
          className="snack-action sl"
          onClick={() => {
            const run = last.action?.run;
            ui.set({ snack: null });
            run?.();
          }}
        >
          {last.action.label}
        </button>
      )}
      <IconButton icon="close" label={t('exitFullscreen')} size="sm" tip={false} onClick={() => ui.set({ snack: null })} />
    </div>,
    document.body,
  );
}

export function Overlays() {
  return (
    <>
      <DialogHost />
      <SnackHost />
    </>
  );
}
