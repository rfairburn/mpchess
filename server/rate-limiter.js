/**
 * Per-IP sliding-window rate limiter.
 *
 * Each IP gets a bucket (array of timestamps). On every check, expired
 * entries are pruned, the remaining count is compared to the threshold,
 * and a new timestamp is pushed if allowed.
 */

/**
 * Create a rate limiter instance.
 * @param {number} max - Maximum number of events allowed per window.
 * @param {number} windowMs - Sliding window size in milliseconds.
 * @param {Map<string, number[]>} [sharedBuckets] - Optional pre-existing bucket map to share across limiter instances.
 * @returns {{ check(ip: string): {allowed: boolean, retryAfter?: number}, sweep(): void, buckets: Map<string, number[]> }}
 */
function createRateLimiter(max, windowMs, sharedBuckets) {
  const buckets = sharedBuckets || new Map();

  function prune(bucket) {
    const now = Date.now();
    while (bucket.length > 0 && bucket[0] <= now - windowMs) {
      bucket.shift();
    }
  }

  function check(ip) {
    const now = Date.now();
    let bucket = buckets.get(ip);
    if (!bucket) {
      bucket = [];
      buckets.set(ip, bucket);
    }
    prune(bucket);
    if (bucket.length >= max) {
      const retryAfter = Math.ceil((bucket[0] - (now - windowMs)) / 1000);
      return { allowed: false, retryAfter: Math.max(1, retryAfter) };
    }
    bucket.push(now);
    return { allowed: true };
  }

  function sweep() {
    for (const [ip, bucket] of buckets) {
      prune(bucket);
      if (bucket.length === 0) {
        buckets.delete(ip);
      }
    }
  }

  return { check, sweep, buckets };
}

module.exports = { createRateLimiter };
