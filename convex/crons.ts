import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.daily(
  "cleanup expired sessions",
  { hourUTC: 3, minuteUTC: 0 },
  internal.auth.cleanupExpiredSessions,
);

// MIS-285: purga diaria de códigos/tickets de recuperación de contraseña
// caducados o ya consumidos.
crons.daily(
  "cleanup expired reset codes",
  { hourUTC: 3, minuteUTC: 5 },
  internal.passwordReset.cleanupExpiredResetCodes,
);

export default crons;
