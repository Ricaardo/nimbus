"""地缘政治关键词分类器 — 文章分类 + 严重性评分 + 区域标签"""

import logging

logger = logging.getLogger(__name__)

CATEGORIES = {
    "military_conflict": {
        "keywords": [
            "war", "missile", "invasion", "nato", "nuclear", "troops",
            "airstrike", "military", "defense", "army", "navy", "bombing",
            "artillery", "ceasefire", "combat", "drone strike", "escalation",
        ],
        "severity": 1.0,
    },
    "trade_war": {
        "keywords": [
            "tariff", "sanctions", "embargo", "decoupling", "trade war",
            "import duty", "export ban", "trade restriction", "trade deficit",
            "protectionism", "dumping", "retaliatory",
        ],
        "severity": 0.8,
    },
    "sanctions": {
        "keywords": [
            "ofac", "frozen assets", "entity list", "financial sanctions",
            "blacklist", "asset freeze", "secondary sanctions", "export controls",
        ],
        "severity": 0.7,
    },
    "energy_security": {
        "keywords": [
            "opec", "pipeline", "oil supply", "production cut", "energy crisis",
            "gas shortage", "oil embargo", "lng", "energy security",
            "strait of hormuz", "oil disruption",
        ],
        "severity": 0.7,
    },
    "political_instability": {
        "keywords": [
            "coup", "election crisis", "government shutdown", "impeachment",
            "protest", "civil unrest", "regime change", "political crisis",
            "martial law", "state of emergency",
        ],
        "severity": 0.6,
    },
    "cyber_threat": {
        "keywords": [
            "cyberattack", "ransomware", "cyber warfare", "hacking",
            "infrastructure attack", "data breach", "cyber espionage",
        ],
        "severity": 0.5,
    },
}

REGION_KEYWORDS = {
    "middle_east": [
        "iran", "israel", "saudi", "iraq", "syria", "yemen", "lebanon",
        "gaza", "houthi", "hezbollah", "persian gulf",
    ],
    "east_asia": [
        "china", "taiwan", "korea", "japan", "south china sea", "strait",
        "kim jong", "pyongyang", "beijing", "tokyo",
    ],
    "europe": [
        "russia", "ukraine", "nato", "eu ", "baltic", "poland",
        "kremlin", "moscow", "kyiv", "crimea",
    ],
    "global": [
        "un ", "g7", "g20", "global", "world", "international",
    ],
}


def classify_article(headline, summary=""):
    """对单篇文章进行地缘政治分类"""
    text = (headline + " " + summary).lower()

    matched_categories = []
    max_severity = 0
    total_hits = 0

    for cat_name, cat_info in CATEGORIES.items():
        hits = sum(1 for kw in cat_info["keywords"] if kw in text)
        if hits > 0:
            matched_categories.append(cat_name)
            total_hits += hits
            if cat_info["severity"] > max_severity:
                max_severity = cat_info["severity"]

    # Region detection
    matched_regions = []
    for region, keywords in REGION_KEYWORDS.items():
        if any(kw in text for kw in keywords):
            matched_regions.append(region)

    # Score: severity * keyword density
    score = max_severity * min(total_hits / 3, 1.0) if total_hits > 0 else 0

    return {
        "categories": matched_categories,
        "max_severity": max_severity,
        "regions": matched_regions,
        "keyword_hits": total_hits,
        "score": round(score, 3),
        "is_geopolitical": len(matched_categories) > 0,
    }


def classify_batch(articles):
    """批量分类文章"""
    geo_articles = []
    category_counts = {}
    region_counts = {}
    total_severity = 0

    for article in articles:
        result = classify_article(
            article.get("headline", ""),
            article.get("summary", ""),
        )
        article["geo_classification"] = result

        if result["is_geopolitical"]:
            geo_articles.append(article)
            total_severity += result["max_severity"]

            for cat in result["categories"]:
                category_counts[cat] = category_counts.get(cat, 0) + 1
            for region in result["regions"]:
                region_counts[region] = region_counts.get(region, 0) + 1

    # Sort by score
    geo_articles.sort(key=lambda x: x["geo_classification"]["score"], reverse=True)

    avg_severity = total_severity / len(geo_articles) if geo_articles else 0

    return {
        "total_articles": len(articles),
        "geo_articles": len(geo_articles),
        "geo_ratio": round(len(geo_articles) / max(len(articles), 1), 3),
        "avg_severity": round(avg_severity, 3),
        "category_counts": category_counts,
        "region_counts": region_counts,
        "top_articles": geo_articles[:10],
    }
