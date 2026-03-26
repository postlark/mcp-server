#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { apiCall, PostlarkApiError } from './lib/api-client.js'

const server = new McpServer({
  name: 'postlark',
  version: '0.2.1',
})

/** 에러를 사용자 친화적 메시지로 변환 */
function errorResult(err: unknown) {
  const message =
    err instanceof PostlarkApiError ? err.message
    : err instanceof Error ? err.message
    : 'Unknown error'
  return { content: [{ type: 'text' as const, text: `Error: ${message}` }], isError: true as const }
}

/** 활성 블로그 ID를 반환 (set_active_blog로 설정된 값 우선) */
function getActiveBlogId(): string | undefined {
  return process.env.POSTLARK_ACTIVE_BLOG || undefined
}

// ─── list_blogs ───
server.tool(
  'list_blogs',
  'List all blogs owned by the current user.',
  {},
  async () => {
    try {
      const result = await apiCall<{
        data: Array<{ id: string; slug: string; name: string; description: string; custom_domain: string | null }>
      }>('/blogs')
      const activeBlog = getActiveBlogId()
      const lines = result.data.map((b) => {
        const active = b.id === activeBlog ? ' (active)' : ''
        const domain = b.custom_domain ? ` [${b.custom_domain}]` : ''
        return `- ${b.name} (${b.slug})${domain}${active}\n  ID: ${b.id}`
      })
      return { content: [{ type: 'text', text: `${result.data.length} blog(s)\n\n${lines.join('\n')}` }] }
    } catch (err) { return errorResult(err) }
  },
)

// ─── set_active_blog ───
server.tool(
  'set_active_blog',
  'Set the active blog for subsequent commands. Use list_blogs to find blog IDs.',
  {
    blog_id: z.string().describe('Blog ID to set as active'),
  },
  async (args) => {
    try {
      // Verify the blog exists and is owned by the user
      const blogs = await apiCall<{
        data: Array<{ id: string; name: string; slug: string }>
      }>('/blogs')
      const blog = blogs.data.find((b) => b.id === args.blog_id)
      if (!blog) {
        return { content: [{ type: 'text', text: `Error: Blog "${args.blog_id}" not found. Use list_blogs to see your blogs.` }], isError: true as const }
      }
      process.env.POSTLARK_ACTIVE_BLOG = args.blog_id
      return { content: [{ type: 'text', text: `Active blog set to "${blog.name}" (${blog.slug})\nID: ${blog.id}\nAll subsequent commands will target this blog.` }] }
    } catch (err) { return errorResult(err) }
  },
)

// ─── create_post ───
server.tool(
  'create_post',
  'Create a new blog post on Postlark. Content should be in Markdown format.',
  {
    title: z.string().describe('Post title'),
    content: z.string().describe('Post content in Markdown'),
    slug: z.string().optional().describe('URL slug (auto-generated from title if omitted)'),
    tags: z.array(z.string()).optional().describe('Tags (max 10)'),
    status: z.enum(['draft', 'published']).optional().describe('Post status (default: published)'),
  },
  async (args) => {
    try {
      const result = await apiCall<{ id: string; slug: string; url: string; status: string }>('/posts', {
        method: 'POST',
        body: { title: args.title, content: args.content, slug: args.slug, tags: args.tags, status: args.status ?? 'published' },
        blogId: getActiveBlogId(),
      })
      return { content: [{ type: 'text', text: `Post created: ${result.url}\nSlug: ${result.slug}\nStatus: ${result.status}` }] }
    } catch (err) { return errorResult(err) }
  },
)

// ─── update_post ───
server.tool(
  'update_post',
  'Update an existing blog post on Postlark.',
  {
    slug: z.string().describe('Slug of the post to update'),
    title: z.string().optional().describe('New title'),
    content: z.string().optional().describe('New content in Markdown'),
    tags: z.array(z.string()).optional().describe('New tags'),
  },
  async (args) => {
    try {
      const body: Record<string, unknown> = {}
      if (args.title !== undefined) body.title = args.title
      if (args.content !== undefined) body.content = args.content
      if (args.tags !== undefined) body.tags = args.tags
      await apiCall(`/posts/${args.slug}`, { method: 'PUT', body, blogId: getActiveBlogId() })
      return { content: [{ type: 'text', text: `Post "${args.slug}" updated successfully.` }] }
    } catch (err) { return errorResult(err) }
  },
)

// ─── list_posts ───
server.tool(
  'list_posts',
  'List blog posts on Postlark. Filter by status or tag.',
  {
    status: z.enum(['draft', 'published', 'scheduled']).optional().describe('Filter by status'),
    tag: z.string().optional().describe('Filter by tag'),
    page: z.number().optional().describe('Page number (default 1)'),
    per_page: z.number().optional().describe('Items per page (default 20)'),
  },
  async (args) => {
    try {
      const params = new URLSearchParams()
      if (args.status) params.set('status', args.status)
      if (args.tag) params.set('tag', args.tag)
      if (args.page) params.set('page', String(args.page))
      if (args.per_page) params.set('per_page', String(args.per_page))
      const result = await apiCall<{
        data: Array<{ title: string; slug: string; status: string; tags: string[] }>
        pagination: { total: number; page: number; total_pages: number }
      }>(`/posts?${params}`, { blogId: getActiveBlogId() })
      const lines = result.data.map((p) => `- [${p.status}] ${p.title} (/${p.slug})${p.tags.length ? ` [${p.tags.join(', ')}]` : ''}`)
      return { content: [{ type: 'text', text: `${result.pagination.total} posts (page ${result.pagination.page}/${result.pagination.total_pages})\n\n${lines.join('\n')}` }] }
    } catch (err) { return errorResult(err) }
  },
)

// ─── get_post ───
server.tool(
  'get_post',
  'Get a single blog post by slug, including full Markdown content.',
  { slug: z.string().describe('Post slug') },
  async (args) => {
    try {
      const post = await apiCall<Record<string, unknown>>(`/posts/${args.slug}`, { blogId: getActiveBlogId() })
      return { content: [{ type: 'text', text: `Title: ${post.title}\nSlug: ${post.slug}\nStatus: ${post.status}\nTags: ${(post.tags as string[])?.join(', ') || 'none'}\nCreated: ${post.created_at}\n\n--- Content (Markdown) ---\n${post.content_md}` }] }
    } catch (err) { return errorResult(err) }
  },
)

// ─── delete_post ───
server.tool(
  'delete_post',
  'Delete a blog post by slug. This action is permanent.',
  { slug: z.string().describe('Slug of the post to delete') },
  async (args) => {
    try {
      const post = await apiCall<{ title: string }>(`/posts/${args.slug}`, { blogId: getActiveBlogId() })
      await apiCall(`/posts/${args.slug}`, { method: 'DELETE', blogId: getActiveBlogId() })
      return { content: [{ type: 'text', text: `Post "${post.title}" (/${args.slug}) deleted.` }] }
    } catch (err) { return errorResult(err) }
  },
)

// ─── schedule_post (Creator+ 전용) ───
server.tool(
  'schedule_post',
  'Schedule a post for future publication. Requires Creator plan or above.',
  {
    slug: z.string().describe('Post slug'),
    scheduled_at: z.string().describe('Publication date/time in ISO 8601 format (e.g. 2026-04-01T09:00:00Z)'),
  },
  async (args) => {
    try {
      const result = await apiCall<{ slug: string; status: string; scheduled_at: string }>(`/posts/${args.slug}/schedule`, {
        method: 'POST',
        body: { scheduled_at: args.scheduled_at },
        blogId: getActiveBlogId(),
      })
      return { content: [{ type: 'text', text: `Post "${result.slug}" scheduled for ${result.scheduled_at}` }] }
    } catch (err) { return errorResult(err) }
  },
)

// ─── get_analytics (스텁) ───
server.tool(
  'get_analytics',
  'Get blog analytics overview (coming soon — Starter+ plan required).',
  { period: z.enum(['7d', '30d', '90d']).optional().describe('Time period') },
  async () => {
    return { content: [{ type: 'text', text: 'Analytics feature is coming soon. Basic view counts will be available with Starter+ plan.' }], isError: true as const }
  },
)

// ─── search_posts — 내 블로그 검색 ───
server.tool(
  'search_posts',
  'Search published posts on your blog using full-text search (title, description, headings, tags).',
  {
    q: z.string().describe('Search query'),
    page: z.number().optional().describe('Page number (default 1)'),
    per_page: z.number().optional().describe('Items per page (default 20, max 50)'),
  },
  async (args) => {
    try {
      const params = new URLSearchParams({ q: args.q })
      if (args.page) params.set('page', String(args.page))
      if (args.per_page) params.set('per_page', String(args.per_page))
      const result = await apiCall<{
        data: Array<{ slug: string; title: string; meta_description: string; tags: string[]; created_at: string }>
        pagination: { total: number; page: number; total_pages: number }
      }>(`/search?${params}`, { blogId: getActiveBlogId() })
      if (result.data.length === 0) {
        return { content: [{ type: 'text', text: `No results for "${args.q}".` }] }
      }
      const lines = result.data.map((p) =>
        `- ${p.title} (/${p.slug})${p.tags.length ? ` [${p.tags.join(', ')}]` : ''}\n  ${p.meta_description || '(no description)'}`,
      )
      return { content: [{ type: 'text', text: `${result.pagination.total} results (page ${result.pagination.page}/${result.pagination.total_pages})\n\n${lines.join('\n')}` }] }
    } catch (err) { return errorResult(err) }
  },
)

// ─── discover_posts — 플랫폼 전체 검색 (인증 불필요) ───
server.tool(
  'discover_posts',
  'Discover published posts across ALL Postlark blogs. No authentication needed. Searches title, description, headings, and tags.',
  {
    q: z.string().describe('Search query'),
    tag: z.string().optional().describe('Filter by tag'),
    page: z.number().optional().describe('Page number (default 1)'),
    per_page: z.number().optional().describe('Items per page (default 20, max 50)'),
  },
  async (args) => {
    try {
      const params = new URLSearchParams({ q: args.q })
      if (args.tag) params.set('tag', args.tag)
      if (args.page) params.set('page', String(args.page))
      if (args.per_page) params.set('per_page', String(args.per_page))
      const result = await apiCall<{
        data: Array<{
          title: string; slug: string; excerpt: string; tags: string[]
          created_at: string; blog_name: string; blog_domain: string; url: string; llms_txt_url: string | null
        }>
        pagination: { total: number; page: number; total_pages: number }
      }>(`/discover?${params}`, { public: true })
      if (result.data.length === 0) {
        return { content: [{ type: 'text', text: `No posts found for "${args.q}" across Postlark.` }] }
      }
      const lines = result.data.map((p) => {
        const parts = [`- ${p.title} (${p.blog_name})`, `  ${p.url}`]
        if (p.excerpt) parts.push(`  ${p.excerpt}`)
        if (p.tags.length) parts.push(`  Tags: ${p.tags.join(', ')}`)
        if (p.llms_txt_url) parts.push(`  llms.txt: ${p.llms_txt_url}`)
        return parts.join('\n')
      })
      return { content: [{ type: 'text', text: `${result.pagination.total} posts found (page ${result.pagination.page}/${result.pagination.total_pages})\n\n${lines.join('\n')}` }] }
    } catch (err) { return errorResult(err) }
  },
)

// 서버 시작 (Node 12 호환: top-level await 대신 async IIFE)
async function main() {
  const transport = new StdioServerTransport()
  await server.connect(transport)
}
main().catch((err) => { console.error('MCP server failed:', err); process.exit(1) })
