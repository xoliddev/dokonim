/**
 * Reviews (Amazon/WB pattern): average + histogram, filters (stars, with photos), verified-buyer reviews with
 * pros/cons, photos, owner reply and a "helpful" vote; paged with a cursor. Plus the product Q&A.
 */
import { useState } from 'react';
import { useApi, useQuery } from '../../api';
import { useI18n } from '../lib/i18n';
import { Button, Chip, Icon, Input, Skeleton, toast } from '../../ui';
import { Stars } from '../components/Stars';
import type { QuestionItem, ReviewItem } from '../lib/types';

export function Reviews({ slug, productId, avg, count, histogram, withPhotos }: { slug: string; productId: string; avg: number; count: number; histogram: Array<{ rating: number; count: number }>; withPhotos: number }) {
  const { t, relativeDay } = useI18n();
  const { api } = useApi();
  const [rating, setRating] = useState<number | null>(null);
  const [media, setMedia] = useState(false);
  const [extra, setExtra] = useState<{ key: string; items: ReviewItem[]; cursor: string | null }>({ key: '', items: [], cursor: null });
  const [votes, setVotes] = useState<Record<string, { voted: boolean; n: number }>>({});
  const input = { slug, productId, rating, withMedia: media || undefined, sort: 'helpful' as const };
  const key = JSON.stringify(input);
  const q = useQuery('store.reviews', input, { staleMs: 60_000 });
  const more = extra.key === key ? extra : { key, items: [], cursor: null };
  const items = [...((q.data?.items ?? []) as unknown as ReviewItem[]), ...more.items];
  const cursor = more.items.length ? more.cursor : (q.data?.nextCursor ?? null);
  const max = Math.max(1, ...histogram.map((h) => h.count));

  const loadMore = async () => {
    if (!cursor) return;
    const page = await api['store.reviews']({ ...input, cursor });
    setExtra({ key, items: [...more.items, ...(page.items as unknown as ReviewItem[])], cursor: page.nextCursor });
  };
  const vote = async (r: ReviewItem) => {
    const cur = votes[r.id] ?? { voted: r.voted, n: r.helpfulCount };
    setVotes((v) => ({ ...v, [r.id]: { voted: !cur.voted, n: cur.n + (cur.voted ? -1 : 1) } }));
    try {
      await api['reviews.helpful']({ slug, reviewId: r.id });
    } catch {
      setVotes((v) => ({ ...v, [r.id]: cur }));
    }
  };

  return (
    <section className="st-sec st-reviews" id="reviews">
      <h2 className="st-sec-title">
        {t('store.reviewsTitle')} <span className="muted">{count}</span>
      </h2>
      {count === 0 ? (
        <p className="muted" style={{ margin: 0 }}>{t('store.noReviews')}</p>
      ) : (
        <>
          <div className="st-card st-rsum">
            <div className="st-rsum-avg">
              <span className="price">{avg.toFixed(1)}</span>
              <Stars value={avg} size={14} />
              <span className="muted">{t('common.reviews', { n: count })}</span>
            </div>
            <div className="st-rsum-bars">
              {histogram.map((h) => (
                <button key={h.rating} type="button" className={`st-rbar${rating === h.rating ? ' is-on' : ''}`} onClick={() => setRating(rating === h.rating ? null : h.rating)} disabled={!h.count}>
                  <span>{h.rating}</span>
                  <span className="st-rbar-track">
                    <span style={{ transform: `scaleX(${h.count / max})` }} />
                  </span>
                  <span className="muted">{h.count}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="st-chips">
            <Chip selected={!rating && !media} onClick={() => (setRating(null), setMedia(false))}>
              {t('store.allStars')}
            </Chip>
            {withPhotos > 0 && (
              <Chip selected={media} onClick={() => setMedia(!media)}>
                {t('store.withPhotos')} <span className="st-fcount">{withPhotos}</span>
              </Chip>
            )}
            {[5, 4, 3, 2, 1].map((r) => (
              <Chip key={r} selected={rating === r} onClick={() => setRating(rating === r ? null : r)} icon={<Icon name="star" size={14} filled />}>
                {r}
              </Chip>
            ))}
          </div>
          {q.loading && !q.data ? (
            <Skeleton h={90} radius="var(--r-card)" />
          ) : (
            <div className="st-rlist">
              {items.map((r) => {
                const v = votes[r.id] ?? { voted: r.voted, n: r.helpfulCount };
                return (
                  <article key={r.id} className="st-review">
                    <header>
                      <b>{r.authorName}</b>
                      <span className="muted">{relativeDay(r.createdAt)}</span>
                    </header>
                    <div className="st-row" style={{ gap: 8 }}>
                      <Stars value={r.rating} size={13} />
                      {r.variantTitle && <span className="muted st-review-variant">{r.variantTitle}</span>}
                    </div>
                    {r.text && <p>{r.text}</p>}
                    {r.pros && (
                      <p>
                        <b>{t('store.pros')}:</b> {r.pros}
                      </p>
                    )}
                    {r.cons && (
                      <p>
                        <b>{t('store.cons')}:</b> {r.cons}
                      </p>
                    )}
                    {r.photos?.length > 0 && (
                      <div className="st-review-photos">
                        {r.photos.map((p, i) => (
                          <img key={i} src={p} alt="" loading="lazy" />
                        ))}
                      </div>
                    )}
                    {r.ownerReply && (
                      <div className="st-review-reply">
                        <b>{t('store.ownerReply')}</b>
                        <p>{r.ownerReply}</p>
                      </div>
                    )}
                    <button type="button" className={`st-helpful${v.voted ? ' is-on' : ''}`} aria-pressed={v.voted} onClick={() => vote(r)}>
                      <Icon name="check" size={16} /> {t('store.helpful', { n: v.n })}
                    </button>
                  </article>
                );
              })}
            </div>
          )}
          {cursor && (
            <Button variant="secondary" block onClick={loadMore}>
              {t('common.showMore')}
            </Button>
          )}
        </>
      )}
    </section>
  );
}

export function Questions({ slug, productId, count }: { slug: string; productId: string; count: number }) {
  const { t, relativeDay } = useI18n();
  const { api } = useApi();
  const q = useQuery('store.questions', { slug, productId }, { staleMs: 60_000 });
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const items = (q.data ?? []) as unknown as QuestionItem[];
  const ask = async () => {
    setBusy(true);
    setErr(null);
    try {
      await api['questions.ask']({ slug, productId, text });
      setText('');
      toast.success(t('store.questionSent'));
      q.reload();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="st-sec">
      <h2 className="st-sec-title">{t('store.questions', { n: Math.max(count, items.length) })}</h2>
      {items.slice(0, 3).map((x) => (
        <div key={x.id} className="st-qa">
          <p className="st-qa-q">
            <b>{x.authorName}</b> <span className="muted">· {relativeDay(x.createdAt)}</span>
            <br />
            {x.text}
          </p>
          {x.answers.map((a) => (
            <p key={a.id} className="st-qa-a">
              <b>{a.isOfficial ? t('store.ownerReply') : a.authorName}</b>
              <br />
              {a.text}
            </p>
          ))}
        </div>
      ))}
      <form
        className="st-qa-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim().length >= 5) ask();
        }}
      >
        <Input value={text} onChange={(e) => setText(e.target.value)} placeholder={t('store.askPlaceholder')} aria-label={t('store.askQuestion')} error={err} maxLength={1000} />
        <Button type="submit" variant="secondary" loading={busy} disabled={text.trim().length < 5}>
          {t('store.askQuestion')}
        </Button>
      </form>
    </section>
  );
}
