/**
 * Wraps an async Express route handler and forwards any rejected promise to next().
 * Eliminates the need for try/catch in every route handler.
 *
 * @param {Function} fn - Async route handler (req, res, next) => Promise
 * @returns {Function} Express middleware that catches async errors
 *
 * @example
 * router.get('/example', asyncHandler(async (req, res) => {
 *   const data = await someAsyncCall();
 *   res.json(data);
 * }));
 */
export function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

export default asyncHandler;
