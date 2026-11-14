/** Product photos: the first is the cover (morphs from the list), add from the art set or upload, reorder, remove. */
import { useRef, useState } from 'react';
import { AnimatePresence, m } from 'motion/react';
import type { MessageKey } from '@dokonim/i18n';
import { useI18n } from '../../../i18n';
import { MorphMedia, spring } from '../../../motion';
import { haptic } from '../../../telegram/shim';
import { Button, Sheet, toast } from '../../../ui';
import { SIcon } from '../../components/SIcon';
import { ART_COLORS, ART_KINDS, ART_PATTERNS, artImage, type ArtPattern } from '../../lib/art';
import { fileToDataUrl } from '../../lib/ctx';

const MAX = 15;

export function MediaEditor({ productId, media, onChange }: { productId: string | null; media: Array<{ url: string }>; onChange: (m: Array<{ url: string }>) => void }) {
  const { t } = useI18n();
  const file = useRef<HTMLInputElement>(null);
  const [art, setArt] = useState(false);
  const add = (urls: string[]) => {
    const next = [...media, ...urls.map((url) => ({ url }))];
    if (next.length > MAX) toast.error(t('seller.mediaLimit'));
    onChange(next.slice(0, MAX));
  };
  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    try {
      add(await Promise.all([...files].slice(0, MAX).map((f) => fileToDataUrl(f))));
      haptic.notify('success');
    } catch {
      toast.error(t('common.errorGeneric'));
    }
  };
  const move = (i: number, to: number) => {
    const next = [...media];
    const [x] = next.splice(i, 1);
    next.splice(to, 0, x!);
    haptic.selection();
    onChange(next);
  };
  return (
    <div className="me">
      <div className="me-grid">
        <AnimatePresence initial={false}>
          {media.map((md, i) => (
            <m.div key={`${md.url.length}:${md.url.slice(-48)}:${media.slice(0, i).filter((x) => x.url === md.url).length}`} layout className={`me-tile${i === 0 ? ' is-cover' : ''}`} initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.8 }} transition={spring.snappy}>
              {i === 0 && productId ? <MorphMedia id={productId} src={md.url} alt="" className="me-img" radius={12} priority /> : <img className="me-img" src={md.url} alt="" />}
              {i === 0 && <span className="me-badge">{t('seller.mediaCover')}</span>}
              <div className="me-tools">
                {i > 0 && (
                  <button type="button" aria-label={t('seller.mediaMakeCover')} onClick={() => move(i, 0)}>
                    <SIcon name="star" size={14} />
                  </button>
                )}
                <button type="button" aria-label={t('common.delete')} onClick={() => onChange(media.filter((_, k) => k !== i))}>
                  <SIcon name="close" size={14} />
                </button>
              </div>
            </m.div>
          ))}
        </AnimatePresence>
        {media.length < MAX && (
          <div className="me-add">
            <button type="button" onClick={() => setArt(true)}>
              <SIcon name="sparkle" size={20} />
              <span>{t('seller.mediaArt')}</span>
            </button>
            <button type="button" onClick={() => file.current?.click()}>
              <SIcon name="upload" size={20} />
              <span>{t('seller.mediaUpload')}</span>
            </button>
          </div>
        )}
      </div>
      <input ref={file} type="file" accept="image/*" multiple hidden onChange={(e) => { void onFiles(e.target.files); e.target.value = ''; }} />
      <ArtSheet open={art} onClose={() => setArt(false)} onPick={(url) => { add([url]); setArt(false); }} />
    </div>
  );
}

function ArtSheet({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (url: string) => void }) {
  const { t } = useI18n();
  const [color, setColor] = useState(ART_COLORS[0]!);
  const [pattern, setPattern] = useState<ArtPattern>('ikat');
  return (
    <Sheet open={open} onClose={onClose} title={t('seller.artTitle')} footer={<Button variant="secondary" block onClick={onClose}>{t('common.close')}</Button>}>
      <div className="art">
        <div className="art-row" role="radiogroup" aria-label={t('seller.artColor')}>
          {ART_COLORS.map((c) => (
            <button key={c} type="button" role="radio" aria-checked={c === color} aria-label={c} className={`art-sw${c === color ? ' is-on' : ''}`} style={{ background: c }} onClick={() => { haptic.selection(); setColor(c); }} />
          ))}
        </div>
        <div className="art-row" role="radiogroup" aria-label={t('seller.artPattern')}>
          {ART_PATTERNS.map((p) => (
            <button key={p} type="button" role="radio" aria-checked={p === pattern} className={`chip${p === pattern ? ' is-selected' : ''}`} onClick={() => setPattern(p)}>
              {t(`seller.pattern_${p}` as MessageKey)}
            </button>
          ))}
        </div>
        {open && (
          <div className="art-grid">
            {ART_KINDS.map((k) => {
              const url = artImage(k, color, pattern);
              return (
                <button key={k} type="button" className="art-pick" aria-label={k} onClick={() => { haptic.impact('light'); onPick(url); }}>
                  <img src={url} alt="" loading="lazy" />
                </button>
              );
            })}
          </div>
        )}
      </div>
    </Sheet>
  );
}
