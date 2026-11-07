// Compatibility entry point: GEO now has its own worker.
console.warn('worker:external is deprecated; use worker:media and worker:geo');
await import('./media-worker.mjs');
