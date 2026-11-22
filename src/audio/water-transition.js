export function createWaterTransition() {
  let previous, candidate, stable = 0, cooldown = 0, strength = 0, dryStrength = 0;
  return (wet, speed, vertical, dt) => {
    cooldown = Math.max(0, cooldown - dt);
    const impact = Math.min(1, Math.max(speed / 10, Math.abs(vertical) / 8));
    if (previous === undefined) { previous = candidate = wet; if (!wet) dryStrength = impact; return null; }
    if (wet === previous) { candidate = wet; stable = strength = 0; if (!wet) dryStrength = impact; return null; }
    if (candidate !== wet) { candidate = wet; stable = 0; strength = wet ? dryStrength : 0; }
    stable += dt;
    // Guarda o impacto antes de a física amortecer a velocidade dentro da água.
    strength = Math.max(strength, impact);
    if (stable < 0.1) return null;
    previous = wet; stable = 0;
    if (cooldown > 0) return null;
    cooldown = 0.32;
    return { name: wet ? 'water-enter' : 'water-exit', volume: (0.2 + strength * 0.7) * (wet ? 1 : 0.55) };
  };
}
