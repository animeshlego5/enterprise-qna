"use client";

// Fixed full-viewport video that backs the workspace section below the hero.
// It sits behind everything (z-0); the hero (z-10) covers it until you scroll
// past, then the content scrolls over it for a parallax effect.
export function SectionBackground() {
  return (
    <div className="section-bg" aria-hidden="true">
      <video
        className="section-bg-video"
        autoPlay
        muted
        loop
        playsInline
        poster="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'%3E%3Crect width='100%25' height='100%25' fill='%230a0e1a'/%3E%3C/svg%3E"
      >
        <source
          src="https://videos.pexels.com/video-files/11773144/11773144-hd_1920_1080_25fps.mp4"
          type="video/mp4"
        />
      </video>
      <div className="section-bg-overlay" />
    </div>
  );
}
