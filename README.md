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

## The geometry

This is the part that has to be physically right, so it is worth stating precisely. All physical
values are centimetres; pixels only appear at the two boundaries (the source image, and the exported
raster at the chosen DPI).

```
printable = sheet − 2 × margin          image area available on one sheet
step      = printable − overlap         what one sheet actually adds to the poster
grid      = cols × step + overlap       total span of a cols × rows grid
```

The **overlap** is the crux. Neighbouring sheets repeat a strip of picture, so a cut that wanders by
less than the strip width still leaves no white gap. That repetition means each sheet contributes
`step`, not `printable` — which is why turning the overlap up can cost you an extra column.

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

Every mark lives in one of two zones that do not survive assembly: the **margin**, which gets cut
off, and the **right/bottom overlap strip**, which the neighbouring sheet is laid on top of. That is
enforced by a keep-out clip in `core/marks.ts`, not by careful arithmetic — the rasteriser cannot put
ink on the finished poster even if a mark is nudged.

| Mark | Where | Why |
| --- | --- | --- |
| Dashed trim line | margin, its inner edge exactly on the picture boundary | cut along the inside of the line and the crop is dead on |
| Corner L-marks | margin, meeting at each corner | make two sheets' L's collinear and the seam is registered |
| Mid-edge ticks | margin, halfway along each seam | catches skew that corners alone hide |
| Overlap guide line | inside the right/bottom strip | slide the next sheet until its cut edge sits on the line |
| Sheet id + spec | margin (top when there is a sheet above, else bottom) | survives shuffling, gets trimmed away |
| TOP arrow | top margin | sheets get shuffled |

Because the overlap strips only ever need one cut per seam, the recommended procedure is: trim the
**left and top** margin of every sheet, then lay each over its neighbour. Without an overlap every
seam is a butt joint and both edges must be cut.

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

- **Pixel-exact reconstruction.** At 254 DPI (exactly 100 px/cm) with a source sized so one source
  pixel is one device pixel, the rendered tiles were cropped on their trim lines and re-assembled.
  Result: 0 differing pixels out of 6.0 M — and 0 of 11.1 M for a ragged 2 × 5 grid — in four
  configurations (4 mm overlap, butt joint, ragged grid, landscape sheets).
- **Mark containment.** Each sheet rendered with and without marks and differenced: 55 613 mark
  pixels drawn, 0 of them inside the area that survives assembly.
- **Seam registration when upscaling.** At 2.5× upscale the shared strip as drawn by one sheet
  versus its neighbour differs by a mean of 0.00/255 (worst single pixel 1/255).
- **PDF true scale.** Every page 595.276 × 841.890 pt = 21.00 × 29.70 cm; page count = sheets + map.
- **DPI tagging.** Exported tile PNGs read back at the density they were exported at.
- **Layout maths.** A4 printable 20.0 × 28.7 cm and step 19.6 × 28.3 cm at 5 mm margin / 4 mm
  overlap; a 1 × 1 grid spans exactly the printable box; every seam duplicates exactly the overlap
  width; the last tile's crop reaches the source's far corner; `ceil` does not overshoot on an exact
  fit.

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

- Colours pass through untouched and assume sRGB. Printer, driver and paper calibration decide the
  rest — print one sheet as a test before committing twenty.
- Upscaling places and interpolates pixels; it does not invent detail. Run an AI upscale first if the
  effective DPI warning is unhappy.
- 600 DPI on many sheets is a lot of pixels (an A4 sheet is 4961 × 7016). It works, but 300 DPI is
  indistinguishable on home printers and exports far faster.
- WEBP and AVIF carry no density field, so "density in file" stays blank for them. It is
  informational only and never drives the tiling.
