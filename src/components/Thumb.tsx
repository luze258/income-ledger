import { useEffect, useRef, useState } from 'react';
import { loadItemImage } from '../storage';
import type { Item } from '../types';

export function Thumb({ item, revision = 0 }: { item: Item; revision?: number }) {
  const frameRef = useRef<HTMLSpanElement>(null);
  const [source, setSource] = useState(item.imageData);
  useEffect(() => {
    setSource(item.imageData);
    if (item.imageData) return;
    let cancelled = false;
    const load = () =>
      loadItemImage(item.id)
        .then((image) => {
          if (!cancelled) setSource(image);
        })
        .catch(() => {});
    const frame = frameRef.current;
    if (!frame || !('IntersectionObserver' in window)) {
      load();
      return () => {
        cancelled = true;
      };
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          observer.disconnect();
          load();
        }
      },
      { rootMargin: '160px' },
    );
    observer.observe(frame);
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [item.id, item.imageData, revision]);

  return (
    <span ref={frameRef} className="thumb">
      {source ? (
        <img className="item-image" src={source} alt={`${item.name} 的商品图片`} loading="lazy" />
      ) : (
        <span className="item-dot" role="img" aria-label={`分类：${item.category}`}>
          {item.category[0] ?? '?'}
        </span>
      )}
    </span>
  );
}
