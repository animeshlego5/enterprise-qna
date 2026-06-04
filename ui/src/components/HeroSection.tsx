"use client";

import { useEffect, useRef, useState } from "react";
import { SignInButton, UserButton, useAuth } from "@clerk/nextjs";

const TYPEWRITER_QUERIES = [
  "What does our leave policy say?",
  "Summarize the Q3 earnings report…",
  "Find all mentions of Project Apollo…",
  "What are the onboarding steps?",
  "Who owns the infrastructure budget?",
];

export function HeroSection() {
  const navRef     = useRef<HTMLElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const videoRef   = useRef<HTMLVideoElement>(null);

  const [searchValue, setSearchValue]       = useState("");
  const [isFocused, setIsFocused]           = useState(false);
  const [typewriterText, setTypewriterText] = useState("");
  const [isDeleting, setIsDeleting]         = useState(false);
  const [phIdx, setPhIdx]                   = useState(0);

  const { isSignedIn, isLoaded } = useAuth();

  // ── Parallax + nav tint on scroll ────────────────────────
  useEffect(() => {
    const onScroll = () => {
      const y  = window.scrollY;
      const vh = window.innerHeight;
      const progress = Math.min(y / (vh * 0.65), 1);

      if (contentRef.current) {
        contentRef.current.style.opacity   = String(Math.max(0, 1 - progress * 1.8));
        contentRef.current.style.transform = `translateY(${-y * 0.2}px)`;
      }
      if (videoRef.current) {
        videoRef.current.style.transform = `translateY(${y * 0.3}px)`;
      }
      if (navRef.current) {
        navRef.current.dataset.scrolled = String(y > vh * 0.85);
      }
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // ── Typewriter animation ──────────────────────────────────
  useEffect(() => {
    const current = TYPEWRITER_QUERIES[phIdx];
    let timeout: ReturnType<typeof setTimeout>;

    if (!isDeleting) {
      if (typewriterText.length < current.length) {
        // type next character
        timeout = setTimeout(
          () => setTypewriterText(current.slice(0, typewriterText.length + 1)),
          62
        );
      } else {
        // fully typed — pause, then start deleting
        timeout = setTimeout(() => setIsDeleting(true), 1900);
      }
    } else {
      if (typewriterText.length > 0) {
        // delete last character (faster)
        timeout = setTimeout(
          () => setTypewriterText(typewriterText.slice(0, -1)),
          36
        );
      } else {
        // fully deleted — short gap, then next phrase
        timeout = setTimeout(() => {
          setIsDeleting(false);
          setPhIdx((i) => (i + 1) % TYPEWRITER_QUERIES.length);
        }, 320);
      }
    }

    return () => clearTimeout(timeout);
  }, [typewriterText, isDeleting, phIdx]);

  const scrollToApp = () =>
    document.getElementById("app-section")?.scrollIntoView({ behavior: "smooth" });

  const showOverlay = !isFocused && !searchValue;

  return (
    <>
      {/* ── Glass Navbar ─────────────────────────────────── */}
      <nav ref={navRef} className="hero-nav">
        <div className="hero-nav-inner">
          <div className="hero-nav-logo">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M20 11.5a8.5 8.5 0 1 1-17 0 8.5 8.5 0 0 1 17 0Z"
                stroke="url(#q-gradient)" strokeWidth="1.5"
              />
              <path
                d="M17.5 17.5L22 22"
                stroke="url(#q-gradient)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
              />
              <path
                d="M11.5 7L12.5 10L15.5 11L12.5 12L11.5 15L10.5 12L7.5 11L10.5 10L11.5 7Z"
                fill="white" opacity="0.8"
              />
              <defs>
                <linearGradient id="q-gradient" x1="3" y1="3" x2="22" y2="22" gradientUnits="userSpaceOnUse">
                  <stop stopColor="#ffffff" stopOpacity="1" />
                  <stop offset="1" stopColor="#ffffff" stopOpacity="0.3" />
                </linearGradient>
              </defs>
            </svg>
            <span className="hero-nav-brand">Enterprise QnA</span>
          </div>

          <div className="hero-nav-actions">
            {isLoaded && isSignedIn ? (
              <UserButton />
            ) : (
              <>
                <SignInButton mode="modal">
                  <button className="hero-nav-login">Log In</button>
                </SignInButton>
                <SignInButton mode="modal">
                  <button className="hero-nav-cta">Get Started →</button>
                </SignInButton>
              </>
            )}
          </div>
        </div>
      </nav>

      {/* ── Hero Section ─────────────────────────────────── */}
      <section className="hero-section">
        {/* Origin aerial cloudscape video */}
        <video
          ref={videoRef}
          className="hero-video"
          autoPlay muted loop playsInline
          poster="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'%3E%3Crect width='100%25' height='100%25' fill='%230a1228'/%3E%3C/svg%3E"
        >
          <source
            src="https://cdn.prod.website-files.com/68acbc076b672f730e0c77b9%2F68bb73e8d95f81619ab0f106_Clouds1-transcode.mp4"
            type="video/mp4"
          />
        </video>

        <div className="hero-overlay" aria-hidden="true" />

        {/* Fade the hero's bottom edge to near-black so it blends seamlessly
            into the workspace section's video below it */}
        <div className="hero-bottom-fade" aria-hidden="true" />

        {/* ── Hero content ── */}
        <div ref={contentRef} className="hero-content">
          <h1 className="hero-title">
            <em>Enterprise</em> QnA.
          </h1>

          <p className="hero-subtitle">
            <strong className="hero-subtitle-lead">Your intelligent knowledge base assistant.</strong>
            Upload documents, ask questions, get instant answers — powered by RAG.
          </p>

          <button onClick={scrollToApp} className="hero-cta-btn">
            GET STARTED →
          </button>

          {/* Glass search bar */}
          <div className="hero-search-wrap">
            <form
              onSubmit={(e) => { e.preventDefault(); scrollToApp(); }}
              className="hero-search-bar"
            >
              <input
                type="text"
                value={showOverlay ? typewriterText : searchValue}
                readOnly={showOverlay}
                onChange={(e) => { if (!showOverlay) setSearchValue(e.target.value); }}
                onFocus={() => setIsFocused(true)}
                onBlur={() => setIsFocused(false)}
                style={{
                  color: showOverlay ? "rgba(255,255,255,0.52)" : "white",
                  caretColor: showOverlay ? "transparent" : "white",
                }}
                className="hero-search-input"
                aria-label="Ask a question"
              />

              <button type="submit" className="hero-search-btn" aria-label="Submit question">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path
                    d="M12 19V5M5 12l7-7 7 7"
                    stroke="currentColor" strokeWidth="2.5"
                    strokeLinecap="round" strokeLinejoin="round"
                  />
                </svg>
              </button>
            </form>
          </div>

          <p className="hero-tagline">Track everything. Ask anything.</p>
        </div>

        {/* Scroll cue */}
        <button onClick={scrollToApp} className="hero-scroll-cue" aria-label="Scroll to app">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M12 5v14M5 12l7 7 7-7"
              stroke="currentColor" strokeWidth="2"
              strokeLinecap="round" strokeLinejoin="round"
            />
          </svg>
        </button>
      </section>
    </>
  );
}
