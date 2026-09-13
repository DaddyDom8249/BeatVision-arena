import baseGateway from './video-fallback-gateway';

const composition = [
  'wide environmental establishing composition with the character small in frame',
  'medium character-focused composition with visible interaction with the environment',
  'tight emotional close-up emphasizing face, hands, or a meaningful object',
  'side/profile composition with strong negative space and directional movement',
  'low-angle composition making the environment feel imposing around the character',
  'high-angle or elevated composition revealing spatial relationships',
  'silhouette/backlit composition using the established world lighting and atmosphere',
  'reflection/foreground-obstruction composition using glass, mirrors, rain, architecture, or another established motif'
];
const action = [
  'walking or changing position through the established location',
  'interacting with a meaningful object or environmental element',
  'pausing and reacting physically to an internal realization',
  'turning, looking, or tracking something outside the frame',
  'moving from one spatial zone to another',
  'performing a restrained physical gesture that expresses the beat emotion',
  'observing the environment while the environment provides the visual event',
  'creating a visible consequence of the previous beat'
];
const camera = [
  'slow lateral tracking move',
  'slow push-in',
  'slow pull-back revealing context',
  'controlled handheld follow',
  'arc around the subject',
  'vertical reveal or tilt',
  'locked-off composition with environmental motion',
  'foreground-to-background rack-focus style reveal'
];
const lighting = [
  'rainy diffuse backlight',
  'hard side light through architecture',
  'practical interior light against deep shadow',
  'cool reflected city light',
  'strong silhouette against atmospheric haze',
  'isolated pool of light surrounded by darkness',
  'wet reflective surfaces catching sparse highlights',
  'mixed warm interior and cold exterior light'
];

function hash(text: string) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < text.length; i += 1) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}
function pick<T>(items: T[], h: number, offset: number) { return items[(h + offset) % items.length]; }

function variationDirective(scene: any, index: number, total: number) {
  const id = String(scene?.beatId || scene?.beat_id || scene?.scene || index + 1);
  const h = hash(id);
  const previous = scene?.previousBeat || scene?.previous_beat || 'none';
  const next = scene?.nextBeat || scene?.next_beat || 'none';
  return [
    'VISUAL DIVERSITY DIRECTIVE:',
    `This is visual beat ${index + 1} of ${total}. Generate a genuinely new visual event, not a reordered or recolored copy of another beat.`,
    `Composition: ${pick(composition, h, 0)}.`,
    `Primary action: ${pick(action, h, 1)}.`,
    `Camera language: ${pick(camera, h, 2)}.`,
    `Lighting treatment: ${pick(lighting, h, 3)}.`,
    `Previous beat: ${previous}. Next beat: ${next}. The transition must feel causally connected while the image itself remains distinct.`,
    'Preserve the established character identity, world rules, locations, motifs, emotional truth, and original concept.',
    'Do not duplicate the previous beat composition, pose, framing, camera angle, or primary action unless reusePolicy explicitly says intentional_motif_return.',
    'Do not create a generic portrait merely because the character is present. The environment and action must contribute to the story.',
    'If reusePolicy is intentional_motif_return, revisit the motif with a materially different composition, consequence, or emotional state rather than copying the earlier shot.'
  ].join(' ');
}

export default {
  async fetch(request: Request, env: any, ctx: ExecutionContext) {
    if (request.method === 'POST') {
      const contentType = request.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        try {
          const body = await request.clone().json();
          if (body?.operation === 'sceneImages' && body?.payload?.storyboard?.scenes) {
            const scenes = Array.isArray(body.payload.storyboard.scenes) ? body.payload.storyboard.scenes : [];
            body.payload.storyboard.scenes = scenes.map((scene: any, index: number) => ({
              ...scene,
              visual_variation_directive: variationDirective(scene, index, scenes.length)
            }));
            return baseGateway.fetch(new Request(request, { body: JSON.stringify(body) }), env, ctx);
          }
        } catch {
          // Let the authoritative gateway return its normal validation/error response.
        }
      }
    }
    return baseGateway.fetch(request, env, ctx);
  }
};
