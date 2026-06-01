import { AppShell } from "@/components/AppShell";
import { AuthNav } from "@/components/AuthNav";

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center bg-claude-bg px-4 py-20">
      {/* Top-right auth controls */}
      <div className="absolute right-6 top-5">
        <AuthNav />
      </div>

      {/* Header */}
      <div className="mb-10 flex flex-col items-center gap-4 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-claude-accent/15 ring-1 ring-claude-accent/30">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="text-claude-accent">
            <path d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2zm0 3a1 1 0 1 1 0 2 1 1 0 0 1 0-2zm-1 4h2v8h-2V9z" fill="currentColor" opacity="0.4" />
            <path d="M8.5 8.5C9.5 7 10.7 6 12 6c1.5 0 2.8 1 3.7 2.5M7 12c0-2.8 2.2-5 5-5s5 2.2 5 5-2.2 5-5 5c-1.8 0-3.4-1-4.3-2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </div>
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-claude-text">Enterprise QnA</h1>
          <p className="mt-2 max-w-md text-base leading-relaxed text-claude-muted">
            Ask questions from your knowledge base.{" "}
            <span className="text-claude-subtle">Sign in for cloud processing, or use local mode free with your own API key.</span>
          </p>
        </div>
      </div>

      {/* Mode-aware content — local vs backend */}
      <AppShell />

      {/* Footer */}
      <div className="mt-12 flex items-center gap-3 text-sm text-claude-subtle">
        <span>
          Built by{" "}
          <a href="https://animeshlego5.github.io/" target="_blank" rel="noopener noreferrer"
            className="font-medium text-claude-accent underline-offset-4 hover:underline">
            Animesh
          </a>
        </span>
        <span className="text-claude-border-hi">·</span>
        <a href="https://github.com/animeshlego5/enterprise-qna" target="_blank" rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 hover:text-claude-text transition-colors">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2C6.477 2 2 6.477 2 12c0 4.418 2.865 8.166 6.839 9.489.5.092.682-.217.682-.482 0-.237-.009-.868-.013-1.703-2.782.604-3.369-1.34-3.369-1.34-.454-1.156-1.11-1.463-1.11-1.463-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.087 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.578 9.578 0 0 1 12 6.836a9.59 9.59 0 0 1 2.504.337c1.909-1.294 2.747-1.025 2.747-1.025.546 1.377.203 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.743 0 .267.18.578.688.48C19.138 20.163 22 16.418 22 12c0-5.523-4.477-10-10-10z" />
          </svg>
          GitHub
        </a>
      </div>
    </main>
  );
}
