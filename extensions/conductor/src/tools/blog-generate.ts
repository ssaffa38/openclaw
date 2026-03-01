import { Type } from "@sinclair/typebox";
import type { OpenClawPluginApi } from "../../../../src/plugins/types.js";
import { jsonResult } from "../../../../src/agents/tools/common.js";
import { generatePost } from "../lib/blog-client.js";
import { resolveConductorConfig } from "../lib/config.js";

export function createBlogGenerateTool(api: OpenClawPluginApi) {
  return {
    name: "conductor_blog_generate",
    description:
      "Generate a full blog post draft using the content engine pipeline (classify → evidence → outline → draft → local SEO). The post is saved as a draft in the CMS.",
    parameters: Type.Object({
      title: Type.String({
        description: "The article topic/title to generate.",
      }),
      site: Type.Optional(
        Type.String({
          description:
            'Blog site key from blogConfig (e.g. "sahr"). Defaults to the first enabled site.',
        }),
      ),
      keywords: Type.Optional(
        Type.Array(Type.String(), {
          description: "Focus keywords for the article.",
        }),
      ),
      style: Type.Optional(
        Type.String({
          description:
            'Writing style (default "educational"). Options: educational, how-to, local-seo, comparison.',
        }),
      ),
      targetCity: Type.Optional(
        Type.String({
          description: 'City for local SEO enrichment (default "Edmonton").',
        }),
      ),
      articleType: Type.Optional(
        Type.String({
          description:
            'Article type: pillar, spoke, local_landing, standalone (default "standalone").',
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
      const title = params.title as string;

      try {
        const result = await generatePost(site, {
          topic: title,
          keywords: Array.isArray(params.keywords) ? (params.keywords as string[]) : undefined,
          style: (params.style as string) ?? "educational",
          target_city: (params.targetCity as string) ?? "Edmonton",
          article_type: (params.articleType as string) ?? "standalone",
        });

        const post = result.post;
        const editUrl = `${site.apiBase}/admin/blog/${post.slug}/edit`;

        return jsonResult({
          site: siteKey,
          source: result.source,
          post: {
            id: post.id,
            title: post.title,
            slug: post.slug,
            status: post.status,
            category: post.category,
            editUrl,
          },
        });
      } catch (err) {
        return jsonResult({
          error: `Blog generation failed: ${err instanceof Error ? err.message : String(err)}`,
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
