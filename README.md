# nykkovitali.com

The live site is the hand-written pages in `docs/`: `index.html`, `cv.html`, `resume.html` and `posters.html`, with `site.css` and `site.js`. GitHub Pages serves that folder. There is no build step: edit those files and push.

When the CV or resume PDF changes, replace it in `docs/files/` and remake the page images:

    pdftoppm -r 170 -png docs/files/VitaliNykko_2026_CV.pdf docs/images/pages/cv
    pdftoppm -r 170 -png docs/files/VitaliNykko_2026_Resume.pdf docs/images/pages/resume

The browser tab icon is drawn in `docs/icon.svg` (NV as one line, pink on black). `docs/favicon.ico` (16, 32 and 48 pixels) and `docs/apple-touch-icon.png` (180 pixels) are pictures of that drawing; if the drawing changes, save it as a 512 pixel picture and shrink it to those sizes again.

The mouse pointer is a small pixel brain (`docs/brain-cursor/`, started from `site.js` on pages whose body has `data-brain-cursor`). It only runs for a real mouse or trackpad. Adding `?beside=1` to an address keeps the ordinary arrow with the brain next to it, and `?cursor=robot` brings back the old robot.

The robot on the home page (`docs/robot/`, started from `site.js` on a page whose body has `data-robot`) looks like a small retro terminal head (`docs/robot/llm_slices.png`, from `/Users/nyk/gemini/brain-cursor`, drawn as a sprite stack by `docs/brain-cursor/sprite-stack.js`, so it turns as it walks) and is run by a small language model that downloads into the visitor's own browser: Qwen3 0.6B (352 MB), through WebLLM 0.2.89 on WebGPU. Nothing runs on a server and nothing is sent anywhere. The library comes from jsDelivr and the model from Hugging Face, so the robot needs both to be reachable. It is offered only for a real mouse or trackpad, with motion allowed, in a browser that has WebGPU. The model starts loading by itself a moment after the page has loaded, unless the browser reports data saver or a slow connection (only Chrome reports these) or the visitor stopped the robot last time; the label shows the size and progress, and a click stops it. Each turn the model is asked where to go and what to do there (look, point or zap), and then, once the robot has walked there, what to say. Every word the model is sent is in `docs/robot/prompt.js`; the model and that wording are Nykko's choices, so change either only with their say. `?robot=off` on an address hides the robot and `?robot=click` makes it wait for a click. Test pages and their read-outs are in `mockups/robot/`, and `redesign/LOG.md` has what each run showed.

The Quarto files in this folder (`_quarto.yml`, the `.qmd` pages, `custom.css`, `styles.scss`, `includes/`) are the previous version of the site, kept for reference. `_quarto.yml` now writes to `_quarto_old_output/`, so rendering it cannot overwrite the live pages.
