import { z } from 'zod';

const coordinate = z.number().min(0).max(640);
const colour = z.string().regex(/^(#[0-9a-fA-F]{6}|none)$/);
const shape = z.object({
  type: z.enum(['ellipse', 'rect', 'line', 'path']),
  x: coordinate, y: coordinate,
  width: coordinate, height: coordinate,
  fill: colour, stroke: colour,
  strokeWidth: z.number().min(0).max(12),
  // A tiny drawing language, not arbitrary SVG markup, URLs, or executable content.
  path: z.string().max(1500).regex(/^[MLCQZmlcqz0-9.,\s-]*$/),
}).strict();

export const sketchSchema = z.object({
  description: z.string().min(1).max(300),
  background: colour,
  shapes: z.array(shape).min(1).max(80),
}).strict();
export type Sketch = z.infer<typeof sketchSchema>;

// Provider schema omits bounds unsupported by structured outputs. Runtime validation above
// remains authoritative, including size and SVG attribute constraints.
export const sketchJsonSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    description: { type: 'string', description: 'Short accessible description, at most 300 characters.' },
    background: { type: 'string', description: 'Six-digit hex colour.' },
    shapes: { type: 'array', items: {
      type: 'object', additionalProperties: false,
      properties: {
        type: { type: 'string', enum: ['ellipse', 'rect', 'line', 'path'] },
        x: { type: 'number' }, y: { type: 'number' },
        width: { type: 'number' }, height: { type: 'number' },
        fill: { type: 'string' }, stroke: { type: 'string' }, strokeWidth: { type: 'number' },
        path: { type: 'string' },
      },
      required: ['type', 'x', 'y', 'width', 'height', 'fill', 'stroke', 'strokeWidth', 'path'],
    } },
  }, required: ['description', 'background', 'shapes'],
} as const;

export function renderSketch(input: unknown): { svg: string; description: string } {
  const sketch = sketchSchema.parse(input);
  const shapes = sketch.shapes.map((s) => {
    const paint = `fill="${s.fill}" stroke="${s.stroke}" stroke-width="${s.strokeWidth}"`;
    if (s.type === 'ellipse') return `<ellipse cx="${s.x}" cy="${s.y}" rx="${s.width / 2}" ry="${s.height / 2}" ${paint}/>`;
    if (s.type === 'rect') return `<rect x="${s.x}" y="${s.y}" width="${s.width}" height="${s.height}" rx="4" ${paint}/>`;
    if (s.type === 'line') return `<line x1="${s.x}" y1="${s.y}" x2="${s.width}" y2="${s.height}" ${paint}/>`;
    return `<path d="${s.path}" ${paint}/>`;
  });
  return {
    description: sketch.description,
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360" width="640" height="360"><rect width="640" height="360" fill="${sketch.background}"/><g stroke-linecap="round" stroke-linejoin="round">${shapes.join('')}</g></svg>`,
  };
}

export function svgDataUrl(svg: string): string {
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}
