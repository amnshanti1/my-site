export function pseudoRandomNoise(x, y, seed = 1337) {
  let n = Math.sin((x * 12.9898 + y * 78.233 + seed) * 43758.5453);
  return n - Math.floor(n);
}

export function animatedNoise(time, speed = 1) {
  const seed = Math.floor(time * speed * 1000);
  return pseudoRandomNoise(seed, seed / 3, seed);
}
