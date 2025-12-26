// src/lib/server/metrics.ts
import { Metric } from "effect";

// A counter to track the number of successful user authentications via session.
export const sessionValidationSuccessCounter = Metric.counter(
  "user_session_validations_total",
  {
    description: "Counts successful session validations, indicating user logins.",
  },
);
