export function compileCharacterContinuity(scene: any, world: any): string {
  const anchor = scene?.character_continuity_anchor ?? scene?.characterContinuityAnchor ?? null;
  const concept = world?.character_concept ?? world?.characterConcept ?? null;
  if (!anchor && !concept) return '';
  const identity = typeof concept === 'string' ? concept : JSON.stringify(concept ?? '');
  return [
    'CHARACTER CONTINUITY:',
    anchor ? `Continuity anchor: ${String(anchor).slice(0, 120)}.` : '',
    identity ? `Canonical character identity: ${String(identity).slice(0, 1200)}.` : '',
    'Treat the canonical identity as persistent across scenes. Preserve recognizable face, hair, body proportions, clothing silhouette, signature accessories, and defining physical traits unless the storyboard explicitly changes them.',
    'Change pose, action, framing, lighting, and environment when required by the beat, but do not redesign the character merely to create visual variety.'
  ].filter(Boolean).join('\n');
}
