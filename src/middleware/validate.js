/**
 * Joi validation middleware factory.
 * Validates req.body against the provided schema.
 * On validation failure, responds 422 with structured error details.
 *
 * @param {import('joi').Schema} schema - Joi schema to validate against
 * @returns {import('express').RequestHandler}
 *
 * @example
 * router.post('/register', validate(registerSchema), asyncHandler(handler));
 */
export function validate(schema) {
  return (req, res, next) => {
    const { error, value } = schema.validate(req.body, {
      abortEarly: false,
      stripUnknown: true,
      convert: true,
    });

    if (error) {
      const details = error.details.map((d) => ({
        field: d.path.join('.'),
        message: d.message.replace(/['"]/g, ''),
      }));
      return res.status(422).json({
        error: 'VALIDATION_ERROR',
        message: 'Request body validation failed',
        details,
        requestId: req.id,
      });
    }

    // Replace req.body with the validated/sanitised value
    req.body = value;
    next();
  };
}

export default validate;
