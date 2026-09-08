/** @type {import('next').NextConfig} */
const nextConfig = {
  // Next 16.3 writes AGENTS.md and CLAUDE.md on dev start. CLAUDE.md carries its
  // own meaning for anyone using Claude Code in this repo, so generation is off
  // rather than letting the framework overwrite a hand-written file.
  agentRules: false,
  images: {
    unoptimized: true,
  },
}

export default nextConfig
