import { Link } from "react-router-dom";
import { useEffect, useRef, useState } from "react";

const formatNewsDate = (value) => {
    if (!value) {
        return "недавно";
    }

    return new Intl.DateTimeFormat("ru-RU", {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
    }).format(new Date(value));
};

export default function NewsCard({ news, isSeen = false, onSeen }) {
    const [isExpanded, setIsExpanded] = useState(false);
    const [isLongText, setIsLongText] = useState(false);
    const cardRef = useRef(null);
    const textRef = useRef(null);
    const displayText = news?.summary || "";
    const hasExpandableText = isLongText;

    useEffect(() => {
        const textNode = textRef.current;

        if (!displayText || !textNode) {
            return undefined;
        }

        const measureText = () => {
            const computedStyle = getComputedStyle(textNode);
            const lineHeight = parseFloat(computedStyle.lineHeight) || 22;
            const maxHeight = lineHeight * 7; // 7 строк
            const clone = textNode.cloneNode(true);

            clone.className = "text-container expanded";
            clone.style.position = "absolute";
            clone.style.visibility = "hidden";
            clone.style.pointerEvents = "none";
            clone.style.height = "auto";
            clone.style.width = `${textNode.clientWidth}px`;
            clone.style.left = "-9999px";
            textNode.parentElement.appendChild(clone);

            const isLong = clone.scrollHeight > maxHeight + 2;
            clone.remove();

            setIsLongText(isLong);
        };

        const frameId = window.requestAnimationFrame(measureText);
        const resizeObserver = new ResizeObserver(() => {
            window.requestAnimationFrame(measureText);
        });

        resizeObserver.observe(textNode);

        return () => {
            window.cancelAnimationFrame(frameId);
            resizeObserver.disconnect();
        };
    }, [displayText]);

    useEffect(() => {
        const cardNode = cardRef.current;

        if (!cardNode || isSeen || !news?.id || !onSeen) {
            return undefined;
        }

        let seenTimer = null;
        const observer = new IntersectionObserver(
            ([entry]) => {
                if (entry.isIntersecting && entry.intersectionRatio >= 0.55) {
                    seenTimer = window.setTimeout(() => onSeen(news.id), 900);
                    return;
                }

                if (seenTimer) {
                    window.clearTimeout(seenTimer);
                    seenTimer = null;
                }
            },
            {
                threshold: [0, 0.55, 1],
            }
        );

        observer.observe(cardNode);

        return () => {
            if (seenTimer) {
                window.clearTimeout(seenTimer);
            }

            observer.disconnect();
        };
    }, [isSeen, news?.id, onSeen]);

    return (
        <div ref={cardRef} className={`containerNewCard ${isSeen ? "is_seen_news" : "is_unseen_news"}`}>
            <div className="containerCardNews">
                <div className="upNews">
                    <a href={news?.url} target="_blank" rel="noreferrer" className='websiteLink'>
                        <h5>{news?.sourceSite || news?.sourceName || "Источник"}</h5>
                    </a>
                    <p style={{opacity: 0.5, fontSize: '13px' }}>{formatNewsDate(news?.publishedAt)}</p>
                </div>
                {news?.image ? (
                    <div className="bannerNewsImg">
                        <img
                            src={news.image}
                            alt={news.title}
                            onError={(event) => {
                                event.currentTarget.closest(".bannerNewsImg")?.classList.add("bannerNewsImg_hidden");
                            }}
                        />
                    </div>
                ) : null}
                <div className="newsTitleText">
                    <h3>{news?.title}</h3>
                </div>
                {displayText ? (
                    <div className="text-block">
                        <div className="text-wrapper">
                            <div
                                ref={textRef}
                                className={`text-container ${!isExpanded ? 'collapsed' : 'expanded'}`}
                            >
                                {displayText}
                            </div>
                        </div>
                        {hasExpandableText && (
                            <div className="news_text_actions">
                                <button
                                    type="button"
                                    onClick={() => setIsExpanded((value) => !value)}
                                    className="news_text_toggle"
                                    aria-expanded={isExpanded}
                                >
                                    {isExpanded ? "скрыть" : "ещё"}
                                </button>
                            </div>
                        )}
                    </div>
                ) : null}
                {news?.relatedAssets?.length ? (
                    <div className="coinlist">
                        {news.relatedAssets.map((asset) => (
                            <Link
                                key={`${news.id}-${asset.symbol}`}
                                to={`/app/market/coin-page?type=${asset.type}&symbol=${encodeURIComponent(asset.routeSymbol || asset.symbol)}`}
                            >
                                <div className="coinList">
                                    {asset.icon ? <img src={asset.icon} alt="" /> : null}
                                    <p>{asset.name}</p>
                                    <p style={{color: 'var(--green)'}}>{asset.symbol}</p>
                                </div>
                            </Link>
                        ))}
                    </div>
                ) : null}
            </div>
        </div>
    );
}
