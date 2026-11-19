export const POWER_LIMITS = Object.freeze({
  minEffectSize: 0.01,
  maxEffectSize: 5,
  minAlpha: 0.0001,
  maxAlpha: 0.20,
  minTargetPower: 0.50,
  maxTargetPower: 0.999,
  minSampleSize: 2,
  maxSampleSize: 500_000,
});

// Positive nodes and corresponding weights of the 16-point Gauss-Legendre rule.
// https://dlmf.nist.gov/3.5
const QUADRATURE = [
  [0.09501250983763744, 0.18945061045506850],
  [0.28160355077925891, 0.18260341504492359],
  [0.45801677765722739, 0.16915651939500254],
  [0.61787624440264375, 0.14959598881657673],
  [0.75540440835500303, 0.12462897125553387],
  [0.86563120238783174, 0.09515851168249278],
  [0.94457502307323258, 0.06225352393864789],
  [0.98940093499164993, 0.02715245941175409],
];
const NORMAL_TAIL_CUTOFF = 8.25;
const DENSITY_CUTOFF = 12;
const SQRT_TWO_PI = Math.sqrt(2 * Math.PI);

function integrate(density, from, to, maxPanelWidth = 1) {
  if (from >= to) return 0;

  const panels = Math.ceil((to - from) / maxPanelWidth);
  const width = (to - from) / panels;
  const halfWidth = width / 2;
  let area = 0;
  for (let panel = 0; panel < panels; panel += 1) {
    const center = from + (panel + 0.5) * width;
    for (const [node, weight] of QUADRATURE) {
      const offset = node * halfWidth;
      area += weight * (density(center - offset) + density(center + offset));
    }
  }
  return halfWidth * area;
}

function normalCdf(z) {
  if (z < -NORMAL_TAIL_CUTOFF) return 0;
  if (z > NORMAL_TAIL_CUTOFF) return 1;

  // Marsaglia's series for (Phi(z) - 0.5) / phi(z).
  // https://doi.org/10.18637/jss.v011.i04
  const square = z * z;
  let term = z;
  let sum = term;
  for (let denominator = 3; ; denominator += 2) {
    term *= square / denominator;
    const next = sum + term;
    if (next === sum) break;
    sum = next;
  }
  return Math.max(0, Math.min(1, 0.5 + sum * Math.exp(-square / 2) / SQRT_TWO_PI));
}

function centralTCriticalValue(degreesOfFreedom, tailProbability) {
  // Transform t = sqrt(df) * tan(theta). The central t density then has
  // weight cos(theta)^(df - 1). Scale theta by sqrt(df) to resolve its peak.
  const scale = Math.sqrt(degreesOfFreedom);
  const limit = Math.min(DENSITY_CUTOFF, scale * Math.PI / 2);
  const weight = (scaledAngle) => {
    const sineOfHalfAngle = Math.sin(scaledAngle / (2 * scale));
    return Math.exp((degreesOfFreedom - 1) * Math.log1p(-2 * sineOfHalfAngle ** 2));
  };
  const tailArea = 2 * tailProbability * integrate(weight, 0, limit);

  let lower = 0;
  let upper = limit;
  for (let iteration = 0; iteration < 46; iteration += 1) {
    const midpoint = (lower + upper) / 2;
    if (integrate(weight, midpoint, limit) > tailArea) {
      lower = midpoint;
    } else {
      upper = midpoint;
    }
  }
  return scale * Math.tan((lower + upper) / (2 * scale));
}

function chiDensity(degreesOfFreedom) {
  const mode = Math.sqrt(degreesOfFreedom - 1);
  return {
    from: Math.max(0, mode - DENSITY_CUTOFF),
    to: mode + DENSITY_CUTOFF,
    // Evaluate the density relative to its value at the mode. This avoids
    // taking a ratio of huge gamma functions and preserves large-df precision.
    weight(y) {
      const offset = y - mode;
      if (mode === 0) return Math.exp(-y * y / 2);
      const relativeOffset = offset / mode;
      const logWeight = (degreesOfFreedom - 1) * (Math.log1p(relativeOffset) - relativeOffset);
      return Math.exp(logWeight - offset * offset / 2);
    },
  };
}

function powerForDesign({ design, effectSize, alpha, tails }, sampleSize) {
  const independent = design === 'independent';
  const degreesOfFreedom = (sampleSize - 1) * (independent ? 2 : 1);
  const noncentrality = effectSize * Math.sqrt(independent ? sampleSize / 2 : sampleSize);
  const critical = centralTCriticalValue(degreesOfFreedom, alpha / tails);
  const slope = critical / Math.sqrt(degreesOfFreedom);
  const { from, to, weight } = chiDensity(degreesOfFreedom);
  const normalization = integrate(weight, from, to);

  // If Y is the square root of chi-square(df), condition on Y in the
  // noncentral t representation (Z + noncentrality) * sqrt(df) / Y.
  // https://stat.ethz.ch/R-manual/R-devel/library/stats/html/TDist.html
  const tailArea = (shift) => {
    // Locate the CDF transition so narrow tails are resolved even for df = 1.
    const transitionStart = Math.min(to, Math.max(from, (shift - NORMAL_TAIL_CUTOFF) / slope));
    const transitionEnd = Math.min(to, Math.max(from, (shift + NORMAL_TAIL_CUTOFF) / slope));
    return integrate(weight, from, transitionStart)
      + integrate((y) => weight(y) * normalCdf(shift - slope * y), transitionStart, transitionEnd,
        Math.min(1, 3 / slope));
  };

  const area = tailArea(noncentrality) + (tails === 2 ? tailArea(-noncentrality) : 0);
  return Math.max(0, Math.min(1, area / normalization));
}

function requireBetween(name, value, min, max) {
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new RangeError(`${name} must be between ${min} and ${max}`);
  }
}

function validateDesign({ design, effectSize, alpha, tails, ratio = 1 }) {
  if (design !== 'independent' && design !== 'paired') {
    throw new RangeError('design must be independent or paired');
  }
  if (ratio !== 1) throw new RangeError('ratio must be 1');
  requireBetween('effectSize', effectSize, POWER_LIMITS.minEffectSize, POWER_LIMITS.maxEffectSize);
  requireBetween('alpha', alpha, POWER_LIMITS.minAlpha, POWER_LIMITS.maxAlpha);
  if (tails !== 1 && tails !== 2) throw new RangeError('tails must be 1 or 2');
}

/**
 * Compute prospective t-test power at a fixed sample size.
 * Independent means an equal-variance t test with equal groups, and
 * sampleSize is per group. The effect is a mean difference divided by
 * the common SD. Paired means a t test on differences, with the mean
 * difference divided by the SD of differences; sampleSize counts pairs.
 * For one tail, the true effect is in the direction of the stated alternative.
 */
export function powerAtSample(options) {
  validateDesign(options);
  const { sampleSize } = options;
  requireBetween('sampleSize', sampleSize, POWER_LIMITS.minSampleSize, POWER_LIMITS.maxSampleSize);
  if (!Number.isInteger(sampleSize)) throw new RangeError('sampleSize must be an integer');
  return powerForDesign(options, sampleSize);
}

/** Find the smallest integer group size or number of pairs meeting the target. */
export function planPower(options) {
  validateDesign(options);
  const { design, targetPower } = options;
  requireBetween('targetPower', targetPower, POWER_LIMITS.minTargetPower, POWER_LIMITS.maxTargetPower);

  const limit = POWER_LIMITS.maxSampleSize;
  let lower = POWER_LIMITS.minSampleSize - 1;
  let upper = POWER_LIMITS.minSampleSize;
  let achievedPower = powerForDesign(options, upper);
  while (achievedPower < targetPower && upper < limit) {
    lower = upper;
    upper = Math.min(limit, upper * 2);
    achievedPower = powerForDesign(options, upper);
  }
  if (achievedPower < targetPower) {
    throw new RangeError('targetPower requires more than the maximum supported sampleSize');
  }

  while (upper - lower > 1) {
    const midpoint = Math.floor((lower + upper) / 2);
    const power = powerForDesign(options, midpoint);
    if (power >= targetPower) {
      upper = midpoint;
      achievedPower = power;
    } else {
      lower = midpoint;
    }
  }

  return {
    sampleSize: upper,
    totalSampleSize: design === 'independent' ? upper * 2 : upper,
    achievedPower,
  };
}
