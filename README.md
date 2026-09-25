# TileCraft

Turn one high-resolution image into a stack of paper tiles that tape back together into a wall-sized
poster. Everything runs in the browser — the image is never uploaded anywhere.

```
npm install
npm run dev      # http://localhost:5173
npm run build    # → app/tilecraft.html, one self-contained file
```

`app/tilecraft.html` needs no server and no install: open it from disk and it works. That is the
copy to keep around for the five minutes before a print run.

---

## Joining the sheets

A home printer cannot print its own paper edge. On an Epson EcoTank L3200 that band is
[3 mm on all four sides](https://files.support.epson.com/docid/cpd6/cpd60185/source/specifications/references/l3250/spex_printable_area_spc_l3250.html),
and borderless printing stops at 13 × 18 cm — A4 borderless is not offered.

That single fact decides everything. The unprintable band lies at the extreme edge of the sheet, so
at a seam it is always the topmost layer: **no amount of overlapping can hide it.** Seamless and
no-cutting are mutually exclusive on A4. So there are three honest options, and the app implements
all of them:

| Join | Cutting | Seams | Cost |
| --- | --- | --- | --- |
| **No cut — on the ink** | none | even 3 mm white lines | 1.7% of the picture lost in the lines |
| **No cut — edges touch** | none | even 6 mm white lines | 3.5% lost; zero judgement needed |
| **Trim & overlap** | every sheet | invisible | 20+ careful knife cuts |
| **Borderless** | none | invisible | 10 × 15 / 13 × 18 photo paper, waste-pad wear |

The white lines are not a defect to apologise for — evenly spaced, they read as a deliberate panel
grid. What makes that work is that the strip of picture falling inside each gutter is **dropped, not
squeezed**: every sheet shows the slice belonging to its true physical position, so a diagonal line
continues correctly across the gap instead of jumping.

**"On the ink"** is the recommended no-cut mode and worth explaining. Instead of butting paper edges
(which puts two unprinted 3 mm bands side by side, doubling the line), you lay each new sheet so its
edge lands *on its neighbour's ink*, and the export prints a faint dashed line marking exactly where
that edge should go. Overshooting is harmless — the gutter stays 3 mm either way — so it is forgiving
to do by hand, and the guide line, the sheet id and everything else live inside the strip that gets
covered, so they vanish as you assemble.

## The geometry

All physical values are centimetres; pixels only appear at the two boundaries (the source image, and
the exported raster at the chosen DPI). Per axis, with sheet size `S` and margin `m`:

```
printable P = S − 2m                 the band of paper that can carry ink
span(n)     = (n−1) · step + P        physical extent of n sheets
gutter      = step − (P − hidden)     unprinted gap left between sheets

              step              hidden    gutter
trim          P − overlap        overlap   0
nocut/butt    S                  0        2m
nocut/tight   S − m − cover      cover     m
borderless    S       (m = 0)     0        0
```

`hidden` is the strip of a sheet's own ink that its neighbour is laid over — the shared overlap in
trim mode, the sacrificed cover strip in tight mode. It is also the only place marks may go.

The printed image occupies `[0, imageCm]` in poster coordinates. Tile `(r, c)` carries poster-x
`[c·step, c·step + printable]`, clipped to the image. Where the clip bites — the last row or column,
or a deliberately oversized grid — the tile is **partial**: it holds less picture and its trim box
shrinks to match, so the marks still sit exactly on the picture's edge. Cells with no picture at all
are dropped from the export rather than printed blank.

Two ways to drive it, kept in sync so switching modes preserves the physical size:

- **By sheet grid** — set columns; rows either follow the aspect ratio (filling the grid width
  exactly) or are pinned, in which case the image is contained inside the grid without distortion.
  There is also "fit *N* sheets", which picks the `cols × rows` closest to the image's proportions.
- **By print size** — set height or width in cm; the other follows the aspect ratio and the grid is
  `ceil(size / step)`. Because of that `ceil`, asking for 100 cm wide can spill 1 cm into an extra
  column and cost a whole stack of sheets, so the panel offers the nearby sizes that end on a whole
  sheet.

### Assembly marks

Every mark lives in a zone that does not survive assembly, and which zones exist depends on the join:

| Join | Legal zones | Marks |
| --- | --- | --- |
| trim | margin (cut off) + overlap strip (cut off or covered) | cut lines, corner crosshairs, mid-edge ticks, overlap guides, id, TOP arrow |
| nocut / tight | cover strip only — the margin is *unprintable* | "cover to here" dashed line + id |
| nocut / butt | none | id only, opt-in, and permanent |
| borderless | none | id only, opt-in, and permanent |

In the first two cases this is enforced by a keep-out clip in `core/marks.ts` rather than by careful
arithmetic — the rasteriser cannot put ink on the finished poster even if a mark is nudged. The clip
rounds outward to whole device pixels, which also kills antialiasing bleed at the boundary.

### What the overlap is for — two conventions

Trim mode asks one more question, because the same geometry supports two ways of closing a seam:

**Cut & butt** (default, the Rasterbator method). The cut lines are printed **on the logical
boundary — inside the duplicated strip, not at the sheet edge.** You cut both sheets there, throw the
duplicated strip away, and the two cut edges meet on *identical image content*, so the picture runs
straight through the join. The overlap is your error budget: a cut that wanders by less than its
width still lands on real picture rather than blank paper. Corner crosshairs are drawn on the corners
of that same logical rect, so matching them across a seam registers the two sheets.

**Lap & glue.** Cut only the leading (left/top) edge of each sheet, then lay it over its neighbour,
aligning the cut edge to a guide line inside the strip. Half the cuts, but the seam is a lap.

Both are exact; `cut` is what the references describe and is the default.

### Resampling

`Lanczos 3` (default) or `Fast`. Lanczos matters here because a poster is almost always *larger* than
its source, and `drawImage` upscales with a soft bilinear filter.

The subtle part: each crop is widened by the filter's support radius before resizing, then the region
of interest is taken back out. Without that, every tile edge would be filtered against a wall of
clamped pixels and adjacent sheets would disagree along the seam. With it, per-tile Lanczos is
identical to resizing the whole poster in one go — measured mean difference **0.000/255**. Cost is
roughly 0.2–0.3 s per sheet; previews always use the fast path.

### Export

- **PNG** per sheet, at the chosen DPI, with a `pHYs` chunk written in so the file declares its real
  density instead of the browser's default 72 (`core/png.ts`). Without that, "print at 100%" is a
  coin flip.
- **ZIP** of every sheet plus the assembly map and a `PRINT-ME.txt`. Stored, not deflated — PNG is
  already compressed.
- **PDF**, one page per sheet, page size in PDF points computed from the real sheet size (A4 =
  595.276 × 841.890 pt). The image fills the page, so "Actual size" in the print dialog reproduces
  the design in centimetres with no scaling decision left to the driver.
- **Assembly map** goes first in every export: the labelled grid, the full specification, the
  assembly steps and a legend for the marks.

Scaling uses stepped halving before the final resize (`core/resample.ts`). A single `drawImage` that
shrinks by more than ~2× drops source pixels and aliases fine detail, which is very visible on
paper.

---

## What was verified

Checked in a headless browser against a hard-edged synthetic pattern, plus a numeric pass over the
layout maths:

- **Pixel-exact reconstruction, every join style.** At 254 DPI (exactly 100 px/cm) with a source
  sized so one source pixel is one device pixel, the rendered sheets were assembled the way hands
  would — taking only the visible part of each, since the next sheet covers the rest — and compared
  against the source with the printer's gutters knocked out. **0 differing pixels of 24 M** for each
  of: trim + overlap, trim butt joint, no-cut edges-touching, no-cut on-the-ink, the same in
  landscape, and borderless.
- **Gutter arithmetic.** Measured against the model on A4 with a 3 mm margin: trim 0 mm, no-cut
  butt 6.0 mm, no-cut tight 3.0 mm, borderless 0 mm; and `span == (cols−1)·step + printable` holds
  for all five.
- **Mark containment.** Sheets rendered with and without marks and differenced: 26 495 mark pixels
  drawn in no-cut mode, **0** inside surviving artwork and **0** in the unprintable margin.
- **Borderless bleed.** An interior sheet is handed exactly its own window plus 3 mm on every edge,
  filling the page, pre-shrunk to 95.59% so the driver's expansion restores true scale; the first
  sheet's bleed clips at the image edge, leaving white to spray away.
- **Cut & butt reconstruction.** Keeping only each sheet's logical rect (i.e. discarding the
  duplicated strip, as the crop marks instruct) and butting them: **0 differing pixels of 24 M**, at
  5 mm overlap, 10 mm overlap, and on landscape sheets.
- **Crop-mark placement.** On a sheet with a right-hand neighbour, the cut line is measured at
  20.00 cm — the logical boundary — while printed content runs to 20.50 cm on a 21 cm sheet. 0 mark
  pixels fall on the part that survives the cut, 3 609 fall inside the strip that gets discarded, and
  nothing is printed past the content edge on a shared side.
- **The advance width itself.** Every tile's crop starts at exactly `N × logical` in source pixels,
  and each shared edge duplicates exactly the overlap width.
- **Lanczos.** Exactly the identity at 1:1 (max channel Δ 0); a hard black/white edge stays within a
  4 px transition through a 4× enlargement; per-tile output matches a single global resize to a mean
  of 0.000/255.
- **Seam registration when upscaling.** At 2.5× upscale the shared strip as drawn by one sheet
  versus its neighbour differs by a mean of 0.00/255 (worst single pixel 1/255).
- **PDF true scale.** Every page 595.276 × 841.890 pt = 21.00 × 29.70 cm; page count = sheets + map.
- **DPI tagging.** Exported tile PNGs read back at the density they were exported at.

## Layout of the source

```
src/core/      pure logic, no React
  units.ts       cm / px / pt conversions, paper sizes
  layout.ts      the tiling engine: grid, crops, warnings
  marks.ts       registration marks + the keep-out clip
  renderTile.ts  one sheet → canvas
  overlay.ts     the grid overlay (screen + printed map share it)
  assemblyMap.ts the reference page
  resample.ts    stepped high-quality scaling
  png.ts         pHYs density tagging
  exporters.ts   PNG / ZIP / PDF
  imageMeta.ts   decode + read embedded density (PNG pHYs, JPEG JFIF/EXIF)
src/components/  UI
```

## Notes and limits

- The 3 mm margin default matches the L3200 series. If the white lines come out wider than the app
  predicts, your printer's real unprintable band is wider — measure it off a test print and set the
  margin to match. No-cut mode is forgiving about this: a wrong margin only changes the gutter width,
  it never breaks the alignment. Trim mode is not — there the margin sets where you cut.
- Borderless wears a dedicated waste pad that absorbs the over-spray, and only a service centre can
  replace it. A 25-sheet borderless poster is a real bite out of its life; that is the main reason
  no-cut is the default rather than borderless.
- Colours pass through untouched and assume sRGB. Printer, driver and paper calibration decide the
  rest — print one sheet as a test before committing twenty.
- Upscaling places and interpolates pixels; it does not invent detail. Run an AI upscale first if the
  effective DPI warning is unhappy.
- 600 DPI on many sheets is a lot of pixels (an A4 sheet is 4961 × 7016). It works, but 300 DPI is
  indistinguishable on home printers and exports far faster.
- WEBP and AVIF carry no density field, so "density in file" stays blank for them. It is
  informational only and never drives the tiling.
