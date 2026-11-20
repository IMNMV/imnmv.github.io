# nykkovitali.com

The live site is the hand-written pages in `docs/`: `index.html`, `cv.html`, `resume.html` and `posters.html`, with `site.css` and `site.js`. GitHub Pages serves that folder. There is no build step: edit those files and push.

When the CV or resume PDF changes, replace it in `docs/files/` and remake the page images:

    pdftoppm -r 170 -png docs/files/VitaliNykko_2026_CV.pdf docs/images/pages/cv
    pdftoppm -r 170 -png docs/files/VitaliNykko_2026_Resume.pdf docs/images/pages/resume

The Quarto files in this folder (`_quarto.yml`, the `.qmd` pages, `custom.css`, `styles.scss`, `includes/`) are the previous version of the site, kept for reference. `_quarto.yml` now writes to `_quarto_old_output/`, so rendering it cannot overwrite the live pages.
