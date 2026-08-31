import type { ErrorRequestHandler } from "express";

type BodyParserError = SyntaxError & {
  status?: number;
  type?: string;
};

export const apiErrorHandler: ErrorRequestHandler = (
  err: unknown,
  req,
  res,
  next,
) => {
  if (res.headersSent) {
    next(err);
    return;
  }

  const parserError = err as BodyParserError;
  if (parserError?.status === 413 || parserError?.type === "entity.too.large") {
    res.status(413).json({
      error: {
        code: "PAYLOAD_TOO_LARGE",
        message: "The request body is too large.",
        retryable: false,
      },
    });
    return;
  }

  if (
    parserError?.type === "entity.parse.failed" ||
    (parserError instanceof SyntaxError && parserError.status === 400)
  ) {
    res.status(400).json({
      error: {
        code: "VALIDATION_ERROR",
        message: "The request body is not valid JSON.",
        retryable: false,
      },
    });
    return;
  }

  req.log.error({ err }, "Unhandled API error");
  res.status(500).json({
    error: {
      code: "INTERNAL_ERROR",
      message: "The request could not be completed.",
      retryable: true,
    },
  });
};
