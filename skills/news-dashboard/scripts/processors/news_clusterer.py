"""新闻聚类器 — 基于词频重叠的简单聚类"""

import logging
import re
from collections import Counter

logger = logging.getLogger(__name__)

STOP_WORDS = {
    "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
    "have", "has", "had", "do", "does", "did", "will", "would", "could",
    "should", "may", "might", "can", "shall", "to", "of", "in", "for",
    "on", "with", "at", "by", "from", "as", "into", "through", "during",
    "before", "after", "above", "below", "between", "out", "off", "over",
    "under", "again", "further", "then", "once", "and", "but", "or", "nor",
    "not", "so", "yet", "both", "either", "neither", "each", "every",
    "all", "any", "few", "more", "most", "other", "some", "such", "no",
    "only", "own", "same", "than", "too", "very", "just", "because",
    "about", "up", "its", "it", "this", "that", "these", "those", "he",
    "she", "they", "we", "you", "i", "me", "him", "her", "us", "them",
    "my", "your", "his", "our", "their", "what", "which", "who", "whom",
    "how", "when", "where", "why", "if", "while", "says", "said", "new",
}


def _tokenize(text):
    """简单分词"""
    words = re.findall(r'[a-z]{3,}', text.lower())
    return [w for w in words if w not in STOP_WORDS]


def _word_overlap(tokens_a, tokens_b):
    """计算两组 token 的 Jaccard 相似度"""
    set_a = set(tokens_a)
    set_b = set(tokens_b)
    if not set_a or not set_b:
        return 0
    intersection = len(set_a & set_b)
    union = len(set_a | set_b)
    return intersection / union if union > 0 else 0


def cluster(articles, similarity_threshold=0.25):
    """基于词频重叠聚类文章"""
    if not articles:
        return []

    # Tokenize all articles
    tokenized = []
    for article in articles:
        text = article.get("headline", "") + " " + article.get("summary", "")
        tokens = _tokenize(text)
        tokenized.append(tokens)

    # Greedy clustering
    clusters = []
    assigned = set()

    for i, article in enumerate(articles):
        if i in assigned:
            continue

        cluster_articles = [article]
        cluster_tokens = list(tokenized[i])
        assigned.add(i)

        for j in range(i + 1, len(articles)):
            if j in assigned:
                continue
            similarity = _word_overlap(tokenized[i], tokenized[j])
            if similarity >= similarity_threshold:
                cluster_articles.append(articles[j])
                cluster_tokens.extend(tokenized[j])
                assigned.add(j)

        # Generate topic summary from most common words
        word_counts = Counter(cluster_tokens)
        top_words = [w for w, _ in word_counts.most_common(5)]
        topic = " / ".join(top_words) if top_words else "misc"

        clusters.append({
            "topic": topic,
            "headline": cluster_articles[0].get("headline", ""),
            "articles": cluster_articles,
            "count": len(cluster_articles),
        })

    # Sort by article count
    clusters.sort(key=lambda x: x["count"], reverse=True)
    logger.info("聚类: %d 篇文章 → %d 个话题", len(articles), len(clusters))
    return clusters
