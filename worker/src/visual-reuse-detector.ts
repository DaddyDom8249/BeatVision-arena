export type ReuseCandidate = {
  shot_id: string;
  compared_to: string;
  reason: 'content_hash' | 'perceptual_hash' | 'semantic_similarity';
  score: number;
  intentional: boolean;
};

const tokens = (value: unknown): Set<string> => new Set(String(value ?? '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(x => x.length > 2));

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let intersection = 0;
  for (const item of a) if (b.has(item)) intersection++;
  return intersection / (a.size + b.size - intersection);
}

function hashDistance(a: string, b: string): number | null {
  const left = a.trim().toLowerCase();
  const right = b.trim().toLowerCase();
  if (!left || !right || left.length !== right.length || !/^[0-9a-f]+$/.test(left) || !/^[0-9a-f]+$/.test(right)) return null;
  let distance = 0;
  for (let i = 0; i < left.length; i++) {
    const x = parseInt(left[i], 16) ^ parseInt(right[i], 16);
    distance += x.toString(2).split('1').length - 1;
  }
  return distance;
}

function semanticFingerprint(shot: any): string {
  const explicit = Array.isArray(shot?.semantic_fingerprint) ? shot.semantic_fingerprint.join(' ') : shot?.semantic_fingerprint;
  if (String(explicit ?? '').trim()) return String(explicit);
  return [
    shot?.lyricMeaning ?? shot?.lyric_meaning,
    shot?.narrativePurpose ?? shot?.narrative_purpose,
    shot?.emotionalState ?? shot?.emotional_state,
    shot?.characterState ?? shot?.character_state,
    shot?.environment,
    shot?.action,
    shot?.visualConcept ?? shot?.visual_concept,
    shot?.cameraIntent ?? shot?.camera_intent,
    Array.isArray(shot?.symbolicElements) ? shot.symbolicElements.join(' ') : shot?.symbolic_elements,
  ].filter(Boolean).join(' ');
}

export function detectVisualReuse(shots: any[], threshold = 0.82): ReuseCandidate[] {
  const findings: ReuseCandidate[] = [];
  const ordered = Array.isArray(shots) ? shots : [];
  for (let i = 0; i < ordered.length; i++) {
    const current = ordered[i];
    const currentIntentional = String(current?.role ?? current?.reusePolicy ?? '').toLowerCase().includes('motif');
    for (let j = 0; j < i; j++) {
      const previous = ordered[j];
      const previousIntentional = String(previous?.role ?? previous?.reusePolicy ?? '').toLowerCase().includes('motif');
      const intentional = currentIntentional || previousIntentional;
      if (current?.asset_id && current.asset_id === previous?.asset_id) {
        findings.push({ shot_id: String(current.id ?? current.beatId ?? i), compared_to: String(previous.id ?? previous.beatId ?? j), reason: 'content_hash', score: 1, intentional });
        continue;
      }
      const currentHash = current?.perceptual_hash ?? current?.asset?.perceptual_hash;
      const previousHash = previous?.perceptual_hash ?? previous?.asset?.perceptual_hash;
      const distance = hashDistance(String(currentHash ?? ''), String(previousHash ?? ''));
      if (distance !== null) {
        const bits = String(currentHash).length * 4;
        const score = bits ? 1 - distance / bits : 0;
        if (score >= 0.90) findings.push({ shot_id: String(current.id ?? current.beatId ?? i), compared_to: String(previous.id ?? previous.beatId ?? j), reason: 'perceptual_hash', score: Number(score.toFixed(3)), intentional });
      }
      const semanticScore = jaccard(tokens(semanticFingerprint(current)), tokens(semanticFingerprint(previous)));
      if (semanticScore >= threshold) findings.push({ shot_id: String(current.id ?? current.beatId ?? i), compared_to: String(previous.id ?? previous.beatId ?? j), reason: 'semantic_similarity', score: Number(semanticScore.toFixed(3)), intentional });
    }
  }
  return findings;
}

export function assertNoUnapprovedReuse(shots: any[]): void {
  const findings = detectVisualReuse(shots).filter(x => !x.intentional);
  if (findings.length) {
    const detail = findings.slice(0, 12).map(x => `${x.shot_id}<-${x.compared_to}:${x.reason}:${x.score}`).join(', ');
    throw new Error(`UNAPPROVED_VISUAL_REUSE:${detail}`);
  }
}
