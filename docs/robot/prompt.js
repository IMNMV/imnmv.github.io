/* Every word the robot's model is sent.
   Third wording, approved by Nyk on Nov 22 2026 (shown in chat, "Sure yeah go ahead").
   Earlier wordings, also approved that day, are kept in mockups/robot/prompts/ (v1.js, v2.js)
   with the test runs that showed their faults (redesign/LOG.md): the model copied v1's example
   answer, and under v2 it chose "walk" almost every turn and said its instructions back.
   Change nothing in the words below without Nyk's approval of the new wording.

   Each turn has two questions. First the move: where to go, and what to do there. Then, once
   the robot has walked there, its line, with the words written at that place in front of it.

   Two rules shape the move, because this small model otherwise repeats itself: the place it
   stands on is left out of the places, and the thing it did last turn is left out of the
   things it can do. Both lists are put in a new random order every turn, since the model
   leans towards whatever is listed first. */

const WHO = "You are a tiny robot that lives on Nykko Vitali's website. You are a small language model running inside the visitor's browser.";

/* ---------- the move ---------- */

export const SYSTEM = `${WHO} Each turn you go to one place on the page and do one thing there.

Answer with JSON only, with two parts: "where" and "do".`;

export const ORDER = ["where", "do"];     // the order of the answer's parts

export const DOS = {
  zap: "fire sparks at it",
  point: "aim at it so the visitor looks",
  look: "read what it says",
};

const shuffled = (list) => {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

/* The words of the move question, and the choices its answer is held to (the same two lists).
   The page fills in:
     at        the place the robot stands at
     pointer   the place under the visitor's pointer, or "you", "empty space", "off the page"
     moves     its moves so far; only the last is told (line left out before the first move)
     onScreen  the places the visitor can see right now */
export const frame = ({ at, onScreen, pointer, moves }) => {
  const last = moves.length ? moves[moves.length - 1] : "";
  const lastDo = last.split(" ")[0];
  const dos = shuffled(Object.keys(DOS).filter((d) => d !== lastDo));
  const places = shuffled(onScreen.filter((p) => p !== at));
  const user = [
    `You are at: ${at}.`,
    `The visitor's pointer is at: ${pointer}.`,
    last ? `You just did: ${last}.` : null,
    `Places you can go to: ${places.join(", ")}.`,
    "Things you can do there:",
    ...dos.map((d) => `${d} = ${DOS[d]}`),
    "Where do you go, and what do you do there?",
  ].filter(Boolean).join("\n");
  return { user, dos, places };
};

/* ---------- the line, asked when it has arrived ----------
   says: the words at the place, cut to 120 characters (line left out when there are none).
   The repetition penalty is a sampling number for this question only: without it the model
   sometimes loops ("I will say 'I will say 'I will say"). */
export const speak = ({ at, says, pointer }) => ({
  system: `${WHO} Nykko is the person who made this website. You say one short sentence to the visitor, at most 12 words.

Answer with JSON only, with one part: "say".`,
  sampling: { repetition_penalty: 1.1 },
  user: (at === "visitor" ? [
    "You are at: the visitor's pointer.",
    `The pointer is at: ${pointer}.`,
    "What do you say to the visitor?",
  ] : [
    `You are at: ${at}.`,
    says ? `Here it says: "${says}"` : null,
    "What do you say to the visitor about it?",
  ]).filter(Boolean).join("\n"),
});

/* Said by the page, not by the model, when the robot wakes (Nyk's words). */
export const FIRST_LINE = "I'm an LLM currently running on this web page.";
