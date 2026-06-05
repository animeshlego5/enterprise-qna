import { PricingTable } from "@clerk/nextjs";

// Pricing section below the hero + workspace. Plans and checkout are fully
// managed by Clerk Billing — the tiers shown here are configured in the Clerk
// Dashboard (Billing → Plans), and <PricingTable /> renders them + handles the
// Stripe checkout flow. See the dashboard setup notes in the README.
//
// The `appearance.variables` below retint Clerk's component to the app's dark
// glass theme (deep-navy surfaces, coral accent, rounded corners).
export function PricingSection() {
  return (
    <section id="pricing" className="relative z-10 w-full px-4 py-28">
      <div className="mx-auto max-w-5xl">
        {/* Header */}
        <div className="mb-14 text-center">
          <p className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-claude-accent">
            Pricing
          </p>
          <h2
            className="text-4xl font-medium tracking-tight text-white sm:text-5xl"
            style={{ fontFamily: "var(--font-playfair), Georgia, serif" }}
          >
            Choose your plan
          </h2>
          <p className="mx-auto mt-5 max-w-xl text-base leading-relaxed text-claude-muted">
            Start free with your own API keys, or upgrade to managed cloud processing
            with higher usage limits. Cancel anytime.
          </p>
        </div>

        {/* Clerk-managed plans + checkout */}
        <PricingTable
          newSubscriptionRedirectUrl="/"
          appearance={{
            variables: {
              colorPrimary: "#e8896b",
              colorBackground: "#141a2b",
              colorText: "#eef1f7",
              colorTextSecondary: "#a8b0c4",
              colorInputBackground: "#1d2438",
              colorInputText: "#eef1f7",
              colorNeutral: "#eef1f7",
              colorDanger: "#f87171",
              colorSuccess: "#3fcf8e",
              borderRadius: "0.9rem",
              fontFamily: "var(--font-inter), system-ui, sans-serif",
            },
          }}
        />

        <p className="mt-8 text-center text-sm text-claude-subtle">
          The Free tier runs entirely in your browser with your own OpenAI / Gemini /
          Anthropic key — no cloud backend. Paid tiers unlock managed cloud processing.
        </p>
      </div>
    </section>
  );
}
