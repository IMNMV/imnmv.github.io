/* The model runs here, off the page's own thread, so the page stays smooth.
   Same pinned WebLLM file as robot.js. */
import { WebWorkerMLCEngineHandler } from "https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@0.2.89/lib/index.js";

const handler = new WebWorkerMLCEngineHandler();
self.onmessage = (msg) => handler.onmessage(msg);
