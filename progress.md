Original prompt: Make the minesweeper game layout and buttons and look look like in the image I uploaded.

Notes:
- Target visual: dark blue glass shell, centered framed board, pill controls, blue rounded cells, right-side note card.
- Keep changes scoped to Minesweeper where shell-level styling is required.
- Implemented scoped shell backdrop/header/note styling plus Minesweeper board frame, tile, toolbar, and minimap visibility updates.
- Restored minimap visibility/desktop column and simplified cells for performance. Replaced per-cell hover listeners with delegated board hover, built cells with a fragment, cached minimap context, and throttled scroll/resize refreshes.
- Tightened dense-board sizing: when fitting would shrink cells below a comfortable floor, Minesweeper now forces scroll/minimap mode and ignores overly small saved preferred tile sizes.
