# Compact mobile navigation verification

Base: `main` at `b01a4687b07419d1d7642244c9b2391164ce119f`, the merge of PR #72.

At widths up to and including 640px, the header keeps the brand, the existing notification bell and a menu toggle on one row. The disclosure exposes the existing account controls, authorized admin link, language switch and theme switch. Authentication and notification components remain mounted once and retain their business logic. Search stays immediately below the header; its requests, suggestions, keyboard selection and feedback are unchanged. Quick cities scroll horizontally and expose their selected state through `aria-pressed`.

Navigation supports Enter/Space activation, Escape, explicit close, outside interaction and closing when keyboard focus leaves the controls. Authentication retains its own modal focus management, including when an open dialog moves from desktop to mobile. Header controls, search suggestions, quick cities and saved-place controls have at least 44px touch targets. Source/update information and existing footer attribution remain available.

## Automated checks

- `npm run build`: passed.
- `npm run lint`: passed.
- `npm test`: 287 passed.
- Full Chromium regression suite: 374 initially passed, 3 cases passed on targeted rerun against the final source, 1 compiled-only test skipped in the development suite. The rerun covered both outside/focus navigation cases and a planner entitlement-read timeout.
- Separate signup suite: 29 passed.
- Compiled profile/push suite: 63 passed; its PWA root-scope check passed separately on the final compiled build. That assertion now uses the tested origin rather than a fixed localhost port.
- Final compiled navigation suite: all 48 new navigation tests plus the PWA root-scope check passed (49 total).

The 48 navigation tests cover 320, 360, 390, 430, 640, 641, 650, 768 and 1440px; BG/EN; light/dark; guest/user/admin controls; single component instances; touch targets; row geometry; horizontal overflow; focus and responsive restoration; existing auth and notification dialogs; quick-city selection; search suggestions, Tab/Enter/Escape, empty results and failures. Existing browser tests use a shared helper to open the mobile disclosure before accessing header controls.

The normal commands remain `npx playwright test`, `npx playwright test --config=playwright.signup.config.ts` and `npx playwright test --config=playwright.profile-build.config.ts`. To run just the new navigation tests: `npx playwright test tests/mobile-navigation.spec.ts --fully-parallel`. Set `CHROMIUM_PATH` when using an installed system Chromium. Compiled navigation was additionally checked with a temporary local build/preview configuration and the same synthetic auth settings as the existing browser configuration.

## Visual checks and scope

Compared header/search/source/quick-city screenshots with unchanged `main` at 641, 650, 768 and 1440px, in BG/EN and light/dark: all 16 comparisons were pixel-identical. Visually inspected the 390px mobile menu in both themes. Browser checks use synthetic services and account fixtures.

The current weather card from PR #72, chatbot, forecasts, APIs, registration logic and push implementation retain their existing source. No production deployment, merge, SQL migration or secret changes were performed.
