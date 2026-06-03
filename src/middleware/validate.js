// Validates req[source] against a zod schema and stores the parsed,
// type-coerced result on req.valid[source]. Errors bubble to errorHandler.
function validate(schema, source = 'query') {
  return (req, res, next) => {
    const result = schema.safeParse(req[source]);
    if (!result.success) return next(result.error);
    req.valid = req.valid || {};
    req.valid[source] = result.data;
    return next();
  };
}

const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

module.exports = { validate, asyncHandler };
