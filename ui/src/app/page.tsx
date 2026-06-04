import { AppShell } from "@/components/AppShell";
import { HeroSection } from "@/components/HeroSection";
import { SectionBackground } from "@/components/SectionBackground";

export default function Home() {
  return (
    <>
      {/* Fixed video backdrop for the workspace — revealed as the hero scrolls away */}
      <SectionBackground />

      {/* Full-viewport hero with glass nav, video bg, and scroll animation */}
      <HeroSection />

      {/* App section — scrolled into view from hero CTA.
          Transparent bg so the fixed SectionBackground video shows behind the panels. */}
      <main
        id="app-section"
        className="relative z-10 flex min-h-screen flex-col items-center px-4 pt-44 pb-24"
      >
        {/* Dark blend band: meets the hero's faded-to-black bottom edge so the cut
            between the two videos is invisible, then fades to reveal the workspace video.
            -z-10 keeps it behind the (non-positioned) workspace panels so it never veils them. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[75vh]"
          style={{
            background:
              "linear-gradient(180deg, rgba(8,11,22,0.97) 0%, rgba(8,11,22,0.82) 16%, rgba(8,11,22,0.45) 45%, rgba(8,11,22,0) 100%)",
          }}
        />

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
    </>
  );
}
