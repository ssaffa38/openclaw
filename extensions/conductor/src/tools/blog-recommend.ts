import { Type } from "@sinclair/typebox";
import type { OpenClawPluginApi } from "../../../../src/plugins/types.js";
import { jsonResult } from "../../../../src/agents/tools/common.js";
import { fetchPosts, recommendTopics } from "../lib/blog-client.js";
import { resolveConductorConfig } from "../lib/config.js";

export function createBlogRecommendTool(api: OpenClawPluginApi) {
  return {
    name: "conductor_blog_recommend",
    description:
      "Analyze existing blog content and recommend new article topics based on content gaps, seasonal relevance, and ontology coverage.",
    parameters: Type.Object({
      site: Type.Optional(
        Type.String({
          description:
            'Blog site key from blogConfig (e.g. "sahr"). Defaults to the first enabled site.',
        }),
      ),
      count: Type.Optional(
        Type.Number({
          description: "Number of recommendations to return (default 5).",
        }),
      ),
      focus: Type.Optional(
        Type.String({
          description: "Optional focus area to prioritize (e.g. a category or seasonal theme).",
        }),
      ),
    }),
    async execute(_id: string, params: Record<string, unknown>) {
      const cfg = resolveConductorConfig(api);
      const siteKey = resolveEnabledSite(cfg.blogConfig, params.site as string | undefined);
      if (!siteKey) {
        return jsonResult({ error: "No enabled blog site found in blogConfig." });
      }

      const site = cfg.blogConfig[siteKey];
      const count = typeof params.count === "number" ? params.count : 5;

      try {
        const posts = await fetchPosts(site, "published");

        const published = posts.length;
        const recommendations = await recommendTopics(site, posts, count);

        return jsonResult({
          site: siteKey,
          existingPostCount: published,
          recommendations: recommendations.map((r) => ({
            title: r.title,
            slug: r.slug,
            focusKeyword: r.focus_keyword,
            category: r.main_category,
            articleType: r.article_type,
            rationale: r.rationale,
            strategicValue: r.strategic_value,
            targetCity: r.target_city,
          })),
        });
      } catch (err) {
        return jsonResult({
          error: `Blog recommend failed: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    },
  };
}

function resolveEnabledSite(
  blogConfig: Record<string, { apiBase: string; enabled?: boolean }>,
  preferredKey?: string,
): string | null {
  if (preferredKey && blogConfig[preferredKey]?.enabled !== false) {
    return preferredKey;
  }
  for (const [key, val] of Object.entries(blogConfig)) {
    if (val.enabled !== false) {
      return key;
    }
  }
  return null;
}
