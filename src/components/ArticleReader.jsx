import { useEffect, useRef } from "preact/hooks";

export function ArticleReader({ article, onClose, onPrev, onNext }) {
  useEffect(() => {
    // Prevent background scroll while reader is open
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, []);

  const scrollRef = useRef(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = 0;
    }
  }, [article]);

  const touchStartX = useRef(null);
  const touchStartY = useRef(null);

  function handleTouchStart(e) {
    e.stopPropagation();
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
  }

  function handleTouchEnd(e) {
    e.stopPropagation();
    if (touchStartX.current === null) return;

    const deltaX = e.changedTouches[0].clientX - touchStartX.current;
    const deltaY = e.changedTouches[0].clientY - touchStartY.current;
    const threshold = 50;

    if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > threshold) {
      if (deltaX < 0) {
        onNext && onNext(); // swiped left → next article
      } else {
        onPrev && onPrev(); // swiped right → previous article
      }
    }

    touchStartX.current = null;
    touchStartY.current = null;
  }

  if (!article) return null;

  const openExternal = () => {
    window.open(article.link, "_blank", "noopener,noreferrer");
    onClose && onClose();
  };

  let rootSite = "";
  try {
    rootSite = new URL(article.link).hostname.replace(/^www\./, "");
  } catch {
    rootSite = "";
  }

  let formattedDate = "";
  if (article.pubDate) {
    const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(article.pubDate);
    const parsed = new Date(article.pubDate);
    if (!Number.isNaN(parsed.getTime())) {
      formattedDate = isDateOnly
        ? parsed.toLocaleDateString(undefined, {
            year: "numeric",
            month: "short",
            day: "numeric",
            timeZone: "UTC", // date-only string has no real time — don't let local TZ shift the calendar day
          })
        : parsed.toLocaleString(undefined, {
            dateStyle: "medium",
            timeStyle: "short",
          });
    }
  }

  return (
    <div
      class="article-reader"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      ref={scrollRef}
    >
<div class="article-reader-header">
  <button
    class="article-reader-icon-btn"
    onClick={onClose}
    aria-label="Close"
  >
    ✕
  </button>
  <div class="article-reader-header-meta">
    {rootSite && <span class="article-reader-domain">{rootSite}</span>}
    {formattedDate && <span class="article-reader-date">{formattedDate}</span>}
  </div>
  <button
    class="article-reader-icon-btn"
    onClick={openExternal}
    aria-label="Open in browser"
  >
    ↗
  </button>
</div>
      <div class="article-reader-content">
        <h1>{article.title}</h1>
        {article.source && (
          <div class="article-reader-source">{article.source}</div>
        )}
        <div class="article-reader-body">
          {article.excerpt
            .split(/\n\s*\n/)
            .map((para, i) => (para.trim() ? <p key={i}>{para}</p> : null))}
        </div>
      </div>
    </div>
  );
}
