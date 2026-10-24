Original prompt: Make the minesweeper game layout and buttons and look look like in the image I uploaded.

Notes:
- Target visual: dark blue glass shell, centered framed board, pill controls, blue rounded cells, right-side note card.
- Keep changes scoped to Minesweeper where shell-level styling is required.
- Implemented scoped shell backdrop/header/note styling plus Minesweeper board frame, tile, toolbar, and minimap visibility updates.
- Restored minimap visibility/desktop column and simplified cells for performance. Replaced per-cell hover listeners with delegated board hover, built cells with a fragment, cached minimap context, and throttled scroll/resize refreshes.
- Tightened dense-board sizing: when fitting would shrink cells below a comfortable floor, Minesweeper now forces scroll/minimap mode and ignores overly small saved preferred tile sizes.

2026-10-23: User requested computer guidance when a demo is too cramped. Added a screen-size notice below 600px width or 480px height, with a portfolio return and an explicit Try on this screen option. No user-agent sniffing, saved-data writes or game logic changes. After interaction, resize does not interrupt play. QA pending.

2026-10-24: User clarified a strict computer-only requirement with no mobile bypass and no website links on small screens. Removed Try anyway and Escape dismissal; mobile/touch-only devices and undersized windows are blocked. Glimpse pauses an active run when a desktop window becomes too small and resumes when adequate. No saved-data or account changes.

2026-10-24 QA: Gallery game modules are unchanged. Production build passed (existing mixed audio-gate import warning). Strict native modal verified at 320/390, landscape, 768, desktop and exact thresholds; wide Android/touch remains blocked. Escape/Space cannot dismiss it. Desktop Wordle launches correctly. Screenshots inspected, no new page errors. Rebuilding the original main commit reproduced the public Netlify asset names, confirming the deployment baseline.
