/**
 * Shared HTTP helpers for Sahr blog API calls.
 * Used by blog-recommend and blog-generate tools.
 */

import type { BlogSiteConfig } from "../types.js";

export type BlogPost = {
  id: string;
  title: string;
  slug: string;
  status: string;
  category?: string;
  tags?: string[];
  focus_keyword?: string;
  article_type?: string;
  ontology?: {
    signal_family?: string | null;
    vehicle_category?: string | null;
    persona_lens?: string | null;
    intent_tier?: number | null;
    intent_contract?: string | null;
    article_type?: string | null;
  };
  word_count?: number;
  created_at?: string;
  updated_at?: string;
  published_at?: string;
  gate_status?: {
    gate_a?: { passed: boolean };
    gate_c?: { passed: boolean; score?: number };
  } | null;
};

export type TopicRecommendation = {
  title: string;
  slug: string;
  caption: string;
  focus_keyword: string;
  main_category: string;
  article_type: string;
  rationale: string;
  strategic_value: number;
  target_city: string | null;
};

async function apiFetch<T>(url: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      ...(opts?.headers as Record<string, string>),
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`API ${res.status}: ${text.slice(0, 200)}`);
  }

  return res.json() as Promise<T>;
}

export async function fetchPosts(site: BlogSiteConfig, status = "all"): Promise<BlogPost[]> {
  const { posts } = await apiFetch<{ posts: BlogPost[] }>(
    `${site.apiBase}/api/blog?status=${encodeURIComponent(status)}`,
  );
  return posts;
}

export async function recommendTopics(
  site: BlogSiteConfig,
  existingPosts: BlogPost[],
  count = 5,
): Promise<TopicRecommendation[]> {
  const existingArticles = existingPosts
    .filter((p) => p.status === "published")
    .map((p) => ({
      id: p.id,
      title: p.title,
      focus_keyword: p.focus_keyword ?? undefined,
      article_type: p.ontology?.article_type ?? p.article_type ?? "standalone",
      main_category: p.category,
      ontology: {
        signal_family: p.ontology?.signal_family ?? undefined,
        vehicle_category: p.ontology?.vehicle_category ?? undefined,
        persona_lens: p.ontology?.persona_lens ?? undefined,
        intent_tier: p.ontology?.intent_tier ?? undefined,
        intent_contract: p.ontology?.intent_contract ?? undefined,
      },
    }));

  const signalFamilies = [
    ...new Set(
      existingPosts
        .map((p) => p.ontology?.signal_family)
        .filter((s): s is string => typeof s === "string"),
    ),
  ];

  const { recommendations } = await apiFetch<{
    recommendations: TopicRecommendation[];
  }>(`${site.apiBase}/api/blog/engine/api/generate/recommend-topics`, {
    method: "POST",
    body: JSON.stringify({
      existing_articles: existingArticles,
      signal_families:
        signalFamilies.length > 0
          ? signalFamilies
          : ["vehicle_protection", "aesthetic_care", "ownership_lifecycle"],
      count,
      current_month: new Date().getMonth() + 1,
    }),
  });

  return recommendations;
}

export async function generatePost(
  site: BlogSiteConfig,
  params: {
    topic: string;
    keywords?: string[];
    style?: string;
    target_city?: string;
    article_type?: string;
  },
): Promise<{ post: BlogPost; source: string }> {
  return apiFetch<{ post: BlogPost; source: string }>(`${site.apiBase}/api/blog/generate`, {
    method: "POST",
    body: JSON.stringify({
      topic: params.topic,
      keywords: params.keywords ?? [],
      style: params.style ?? "educational",
      target_city: params.target_city ?? "Edmonton",
      use_pipeline: true,
      article_type: params.article_type ?? "standalone",
    }),
  });
}
