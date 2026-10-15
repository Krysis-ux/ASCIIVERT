# ASCIIVERT

The conversion engine behind ASCIIVERT. Images, video and text to ASCII.

- `src/ascii` image/video to ASCII: sampling, tone, edges, dithering, glyph matching, color, export (txt, ANSI, HTML, SVG, PNG, JSON, video)
- `src/text` text to ASCII: FIGfont parser + smushing, Unicode styles
- `fonts` 328 FIGfonts

Runs in the browser (uses canvas).

```bash
npm install
npm test
```
