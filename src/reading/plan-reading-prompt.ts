/**
 * What a model is asked to look for (Sprint 1.9; ADR-0044 revision 1.1 Rules 3, 4).
 *
 * This is the only thing in the whole extraction arc that is genuinely about
 * *reading*, and the only place a model appears in it. Everything else — the
 * page raster, the placement, the scale, the arithmetic, the assembly, the
 * approval — belongs to code that already exists on one side or the other.
 *
 * ## The column that matters is the right-hand one
 *
 * | Asked                                  | **Never asked**                          |
 * | -------------------------------------- | ---------------------------------------- |
 * | a line you believe is a wall, in pixels | how long it is, how thick, what it joins |
 * | an opening symbol, and what it read as  | which wall hosts it, its swing, its hand |
 * | a text run, exactly as it appears       | what the number means, or its unit       |
 * | a confidence per observation            | an overall score for the drawing         |
 *
 * Every entry on the right is either a Skill that exists — `parseDimensionText`,
 * `associateDimensions`, `reconcileDimensions`, `pageProjection` (ArchiSimple
 * Sprint 046.6) — or something this platform deliberately does not model, like
 * door handedness. Asking for any of it would be ADR-0027.1 Rule 9 failing in
 * the one place it is hardest to notice: a number that looks right.
 *
 * `"3,40"` comes back as `"3,40"`.
 */

/** The schema the reply must satisfy, stated to the model in its own terms. */
export const PLAN_READING_SCHEMA = `{
  "observations": [
    { "kind": "wall",    "from": {"x": 0, "y": 0}, "to": {"x": 0, "y": 0}, "confidence": 0.0 },
    { "kind": "opening", "from": {"x": 0, "y": 0}, "to": {"x": 0, "y": 0}, "symbol": "door|window", "confidence": 0.0 },
    { "kind": "text",    "at":   {"x": 0, "y": 0}, "text": "as printed", "confidence": 0.0 }
  ]
}`;

export interface PlanReadingPromptInput {
  readonly pixelWidth: number;
  readonly pixelHeight: number;
}

/**
 * The instruction, composed here so it is reviewable as one thing.
 *
 * The page's pixel dimensions are stated because coordinates are meaningless
 * without them, and because a model told the frame is less likely to answer in
 * a normalised one it invented.
 */
export function planReadingInstruction(input: PlanReadingPromptInput): string {
  return [
    'You are reading an architectural floor plan drawing.',
    `The image is ${input.pixelWidth} by ${input.pixelHeight} pixels.`,
    '',
    'Report only what you can see. Give every coordinate in pixels from the',
    'top-left of the image. Reply with JSON matching this shape and nothing else:',
    '',
    PLAN_READING_SCHEMA,
    '',
    'Report:',
    '- every line you believe is a wall, as its two endpoints;',
    '- every door or window symbol, as the two ends of the gap it sits in,',
    '  and whether the symbol reads as a door or a window;',
    '- every text run, transcribed exactly as printed, including its decimal',
    '  separator and any unit — "3,40" stays "3,40".',
    '',
    'Do NOT report, calculate or infer:',
    '- the length, thickness or area of anything;',
    '- which walls meet, or which wall an opening or a dimension belongs to;',
    '- which lines enclose a room, or what any room is called;',
    '- the drawing scale, or any measurement in metres;',
    '- the direction a door swings.',
    '',
    'All of that is computed from your observations afterwards. A number you',
    'calculate would silently become a building dimension.',
    '',
    'Give each observation a confidence from 0 to 1 for that observation alone.',
    'If you cannot see something clearly, report it with a low confidence or',
    'leave it out — do not guess at its position.'
  ].join('\n');
}
