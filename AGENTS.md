# AGENTS.md

**This is a living project guide.** Record user preferences, development style, and workflows here. After solving tasks, add or refine guidance when it would help future work. Prefer concrete, reusable notes over one-off task details. Keep entries concise, actionable, and specific. Remove stale guidance and avoid duplicating information that already exists in canonical docs.

**This file is for general principles and preferences.** Project-specific context (what's implemented, architecture decisions, roadmap) belongs in `agent-context/`. See [Long-term Project Context](#long-term-project-context) below. 

## Tech Stack & Environment

### Language & Runtime
- **TypeScript** — Primary project language.
- **Node.js 22+** — Runtime target.

### Build & Dev
- **pnpm** — Package manager.
- **tsx** — Run TypeScript directly in development.

### Testing
- **Vitest** — Test runner.

### Linting & Formatting
- **Biome** — Linting and formatting.

## Rules

### Don't Jump Right to Coding

Before writing any code, have a conversation to understand the developer's intent and approach. If anything about the task is ambiguous, ask clarifying questions. Once the approach is agreed upon, start small and iterate (see [Progressive Implementation](#progressive-implementation)).

### Close the Loop

**Bug fixes:** Write a test that reproduces the issue first. Implement the fix. Run the test again to confirm it passes.

**New features:** Write tests before changing the codebase. The tests are your roadmap. Implement incrementally, running tests as you go.

### Take To-do Lists Seriously

To avoid forgetting parts of the implementation and missing important steps, maintain a to-do list, update it frequently, and check items off as you go.

### Think in Systems

When implementing features, identify shared parent components rather than creating variations. If multiple UI components share similar structure (windows, panels, cards), implement the base component once and compose variations from it. The same applies to programmatic logic — extract common patterns into shared utilities or base classes. Before writing new code, check if existing components can be extended or composed to achieve the same goal.

### Tentacle Layout Preference

For pane-based UI layout, keep each tentacle as a full-height column. Spawned agents for that tentacle should stack vertically within the same column (below the tentacle/root pane), while other tentacle columns remain on the left and right sides.

### Preserve Existing Patterns

Before implementing a feature, read similar existing code to understand established patterns (component structure, state management, API design). Match the existing style and architecture unless there's a compelling reason to deviate.

### Progressive Implementation

Implement features incrementally — get the simplest version working first, then iterate and enhance. Avoid big-bang implementations that try to do everything at once. This makes debugging easier, allows for early feedback, and reduces the risk of major refactoring.

### Implement Features Atomically

Follow an atomic test-driven plan. Start with a simple test to pin down the approach, then develop further. Each increment should leave the codebase in a working state.

### Question Your Assumptions

When debugging, verify your mental model matches reality. Read the actual code being executed, check logs, and reproduce issues before proposing fixes. Don't assume you know what's happening. Act like a senior developer.

### Think About Edge Cases

Before implementing or modifying code, explicitly consider edge cases and future scenarios: empty arrays, null values, concurrent requests, large datasets, network failures. Handle error states gracefully. Design with extensibility in mind without over-engineering.

### Security First

Always consider security implications before implementing features. Think about input validation, authentication, authorization boundaries, SQL injection, XSS, CSRF, and other common vulnerabilities. If you identify a potential security issue, flag it explicitly and propose secure alternatives.

### Comments Explain Why, Not What

Never write comments that repeat what the code does — the code should be self-explanatory. Add comments only to explain non-obvious reasoning, document why a particular approach was chosen, or note important constraints and edge cases.

### Leave Breadcrumbs

When implementing complex logic, add concise comments explaining why decisions were made. Link to relevant issues, RFCs, or documentation. This helps future maintainers understand constraints and avoid "fixing" intentional behavior.

## Documentation

This is an open-source project. Actively maintain documentation in a `docs/` folder following standard documentation practices. This includes:

- **Usage guides** for end users.
- **Contributing guide** for new contributors.
- **API documentation** where applicable.
- **Architecture overview** for developers working on the codebase.

Keep docs in sync with the code — when a feature changes, update its documentation in the same PR.

## Long-term Project Context

Maintain an `agent-context/` folder as your persistent notepad for project-specific development context. This folder is your memory across sessions — use it to track what's been implemented, architectural decisions and their rationale, known issues and workarounds, planned work for future releases, and anything else you'll need to recall in later sessions.

- Keep an `index.md` in this folder as a table of contents for easy navigation.
- Create separate markdown files for distinct topics (e.g., `auth_issue.md`, `architecture.md`, `roadmap.md`, `decisions.md`).
- Update these files proactively as the project evolves — don't wait to be asked.
