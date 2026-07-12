# Pitch deck

`PITCH.md` is the submission deck — plain Markdown that is also a
[Marp](https://marp.app) presentation (front-matter + `---` slide breaks).

Export to PDF for the Builder Hub upload:

```bash
npx @marp-team/marp-cli pitch/PITCH.md --pdf --allow-local-files -o pitch/PITCH.pdf
```

(or `--pptx` for PowerPoint, or open in the VS Code Marp extension to present
directly). The deck's numbers (epochs, loans, gas) are from the live Fuji
deployment as of 2026-07-12 — re-check `https://window-indexer.onrender.com/health`
and `/loans` before presenting and bump them if the stack has kept running.
