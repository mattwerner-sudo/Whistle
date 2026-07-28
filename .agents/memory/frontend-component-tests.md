---
name: frontend component tests
description: How to render real React page/components inside the repo's tsx-script test convention (no test runner, no prior DOM env).
---

# Rendering React components in tests

The repo has no test runner and no DOM test env — tests are plain tsx scripts
(`npx tsx tests/x.test.ts`) with a hand-rolled `check()` helper. To test
frontend behavior you can still render real components with `jsdom` + `react-dom/client`.

**Why:** there was no precedent for frontend tests here; component behavior
(e.g. post-checkout query refresh in `use-post-checkout-refresh.ts`) had no
guard. This pattern lets a tsx script mount the actual pages.

**How to apply:**
- `jsdom` is installed as a dev dependency. Create a `JSDOM` instance and copy
  `window/document/navigator/HTMLElement/getComputedStyle/requestAnimationFrame`
  onto `globalThis` BEFORE dynamically importing React/components. Stub
  `matchMedia` and `ResizeObserver` (Radix reaches for them).
- The page components do NOT import React (Vite injects it). tsx uses the
  classic JSX transform, so set `globalThis.React = <react module>` before
  importing pages, or you get `ReferenceError: React is not defined`.
- Keep the test file `*.test.ts` (NOT `.tsx`) so it stays excluded from
  `tsconfig`/`npm run check`. Build elements with `React.createElement`, not JSX.
- Stub `global.fetch` (return `new Response(JSON.stringify(...))`) — the default
  query fetcher (`getQueryFn`) just `fetch`es `queryKey.join('/')`.
- Wrap pages in `QueryClientProvider` using the singleton `@/lib/queryClient`
  (hooks invalidate that singleton, so the provider must use the same instance).
- Control `useSearch()` by wrapping in wouter `<Router hook={() => ['/', ()=>{}]} searchHook={() => 'success=true'}>` — avoids touching `window.location`.
- Set `globalThis.IS_REACT_ACT_ENVIRONMENT = false` and poll the DOM /
  spy counters with a `waitFor` loop (real timers) rather than fighting `act`.

Example: `tests/post-checkout-refresh.test.ts`.
