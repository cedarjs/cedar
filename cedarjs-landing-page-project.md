# Project Brief: CedarJS Landing Page Redesign

This document outlines the strategic and structural requirements for the new CedarJS landing page. It is based on Rob Walling’s "10 Elements of Effective Landing Pages," adapted for a production-grade open-source framework.

**Goal:** Position CedarJS as the stable, cohesive, and "production-first" alternative to fragmented full-stack setups.
**Target Audience:** Developers seeking a trusted, opinionated framework that eliminates "glue-work" and is optimized for the AI era.

---

## 1. Core Messaging & Tone

- **Tone:** Professional, direct, stable, and authoritative.
- **Avoid:** "Next-gen," "Blazing fast," or "Bleeding edge."
- **Emphasize:** "Production-ready," "Cohesive," "Trusted," and "Maintainable."

---

## 2. Page Structure (The 10 Elements)

### Element 1 & 2: The Hero Section

- **Headline:** `Stop gluing libraries together. Start building your product.`
- **Sub-headline:** `CedarJS is a stable, opinionated full-stack framework that integrates React, GraphQL, and Prisma into a cohesive system. Don't waste weeks on boilerplate—use the foundation trusted for production-grade applications.`
- **The "One Thing" (Primary CTA):** A terminal component displaying:
  `yarn create cedar-app` (Include a copy-to-clipboard button).
- **Secondary CTA:** A button labeled `Take the Tutorial`.

### Element 3: The Visual "Aha" Moment

- **Concept:** A split-screen interactive code component.
- **Left Side (CLI):** Animation of `cedar generate service post`.
- **Right Side (Code):** A snippet of `posts.service.ts`.
- **Caption:** _"In Cedar, your business logic lives in **Services**. They automatically act as your GraphQL resolvers, providing a clean, typesafe bridge between your database and your UI without manual wiring."_

### Element 4: Key Benefits (The "Cedar Edge")

- **Stability over Hype:** Build on proven patterns. CedarJS leverages React and GraphQL within a predictable, production-tested architecture that prioritizes long-term maintainability.
- **Integrated Infrastructure:** Auth, Recurring Jobs, and Mailers are first-class citizens—core components designed to work together out of the box.
- **Production-Ready Observability:** Scale with confidence. The Cedar CLI includes dedicated setup commands for **OpenTelemetry** and **Sentry**, allowing you to add professional monitoring the moment you need it.

### Element 5: Social Proof (The Trust Bar)

- **Placement:** Immediately below the Hero section.
- **Content:** Logos for **Aerafarms**, **ACM**, and two additional sponsor placeholders.
- **Copy:** _"Built for the long haul. Sponsored and used in production by industry leaders."_

### Element 6: Differentiator (AI-Agent Ready)

- **Heading:** `The Framework for the AI Era.`
- **Copy:** _"Because CedarJS uses a strict, predictable directory structure and a standard CLI, AI agents don't have to 'guess' your architecture. They can generate feature-complete services, mailers, and jobs that work perfectly the first time. Cedar isn't just easy for humans to read—it's optimized for the LLMs you use every day."_

### Element 7 & 9: Navigation & Decisions

- **Navigation Bar:** Limit to 4 links: `Documentation`, `Tutorial`, `GitHub`, `Sponsor`.
- **Philosophy:** Reduce choice paralysis. Every section should subtly funnel the user back to the Tutorial or the `create` command.

### Element 8 & 10: The Footer & Persistent CTA

- **Persistent CTA:** Every page/long section should end with a reminder of the `yarn create cedar-app` command.
- **Footer Links:**
  - **The Transition:** `Moving from RedwoodJS? Read the Migration Guide.` (High visibility).
  - **Community:** Discord, Twitter/X.
  - **Resources:** API Reference, CLI Docs, Security Policy, LICENSE.

---

## 3. Technical Assets Required

1.  **Sponsor Logos:** SVG versions of Aerafarms and ACM.
    - Use placeholder SVGs for now.
2.  **Terminal Component:** A lightweight library (like `react-syntax-highlighter` or a custom CSS animation) to showcase the CLI.
    - Use static text for now
3.  **Code Snippets:** High-quality, syntax-highlighted examples of a Cedar Service and a corresponding GraphQL schema.
    - Look in `test-project/api/src/services` to see if you can find something suitable to use

---

## 4. Success Metrics

- Increased "Copy" clicks on the `yarn create cedar-app` command.
- Higher click-through rate to the Tutorial.
- Reduced bounce rate from first-time visitors.
